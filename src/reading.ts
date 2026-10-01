/** Durable activity, deliberately separate from layout/preferences. */
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, defaultDataDir, KeyedMutex } from './store.ts';

export interface ReadingState {
  url: string;
  status: 'seen' | 'opened' | 'read';
  title?: string;
  lastSeenAt: string;
  lastOpenedAt?: string;
  readAt?: string;
  anchor?: { heading?: string; block?: number };
  progress?: number;
}
export interface ReadingUpdate {
  url: string;
  status: ReadingState['status'];
  title?: string;
  anchor?: ReadingState['anchor'] | null;
  progress?: number;
}
export interface ReadingStore {
  get(userId: string, url: string): Promise<ReadingState | undefined>;
  record(userId: string, update: ReadingUpdate): Promise<ReadingState>;
  list(userId: string, options?: { unfinished?: boolean; limit?: number }): Promise<ReadingState[]>;
  import(userId: string, states: unknown[]): Promise<number>;
  deleteAll(userId: string): Promise<void>;
}
export const READING_LIMIT = 1000;
export function canonicalReadingUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Reading URL must be an HTTP(S) URL of at most 4096 characters.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Reading URL must be HTTP(S), without credentials.');
  url.hash = '';
  return url.href;
}
export function validateReadingUpdate(raw: ReadingUpdate): ReadingUpdate {
  const url = canonicalReadingUrl(raw.url);
  if (!['seen', 'opened', 'read'].includes(raw.status)) throw new Error('status must be seen, opened or read');
  if (raw.progress !== undefined && (!Number.isFinite(raw.progress) || raw.progress < 0 || raw.progress > 1)) throw new Error('progress must be between 0 and 1');
  if (raw.status === 'seen' && (raw.anchor !== undefined || raw.progress !== undefined)) throw new Error('seen does not change reading position');
  let anchor = raw.anchor;
  if (anchor != null) {
    if (typeof anchor !== 'object' || Array.isArray(anchor) || (anchor.block !== undefined && (!Number.isSafeInteger(anchor.block) || anchor.block < 0))) throw new Error('anchor.block must be a nonnegative integer');
    if (anchor.heading !== undefined && (typeof anchor.heading !== 'string' || anchor.heading.length > 300)) throw new Error('anchor.heading must be at most 300 characters');
    anchor = { ...(anchor.heading !== undefined ? { heading: anchor.heading } : {}), ...(anchor.block !== undefined ? { block: anchor.block } : {}) };
  }
  if (raw.title !== undefined && (typeof raw.title !== 'string' || raw.title.length > 300)) throw new Error('title must be at most 300 characters');
  return { url, status: raw.status, ...(raw.title !== undefined ? { title: raw.title } : {}), ...(anchor !== undefined ? { anchor } : {}), ...(raw.progress !== undefined ? { progress: raw.progress } : {}) };
}
export function nextReading(previous: ReadingState | undefined, input: ReadingUpdate, now = new Date().toISOString()): ReadingState {
  const update = validateReadingUpdate(input);
  const next: ReadingState = { ...previous, url: update.url, status: update.status === 'seen' && previous ? previous.status : update.status, lastSeenAt: now };
  if (update.title !== undefined) next.title = update.title;
  if (update.status !== 'seen') next.lastOpenedAt = now;
  if (update.status === 'read') { next.readAt = now; next.progress = 1; }
  if (update.status === 'opened') { delete next.readAt; if (update.progress !== undefined) next.progress = update.progress; }
  if (update.anchor === null) delete next.anchor;
  else if (update.anchor !== undefined) next.anchor = update.anchor;
  return next;
}
export function readingList(states: ReadingState[], options: { unfinished?: boolean; limit?: number } = {}): ReadingState[] {
  const limit = Math.min(READING_LIMIT, Math.max(1, Math.floor(Number(options.limit) || 20)));
  return states.filter(s => !options.unfinished || s.status === 'opened').sort((a,b) => (b.lastOpenedAt ?? b.lastSeenAt).localeCompare(a.lastOpenedAt ?? a.lastSeenAt) || a.url.localeCompare(b.url)).slice(0, limit);
}
export function importedReading(raw: unknown): ReadingState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid reading record');
  const value = raw as ReadingState;
  const validated = validateReadingUpdate(value);
  const result: ReadingState = { url: validated.url, status: validated.status, lastSeenAt: timestamp(value.lastSeenAt) };
  if (validated.title !== undefined) result.title = validated.title;
  if (validated.anchor) result.anchor = validated.anchor;
  if (validated.progress !== undefined) result.progress = validated.progress;
  if (value.lastOpenedAt !== undefined) result.lastOpenedAt = timestamp(value.lastOpenedAt);
  if (value.readAt !== undefined) result.readAt = timestamp(value.readAt);
  if (result.status !== 'seen' && !result.lastOpenedAt) throw new Error('Opened/read record requires lastOpenedAt');
  if (result.status === 'read') { if (!result.readAt) throw new Error('Read record requires readAt'); result.progress = 1; }
  return result;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid reading timestamp');
  return new Date(value).toISOString();
}
export class FileReadingStore implements ReadingStore {
  private mutex = new KeyedMutex();
  private dir: string;
  constructor(dir = defaultDataDir()) { this.dir = dir; }
  private file(userId: string) { return path.join(this.dir, 'reading', createHash('sha256').update(userId).digest('hex') + '.json'); }
  private async load(userId: string): Promise<ReadingState[]> {
    try { const raw = JSON.parse(await readFile(this.file(userId), 'utf8')); if (!Array.isArray(raw) || raw.length > READING_LIMIT) throw new Error('Invalid reading document'); return raw.map(importedReading); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async get(userId: string, url: string) { const canonical = canonicalReadingUrl(url); return this.mutex.run(userId, async () => (await this.load(userId)).find(s => s.url === canonical)); }
  async list(userId: string, options = {}) { return this.mutex.run(userId, async () => readingList(await this.load(userId), options)); }
  record(userId: string, input: ReadingUpdate) { return this.mutex.run(userId, async () => {
    const update = validateReadingUpdate(input); const states = await this.load(userId);
    const next = nextReading(states.find(s => s.url === update.url), update);
    const all = readingList([next, ...states.filter(s => s.url !== update.url)], { limit: READING_LIMIT });
    await atomicWrite(this.file(userId), JSON.stringify(all)); return next;
  }); }
  import(userId: string, raw: unknown[]) { return this.mutex.run(userId, async () => {
    if (raw.length > READING_LIMIT) throw new Error('Too many reading records');
    const incoming = raw.map(importedReading); const states = await this.load(userId); const urls = new Set(states.map(s => s.url));
    const fresh = incoming.filter(s => { if (urls.has(s.url)) return false; urls.add(s.url); return true; }).slice(0, READING_LIMIT - states.length);
    await atomicWrite(this.file(userId), JSON.stringify([...states, ...fresh])); return fresh.length;
  }); }
  deleteAll(userId: string) { return this.mutex.run(userId, () => rm(this.file(userId), { force: true })); }
}
