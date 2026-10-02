/**
 * Handoffs: a page (and maybe a passage) sent from the room to a new chat
 * (docs/plans/attention.md, phase 2). Hosts can't open or message another conversation,
 * so the room stores a pointer under a short code, and the user says "Open MCPortal
 * handoff <code>" in a new chat. Codes are per account: someone else's code opens nothing.
 * Kept for HANDOFF_DAYS, at most HANDOFF_LIMIT per account (the oldest go first); deleted
 * with the account and not exported (they're pointers, not things the user made).
 */
import { randomInt } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './lib/errors.ts';
import { atomicWrite, defaultDataDir, KeyedMutex, removeStale } from './lib/files.ts';
import { sha256Hex } from './lib/ids.ts';
import { clean } from './lib/text.ts';
import { httpUrl } from './profile.ts';

export const HANDOFF_LIMIT = 50;
export const HANDOFF_DAYS = 7;
export const HANDOFF_PASSAGE_CHARS = 2000;
/** No 0/o, 1/l/i: codes are read aloud and retyped. */
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const CODE_LENGTH = 6;

/** Where to read the page: an article, or a page of a docs site (by portal or address). */
export type HandoffPlace = { kind: 'article' } | { kind: 'docs'; portalId?: string; docs?: string };

export interface Handoff {
  code: string;
  url: string;
  title: string;
  place: HandoffPlace;
  /** Where the user was: the block to scroll to, and the heading above it. */
  anchor?: { block?: number; heading?: string };
  /** The passage they selected, if any. */
  passage?: string;
  createdAt: string;
  expiresAt: string;
  openedAt?: string;
}

export type HandoffInput = Pick<Handoff, 'url' | 'title' | 'place'> & Partial<Pick<Handoff, 'anchor' | 'passage'>>;

export interface HandoffStore {
  create(userId: string, input: HandoffInput): Promise<Handoff>;
  /** An open (unexpired) handoff by code. */
  get(userId: string, code: string): Promise<Handoff | undefined>;
  /** Open handoffs, newest first. */
  list(userId: string): Promise<Handoff[]>;
  markOpened(userId: string, code: string): Promise<void>;
  deleteAll(userId: string): Promise<void>;
  /** Retention: remove expired handoffs. Stores that keep them elsewhere (a linked MCPortal's) leave it out. */
  purgeExpired?(): Promise<number>;
}

const invalid = (message: string) => new AppError('invalid_argument', message);

export function newHandoffCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** A code as people type it: case and spaces don't matter. */
export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) : '';
}

/** Check and trim what the room sends; build the stored record. */
export function buildHandoff(raw: Record<string, unknown>, now = new Date(), code = newHandoffCode()): Handoff {
  const url = httpUrl(raw.url);
  if (!url) throw invalid('A handoff needs the http(s) url of the page.');
  const title = clean(raw.title, 300) || url;
  const place = raw.place && typeof raw.place === 'object' ? raw.place as Record<string, unknown> : { kind: 'article' };
  let where: HandoffPlace;
  if (place.kind === 'docs') {
    const portalId = clean(place.portalId, 80), docs = clean(place.docs, 500);
    if (!portalId && !docs) throw invalid('A docs handoff needs the portalId or docs address it belongs to.');
    where = { kind: 'docs', ...(portalId ? { portalId } : {}), ...(docs ? { docs } : {}) };
  } else if (place.kind === 'article' || place.kind === undefined) where = { kind: 'article' };
  else throw invalid('place.kind must be article or docs.');
  const anchorIn = raw.anchor && typeof raw.anchor === 'object' ? raw.anchor as Record<string, unknown> : {};
  const block = typeof anchorIn.block === 'number' && Number.isInteger(anchorIn.block) && anchorIn.block >= 0 ? anchorIn.block : undefined;
  const heading = clean(anchorIn.heading, 300) || undefined;
  const passage = typeof raw.passage === 'string' ? raw.passage.replace(/\r\n?/g, '\n').trim().slice(0, HANDOFF_PASSAGE_CHARS) : '';
  return {
    code, url, title, place: where,
    ...(block !== undefined || heading ? { anchor: { ...(block !== undefined ? { block } : {}), ...(heading ? { heading } : {}) } } : {}),
    ...(passage ? { passage } : {}),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + HANDOFF_DAYS * 86_400_000).toISOString(),
  };
}

const open = (now: Date) => (h: Handoff) => h.expiresAt > now.toISOString();
const newestFirst = (a: Handoff, b: Handoff) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** The list after adding one: expired ones dropped, the newest HANDOFF_LIMIT kept, codes unique. */
function added(list: Handoff[], input: HandoffInput, now: Date): { list: Handoff[]; handoff: Handoff } {
  const live = list.filter(open(now));
  let handoff = buildHandoff(input as unknown as Record<string, unknown>, now);
  while (live.some((h) => h.code === handoff.code)) handoff = { ...handoff, code: newHandoffCode() };
  return { list: [handoff, ...live].sort(newestFirst).slice(0, HANDOFF_LIMIT), handoff };
}

/** One JSON list per account, under <data>/handoffs/. */
export class FileHandoffStore implements HandoffStore {
  private mutex = new KeyedMutex();
  private dir: string;
  private now: () => Date;
  constructor(dir = defaultDataDir(), now = () => new Date()) { this.dir = dir; this.now = now; }
  private file(userId: string) { return path.join(this.dir, 'handoffs', `${sha256Hex(userId)}.json`); }
  private async load(userId: string): Promise<Handoff[]> {
    try {
      const raw = JSON.parse(await readFile(this.file(userId), 'utf8'));
      if (!Array.isArray(raw)) throw new Error('Invalid handoffs document');
      return raw as Handoff[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  create(userId: string, input: HandoffInput) {
    return this.mutex.run(userId, async () => {
      const { list, handoff } = added(await this.load(userId), input, this.now());
      await atomicWrite(this.file(userId), JSON.stringify(list));
      return handoff;
    });
  }
  async get(userId: string, code: string) {
    const wanted = normalizeCode(code);
    return (await this.list(userId)).find((h) => h.code === wanted);
  }
  list(userId: string) {
    return this.mutex.run(userId, async () => (await this.load(userId)).filter(open(this.now())).sort(newestFirst));
  }
  markOpened(userId: string, code: string) {
    return this.mutex.run(userId, async () => {
      const list = await this.load(userId);
      const at = this.now().toISOString();
      const next = list.map((h) => (h.code === normalizeCode(code) ? { ...h, openedAt: at } : h));
      await atomicWrite(this.file(userId), JSON.stringify(next));
    });
  }
  deleteAll(userId: string) { return this.mutex.run(userId, () => rm(this.file(userId), { force: true })); }
  /**
   * A handoff expires HANDOFF_DAYS after it's created, and every write is a create or a
   * mark on an existing one, so a file not written since then holds nothing live.
   * (Expired handoffs in a file that's still in use go on its next write.)
   */
  purgeExpired() { return removeStale(path.join(this.dir, 'handoffs'), this.now().getTime() - HANDOFF_DAYS * 86_400_000); }
}

/** In memory, for tests. */
export class MemoryHandoffStore implements HandoffStore {
  private byUser = new Map<string, Handoff[]>();
  private now: () => Date;
  constructor(now = () => new Date()) { this.now = now; }
  async create(userId: string, input: HandoffInput) {
    const { list, handoff } = added(this.byUser.get(userId) ?? [], input, this.now());
    this.byUser.set(userId, list);
    return handoff;
  }
  async get(userId: string, code: string) { return (await this.list(userId)).find((h) => h.code === normalizeCode(code)); }
  async list(userId: string) { return (this.byUser.get(userId) ?? []).filter(open(this.now())).sort(newestFirst); }
  async markOpened(userId: string, code: string) {
    const at = this.now().toISOString();
    this.byUser.set(userId, (this.byUser.get(userId) ?? []).map((h) => (h.code === normalizeCode(code) ? { ...h, openedAt: at } : h)));
  }
  async deleteAll(userId: string) { this.byUser.delete(userId); }
  async purgeExpired() {
    let n = 0;
    for (const [user, list] of this.byUser) {
      const live = list.filter(open(this.now()));
      n += list.length - live.length;
      if (live.length) this.byUser.set(user, live); else this.byUser.delete(user);
    }
    return n;
  }
}
