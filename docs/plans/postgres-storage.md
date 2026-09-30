# Plan: Postgres storage for the hosted server

**Status:** in progress (2026-09-30). **Milestone:** M1.5 durable storage. Comes before [local-hosted-hybrid.md](local-hosted-hybrid.md), whose linked devices will store real data here.

## Why

The hosted server keeps profiles, saved items and sign-in records as JSON files on one Railway volume, which is a single copy. Railway Postgres adds point-in-time recovery, scheduled backups, and transactional writes, and it gives the social features (M2) a real database to grow into.

## Design

- **Storage is chosen at startup.** With `DATABASE_URL` set (hosted), MCPortal uses Postgres. Without it (local stdio, local HTTP), it uses files, exactly as today.
- **Tables** (created if missing):
  - `mcportal_profiles(user_id text primary key, data jsonb, rev bigint, created_at, updated_at)`: one row per user. `rev` increments on every write, for the sync plan's `ETag` and `If-Match`.
  - `mcportal_kv(key text primary key, value jsonb, updated_at)`: the OAuth document (`auth`), plus room for small server-wide state.
  - `mcportal_meta(key text primary key, value text)`: schema version and the one-time import marker.
- **Profiles:** `PgProfileStore` implements the existing `ProfileStore` interface. Reads validate like the file store (an unreadable row falls back to the default and tells the user once). Writes are single upserts.
- **Sign-in records:** `AuthStore` keeps its logic, in-memory cache and lock. Its persistence becomes pluggable (file or Postgres row). The single-instance assumption stays, as already documented for OAuth state.
- **Import:** the first start against an empty database copies `/data/*.json` profiles and `auth.json` in, never overwriting existing rows, then records a marker. Files stay on the volume.
- **Dependency:** `pg`, imported lazily, only when `DATABASE_URL` is set. The local plugin still runs with no `npm install`; the Docker image installs production dependencies from the lockfile.
- **Visibility:** `/health` reports `storage: "postgres" | "files"`.

## Railway

1. Add a Postgres service to the `mcportal` project.
2. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}` (private network) on the `mcportal` service.
3. Deploy. Verify `/health` shows `storage: "postgres"`, the import counts in the logs, and sign-in and profiles working.
4. Enable point-in-time recovery, and daily plus weekly backup schedules (Railway CLI 5.33 or later).

**Rollback:** unset `DATABASE_URL` and redeploy to go back to the files on the volume. Anything written only to Postgres after the switch would not be in those files, so rolling back after real use means exporting first.

## Tests

- Unit tests are unchanged, since file and memory stores are still the default.
- Postgres integration tests run when `TEST_DATABASE_URL` is set, each run in its own schema: profile round-trip, `rev` increments, corrupt-row recovery, concurrent writes, auth persistence across restarts, and idempotent import.
- Run them locally against a throwaway Postgres (Homebrew `postgresql@14`) before deploying.
