/**
 * Small HTTP helpers shared by the hosted pages and endpoints (OAuth, account,
 * admin, the public site): bounded body readers, cookies, and responses with the
 * headers every page here wants (no caching, no framing, no referrer).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from './errors.ts';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * The request body, at most `max` bytes. A larger one (declared or actual) throws
 * limit_exceeded before more of it is read.
 */
export async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) throw new AppError('limit_exceeded', 'Request body too large', { details: { max } });
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new AppError('limit_exceeded', 'Request body too large', { details: { max } });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** A url-encoded form body. */
export async function readForm(req: IncomingMessage, max: number): Promise<URLSearchParams> {
  return new URLSearchParams((await readBody(req, max)).toString('utf8'));
}

/** A JSON object body ({} when empty). Anything else is invalid_argument. */
export async function readJson(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  const raw = (await readBody(req, max)).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch (error) {
    throw new AppError('invalid_argument', 'Body is not valid JSON', { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new AppError('invalid_argument', 'Body must be a JSON object');
  return parsed as Record<string, unknown>;
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Whether a browser request came from one of our own pages (Origin, or Sec-Fetch-Site without one). */
export function sameOrigin(req: IncomingMessage, publicUrl: string): boolean {
  const origin = req.headers.origin;
  if (origin) return origin === new URL(publicUrl).origin;
  return req.headers['sec-fetch-site'] === 'same-origin';
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', ...extra });
  res.end(JSON.stringify(body));
}

/** A JSON error in the OAuth shape every endpoint here uses: { error: code, error_description: message }. */
export function sendJsonError(res: ServerResponse, status: number, code: string, message: string, extra: Record<string, string> = {}): void {
  sendJson(res, status, { error: code, error_description: message }, extra);
}

export function sendHtml(res: ServerResponse, status: number, html: string, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    // No form-action: Chrome applies it to the post-submit redirect (to GitHub or back to the client).
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    // Not no-referrer: under it a browser sends `Origin: null` with a form POST, and every
    // form here is checked for a same-origin Origin. same-origin still sends other sites nothing.
    'referrer-policy': 'same-origin',
    ...extra,
  });
  res.end(html);
}

export function redirect(res: ServerResponse, location: string, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(302, { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...extra });
  res.end();
}
