/**
 * Where clips are kept: the ClipStore interface, and the in-process stores (memory for
 * tests, one JSON file per user locally) that hold a user's clips as one document.
 * Postgres has its own in src/db/clips.ts. Re-exported from clips.ts.
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CLIP_LIMITS, ClipError, clampLimit, normalizeTags, patchClip, queryWords, searchTextOf, summaryOf, type Clip, type ClipPatch, type ClipQuery, type ClipSummary } from './clips.ts';
import { atomicWrite, defaultDataDir, KeyedMutex, safeFileId } from './lib/files.ts';

export interface ClipStore {
  /**
   * Keep a clip built by buildClip, and resolve to the clip as stored: use that one
   * afterwards (a linked MCPortal's hosted server builds it again and assigns the id).
   * Throws ClipError when the user is at a limit.
   */
  add(userId: string, clip: Clip): Promise<Clip>;
  get(userId: string, id: string): Promise<Clip | undefined>;
  /** Newest first, without content. */
  list(userId: string, query?: ClipQuery): Promise<ClipSummary[]>;
  update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined>;
  delete(userId: string, id: string): Promise<boolean>;
  /** Every clip of the user (account deletion). Returns how many. */
  deleteAll(userId: string): Promise<number>;
  usage(userId: string): Promise<{ count: number; bytes: number }>;
}

/** Filtering shared by the in-process stores. */
export function filterClips(clips: Clip[], query: ClipQuery = {}): ClipSummary[] {
  const words = queryWords(query.query);
  const tag = query.tag ? normalizeTags([query.tag])[0] : undefined;
  return clips
    .filter((c) => (!query.kind || c.kind === query.kind)
      && (!tag || c.tags.includes(tag))
      && (!query.before || c.createdAt < query.before)
      && (!words.length || words.every((w) => searchTextOf(c).includes(w))))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, clampLimit(query.limit, 20, CLIP_LIMITS.perUser))
    .map(summaryOf);
}

/** Why a user at `usage` can't add `adding` more bytes of clips, or undefined if they can. Every store applies it. */
export function clipQuotaProblem(usage: { count: number; bytes: number }, adding: number): string | undefined {
  if (usage.count >= CLIP_LIMITS.perUser) return `You have ${CLIP_LIMITS.perUser} clips, the most MCPortal keeps. Delete some first.`;
  if (usage.bytes + adding > CLIP_LIMITS.bytesPerUser) return `Your clips use ${Math.round(usage.bytes / 1e6)} MB of the ${CLIP_LIMITS.bytesPerUser / 1e6} MB allowed. Delete some (large images first).`;
  return undefined;
}

/** A whole user's clips in one place (memory or one file), behind the store interface. */
abstract class DocumentClipStore implements ClipStore {
  private mutex = new KeyedMutex();
  protected abstract load(userId: string): Promise<Clip[]>;
  protected abstract save(userId: string, clips: Clip[]): Promise<void>;
  protected now: () => Date = () => new Date();

  private edit<T>(userId: string, change: (clips: Clip[]) => { clips?: Clip[]; result: T }): Promise<T> {
    return this.mutex.run(userId, async () => {
      const { clips, result } = change(await this.load(userId));
      if (clips) await this.save(userId, clips);
      return result;
    });
  }

  add(userId: string, clip: Clip): Promise<Clip> {
    return this.edit(userId, (clips) => {
      const refused = clipQuotaProblem({ count: clips.length, bytes: clips.reduce((sum, c) => sum + c.bytes, 0) }, clip.bytes);
      if (refused) throw new ClipError(refused, 'limit_exceeded');
      return { clips: [clip, ...clips.filter((c) => c.id !== clip.id)], result: structuredClone(clip) };
    });
  }

  async get(userId: string, id: string): Promise<Clip | undefined> {
    const clips = await this.mutex.run(userId, () => this.load(userId));
    return structuredClone(clips.find((c) => c.id === id));
  }

  async list(userId: string, query?: ClipQuery): Promise<ClipSummary[]> {
    return filterClips(await this.mutex.run(userId, () => this.load(userId)), query);
  }

  update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined> {
    return this.edit(userId, (clips) => {
      const at = clips.findIndex((c) => c.id === id);
      if (at === -1) return { result: undefined };
      const next = patchClip(clips[at]!, patch, this.now());
      return { clips: clips.map((c, i) => (i === at ? next : c)), result: structuredClone(next) };
    });
  }

  delete(userId: string, id: string): Promise<boolean> {
    return this.edit(userId, (clips) => {
      const rest = clips.filter((c) => c.id !== id);
      return rest.length === clips.length ? { result: false } : { clips: rest, result: true };
    });
  }

  deleteAll(userId: string): Promise<number> {
    return this.edit(userId, (clips) => ({ clips: [], result: clips.length }));
  }

  async usage(userId: string): Promise<{ count: number; bytes: number }> {
    const clips = await this.mutex.run(userId, () => this.load(userId));
    return { count: clips.length, bytes: clips.reduce((sum, c) => sum + c.bytes, 0) };
  }
}

export class MemoryClipStore extends DocumentClipStore {
  private data = new Map<string, Clip[]>();

  protected async load(userId: string): Promise<Clip[]> {
    return structuredClone(this.data.get(userId) ?? []);
  }

  protected async save(userId: string, clips: Clip[]): Promise<void> {
    this.data.set(userId, structuredClone(clips));
  }
}

/**
 * `<dataDir>/clips/<user>.json`, written atomically. A subdirectory, so the
 * Postgres import (top-level *.json only) never mistakes it for a profile.
 */
export class FileClipStore extends DocumentClipStore {
  dir: string;

  constructor(dataDir = defaultDataDir()) {
    super();
    this.dir = path.join(dataDir, 'clips');
  }

  private file(userId: string): string {
    return path.join(this.dir, `${safeFileId(userId)}.json`);
  }

  protected async load(userId: string): Promise<Clip[]> {
    let raw: string;
    try {
      raw = await readFile(this.file(userId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const parsed = JSON.parse(raw) as { clips?: unknown };
    return Array.isArray(parsed.clips) ? (parsed.clips as Clip[]) : [];
  }

  /** No clips, no file (deleting them all, or the account, leaves nothing behind). */
  protected async save(userId: string, clips: Clip[]): Promise<void> {
    if (!clips.length) return rm(this.file(userId), { force: true });
    await atomicWrite(this.file(userId), `${JSON.stringify({ version: 1, clips })}\n`);
  }
}
