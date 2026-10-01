/**
 * Postgres storage for the hosted server, used when DATABASE_URL is set. Local
 * MCPortal (stdio or local HTTP) keeps using files and never loads `pg`, so the
 * plugin still runs without `npm install`.
 *
 * Tables: mcportal_profiles (one row per user, with a `rev` that increments on
 * every write), mcportal_clips (one row per clip, schema v2), mcportal_shares,
 * mcportal_follows / _mutes / _blocks and mcportal_reports (schema v3),
 * mcportal_kv (the OAuth, accounts and public-profiles documents), mcportal_meta
 * (schema version, import marker).
 */
import { canonicalReadingUrl, importedReading, nextReading, READING_LIMIT, validateReadingUpdate, type ReadingState, type ReadingStore, type ReadingUpdate } from './reading.ts';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthPersistence } from './auth/store.ts';
import type { PageQuery, Relation, Report, Share, SocialStore } from './social.ts';
import { CLIP_LIMITS, ClipError, clampLimit, normalizeTags, patchClip, queryWords, searchTextOf, summaryOf, type Clip, type ClipPatch, type ClipQuery, type ClipStore, type ClipSummary } from './clips.ts';
import { AppError } from './lib/errors.ts';
import { processLogger } from './lib/log.ts';
import { defaultProfile, validateProfile, type Profile } from './profile.ts';
import type { ProfileStore } from './store.ts';

/** The subset of pg.Pool we use; lets tests pass a pool pinned to a schema. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
  end?(): Promise<void>;
}

export async function connect(url: string, options: { searchPath?: string } = {}): Promise<Queryable> {
  let pg: typeof import('pg');
  try {
    pg = (await import('pg')).default as unknown as typeof import('pg');
  } catch {
    throw new Error('DATABASE_URL is set but the "pg" package is not installed. Run `npm install` (the Docker image does this).');
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(options.searchPath ? { options: `-c search_path=${options.searchPath}` } : {}),
  });
  pool.on('error', (error) => processLogger().error('postgres.pool_error', { error: error.message }));
  return pool as unknown as Queryable;
}

const SCHEMA_VERSION = '4';

export async function ensureSchema(db: Queryable): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_meta (key text PRIMARY KEY, value text NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_profiles (
    user_id text PRIMARY KEY,
    data jsonb NOT NULL,
    rev bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_kv (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_reading (user_id text NOT NULL, url text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(user_id, url))`);
  // v2: clips. Content in `data`; `summary` is everything but the content, for lists.
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_clips (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    data jsonb NOT NULL,
    summary jsonb NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    search_text text NOT NULL DEFAULT '',
    bytes integer NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS mcportal_clips_user_created ON mcportal_clips (user_id, created_at DESC)`);
  // v3: sharing. A share's content is a copy in `data`; relations are (a, b) pairs.
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_shares (
    id text PRIMARY KEY,
    account_id text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    hidden_at timestamptz
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS mcportal_shares_account_created ON mcportal_shares (account_id, created_at DESC)`);
  for (const relation of ['follows', 'mutes', 'blocks']) {
    await db.query(`CREATE TABLE IF NOT EXISTS mcportal_${relation} (a text NOT NULL, b text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (a, b))`);
    await db.query(`CREATE INDEX IF NOT EXISTS mcportal_${relation}_b ON mcportal_${relation} (b)`);
  }
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_reports (
    id text PRIMARY KEY,
    reporter_id text NOT NULL,
    status text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS mcportal_reports_status_created ON mcportal_reports (status, created_at DESC)`);
  await db.query(
    `INSERT INTO mcportal_meta (key, value) VALUES ('schema_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE mcportal_meta.value::int < EXCLUDED.value::int`,
    [SCHEMA_VERSION],
  );
}

export class PgProfileStore implements ProfileStore {
  private notices = new Map<string, string>();
  private db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async get(userId: string): Promise<Profile> {
    const { rows } = await this.db.query<{ data: unknown }>(`SELECT data FROM mcportal_profiles WHERE user_id = $1`, [userId]);
    if (!rows.length) return defaultProfile();
    const data = rows[0]!.data as Partial<Profile>;
    try {
      return { ...validateProfile(data), updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString() };
    } catch (error) {
      // Keep the unreadable row under another key rather than losing it.
      await this.db.query(
        `INSERT INTO mcportal_kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [`corrupt-profile:${userId}:${Date.now()}`, JSON.stringify(data)],
      );
      await this.db.query(`DELETE FROM mcportal_profiles WHERE user_id = $1`, [userId]);
      this.notices.set(userId, `Your saved layout couldn't be read (${(error as Error).message.slice(0, 120)}), so MCPortal restored the default layout. The old copy was kept.`);
      return defaultProfile();
    }
  }

  async put(userId: string, profile: Profile): Promise<void> {
    await this.db.query(
      `INSERT INTO mcportal_profiles (user_id, data) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, rev = mcportal_profiles.rev + 1, updated_at = now()`,
      [userId, JSON.stringify(profile)],
    );
  }

  async delete(userId: string): Promise<void> {
    await this.db.query(`DELETE FROM mcportal_profiles WHERE user_id = $1`, [userId]);
    await this.db.query(`DELETE FROM mcportal_kv WHERE key LIKE $1`, [`corrupt-profile:${userId.replace(/[\\%_]/g, (c) => `\\${c}`)}:%`]);
  }

  /** Revision of a user's profile, 0 if none (for the sync plan's ETags). */
  async rev(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ rev: string }>(`SELECT rev FROM mcportal_profiles WHERE user_id = $1`, [userId]);
    return rows.length ? Number(rows[0]!.rev) : 0;
  }

  takeNotice(userId: string): string | undefined {
    const notice = this.notices.get(userId);
    this.notices.delete(userId);
    return notice;
  }
}

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

const RELATION_TABLES: Record<Relation, string> = { follows: 'mcportal_follows', mutes: 'mcportal_mutes', blocks: 'mcportal_blocks' };

/** Shares, relations and reports in tables. Rules live in Social, not here. */
export class PgSocialStore implements SocialStore {
  private db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async addShare(share: Share): Promise<void> {
    await this.db.query(`INSERT INTO mcportal_shares (id, account_id, data, created_at, hidden_at) VALUES ($1, $2, $3, $4, $5)`,
      [share.id, share.accountId, JSON.stringify(share), share.createdAt, share.hiddenAt ?? null]);
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
      where.push(`created_at < $${values.length}`);
    }
    values.push(Math.min(200, Math.max(1, Math.round(Number(query.limit) || 30))));
    const { rows } = await this.db.query<{ data: Share; hidden_at: Date | null }>(
      `SELECT data, hidden_at FROM mcportal_shares WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`, values);
    return rows.map((r) => this.row(r));
  }

  async countShares(accountId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM mcportal_shares WHERE account_id = $1`, [accountId]);
    return Number(rows[0]?.n ?? 0);
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

  async resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined> {
    const { rows } = await this.db.query<{ data: Report; reporter_id: string }>(
      `UPDATE mcportal_reports SET status = 'resolved', data = data || $2::jsonb WHERE id = $1 RETURNING data, reporter_id`,
      [id, JSON.stringify({ status: 'resolved', resolvedAt: at, resolvedBy: by, resolution })]);
    return rows.length ? { ...rows[0]!.data, reporterId: rows[0]!.reporter_id } : undefined;
  }

  async forget(accountId: string): Promise<void> {
    await this.db.query(`DELETE FROM mcportal_shares WHERE account_id = $1`, [accountId]);
    for (const table of Object.values(RELATION_TABLES)) await this.db.query(`DELETE FROM ${table} WHERE a = $1 OR b = $1`, [accountId]);
    await this.db.query(`UPDATE mcportal_reports SET reporter_id = 'deleted', data = data || '{"reporterId":"deleted"}'::jsonb WHERE reporter_id = $1`, [accountId]);
  }
}

/** OAuth document persistence in mcportal_kv (see AuthStore). */
export function pgAuthPersistence(db: Queryable, key = 'auth'): AuthPersistence {
  return {
    async read() {
      const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM mcportal_kv WHERE key = $1`, [key]);
      return rows.length ? JSON.stringify(rows[0]!.value) : undefined;
    },
    async write(json: string) {
      await db.query(
        `INSERT INTO mcportal_kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, json],
      );
    },
  };
}

/**
 * One-time import of the file store (profiles and auth.json) into an empty
 * database. Never overwrites rows; files are left in place. Returns what it did.
 */
export async function importFiles(db: Queryable, dataDir: string): Promise<{ skipped: boolean; profiles: number; auth: boolean }> {
  const done = await db.query(`SELECT 1 FROM mcportal_meta WHERE key = 'imported_files'`);
  if (done.rows.length) return { skipped: true, profiles: 0, auth: false };
  let names: string[] = [];
  try {
    names = await readdir(dataDir);
  } catch {
    names = [];
  }
  let profiles = 0;
  let auth = false;
  for (const name of names) {
    if (!name.endsWith('.json') || name.includes('.corrupt-') || name.endsWith('.tmp')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
    } catch {
      continue;   // unreadable files stay on the volume for a human to look at
    }
    if (name === 'auth.json') {
      const r = await db.query(`INSERT INTO mcportal_kv (key, value) VALUES ('auth', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(parsed)]);
      auth = (r.rowCount ?? 0) > 0;
      continue;
    }
    try {
      validateProfile(parsed);
    } catch {
      continue;
    }
    const userId = name.slice(0, -'.json'.length);
    const r = await db.query(`INSERT INTO mcportal_profiles (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, JSON.stringify(parsed)]);
    profiles += r.rowCount ?? 0;
  }
  await db.query(`INSERT INTO mcportal_meta (key, value) VALUES ('imported_files', $1) ON CONFLICT (key) DO NOTHING`, [new Date().toISOString()]);
  return { skipped: false, profiles, auth };
}

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
