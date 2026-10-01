/**
 * Profile storage: one JSON file per user in a data directory (a Railway volume
 * when hosted, ~/.mcportal locally). Writes are serialized per file and atomic
 * (unique temp file + rename). A corrupt or hand-broken file is moved aside and
 * replaced by the default profile so the user is never locked out.
 */
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from './lib/errors.ts';
import { atomicWrite, defaultDataDir, KeyedMutex, safeFileId } from './lib/files.ts';
import { processLogger } from './lib/log.ts';
import { defaultProfile, validateProfile, type Profile } from './profile.ts';

/** What an update's change returns: the profile to save (none means no write) and what to hand back. */
export interface ProfileChange<T> {
  profile?: Profile;
  result: T;
}

export interface ProfileStore {
  get(userId: string): Promise<Profile>;
  /** Replace the whole profile (imports, first-run setup). Prefer update() for changes. */
  put(userId: string, profile: Profile): Promise<void>;
  /**
   * Read, change and save as one step, so two changes at once can't lose either.
   * `change` must be synchronous and runs while the user's profile is locked: do any
   * fetching before calling update, never inside it.
   */
  update<T>(userId: string, change: (profile: Profile) => ProfileChange<T>): Promise<T>;
  /** A one-time notice for the user (e.g. "your profile was unreadable and was reset"). */
  takeNotice?(userId: string): string | undefined;
  /** Remove the user's profile (account deletion). */
  delete(userId: string): Promise<void>;
}

export { atomicWrite, defaultDataDir, KeyedMutex, safeFileId } from './lib/files.ts';

export class FileProfileStore implements ProfileStore {
  dir: string;
  private mutex = new KeyedMutex();
  private notices = new Map<string, string>();

  constructor(dir = defaultDataDir()) {
    this.dir = dir;
  }

  private file(userId: string): string {
    return path.join(this.dir, `${safeFileId(userId)}.json`);
  }

  get(userId: string): Promise<Profile> {
    return this.mutex.run(userId, () => this.read(userId));
  }

  update<T>(userId: string, change: (profile: Profile) => ProfileChange<T>): Promise<T> {
    return this.mutex.run(userId, async () => {
      const { profile, result } = change(await this.read(userId));
      if (profile) await this.write(userId, profile);
      return result;
    });
  }

  private async read(userId: string): Promise<Profile> {
    const file = this.file(userId);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultProfile();
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as Profile;
      return { ...validateProfile(parsed), updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString() };
    } catch (error) {
      const backup = file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
      await rename(file, backup).catch((error: unknown) => processLogger().warn('profile.backup_failed', { error: errorMessage(error) }));
      this.notices.set(userId, `Your saved layout couldn't be read (${(error as Error).message.slice(0, 120)}), so MCPortal restored the default layout. The old file was kept as ${path.basename(backup)}.`);
      return defaultProfile();
    }
  }

  private write(userId: string, profile: Profile): Promise<void> {
    return atomicWrite(this.file(userId), `${JSON.stringify(profile, null, 2)}\n`);
  }

  put(userId: string, profile: Profile): Promise<void> {
    return this.mutex.run(userId, () => this.write(userId, profile));
  }

  delete(userId: string): Promise<void> {
    return this.mutex.run(userId, () => rm(this.file(userId), { force: true }));
  }

  takeNotice(userId: string): string | undefined {
    const notice = this.notices.get(userId);
    this.notices.delete(userId);
    return notice;
  }
}

export class MemoryProfileStore implements ProfileStore {
  private profiles: Map<string, Profile>;
  private mutex = new KeyedMutex();

  constructor(initial: Record<string, Profile> = {}) {
    this.profiles = new Map(Object.entries(initial));
  }

  async get(userId: string): Promise<Profile> {
    return structuredClone(this.profiles.get(userId) ?? defaultProfile());
  }

  async put(userId: string, profile: Profile): Promise<void> {
    this.profiles.set(userId, structuredClone(profile));
  }

  update<T>(userId: string, change: (profile: Profile) => ProfileChange<T>): Promise<T> {
    return this.mutex.run(userId, async () => {
      const { profile, result } = change(structuredClone(this.profiles.get(userId) ?? defaultProfile()));
      if (profile) this.profiles.set(userId, structuredClone(profile));
      return result;
    });
  }

  async delete(userId: string): Promise<void> {
    this.profiles.delete(userId);
  }
}
