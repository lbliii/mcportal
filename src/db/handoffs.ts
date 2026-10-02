/** Handoffs in mcportal_handoffs, one row per account and code (src/handoffs.ts). */
import { buildHandoff, HANDOFF_LIMIT, newHandoffCode, normalizeCode, type Handoff, type HandoffInput, type HandoffStore } from '../handoffs.ts';
import type { Queryable } from './schema.ts';

export class PgHandoffStore implements HandoffStore {
  private db: Queryable;
  private now: () => Date;
  constructor(db: Queryable, now = () => new Date()) { this.db = db; this.now = now; }
  async create(userId: string, input: HandoffInput) {
    const now = this.now();
    await this.db.query('DELETE FROM mcportal_handoffs WHERE user_id = $1 AND expires_at <= $2', [userId, now.toISOString()]);
    let handoff = buildHandoff(input as unknown as Record<string, unknown>, now);
    for (let tries = 0; ; tries++) {
      const { rowCount } = await this.db.query(
        `INSERT INTO mcportal_handoffs (user_id, code, data, created_at, expires_at) VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT DO NOTHING`,
        [userId, handoff.code, JSON.stringify(handoff), handoff.createdAt, handoff.expiresAt]);
      if (rowCount || tries >= 5) break;
      handoff = { ...handoff, code: newHandoffCode() };
    }
    await this.db.query(`DELETE FROM mcportal_handoffs WHERE user_id = $1 AND code IN (SELECT code FROM mcportal_handoffs WHERE user_id = $1 ORDER BY created_at DESC, code OFFSET $2)`, [userId, HANDOFF_LIMIT]);
    return handoff;
  }
  async get(userId: string, code: string) {
    const { rows } = await this.db.query<{ data: Handoff }>('SELECT data FROM mcportal_handoffs WHERE user_id = $1 AND code = $2 AND expires_at > $3', [userId, normalizeCode(code), this.now().toISOString()]);
    return rows[0]?.data;
  }
  async list(userId: string) {
    const { rows } = await this.db.query<{ data: Handoff }>('SELECT data FROM mcportal_handoffs WHERE user_id = $1 AND expires_at > $2 ORDER BY created_at DESC, code', [userId, this.now().toISOString()]);
    return rows.map((r) => r.data);
  }
  async markOpened(userId: string, code: string) {
    await this.db.query(`UPDATE mcportal_handoffs SET data = data || jsonb_build_object('openedAt', $3::text) WHERE user_id = $1 AND code = $2`, [userId, normalizeCode(code), this.now().toISOString()]);
  }
  async deleteAll(userId: string) { await this.db.query('DELETE FROM mcportal_handoffs WHERE user_id = $1', [userId]); }
}
