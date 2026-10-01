/**
 * Bounded outbound HTTP (Orrery's "boundaries" pattern).
 *
 * MCPortal fetches URLs that users and agents choose (feeds, articles), which
 * makes it an SSRF target. Every request:
 *   - must be http(s) with no embedded credentials and no local hostnames;
 *   - may only CONNECT to public addresses. The check runs inside the socket's
 *     DNS lookup, so the address that is validated is the address that is used
 *     (no DNS-rebinding window between a check and the fetch);
 *   - follows at most a few redirects manually, re-checking each hop and
 *     dropping credentials when the host changes;
 *   - is capped in time and in *decompressed* bytes.
 *
 * Built on node:http/https so it stays dependency-free.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { pipeline, type Readable } from 'node:stream';
import zlib from 'node:zlib';
import type { FetchOptions, FetchResponse, Fetcher } from '../types.ts';
import { AppError, UpstreamError, upstreamStatus, type AppErrorOptions } from './errors.ts';
import { isPublicAddress } from './ip.ts';

export const USER_AGENT = 'MCPortal/0.4 (+https://github.com/lbliii/mcportal)';

/**
 * The fetch boundary refused or gave up. `code` says why: fetch_blocked (not a
 * public http(s) URL, or a redirect to one), fetch_timeout, or fetch_too_large.
 */
export class BoundaryError extends AppError {
  override name = 'BoundaryError';

  constructor(message: string, code: 'fetch_blocked' | 'fetch_timeout' | 'fetch_too_large' = 'fetch_blocked', options?: AppErrorOptions) {
    super(code, message, options);
  }
}

/** Backwards-compatible name used by tests and callers. */
export function isPrivateAddress(ip: string): boolean {
  return !isPublicAddress(ip);
}

/** Static checks that don't need DNS. Hostnames are checked again at connect time. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BoundaryError('Not a valid URL');
  }
  // Error messages never echo URL parts: they can reach the model, and URLs are attacker-chosen.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BoundaryError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new BoundaryError('URLs with embedded credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new BoundaryError('Refusing to fetch a local host');
  }
  if (isIP(host) && !isPublicAddress(host)) throw new BoundaryError('Refusing to fetch a non-public address');
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;

/** DNS lookup that refuses to hand a non-public address to the socket. */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number } | number, callback: LookupCallback): void {
  const opts = typeof options === 'number' ? { family: options } : options ?? {};
  dnsLookup(hostname, { family: opts.family ?? 0, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new BoundaryError('Refusing to connect to a non-public address') as NodeJS.ErrnoException);
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

function request(url: URL, method: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal): Promise<IncomingMessage> {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method, headers, lookup: guardedLookup as never, signal }, resolve);
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * Decompress with pipeline() so an abort, timeout or upstream error on the
 * socket also destroys the decompressor (a plain .pipe() would leave it
 * waiting forever on a stalled gzip stream).
 */
function decoded(res: IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  const decoder =
    encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
    : encoding === 'deflate' ? zlib.createInflate()
    : encoding === 'br' ? zlib.createBrotliDecompress()
    : undefined;
  if (!decoder) return res;
  pipeline(res, decoder, () => {});
  return decoder;
}

async function readCapped(stream: Readable, maxBytes: number, truncate: boolean, encoding: BufferEncoding = 'utf8'): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    if (total + buf.length > maxBytes) {
      stream.destroy();
      if (!truncate) throw new BoundaryError(`Response exceeded ${maxBytes} bytes`, 'fetch_too_large', { details: { maxBytes } });
      chunks.push(buf.subarray(0, maxBytes - total));
      return { text: Buffer.concat(chunks).toString(encoding), truncated: true };
    }
    total += buf.length;
    chunks.push(buf);
  }
  return { text: Buffer.concat(chunks).toString(encoding), truncated: false };
}

/** Decode and read a response body within a byte cap. Exported for tests. */
export function readResponse(res: IncomingMessage, maxBytes: number, truncate = false, binary = false): Promise<{ text: string; truncated: boolean }> {
  return readCapped(decoded(res), maxBytes, truncate, binary ? 'base64' : 'utf8');
}

const SENSITIVE = ['authorization', 'cookie', 'proxy-authorization'];

export const safeFetch: Fetcher = async (target: string, options: FetchOptions = {}): Promise<FetchResponse> => {
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let method = options.method ?? 'GET';
  let body = options.body;
  let headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    'accept-encoding': 'gzip, deflate, br',
    ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  let url = assertPublicUrl(target);
  const originalHost = url.host;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: IncomingMessage;
    try {
      res = await request(url, method, headers, body, signal);
    } catch (error) {
      if (error instanceof BoundaryError) throw error;
      if ((error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError') throw new BoundaryError(`Timed out fetching ${url.host}`, 'fetch_timeout', { cause: error });
      throw new UpstreamError('upstream_unreachable', `Could not reach ${url.host}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`, { cause: error });
    }
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      let next: URL;
      try {
        next = assertPublicUrl(new URL(res.headers.location, url).href);
      } catch {
        throw new BoundaryError(`${url.host} redirected to a disallowed URL`);
      }
      if (next.host !== originalHost) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !SENSITIVE.includes(k)));
      if (status === 303 || ((status === 301 || status === 302) && method !== 'GET')) {
        method = 'GET';
        body = undefined;
      }
      url = next;
      continue;
    }
    const { text, truncated } = await readResponse(res, maxBytes, options.truncate ?? false, options.binary ?? false);
    return { status, url: url.href, contentType: String(res.headers['content-type'] ?? ''), text, truncated };
  }
  throw new BoundaryError(`Too many redirects from ${new URL(target).host}`);
};

/** Fetch and parse JSON with errors that never echo upstream content. */
export async function fetchJson<T>(fetcher: Fetcher, url: string, options?: FetchOptions): Promise<T> {
  const res = await fetcher(url, options);
  const host = new URL(url).host;
  if (res.status < 200 || res.status >= 300) throw upstreamStatus(host, res.status);
  try {
    return JSON.parse(res.text) as T;
  } catch (error) {
    throw new UpstreamError('upstream_error', `${host} returned invalid JSON`, { cause: error });
  }
}
