/**
 * Random ids, secrets and hashes. Secrets (session cookies, one-time links, OAuth
 * codes) are only ever stored as their sha256Hex, and compared with safeEqual.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** An unguessable token, base64url. 24 bytes for short-lived links, 32 for sessions and grants. */
export function secretToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** A short random record id (not a secret): `prefix` plus 12 hex digits. */
export function shortId(prefix = ''): string {
  return `${prefix}${randomBytes(6).toString('hex')}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** Constant-time string comparison (for secrets and CSRF tokens). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
