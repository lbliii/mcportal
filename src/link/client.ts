/**
 * A linked local MCPortal's connection to its hosted account: the state API client.
 *
 * Calls made in the same tick go out as one batch (POST /api/v1/call), so a tool
 * that reads the room, seen sets and the feed at once pays one round trip. A 401 gets
 * one token refresh and a retry. Failures come back as AppErrors with the server's
 * code; not reaching the server at all is `upstream_unreachable`, with a message
 * meant for the user.
 */
import { API_EXPORT_PATH, API_IMPORT_PATH, API_MAX_CALLS, API_PATH, CLIENT_HEADER } from '../api/calls.ts';
import type { ImportResult } from '../portability.ts';
import { AppError, ERROR_CODES, type ErrorCode } from '../lib/errors.ts';
import { SERVER_INFO } from '../mcp.ts';

/** Where the bearer token comes from; phase 5's link file implements it with refresh. */
export interface LinkAuth {
  token(): Promise<string>;
  /** A fresh token after `rejected` was refused, or undefined if the link is gone (signed out or revoked). */
  refresh(rejected: string): Promise<string | undefined>;
}

export interface StateClientOptions {
  /** The hosted MCPortal, e.g. https://mcportal-production.up.railway.app */
  server: string;
  auth: LinkAuth;
  /** Defaults to the global fetch (keep-alive). */
  fetch?: typeof fetch;
  /** Per request. */
  timeoutMs?: number;
  /** Sent as mcportal-client; defaults to this package's version. */
  version?: string;
}

type Pending = { method: string; params: Record<string, unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void };
type Result = { id: number; result?: unknown; error?: { code: string; message: string; details?: Record<string, string | number | boolean> } };

const UNREACHABLE = "Can't reach your hosted MCPortal right now, so nothing was changed. Check the connection and try again.";

export class StateClient {
  private queue: Pending[] = [];
  private scheduled = false;
  private readonly fetch: typeof fetch;
  private readonly options: StateClientOptions;
  /** The hosted server's version, from its last answer (for "a newer MCPortal is out"). */
  serverVersion: string | undefined;

  constructor(options: StateClientOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
  }

  /** One method call; joins whatever else is called in the same tick. */
  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ method, params, resolve: resolve as (v: unknown) => void, reject });
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        const all = this.queue.splice(0);
        for (let i = 0; i < all.length; i += API_MAX_CALLS) void this.send(all.slice(i, i + API_MAX_CALLS));
      });
    });
  }

  private async send(batch: Pending[]): Promise<void> {
    try {
      const results = await this.post({ calls: batch.map((c, id) => ({ id, method: c.method, params: c.params })) });
      batch.forEach((c, id) => {
        const r = results.find((x) => x.id === id);
        if (!r) return c.reject(new AppError('upstream_error', 'Your hosted MCPortal gave an incomplete answer.'));
        if (r.error) return c.reject(new AppError(knownCode(r.error.code), r.error.message, r.error.details ? { details: r.error.details } : {}));
        c.resolve(r.result);
      });
    } catch (error) {
      for (const c of batch) c.reject(error);
    }
  }

  private async post(body: unknown): Promise<Result[]> {
    const res = await this.request(API_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({})) as { results?: Result[] };
    if (!Array.isArray(json.results)) throw new AppError('upstream_error', 'Your hosted MCPortal gave an answer MCPortal can\'t read.');
    return json.results;
  }

  /** A whole export from the hosted account, in any format. */
  async download(format: string): Promise<{ body: Buffer; filename: string; summary: string }> {
    const res = await this.request(`${API_EXPORT_PATH}?format=${encodeURIComponent(format)}`, { method: 'GET' }, 120_000);
    const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `mcportal-export.${format === 'mcportal' ? 'json' : 'bin'}`;
    return { body: Buffer.from(await res.arrayBuffer()), filename: filename.replace(/[^\w.-]/g, '_'), summary: clean(res.headers.get('x-mcportal-summary')) ?? 'your data' };
  }

  /** Add an MCPortal export to the hosted account, as the account page's import does. */
  async upload(exportJson: string): Promise<{ result: ImportResult; summary: string }> {
    const res = await this.request(API_IMPORT_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: exportJson }, 120_000);
    return await res.json() as { result: ImportResult; summary: string };
  }

  /**
   * One authenticated request: a refused token gets one refresh and a retry, and every
   * failure becomes an AppError with a message for the user. Resolves only on 2xx.
   */
  private async request(pathAndQuery: string, init: RequestInit & { headers?: Record<string, string> }, timeoutMs = this.options.timeoutMs ?? 15_000): Promise<Response> {
    let token = await this.options.auth.token();
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(new URL(pathAndQuery, this.options.server), {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}`, [CLIENT_HEADER]: this.options.version ?? SERVER_INFO.version },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new AppError('upstream_unreachable', UNREACHABLE, { cause: error });
      }
      this.serverVersion = res.headers.get('mcportal-server') ?? this.serverVersion;
      if (res.status === 401 && attempt === 0) {
        const fresh = await this.options.auth.refresh(token);
        if (fresh) { token = fresh; continue; }
      }
      if (res.ok) return res;
      const json = await res.json().catch(() => ({})) as { error?: string; error_description?: string };
      if (res.status === 401) throw new AppError('unauthenticated', 'This computer is no longer signed in to your hosted MCPortal. Sign in again to keep using it.');
      if (res.status === 426) throw new AppError('unavailable', clean(json.error_description) ?? 'Update MCPortal to keep using your linked portal.');
      if (res.status === 429) throw new AppError('rate_limited', 'Your hosted MCPortal is busy; try again in a minute.');
      if (res.status === 400 && json.error && Object.hasOwn(ERROR_CODES, json.error)) throw new AppError(knownCode(json.error), clean(json.error_description) ?? 'Your hosted MCPortal refused that.');
      throw new AppError('upstream_error', `Your hosted MCPortal answered ${res.status}.`);
    }
  }
}

function knownCode(code: string): ErrorCode {
  return Object.hasOwn(ERROR_CODES, code) ? (code as ErrorCode) : 'upstream_error';
}

function clean(text: unknown): string | undefined {
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 300) : undefined;
}
