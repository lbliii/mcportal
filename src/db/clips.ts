/** Clips in mcportal_clips: content in `data`, everything else in `summary` for lists. */
import { pgWriteReceipt } from './write-receipts.ts';
import { missingReplay } from '../write-receipts.ts';
import { clipQuotaProblem } from '../clip-stores.ts';
import { CLIP_LIMITS, ClipError, clampLimit, normalizeTags, patchClip, queryWords, searchTextOf, summaryOf, type Clip, type ClipPatch, type ClipQuery, type ClipStore, type ClipSummary } from '../clips.ts';
import { exactTermPattern } from '../lib/search.ts';
import { transaction, type Queryable } from './schema.ts';

/** Escape LIKE wildcards so a search word matches literally. */
function likeWord(word: string): string {
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Clips in mcportal_clips. Every query is scoped by user_id. */
export class PgClipStore implements ClipStore {
  private db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  /** All account writes share a transaction lock, including the first clip (no row yet). */
  private edit<T>(userId: string, change: (store: PgClipStore) => Promise<T>): Promise<T> {
    return transaction(this.db, async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`clips:${userId}`]);
      // Reads and writes must use this connection after acquiring the lock.
      return change(new PgClipStore(tx));
    });
  }

  add(userId: string, clip: Clip, requestKey?: string): Promise<Clip> {
    return this.edit(userId, store => pgWriteReceipt(store.db, userId, 'clip', requestKey,
      { kind: clip.kind, title: clip.title, note: clip.note, tags: clip.tags, source: clip.source, data: clip.data },
      async id => (await store.get(userId, id)) ?? missingReplay(), async () => {
      const refused = clipQuotaProblem(await store.usage(userId), clip.bytes);
      if (refused) throw new ClipError(refused, 'limit_exceeded');
      await store.db.query(
        `INSERT INTO mcportal_clips (id, user_id, kind, title, data, summary, tags, search_text, bytes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [clip.id, userId, clip.kind, clip.title, JSON.stringify(clip.data), JSON.stringify(summaryOf(clip)), clip.tags, searchTextOf(clip), clip.bytes, clip.createdAt, clip.updatedAt],
      );
      return { id: clip.id, result: clip };
    }));
  }

  async get(userId: string, id: string): Promise<Clip | undefined> {
    const { rows } = await this.db.query<{ summary: ClipSummary; data: Clip['data'] }>(`SELECT summary, data FROM mcportal_clips WHERE user_id = $1 AND id = $2`, [userId, id]);
    return rows.length ? { ...rows[0]!.summary, data: rows[0]!.data } : undefined;
  }

  async list(userId: string, query: ClipQuery = {}): Promise<ClipSummary[]> {
    const where = ['user_id = $1'];
    const values: unknown[] = [userId];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replace('?', `$${values.length}`));
    };
    if (query.kind) add('kind = ?', query.kind);
    const tag = query.tag ? normalizeTags([query.tag])[0] : undefined;
    if (tag) add('? = ANY(tags)', tag);
    if (query.before && !Number.isNaN(Date.parse(query.before))) add('created_at < ?', query.before);
    if (query.exactTerms?.length) add('search_text ~ ALL(?::text[])', query.exactTerms.map(term => exactTermPattern(term, true)));
    const words = queryWords(query.query);
    let order = 'created_at DESC, id ASC';
    if (words.length && words.every((word) => /^[\p{L}\p{N}]+$/u.test(word))) {
      values.push(words.join(' '));
      const fullText = `plainto_tsquery('english'::regconfig, $${values.length})`;
      values.push(words.map(likeWord));
      // Keep literal substring/punctuation and stopword-only queries useful while
      // also matching inflections. Parameters never become tsquery syntax.
      where.push(`(search_vector @@ ${fullText} OR search_text LIKE ALL($${values.length}::text[]))`);
      order = `ts_rank_cd(search_vector, ${fullText}) DESC, created_at DESC, id ASC`;
    } else if (words.length) {
      // Signs and identifier punctuation are literal, rather than silently
      // discarded by the full-text parser (e.g. 100% must not match 100).
      add(`search_text LIKE ALL(?::text[])`, words.map(likeWord));
    }
    values.push(clampLimit(query.limit, 20, CLIP_LIMITS.perUser));
    const { rows } = await this.db.query<{ summary: ClipSummary }>(
      `SELECT summary FROM mcportal_clips WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${values.length}`,
      values,
    );
    return rows.map((r) => r.summary);
  }

  update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined> {
    return this.edit(userId, async store => {
      const clip = await store.get(userId, id);
      if (!clip) return undefined;
      const next = patchClip(clip, patch);
      const refused = clipQuotaProblem(await store.usage(userId), next.bytes - clip.bytes, 0);
      if (refused) throw new ClipError(refused, 'limit_exceeded');
      await store.db.query(
        `UPDATE mcportal_clips SET title = $3, summary = $4, tags = $5, search_text = $6, bytes = $7, updated_at = $8 WHERE user_id = $1 AND id = $2`,
        [userId, id, next.title, JSON.stringify(summaryOf(next)), next.tags, searchTextOf(next), next.bytes, next.updatedAt],
      );
      return next;
    });
  }

  delete(userId: string, id: string): Promise<boolean> {
    return this.edit(userId, async store => {
      const r = await store.db.query(`DELETE FROM mcportal_clips WHERE user_id = $1 AND id = $2`, [userId, id]);
      return (r.rowCount ?? 0) > 0;
    });
  }

  deleteAll(userId: string): Promise<number> {
    return this.edit(userId, async store => {
      await store.db.query("DELETE FROM mcportal_write_receipts WHERE user_id=$1 AND operation='clip'", [userId]);
      const r = await store.db.query(`DELETE FROM mcportal_clips WHERE user_id = $1`, [userId]);
      return r.rowCount ?? 0;
    });
  }

  async usage(userId: string): Promise<{ count: number; bytes: number }> {
    const { rows } = await this.db.query<{ count: string; bytes: string | null }>(`SELECT count(*) AS count, sum(bytes) AS bytes FROM mcportal_clips WHERE user_id = $1`, [userId]);
    return { count: Number(rows[0]?.count ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
  }
}
