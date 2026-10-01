/** Whole JSON documents (OAuth, accounts, public profiles) as rows of mcportal_kv. */
import type { AuthPersistence } from '../auth/store.ts';
import type { Queryable } from './schema.ts';

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
