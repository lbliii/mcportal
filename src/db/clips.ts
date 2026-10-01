/** Clips in mcportal_clips: content in `data`, everything else in `summary` for lists. */
import { CLIP_LIMITS, ClipError, clampLimit, normalizeTags, patchClip, queryWords, searchTextOf, summaryOf, type Clip, type ClipPatch, type ClipQuery, type ClipStore, type ClipSummary } from '../clips.ts';
import type { Queryable } from './schema.ts';

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

  async add(userId: string, clip: Clip): Promise<void> {
    const { count, bytes } = await this.usage(userId);
    if (count >= CLIP_LIMITS.perUser) throw new ClipError(`You have ${CLIP_LIMITS.perUser} clips, the most MCPortal keeps. Delete some first.`, 'limit_exceeded');
    if (bytes + clip.bytes > CLIP_LIMITS.bytesPerUser) throw new ClipError(`Your clips use ${Math.round(bytes / 1e6)} MB of the ${CLIP_LIMITS.bytesPerUser / 1e6} MB allowed. Delete some (large images first).`, 'limit_exceeded');
    await this.db.query(
      `INSERT INTO mcportal_clips (id, user_id, kind, title, data, summary, tags, search_text, bytes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [clip.id, userId, clip.kind, clip.title, JSON.stringify(clip.data), JSON.stringify(summaryOf(clip)), clip.tags, searchTextOf(clip), clip.bytes, clip.createdAt, clip.updatedAt],
    );
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
    const words = queryWords(query.query);
    if (words.length) add(`search_text LIKE ALL(?::text[])`, words.map(likeWord));
    values.push(clampLimit(query.limit, 20, CLIP_LIMITS.perUser));
    const { rows } = await this.db.query<{ summary: ClipSummary }>(
      `SELECT summary FROM mcportal_clips WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    );
    return rows.map((r) => r.summary);
  }

  async update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined> {
    const clip = await this.get(userId, id);
    if (!clip) return undefined;
    const next = patchClip(clip, patch);
    await this.db.query(
      `UPDATE mcportal_clips SET title = $3, summary = $4, tags = $5, search_text = $6, bytes = $7, updated_at = $8 WHERE user_id = $1 AND id = $2`,
      [userId, id, next.title, JSON.stringify(summaryOf(next)), next.tags, searchTextOf(next), next.bytes, next.updatedAt],
    );
    return next;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const r = await this.db.query(`DELETE FROM mcportal_clips WHERE user_id = $1 AND id = $2`, [userId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async deleteAll(userId: string): Promise<number> {
    const r = await this.db.query(`DELETE FROM mcportal_clips WHERE user_id = $1`, [userId]);
    return r.rowCount ?? 0;
  }

  async usage(userId: string): Promise<{ count: number; bytes: number }> {
    const { rows } = await this.db.query<{ count: string; bytes: string | null }>(`SELECT count(*) AS count, sum(bytes) AS bytes FROM mcportal_clips WHERE user_id = $1`, [userId]);
    return { count: Number(rows[0]?.count ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
  }
}
