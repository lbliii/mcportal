/** Profiles in mcportal_profiles, one row per user; an unreadable row is set aside in mcportal_kv, not lost. */
import { defaultProfile, validateProfile, type Profile } from '../profile.ts';
import type { ProfileStore } from '../store.ts';
import type { Queryable } from './schema.ts';

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
