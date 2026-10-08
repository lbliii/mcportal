/** Durable passage hints shared by quotes and collection entries. Never trust a block alone. */
import { AppError } from './lib/errors.ts';
export interface PassageLocator { heading?: string; block?: number; text: string }
export const LOCATOR_SCHEMA = { type: 'object', required: ['text'], additionalProperties: false, properties: {
  heading: { type: 'string', maxLength: 300 }, block: { type: 'integer', minimum: 0, maximum: 100000 }, text: { type: 'string', minLength: 3, maxLength: 300 },
} };
export function passageLocator(raw: unknown): PassageLocator | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('invalid_argument', 'Invalid passage locator.');
  const p = raw as PassageLocator;
  if (typeof p.text !== 'string' || p.text.trim().length < 3 || p.text.length > 300 || (p.heading !== undefined && (typeof p.heading !== 'string' || p.heading.length > 300)) || (p.block !== undefined && (!Number.isSafeInteger(p.block) || p.block < 0 || p.block > 100000))) throw new AppError('invalid_argument', 'A passage locator needs 3–300 characters of selected text and an optional heading or block.');
  return { text: p.text.trim(), ...(p.heading !== undefined ? { heading: p.heading } : {}), ...(p.block !== undefined ? { block: p.block } : {}) };
}
