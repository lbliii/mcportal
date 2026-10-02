/** Seen sets in mcportal_seen, one row per account and portal (src/seen.ts). */
import { mergeSeen, seenHash, type SeenStore } from '../seen.ts';
import { transaction, type Queryable } from './schema.ts';

export class PgSeenStore implements SeenStore {
  private db: Queryable;
  constructor(db: Queryable) { this.db = db; }
  async get(userId: string, portalIds: string[]) {
    if (!portalIds.length) return new Map<string, Set<string>>();
    const { rows } = await this.db.query<{ portal_id: string; ids: string[] }>('SELECT portal_id, ids FROM mcportal_seen WHERE user_id = $1 AND portal_id = ANY($2)', [userId, portalIds]);
    return new Map(rows.map((r) => [r.portal_id, new Set(r.ids)]));
  }
  async mark(userId: string, marks: Array<{ portalId: string; itemIds: string[] }>) {
    if (!marks.length) return;
    await transaction(this.db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`seen:${userId}`]);
      const { rows } = await tx.query<{ portal_id: string; ids: string[] }>('SELECT portal_id, ids FROM mcportal_seen WHERE user_id = $1 AND portal_id = ANY($2)', [userId, marks.map((m) => m.portalId)]);
      const current = new Map(rows.map((r) => [r.portal_id, r.ids]));
      for (const { portalId, itemIds } of marks) {
        const ids = mergeSeen(current.get(portalId) ?? [], itemIds.map(seenHash));
        current.set(portalId, ids);
        await tx.query(`INSERT INTO mcportal_seen (user_id, portal_id, ids, at) VALUES ($1, $2, $3, now())
          ON CONFLICT (user_id, portal_id) DO UPDATE SET ids = EXCLUDED.ids, at = EXCLUDED.at`, [userId, portalId, ids]);
      }
    });
  }
  async keepOnly(userId: string, portalIds: string[]) {
    await this.db.query('DELETE FROM mcportal_seen WHERE user_id = $1 AND NOT (portal_id = ANY($2))', [userId, portalIds]);
  }
  async deleteAll(userId: string) { await this.db.query('DELETE FROM mcportal_seen WHERE user_id = $1', [userId]); }
}
