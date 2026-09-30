/**
 * Bounded outbound HTTP, borrowed from Orrery's "boundaries" pattern.
 *
 * MCPortal fetches URLs that users (and, indirectly, agents) choose: RSS feeds
 * and articles. That makes it an SSRF target, so every request:
 *   - must be http(s) with no embedded credentials,
 *   - must resolve only to public IP addresses (checked on every redirect hop),
 *   - follows at most a few redirects, manually,
 *   - is capped in size and time.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FetchOptions, FetchResponse, Fetcher } from '../types.ts';

export const USER_AGENT = 'MCPortal/0.1 (+https://github.com/lbliii/mcportal)';

export class BoundaryError extends Error {
  override name = 'BoundaryError';
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  return true;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BoundaryError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BoundaryError(`Only http(s) URLs are allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new BoundaryError('URLs with embedded credentials are not allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BoundaryError(`Refusing to fetch local host: ${host}`);
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new BoundaryError(`Refusing to fetch non-public address for ${host}`);
  }
  return url;
}

async function readCapped(res: Response, maxBytes: number, truncate: boolean): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      if (!truncate) {
        await reader.cancel();
        throw new BoundaryError(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

export const safeFetch: Fetcher = async (target: string, options: FetchOptions = {}): Promise<FetchResponse> => {
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 2_000_000;
  let current = target;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      headers: { 'user-agent': USER_AGENT, ...options.headers },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new BoundaryError(`Redirect without location from ${current}`);
      current = new URL(location, current).href;
      continue;
    }
    const { text, truncated } = await readCapped(res, maxBytes, options.truncate ?? false);
    return {
      status: res.status,
      url: current,
      contentType: res.headers.get('content-type') ?? '',
      text,
      truncated,
    };
  }
  throw new BoundaryError(`Too many redirects starting at ${target}`);
};

/** Fetch and parse JSON, raising a readable error on non-2xx responses. */
export async function fetchJson<T>(fetcher: Fetcher, url: string, options?: FetchOptions): Promise<T> {
  const res = await fetcher(url, options);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${new URL(url).host} responded ${res.status}`);
  }
  return JSON.parse(res.text) as T;
}
