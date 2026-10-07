/** Shares, follows, mutes, blocks and reports in their own tables. */
import { AppError } from '../lib/errors.ts';
import type { PageQuery, Relation, Report, Share, SocialStore } from '../social.ts';
import { DELETED_ID, DELETED_RESOLUTION, limitOf } from '../social-store.ts';
import type { Queryable } from './schema.ts';

const RELATION_TABLES: Record<Relation, string> = { follows: 'mcportal_follows', mutes: 'mcportal_mutes', blocks: 'mcportal_blocks', intros: 'mcportal_intros', joins: 'mcportal_joins' };

/** Shares, relations and reports in tables. Rules live in Social, not here. */
export class PgSocialStore implements SocialStore {
  private db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async addShare(share: Share): Promise<void> {
    try {
      await this.db.query(`INSERT INTO mcportal_shares (id, account_id, data, created_at, hidden_at, root_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [share.id, share.accountId, JSON.stringify(share), share.createdAt, share.hiddenAt ?? null, share.reblogOf?.root ?? null]);
    } catch (error) {
      // mcportal_shares_one_reblog: one reblog per account per original, even when two race.
      if ((error as { code?: string }).code === '23505' && share.reblogOf) throw new AppError('conflict', 'You already reblogged it', { cause: error });
      throw error;
    }
  }

  private row(r: { data: Share; hidden_at: Date | string | null }): Share {
    const share = { ...r.data };
    if (r.hidden_at) share.hiddenAt = new Date(r.hidden_at).toISOString();
    else delete share.hiddenAt;
    return share;
  }

  async getShare(id: string): Promise<Share | undefined> {
    const { rows } = await this.db.query<{ data: Share; hidden_at: Date | null }>(`SELECT data, hidden_at FROM mcportal_shares WHERE id = $1`, [id]);
    return rows.length ? this.row(rows[0]!) : undefined;
  }

  async deleteShare(accountId: string, id: string): Promise<boolean> {
    return ((await this.db.query(`DELETE FROM mcportal_shares WHERE id = $1 AND account_id = $2`, [id, accountId])).rowCount ?? 0) > 0;
  }

  async setHidden(id: string, hiddenAt: string | null): Promise<boolean> {
    return ((await this.db.query(`UPDATE mcportal_shares SET hidden_at = $2 WHERE id = $1`, [id, hiddenAt])).rowCount ?? 0) > 0;
  }

  async sharesBy(accountIds: string[], query: PageQuery & { includeHidden?: boolean }): Promise<Share[]> {
    if (!accountIds.length) return [];
    const values: unknown[] = [accountIds];
    const where = ['account_id = ANY($1::text[])'];
    if (!query.includeHidden) where.push('hidden_at IS NULL');
    if (query.before && !Number.isNaN(Date.parse(query.before))) {
      values.push(query.before);
      const dateParam = values.length;
      if (query.beforeId) { values.push(query.beforeId); where.push(`(created_at, id) < ($${dateParam}::timestamptz, $${values.length}::text)`); }
      else where.push(`created_at < $${dateParam}`);
    }
    values.push(limitOf(query));
    const { rows } = await this.db.query<{ data: Share; hidden_at: Date | null }>(
      `SELECT data, hidden_at FROM mcportal_shares WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`, values);
    return rows.map((r) => this.row(r));
  }

  async countShares(accountId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM mcportal_shares WHERE account_id = $1`, [accountId]);
    return Number(rows[0]?.n ?? 0);
  }

  async reblogsOf(rootId: string, query: PageQuery): Promise<Share[]> {
    const values: unknown[] = [rootId];
    const where = ['root_id = $1', 'hidden_at IS NULL'];
    if (query.before && !Number.isNaN(Date.parse(query.before))) {
      values.push(query.before);
      where.push(`created_at < $${values.length}`);
    }
    values.push(limitOf(query));
    const { rows } = await this.db.query<{ data: Share; hidden_at: Date | null }>(
      `SELECT data, hidden_at FROM mcportal_shares WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`, values);
    return rows.map((r) => this.row(r));
  }

  async countReblogs(rootIds: string[]): Promise<Map<string, number>> {
    if (!rootIds.length) return new Map();
    const { rows } = await this.db.query<{ root_id: string; n: string }>(
      `SELECT root_id, count(*) AS n FROM mcportal_shares WHERE root_id = ANY($1::text[]) AND hidden_at IS NULL AND data->>'detachedAt' IS NULL GROUP BY root_id`, [rootIds]);
    return new Map(rows.map((r) => [r.root_id, Number(r.n)]));
  }

  async reblogsBy(accountId: string, rootIds: string[]): Promise<Map<string, string>> {
    if (!rootIds.length) return new Map();
    const { rows } = await this.db.query<{ root_id: string; id: string }>(
      `SELECT root_id, id FROM mcportal_shares WHERE account_id = $1 AND root_id = ANY($2::text[])`, [accountId, rootIds]);
    return new Map(rows.map((r) => [r.root_id, r.id]));
  }

  async updateShare(id: string, change: { reblogs?: Share['reblogs'] | null; detachedAt?: string | null }): Promise<boolean> {
    const set: Record<string, string> = {};
    const unset: string[] = [];
    for (const key of ['reblogs', 'detachedAt'] as const) {
      const value = change[key];
      if (value === null) unset.push(key);
      else if (value !== undefined) set[key] = value;
    }
    return ((await this.db.query(`UPDATE mcportal_shares SET data = (data - $3::text[]) || $2::jsonb WHERE id = $1`, [id, JSON.stringify(set), unset])).rowCount ?? 0) > 0;
  }

  async relate(relation: Relation, a: string, b: string): Promise<boolean> {
    return ((await this.db.query(`INSERT INTO ${RELATION_TABLES[relation]} (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [a, b])).rowCount ?? 0) > 0;
  }

  async unrelate(relation: Relation, a: string, b: string): Promise<boolean> {
    return ((await this.db.query(`DELETE FROM ${RELATION_TABLES[relation]} WHERE a = $1 AND b = $2`, [a, b])).rowCount ?? 0) > 0;
  }

  async outgoing(relation: Relation, a: string): Promise<string[]> {
    return (await this.db.query<{ b: string }>(`SELECT b FROM ${RELATION_TABLES[relation]} WHERE a = $1 ORDER BY created_at`, [a])).rows.map((r) => r.b);
  }

  async incoming(relation: Relation, b: string): Promise<string[]> {
    return (await this.db.query<{ a: string }>(`SELECT a FROM ${RELATION_TABLES[relation]} WHERE b = $1 ORDER BY created_at`, [b])).rows.map((r) => r.a);
  }

  async addReport(report: Report): Promise<void> {
    await this.db.query(`INSERT INTO mcportal_reports (id, reporter_id, status, data, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [report.id, report.reporterId, report.status, JSON.stringify(report), report.createdAt]);
  }

  async reports(status?: Report['status'], limit = 100): Promise<Report[]> {
    const { rows } = await this.db.query<{ data: Report; reporter_id: string }>(
      status ? `SELECT data, reporter_id FROM mcportal_reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2` : `SELECT data, reporter_id FROM mcportal_reports ORDER BY created_at DESC LIMIT $1`,
      status ? [status, limit] : [limit]);
    return rows.map((r) => ({ ...r.data, reporterId: r.reporter_id }));
  }

  async reportsFiled(accountId: string): Promise<Report[]> {
    const { rows } = await this.db.query<{ data: Report; reporter_id: string }>(
      `SELECT data, reporter_id FROM mcportal_reports WHERE reporter_id = $1 ORDER BY created_at DESC`, [accountId]);
    return rows.map((r) => ({ ...r.data, reporterId: r.reporter_id }));
  }

  async resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined> {
    const { rows } = await this.db.query<{ data: Report; reporter_id: string }>(
      `UPDATE mcportal_reports SET status = 'resolved', data = data || $2::jsonb WHERE id = $1 RETURNING data, reporter_id`,
      [id, JSON.stringify({ status: 'resolved', resolvedAt: at, resolvedBy: by, resolution })]);
    return rows.length ? { ...rows[0]!.data, reporterId: rows[0]!.reporter_id } : undefined;
  }

  async forget(accountId: string, at: string): Promise<void> {
    const shares = (await this.db.query<{ id: string }>(`SELECT id FROM mcportal_shares WHERE account_id = $1`, [accountId])).rows.map((r) => r.id);
    await this.db.query(`DELETE FROM mcportal_shares WHERE account_id = $1`, [accountId]);
    for (const table of Object.values(RELATION_TABLES)) await this.db.query(`DELETE FROM ${table} WHERE a = $1 OR b = $1`, [accountId]);
    await this.db.query(
      `UPDATE mcportal_reports SET reporter_id = $2, data = data || jsonb_build_object('reporterId', $2::text) || CASE WHEN status = 'resolved' THEN '{"reason":""}'::jsonb ELSE '{}'::jsonb END WHERE reporter_id = $1`,
      [accountId, DELETED_ID]);
    const about = `((data->>'targetKind' = 'profile' AND data->>'targetId' = $1) OR (data->>'targetKind' = 'share' AND data->>'targetId' = ANY($2::text[])))`;
    await this.db.query(
      `UPDATE mcportal_reports SET status = 'resolved', data = data || jsonb_build_object('status', 'resolved', 'resolvedAt', $3::text, 'resolvedBy', 'system', 'resolution', $4::text) WHERE status = 'open' AND ${about}`,
      [accountId, shares, at, DELETED_RESOLUTION]);
    await this.db.query(`UPDATE mcportal_reports SET data = data || jsonb_build_object('targetId', $3::text) WHERE ${about}`, [accountId, shares, DELETED_ID]);
  }

  async purgeReports(resolvedBefore: string): Promise<number> {
    return (await this.db.query(`DELETE FROM mcportal_reports WHERE status = 'resolved' AND data->>'resolvedAt' < $1`, [resolvedBefore])).rowCount ?? 0;
  }
}
