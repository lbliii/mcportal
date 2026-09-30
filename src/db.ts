/**
 * Postgres storage for the hosted server, used when DATABASE_URL is set. Local
 * MCPortal (stdio or local HTTP) keeps using files and never loads `pg`, so the
 * plugin still runs without `npm install`.
 *
 * Tables: mcportal_profiles (one row per user, with a `rev` that increments on
 * every write), mcportal_kv (the OAuth document), mcportal_meta (schema version,
 * import marker).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthPersistence } from './auth/store.ts';
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
  pool.on('error', (error) => process.stderr.write(`[mcportal] postgres pool error: ${error.message}\n`));
  return pool as unknown as Queryable;
}

const SCHEMA_VERSION = '1';

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
  await db.query(`INSERT INTO mcportal_meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO NOTHING`, [SCHEMA_VERSION]);
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
