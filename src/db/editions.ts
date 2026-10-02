/** Editions in mcportal_editions, one row per account (src/editions.ts). */
import type { Edition, EditionStore } from '../editions.ts';
import type { Queryable } from './schema.ts';

export class PgEditionStore implements EditionStore {
  private db: Queryable;
  private now: () => Date;
  constructor(db: Queryable, now = () => new Date()) { this.db = db; this.now = now; }
  async get(userId: string) {
    const { rows } = await this.db.query<{ data: Edition }>('SELECT data FROM mcportal_editions WHERE user_id = $1 AND expires_at > $2', [userId, this.now().toISOString()]);
    return rows[0]?.data;
  }
  async put(userId: string, edition: Edition) {
    await this.db.query(
      `INSERT INTO mcportal_editions (user_id, data, created_at, expires_at) VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
      [userId, JSON.stringify(edition), edition.createdAt, edition.expiresAt]);
  }
  async deleteAll(userId: string) { await this.db.query('DELETE FROM mcportal_editions WHERE user_id = $1', [userId]); }
}
