/**
 * Profile storage: one JSON file per user in a data directory (a Railway volume
 * when hosted, ~/.mcportal locally). Writes are serialized per file and atomic
 * (unique temp file + rename). A corrupt or hand-broken file is moved aside and
 * replaced by the default profile so the user is never locked out.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { defaultProfile, validateProfile, type Profile } from './profile.ts';

export interface ProfileStore {
  get(userId: string): Promise<Profile>;
  put(userId: string, profile: Profile): Promise<void>;
  /** A one-time notice for the user (e.g. "your profile was unreadable and was reset"). */
  takeNotice?(userId: string): string | undefined;
}

export function defaultDataDir(): string {
  return process.env.MCPORTAL_DATA_DIR || path.join(homedir(), '.mcportal');
}

export function safeFileId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

/** Serialize async work per key. */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(work, work);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

export async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

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
    return this.mutex.run(userId, async () => {
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
        await rename(file, backup).catch(() => {});
        this.notices.set(userId, `Your saved layout couldn't be read (${(error as Error).message.slice(0, 120)}), so MCPortal restored the default layout. The old file was kept as ${path.basename(backup)}.`);
        return defaultProfile();
      }
    });
  }

  put(userId: string, profile: Profile): Promise<void> {
    return this.mutex.run(userId, () => atomicWrite(this.file(userId), `${JSON.stringify(profile, null, 2)}\n`));
  }

  takeNotice(userId: string): string | undefined {
    const notice = this.notices.get(userId);
    this.notices.delete(userId);
    return notice;
  }
}

export class MemoryProfileStore implements ProfileStore {
  private profiles: Map<string, Profile>;

  constructor(initial: Record<string, Profile> = {}) {
    this.profiles = new Map(Object.entries(initial));
  }

  async get(userId: string): Promise<Profile> {
    return structuredClone(this.profiles.get(userId) ?? defaultProfile());
  }

  async put(userId: string, profile: Profile): Promise<void> {
    this.profiles.set(userId, structuredClone(profile));
  }
}
