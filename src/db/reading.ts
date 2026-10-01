/** Reading state in mcportal_reading, one row per user and canonical URL. */
import { AppError } from '../lib/errors.ts';
import { canonicalReadingUrl, importedReading, nextReading, READING_LIMIT, validateReadingUpdate, type ReadingState, type ReadingStore, type ReadingUpdate } from '../reading.ts';
import type { Queryable } from './schema.ts';

/** Atomic JSON updates preserve fields absent from incremental activity events. */
export class PgReadingStore implements ReadingStore {
  private db: Queryable;
  constructor(db: Queryable) { this.db = db; }
  async get(userId: string, url: string) {
    const { rows } = await this.db.query<{ data: ReadingState }>('SELECT data FROM mcportal_reading WHERE user_id = $1 AND url = $2', [userId, canonicalReadingUrl(url)]);
    return rows[0]?.data;
  }
  async record(userId: string, input: ReadingUpdate) {
    const update = validateReadingUpdate(input);
    const next = nextReading(undefined, update);
    const { rows } = await this.db.query<{ data: ReadingState }>(`
      INSERT INTO mcportal_reading(user_id, url, data) VALUES ($1, $2, $3::jsonb)
      ON CONFLICT(user_id, url) DO UPDATE SET data =
        (CASE WHEN $5 THEN (CASE WHEN $4 = 'opened' THEN mcportal_reading.data - 'readAt' ELSE mcportal_reading.data END) - 'anchor' ELSE (CASE WHEN $4 = 'opened' THEN mcportal_reading.data - 'readAt' ELSE mcportal_reading.data END) END)
        || (CASE WHEN $4 = 'seen' THEN $3::jsonb - 'status' ELSE $3::jsonb END)
      RETURNING data`, [userId, update.url, JSON.stringify(next), update.status, update.anchor === null]);
    await this.db.query(`DELETE FROM mcportal_reading WHERE user_id=$1 AND url IN (SELECT url FROM mcportal_reading WHERE user_id=$1 ORDER BY COALESCE(data->>'lastOpenedAt', data->>'lastSeenAt') DESC, url OFFSET $2)`, [userId, READING_LIMIT]);
    return rows[0]!.data;
  }
  async list(userId: string, options: { unfinished?: boolean; limit?: number } = {}) {
    const limit = Math.min(READING_LIMIT, Math.max(1, Math.floor(Number(options.limit) || 20)));
    const { rows } = await this.db.query<{ data: ReadingState }>(`SELECT data FROM mcportal_reading WHERE user_id=$1 ${options.unfinished ? "AND data->>'status' = 'opened'" : ''} ORDER BY COALESCE(data->>'lastOpenedAt', data->>'lastSeenAt') DESC, url LIMIT $2`, [userId, limit]);
    return rows.map(r => r.data);
  }
  async import(userId: string, raw: unknown[]) {
    if (raw.length > READING_LIMIT) throw new AppError('limit_exceeded', 'Too many reading records');
    const states = raw.map(importedReading);
    let count = 0;
    for (const state of states) {
      if ((await this.list(userId, { limit: READING_LIMIT })).length >= READING_LIMIT) break;
      count += (await this.db.query(`INSERT INTO mcportal_reading(user_id,url,data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [userId, state.url, JSON.stringify(state)])).rowCount ?? 0;
    }
    return count;
  }
  async deleteAll(userId: string) { await this.db.query('DELETE FROM mcportal_reading WHERE user_id=$1', [userId]); }
}
