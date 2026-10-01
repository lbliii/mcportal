/** Whole JSON documents (OAuth, accounts, public profiles) as rows of mcportal_kv. */
import type { DocumentPersistence } from '../lib/document.ts';
import { transaction, type Queryable } from './schema.ts';

const SELECT = `SELECT value FROM mcportal_kv WHERE key = $1`;
const UPSERT = `INSERT INTO mcportal_kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;

/** A document in mcportal_kv. `transact` holds a per-key advisory lock, so instances take turns changing it. */
export function pgAuthPersistence(db: Queryable, key = 'auth'): DocumentPersistence {
  const read = async (q: Queryable) => {
    const { rows } = await q.query<{ value: unknown }>(SELECT, [key]);
    return rows.length ? JSON.stringify(rows[0]!.value) : undefined;
  };
  return {
    read: () => read(db),
    async write(json: string) {
      await db.query(UPSERT, [key, json]);
    },
    transact(change) {
      return transaction(db, async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`kv:${key}`]);
        const { json, result } = change(await read(tx));
        if (json !== undefined) await tx.query(UPSERT, [key, json]);
        return result;
      });
    },
  };
}
