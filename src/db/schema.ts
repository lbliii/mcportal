/**
 * The Postgres pool and the schema: tables are created (and the schema version raised)
 * on start, never dropped. Loads `pg` lazily so local file-backed runs don't need it.
 */
import { processLogger } from '../lib/log.ts';

/** The subset of pg.Pool we use; lets tests pass a pool pinned to a schema. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
  end?(): Promise<void>;
  /** A dedicated connection, for a transaction (pg.Pool has it). */
  connect?(): Promise<Queryable & { release(): void }>;
}

/** Run `work` in a transaction on its own connection (or straight on `db` if it can't give one). */
export async function transaction<T>(db: Queryable, work: (tx: Queryable) => Promise<T>): Promise<T> {
  if (!db.connect) return work(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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

export const SCHEMA_VERSION = '9';

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
  // v9: full-text clips. Generated vectors backfill existing rows and stay current
  // on insert/update; local/file stores continue to use literal substring search.
  await db.query(`ALTER TABLE mcportal_clips ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, title), 'A') ||
      setweight(to_tsvector('english'::regconfig, search_text), 'D')
    ) STORED`);
  await db.query(`CREATE INDEX IF NOT EXISTS mcportal_clips_search ON mcportal_clips USING GIN (search_vector)`);

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
  // v5: handoffs, pages sent from the room to a new chat (src/handoffs.ts).
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_handoffs (
    user_id text NOT NULL,
    code text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, code)
  )`);
  // v6: what each account has seen in each portal (src/seen.ts).
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_seen (
    user_id text NOT NULL,
    portal_id text NOT NULL,
    ids text[] NOT NULL,
    at timestamptz NOT NULL,
    PRIMARY KEY (user_id, portal_id)
  )`);
  // v7: each account's latest edition, the agent's highlights the room leads with (src/editions.ts).
  await db.query(`CREATE TABLE IF NOT EXISTS mcportal_editions (
    user_id text PRIMARY KEY,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
  )`);
  // v8: reblogs (docs/plans/reblog.md). A reblog's original, for counting and finding them;
  // at most one reblog per account per original.
  await db.query(`ALTER TABLE mcportal_shares ADD COLUMN IF NOT EXISTS root_id text`);
  await db.query(`UPDATE mcportal_shares SET root_id = data->'reblogOf'->>'root' WHERE root_id IS NULL AND data ? 'reblogOf'`);
  await db.query(`CREATE INDEX IF NOT EXISTS mcportal_shares_root_created ON mcportal_shares (root_id, created_at DESC) WHERE root_id IS NOT NULL`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS mcportal_shares_one_reblog ON mcportal_shares (account_id, root_id) WHERE root_id IS NOT NULL`);
  await db.query(
    `INSERT INTO mcportal_meta (key, value) VALUES ('schema_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE mcportal_meta.value::int < EXCLUDED.value::int`,
    [SCHEMA_VERSION],
  );
}
