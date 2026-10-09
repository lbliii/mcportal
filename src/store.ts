/**
 * Profile storage: one JSON file per user in a data directory (a Railway volume
 * when hosted, ~/.mcportal locally). Writes are serialized per file and atomic
 * (unique temp file + rename). A corrupt or hand-broken file is moved aside and
 * replaced by the default profile so the user is never locked out.
 */
import { readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError, errorMessage } from './lib/errors.ts';
import { atomicWrite, defaultDataDir, KeyedMutex, safeFileId } from './lib/files.ts';
import { processLogger } from './lib/log.ts';
import { defaultProfile, validateProfile, preserveProfileSettings, type Profile } from './profile.ts';

/** What an update's change returns: the profile to save (none means no write) and what to hand back. */
export interface ProfileChange<T> {
  profile?: Profile;
  result: T;
}

/** A profile and its revision. */
export interface Versioned {
  profile: Profile;
  rev: number;
}

/** The error replaceIf throws when the profile changed since the revision it was given. */
export function revisionConflict(ifMatch: number, rev: number): AppError {
  return new AppError('conflict', 'The room changed since it was read; read it again and retry.', { details: { ifMatch, rev } });
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
  /**
   * The profile with its revision: 0 before the first write, then one more on every
   * write (put, update, replaceIf). What a linked MCPortal checks before replacing it.
   */
  versioned(userId: string): Promise<Versioned>;
  /**
   * Replace the whole profile only if its revision is still `ifMatch`, and resolve to
   * the new revision. Throws a `conflict` AppError if it changed in between.
   */
  replaceIf(userId: string, profile: Profile, ifMatch: number): Promise<number>;
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
    return this.mutex.run(userId, async () => (await this.read(userId)).profile);
  }

  versioned(userId: string): Promise<Versioned> {
    return this.mutex.run(userId, () => this.read(userId));
  }

  update<T>(userId: string, change: (profile: Profile) => ProfileChange<T>): Promise<T> {
    return this.mutex.run(userId, async () => {
      const { profile: current, rev } = await this.read(userId);
      const { profile, result } = change(current);
      if (profile) await this.write(userId, preserveProfileSettings(current, profile), rev + 1);
      return result;
    });
  }

  replaceIf(userId: string, profile: Profile, ifMatch: number): Promise<number> {
    return this.mutex.run(userId, async () => {
      const { profile: current, rev } = await this.read(userId);
      if (rev !== ifMatch) throw revisionConflict(ifMatch, rev);
      await this.write(userId, preserveProfileSettings(current, profile), rev + 1);
      return rev + 1;
    });
  }

  /** The profile and its revision; files written before revisions count as revision 1. */
  private async read(userId: string): Promise<Versioned> {
    const file = this.file(userId);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { profile: defaultProfile(), rev: 0 };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as Profile & { rev?: unknown };
      const rev = typeof parsed.rev === 'number' && Number.isSafeInteger(parsed.rev) && parsed.rev > 0 ? parsed.rev : 1;
      return { profile: { ...validateProfile(parsed), updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString() }, rev };
    } catch (error) {
      const backup = file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
      await rename(file, backup).catch((error: unknown) => processLogger().warn('profile.backup_failed', { error: errorMessage(error) }));
      this.notices.set(userId, `Your saved layout couldn't be read (${(error as Error).message.slice(0, 120)}), so MCPortal restored the default layout. The old file was kept as ${path.basename(backup)}.`);
      return { profile: defaultProfile(), rev: 0 };
    }
  }

  /** The revision goes first in the file, beside the profile; validateProfile drops it on read. */
  private write(userId: string, profile: Profile, rev: number): Promise<void> {
    return atomicWrite(this.file(userId), `${JSON.stringify({ rev, ...profile }, null, 2)}\n`);
  }

  put(userId: string, profile: Profile): Promise<void> {
    return this.mutex.run(userId, async () => { const before = await this.read(userId); await this.write(userId, preserveProfileSettings(before.profile, profile), before.rev + 1); });
  }

  /** The room, and any unreadable copies set aside for it (`<id>.corrupt-<time>.json`). */
  delete(userId: string): Promise<void> {
    return this.mutex.run(userId, async () => {
      await rm(this.file(userId), { force: true });
      const prefix = `${safeFileId(userId)}.corrupt-`;
      const names = await readdir(this.dir).catch(() => [] as string[]);
      for (const name of names) if (name.startsWith(prefix) && name.endsWith('.json')) await rm(path.join(this.dir, name), { force: true });
    });
  }

  takeNotice(userId: string): string | undefined {
    const notice = this.notices.get(userId);
    this.notices.delete(userId);
    return notice;
  }
}

export class MemoryProfileStore implements ProfileStore {
  private profiles: Map<string, Versioned>;
  private mutex = new KeyedMutex();

  constructor(initial: Record<string, Profile> = {}) {
    this.profiles = new Map(Object.entries(initial).map(([id, profile]) => [id, { profile, rev: 1 }]));
  }

  private read(userId: string): Versioned {
    const found = this.profiles.get(userId);
    return found ? structuredClone(found) : { profile: defaultProfile(), rev: 0 };
  }

  private write(userId: string, profile: Profile): number {
    const rev = (this.profiles.get(userId)?.rev ?? 0) + 1;
    this.profiles.set(userId, { profile: structuredClone(preserveProfileSettings(this.read(userId).profile, profile)), rev });
    return rev;
  }

  async get(userId: string): Promise<Profile> {
    return this.read(userId).profile;
  }

  async versioned(userId: string): Promise<Versioned> {
    return this.read(userId);
  }

  async put(userId: string, profile: Profile): Promise<void> {
    this.write(userId, profile);
  }

  update<T>(userId: string, change: (profile: Profile) => ProfileChange<T>): Promise<T> {
    return this.mutex.run(userId, async () => {
      const { profile, result } = change(this.read(userId).profile);
      if (profile) this.write(userId, profile);
      return result;
    });
  }

  replaceIf(userId: string, profile: Profile, ifMatch: number): Promise<number> {
    return this.mutex.run(userId, async () => {
      const { rev } = this.read(userId);
      if (rev !== ifMatch) throw revisionConflict(ifMatch, rev);
      return this.write(userId, profile);
    });
  }

  async delete(userId: string): Promise<void> {
    this.profiles.delete(userId);
  }
}
