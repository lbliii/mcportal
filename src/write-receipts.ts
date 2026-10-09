/** Bounded account/operation-scoped receipts. Retained for seven days, including deletion tombstones. */
import { createHash } from 'node:crypto';
import { AppError } from './lib/errors.ts';
export const REQUEST_KEY_SCHEMA = { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' };
export const RECEIPT_DAYS = 7;
export const RECEIPT_LIMIT = 2000;
export interface WriteReceipt { key: string; fingerprint: string; id: string; expiresAt: number }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,stable(v)]));
  return value;
}
export function writeRequest(key: string | undefined, payload: unknown): Pick<WriteReceipt, 'key' | 'fingerprint'> | undefined {
  if (key === undefined) return undefined;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError('invalid_argument', 'requestKey needs 8–100 letters, digits, underscores or hyphens.');
  return { key: hash(key), fingerprint: hash(JSON.stringify(stable(payload))) };
}
export function replayReceipt(receipts: WriteReceipt[], request: Pick<WriteReceipt, 'key' | 'fingerprint'>): string | undefined {
  const found = receipts.find(r => r.key === request.key && r.expiresAt > Date.now());
  if (!found) return undefined;
  if (found.fingerprint !== request.fingerprint) throw new AppError('conflict', 'This requestKey was already used for different content. Use a new key for a new action.');
  return found.id;
}
export function newReceipt(request: Pick<WriteReceipt, 'key' | 'fingerprint'>, id: string, receipts: WriteReceipt[]): WriteReceipt {
  if (receipts.filter(r => r.expiresAt > Date.now()).length >= RECEIPT_LIMIT) throw new AppError('limit_exceeded', 'Too many recent write requests. Retry existing keys or wait for receipts to expire.');
  return { ...request, id, expiresAt: Date.now() + RECEIPT_DAYS * 86400000 };
}
export function missingReplay(): never { throw new AppError('failed_precondition', 'The original result was deleted. This retry will not create it again; use a new requestKey for an intentional new action.'); }
