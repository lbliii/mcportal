/** Profiles in mcportal_profiles, one row per user; an unreadable row is set aside in mcportal_kv, not lost. */
import { defaultProfile, validateProfile, type Profile } from '../profile.ts';
import { revisionConflict, type ProfileChange, type ProfileStore, type Versioned } from '../store.ts';
import { transaction, type Queryable } from './schema.ts';

export class PgProfileStore implements ProfileStore {
  private notices = new Map<string, string>();
  private db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async get(userId: string): Promise<Profile> {
    return (await this.read(userId)).profile;
  }

  versioned(userId: string): Promise<Versioned> {
    return this.read(userId);
  }

  /** Under the same per-user lock as update, so the revision can't move between the check and the write. */
  async replaceIf(userId: string, profile: Profile, ifMatch: number): Promise<number> {
    return transaction(this.db, async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`profile:${userId}`]);
      const { rev } = await this.read(userId, tx);
      if (rev !== ifMatch) throw revisionConflict(ifMatch, rev);
      return this.write(userId, profile, tx);
    });
  }

  /**
   * Read, change and write in one transaction holding a per-user advisory lock, so
   * concurrent changes (from any instance) queue instead of overwriting each other.
   */
  async update<T>(userId: string, change: (profile: Profile) => ProfileChange<T>): Promise<T> {
    return transaction(this.db, async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`profile:${userId}`]);
      const { profile, result } = change((await this.read(userId, tx)).profile);
      if (profile) await this.write(userId, profile, tx);
      return result;
    });
  }

  private async read(userId: string, db: Queryable = this.db): Promise<{ profile: Profile; rev: number }> {
    const { rows } = await db.query<{ data: unknown; rev: string }>(`SELECT data, rev FROM mcportal_profiles WHERE user_id = $1`, [userId]);
    if (!rows.length) return { profile: defaultProfile(), rev: 0 };
    const rev = Number(rows[0]!.rev);
    const data = rows[0]!.data as Partial<Profile>;
    try {
      return { profile: { ...validateProfile(data), updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString() }, rev };
    } catch (error) {
      // Keep the unreadable row under another key rather than losing it.
      await db.query(
        `INSERT INTO mcportal_kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [`corrupt-profile:${userId}:${Date.now()}`, JSON.stringify(data)],
      );
      await db.query(`DELETE FROM mcportal_profiles WHERE user_id = $1`, [userId]);
      this.notices.set(userId, `Your saved layout couldn't be read (${(error as Error).message.slice(0, 120)}), so MCPortal restored the default layout. The old copy was kept.`);
      return { profile: defaultProfile(), rev: 0 };
    }
  }

  async put(userId: string, profile: Profile): Promise<void> {
    await this.write(userId, profile);
  }

  /** Resolves to the new revision. */
  private async write(userId: string, profile: Profile, db: Queryable = this.db): Promise<number> {
    const { rows } = await db.query<{ rev: string }>(
      `INSERT INTO mcportal_profiles (user_id, data) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, rev = mcportal_profiles.rev + 1, updated_at = now()
       RETURNING rev`,
      [userId, JSON.stringify(profile)],
    );
    return Number(rows[0]!.rev);
  }

  async delete(userId: string): Promise<void> {
    await this.db.query(`DELETE FROM mcportal_profiles WHERE user_id = $1`, [userId]);
    await this.db.query(`DELETE FROM mcportal_kv WHERE key LIKE $1`, [`corrupt-profile:${userId.replace(/[\\%_]/g, (c) => `\\${c}`)}:%`]);
  }

  takeNotice(userId: string): string | undefined {
    const notice = this.notices.get(userId);
    this.notices.delete(userId);
    return notice;
  }
}
