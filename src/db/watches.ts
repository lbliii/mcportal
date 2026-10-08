import { DocumentWatchStore, emptyWatches, validateWatchDocument, type StoreWatch, type WatchDocument } from '../watches.ts';
import { transaction, type Queryable } from './schema.ts';

/** Account locks also cover the absent-row case, across replicas and deletion. */
export class PgWatchStore extends DocumentWatchStore {
  private db: Queryable;
  constructor(db: Queryable) { super(); this.db = db; }

  override async list(userId: string): Promise<StoreWatch[]> {
    const { rows } = await this.db.query<{ data: WatchDocument }>('SELECT data FROM mcportal_watches WHERE user_id=$1', [userId]);
    return rows[0] ? validateWatchDocument(rows[0].data).watches : [];
  }

  update<T>(userId: string, change: (state: WatchDocument) => { state?: WatchDocument; result: T }): Promise<T> {
    return transaction(this.db, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('mcportal_watches:' || $1, 0))", [userId]);
      const { rows } = await db.query<{ data: WatchDocument }>('SELECT data FROM mcportal_watches WHERE user_id=$1 FOR UPDATE', [userId]);
      const result = change(rows[0] ? validateWatchDocument(rows[0].data) : emptyWatches());
      if (result.state) {
        const valid = validateWatchDocument(result.state);
        if (valid.watches.length) await db.query('INSERT INTO mcportal_watches(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data', [userId, JSON.stringify(valid)]);
        else await db.query('DELETE FROM mcportal_watches WHERE user_id=$1', [userId]);
      }
      return structuredClone(result.result);
    });
  }

  async deleteAll(userId: string): Promise<void> {
    await transaction(this.db, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('mcportal_watches:' || $1, 0))", [userId]);
      await db.query('DELETE FROM mcportal_watches WHERE user_id=$1', [userId]);
    });
  }
}
