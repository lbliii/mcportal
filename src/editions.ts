/**
 * The room's edition: the agent's latest highlights, kept so the room can lead with them
 * (docs/plans/room-layouts.md, phase 3). show_highlights stores one per account,
 * replacing the last; it lasts EDITION_HOURS. Only the agent's own words are kept (title,
 * intro, a reason per pick) and refs to items: open_room finds each pick among the room's
 * current items and drops the ones that have left their feed, so no site text is stored.
 * Deleted with the account; not exported (it's state, not something the user made).
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, defaultDataDir, KeyedMutex } from './lib/files.ts';
import { sha256Hex } from './lib/ids.ts';

export const EDITION_HOURS = 24;

export interface Edition {
  title: string;
  intro?: string;
  /** In the agent's order: the first leads. Refs as list_new_items gives them. */
  picks: Array<{ ref: string; why: string }>;
  createdAt: string;
  expiresAt: string;
}

export interface EditionStore {
  /** The account's edition, unless it has expired. */
  get(userId: string): Promise<Edition | undefined>;
  put(userId: string, edition: Edition): Promise<void>;
  deleteAll(userId: string): Promise<void>;
}

export function buildEdition(input: Pick<Edition, 'title' | 'intro' | 'picks'>, now = new Date()): Edition {
  return {
    title: input.title,
    ...(input.intro ? { intro: input.intro } : {}),
    picks: input.picks.map(({ ref, why }) => ({ ref, why })),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EDITION_HOURS * 3_600_000).toISOString(),
  };
}

const live = (edition: Edition | undefined, now: Date) => (edition && edition.expiresAt > now.toISOString() ? edition : undefined);

/** One JSON document per account, under <data>/editions/. */
export class FileEditionStore implements EditionStore {
  private mutex = new KeyedMutex();
  private dir: string;
  private now: () => Date;
  constructor(dir = defaultDataDir(), now = () => new Date()) { this.dir = dir; this.now = now; }
  private file(userId: string) { return path.join(this.dir, 'editions', `${sha256Hex(userId)}.json`); }
  get(userId: string) {
    return this.mutex.run(userId, async () => {
      try {
        const raw = JSON.parse(await readFile(this.file(userId), 'utf8'));
        return live(raw && typeof raw === 'object' && Array.isArray(raw.picks) ? raw as Edition : undefined, this.now());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    });
  }
  put(userId: string, edition: Edition) { return this.mutex.run(userId, () => atomicWrite(this.file(userId), JSON.stringify(edition))); }
  deleteAll(userId: string) { return this.mutex.run(userId, () => rm(this.file(userId), { force: true })); }
}

/** In memory, for tests. */
export class MemoryEditionStore implements EditionStore {
  private byUser = new Map<string, Edition>();
  private now: () => Date;
  constructor(now = () => new Date()) { this.now = now; }
  async get(userId: string) { return live(this.byUser.get(userId), this.now()); }
  async put(userId: string, edition: Edition) { this.byUser.set(userId, edition); }
  async deleteAll(userId: string) { this.byUser.delete(userId); }
}
