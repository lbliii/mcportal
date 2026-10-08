/**
 * What the user has seen in each portal, so "new" means new to them
 * (docs/explanation/reading.md, phase 3). Kept apart from reading history: that holds 1,000
 * records an account, and feed items would push real reading out within days.
 *
 * A portal's seen set is its items' ids, hashed (12 hex characters), at most
 * SEEN_PER_PORTAL with the oldest dropped first. The first time a portal is shown, every
 * item it shows becomes the baseline, so a first visit isn't a flood of "new"; from then
 * on the room adds the items that stay on screen, and the ones the user opens. Removing a
 * portal drops its set; deleting the account deletes them all. Not exported: it's state,
 * not something the user made.
 */
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, defaultDataDir, KeyedMutex } from './lib/files.ts';
import { sha256Hex } from './lib/ids.ts';
import type { PortalResult, SourceKind } from './types.ts';

export const SEEN_PER_PORTAL = 500;
/** One mark_seen call: at most this many portals, and items per portal. */
export const SEEN_BATCH = { portals: 40, items: 100 };

/** Your own portals (what you saved or clipped) have nothing new to tell you. */
const UNTRACKED: ReadonlySet<SourceKind> = new Set(['saved', 'clips', 'people']);
export const tracksSeen = (source: SourceKind) => !UNTRACKED.has(source);

/** An item id as stored: short, and nothing the site wrote. */
export const seenHash = (itemId: string) => createHash('sha256').update(itemId).digest('hex').slice(0, 12);

export interface SeenStore {
  /** Each portal's seen set (hashes), for the portals asked about that have one. */
  get(userId: string, portalIds: string[]): Promise<Map<string, Set<string>>>;
  /** Add item ids (raw; hashed here) to portals' sets, creating sets as needed. */
  mark(userId: string, marks: Array<{ portalId: string; itemIds: string[] }>): Promise<void>;
  /** Drop the sets of portals no longer in the room. */
  keepOnly(userId: string, portalIds: string[]): Promise<void>;
  deleteAll(userId: string): Promise<void>;
}

/** A set with these hashes added, newest last, capped. */
export function mergeSeen(current: string[], hashes: string[]): string[] {
  const fresh = hashes.filter((h, i) => !current.includes(h) && hashes.indexOf(h) === i);
  return [...current, ...fresh].slice(-SEEN_PER_PORTAL);
}

type SeenDocument = Record<string, { ids: string[]; at: string }>;

/** One JSON document per account, under <data>/seen/ (or in memory, given null). */
export class FileSeenStore implements SeenStore {
  private mutex = new KeyedMutex();
  private dir: string | null;
  private memory = new Map<string, SeenDocument>();
  /** null: kept in memory (tests). Not undefined, which would mean the default directory. */
  constructor(dir: string | null = defaultDataDir()) { this.dir = dir; }
  private file(userId: string) { return path.join(this.dir!, 'seen', `${sha256Hex(userId)}.json`); }
  private async load(userId: string): Promise<SeenDocument> {
    if (!this.dir) return this.memory.get(userId) ?? {};
    try {
      const raw = JSON.parse(await readFile(this.file(userId), 'utf8'));
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as SeenDocument : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  private async save(userId: string, doc: SeenDocument) {
    if (!this.dir) this.memory.set(userId, doc);
    else await atomicWrite(this.file(userId), JSON.stringify(doc));
  }
  get(userId: string, portalIds: string[]) {
    return this.mutex.run(userId, async () => {
      const doc = await this.load(userId);
      return new Map(portalIds.filter((id) => doc[id]).map((id) => [id, new Set(doc[id]!.ids)]));
    });
  }
  mark(userId: string, marks: Array<{ portalId: string; itemIds: string[] }>) {
    return this.mutex.run(userId, async () => {
      const doc = await this.load(userId);
      const at = new Date().toISOString();
      for (const { portalId, itemIds } of marks) doc[portalId] = { ids: mergeSeen(doc[portalId]?.ids ?? [], itemIds.map(seenHash)), at };
      await this.save(userId, doc);
    });
  }
  keepOnly(userId: string, portalIds: string[]) {
    return this.mutex.run(userId, async () => {
      const doc = await this.load(userId);
      const gone = Object.keys(doc).filter((id) => !portalIds.includes(id));
      if (!gone.length) return;
      for (const id of gone) delete doc[id];
      await this.save(userId, doc);
    });
  }
  deleteAll(userId: string) {
    return this.mutex.run(userId, async () => {
      this.memory.delete(userId);
      if (this.dir) await rm(this.file(userId), { force: true });
    });
  }
}

/**
 * Mark what's new in these portals: items not in their seen sets get `new: true`, and
 * each portal its `newCount`. A tracked portal with no set yet is shown for the first
 * time: its items become the baseline, and nothing in it is new.
 */
export async function withNews(portals: PortalResult[], userId: string, store: SeenStore | undefined): Promise<PortalResult[]> {
  if (!store) return portals;
  const tracked = portals.filter((p) => tracksSeen(p.source) && !p.error);
  if (!tracked.length) return portals;
  const sets = await store.get(userId, tracked.map((p) => p.portalId));
  const baseline = tracked.filter((p) => !sets.has(p.portalId) && p.items.length);
  if (baseline.length) await store.mark(userId, baseline.map((p) => ({ portalId: p.portalId, itemIds: p.items.map((i) => i.id) })));
  return portals.map((portal) => {
    const seen = sets.get(portal.portalId);
    if (!seen || !tracksSeen(portal.source) || portal.error) return portal;
    const items = portal.items.map((item) => (seen.has(seenHash(item.id)) ? item : { ...item, new: true as const }));
    return { ...portal, items, newCount: items.filter((i) => i.new).length };
  });
}
