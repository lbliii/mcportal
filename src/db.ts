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
 *
 * Each part lives in ./db/: schema.ts (pool and tables), one file per store
 * (profiles, clips, social, reading, handoffs, seen, editions), auth.ts (mcportal_kv documents) and import.ts.
 * This barrel keeps `import('./db.ts')` working for the server, the admin CLI and tests.
 */
export { connect, ensureSchema, type Queryable } from './db/schema.ts';
export { PgProfileStore } from './db/profiles.ts';
export { PgClipStore } from './db/clips.ts';
export { PgSocialStore } from './db/social.ts';
export { PgReadingStore } from './db/reading.ts';
export { PgHandoffStore } from './db/handoffs.ts';
export { PgSeenStore } from './db/seen.ts';
export { PgEditionStore } from './db/editions.ts';
export { pgAuthPersistence } from './db/auth.ts';
export { importFiles } from './db/import.ts';
