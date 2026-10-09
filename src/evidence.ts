/** Durable passage hints shared by quotes and collection entries. Never trust a block alone. */
import { AppError } from './lib/errors.ts';
export interface PassageLocator { heading?: string; block?: number; text: string; prefix?: string; suffix?: string; digest?: string; revision?: string }
export const LOCATOR_SCHEMA = { type: 'object', required: ['text'], additionalProperties: false, properties: {
  prefix: { type: 'string', maxLength: 120 }, suffix: { type: 'string', maxLength: 120 }, digest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, revision: { type: 'string', maxLength: 200 },
  heading: { type: 'string', maxLength: 300 }, block: { type: 'integer', minimum: 0, maximum: 100000 }, text: { type: 'string', minLength: 3, maxLength: 300 },
} };
export function passageLocator(raw: unknown): PassageLocator | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('invalid_argument', 'Invalid passage locator.');
  const p = raw as PassageLocator;
  if (typeof p.text !== 'string' || p.text.trim().length < 3 || p.text.length > 300 || (p.heading !== undefined && (typeof p.heading !== 'string' || p.heading.length > 300)) || (p.block !== undefined && (!Number.isSafeInteger(p.block) || p.block < 0 || p.block > 100000))) throw new AppError('invalid_argument', 'A passage locator needs 3–300 characters of selected text and an optional heading or block.');
  for (const key of ['prefix', 'suffix', 'revision'] as const) {
    if (p[key] !== undefined && (typeof p[key] !== 'string' || p[key].length > (key === 'revision' ? 200 : 120))) throw new AppError('invalid_argument', `Invalid passage ${key}.`);
  }
  if (p.digest !== undefined && (typeof p.digest !== 'string' || !/^[a-f0-9]{64}$/.test(p.digest))) throw new AppError('invalid_argument', 'Invalid passage digest.');
  return { ...(p.prefix !== undefined ? { prefix: p.prefix } : {}), ...(p.suffix !== undefined ? { suffix: p.suffix } : {}), ...(p.digest !== undefined ? { digest: p.digest } : {}), ...(p.revision !== undefined ? { revision: p.revision } : {}), text: p.text.trim(), ...(p.heading !== undefined ? { heading: p.heading } : {}), ...(p.block !== undefined ? { block: p.block } : {}) };
}
