/**
 * Where clips are kept: the ClipStore interface, and the in-process stores (memory for
 * tests, one JSON file per user locally) that hold a user's clips as one document.
 * Postgres has its own in src/db/clips.ts. Re-exported from clips.ts.
 */
import { writeRequest, replayReceipt, newReceipt, missingReplay, type WriteReceipt } from './write-receipts.ts';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CLIP_LIMITS, ClipError, clampLimit, normalizeTags, patchClip, queryWords, searchTextOf, summaryOf, type Clip, type ClipPatch, type ClipQuery, type ClipSummary } from './clips.ts';
import { atomicWrite, defaultDataDir, KeyedMutex, safeFileId } from './lib/files.ts';
import { matchesTerm } from './lib/search.ts';

export interface ClipStore {
  /**
   * Keep a clip built by buildClip, and resolve to the clip as stored: use that one
   * afterwards (a linked MCPortal's hosted server builds it again and assigns the id).
   * Throws ClipError when the user is at a limit.
   */
  add(userId: string, clip: Clip, requestKey?: string): Promise<Clip>;
  get(userId: string, id: string): Promise<Clip | undefined>;
  /** Newest first, without content. */
  list(userId: string, query?: ClipQuery): Promise<ClipSummary[]>;
  /** Metadata growth counts toward the byte cap; shrinking existing clips is always allowed. */
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
      && (!words.length || words.every((w) => searchTextOf(c).includes(w)))
      && (!query.exactTerms?.length || query.exactTerms.every(w => matchesTerm(searchTextOf(c), w))))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : query.exactTerms ? a.id.localeCompare(b.id) : 0))
    .slice(0, clampLimit(query.limit, 20, CLIP_LIMITS.perUser))
    .map(summaryOf);
}

/** Every store checks growth against the same caps. Updates pass a byte delta and zero new clips. */
export function clipQuotaProblem(usage: { count: number; bytes: number }, adding: number, addingCount = 1): string | undefined {
  if (addingCount > 0 && usage.count + addingCount > CLIP_LIMITS.perUser) return `You have ${CLIP_LIMITS.perUser} clips, the most MCPortal keeps. Delete some first.`;
  // Previously over-limit accounts must still be able to reduce their usage.
  if (adding > 0 && usage.bytes + adding > CLIP_LIMITS.bytesPerUser) return `Your clips use ${Math.round(usage.bytes / 1e6)} MB of the ${CLIP_LIMITS.bytesPerUser / 1e6} MB allowed. Delete some (large images first).`;
  return undefined;
}

/** A whole user's clips in one place (memory or one file), behind the store interface. */
interface ClipDocument { clips: Clip[]; receipts: WriteReceipt[] }
abstract class DocumentClipStore implements ClipStore {
  protected mutex = new KeyedMutex();
  protected lockKey(userId: string) { return userId; }
  protected abstract load(userId: string): Promise<ClipDocument>;
  protected abstract save(userId: string, doc: ClipDocument): Promise<void>;
  protected now: () => Date = () => new Date();

  private edit<T>(userId: string, change: (clips: Clip[], receipts: WriteReceipt[]) => { clips?: Clip[]; result: T }): Promise<T> {
    return this.mutex.run(this.lockKey(userId), async () => {
      const doc = await this.load(userId);
      doc.receipts = doc.receipts.filter(r => r.expiresAt > Date.now());
      const { clips, result } = change(doc.clips, doc.receipts);
      if (clips) await this.save(userId, { clips, receipts: doc.receipts });
      return result;
    });
  }

  add(userId: string, clip: Clip, requestKey?: string): Promise<Clip> {
    const request = writeRequest(requestKey, { kind: clip.kind, title: clip.title, note: clip.note, tags: clip.tags, source: clip.source, data: clip.data });
    return this.edit(userId, (clips, receipts) => {
      const prior = request ? replayReceipt(receipts, request) : undefined;
      if (prior) return { result: structuredClone(clips.find(c => c.id === prior) ?? missingReplay()) };
      const receipt = request ? newReceipt(request, clip.id, receipts) : undefined;
      const refused = clipQuotaProblem({ count: clips.length, bytes: clips.reduce((sum, c) => sum + c.bytes, 0) }, clip.bytes);
      if (refused) throw new ClipError(refused, 'limit_exceeded');
      if (receipt) receipts.push(receipt);
      return { clips: [clip, ...clips.filter((c) => c.id !== clip.id)], result: structuredClone(clip) };
    });
  }

  async get(userId: string, id: string): Promise<Clip | undefined> {
    const { clips } = await this.mutex.run(this.lockKey(userId), () => this.load(userId));
    return structuredClone(clips.find((c) => c.id === id));
  }

  async list(userId: string, query?: ClipQuery): Promise<ClipSummary[]> {
    return filterClips((await this.mutex.run(this.lockKey(userId), () => this.load(userId))).clips, query);
  }

  update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined> {
    return this.edit(userId, (clips) => {
      const at = clips.findIndex((c) => c.id === id);
      if (at === -1) return { result: undefined };
      const next = patchClip(clips[at]!, patch, this.now());
      const refused = clipQuotaProblem({ count: clips.length, bytes: clips.reduce((sum, c) => sum + c.bytes, 0) }, next.bytes - clips[at]!.bytes, 0);
      if (refused) throw new ClipError(refused, 'limit_exceeded');
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
    return this.edit(userId, (clips, receipts) => { receipts.length = 0; return { clips: [], result: clips.length }; });
  }

  async usage(userId: string): Promise<{ count: number; bytes: number }> {
    const { clips } = await this.mutex.run(this.lockKey(userId), () => this.load(userId));
    return { count: clips.length, bytes: clips.reduce((sum, c) => sum + c.bytes, 0) };
  }
}

export class MemoryClipStore extends DocumentClipStore {
  private data = new Map<string, ClipDocument>();

  protected async load(userId: string): Promise<ClipDocument> {
    return structuredClone(this.data.get(userId) ?? { clips: [], receipts: [] });
  }

  protected async save(userId: string, doc: ClipDocument): Promise<void> {
    this.data.set(userId, structuredClone(doc));
  }
}

/**
 * `<dataDir>/clips/<user>.json`, written atomically. A subdirectory, so the
 * Postgres import (top-level *.json only) never mistakes it for a profile.
 */
const fileClipMutex = new KeyedMutex();
export class FileClipStore extends DocumentClipStore {
  dir: string;

  constructor(dataDir = defaultDataDir()) {
    super();
    this.mutex = fileClipMutex;
    this.dir = path.join(dataDir, 'clips');
  }

  protected override lockKey(userId: string) { return this.file(userId); }
  private file(userId: string): string {
    return path.join(this.dir, `${safeFileId(userId)}.json`);
  }

  protected async load(userId: string): Promise<ClipDocument> {
    let raw: string;
    try {
      raw = await readFile(this.file(userId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { clips: [], receipts: [] };
      throw error;
    }
    const parsed = JSON.parse(raw) as ClipDocument;
    if (!Array.isArray(parsed.clips) || (parsed.receipts !== undefined && !Array.isArray(parsed.receipts))) throw new Error('Unreadable clips document');
    return { clips: parsed.clips, receipts: parsed.receipts ?? [] };
  }

  /** No clips, no file (deleting them all, or the account, leaves nothing behind). */
  protected async save(userId: string, doc: ClipDocument): Promise<void> {
    if (!doc.clips.length && !doc.receipts.length) return rm(this.file(userId), { force: true });
    await atomicWrite(this.file(userId), `${JSON.stringify({ version: 1, ...doc })}\n`);
  }
}
