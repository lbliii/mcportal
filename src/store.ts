/**
 * Profile storage. Phase 1 uses one JSON file per user in a data directory
 * (a Railway volume when hosted, ~/.mcportal locally). The interface is small
 * so a Postgres store can replace it once there are multiple users and OAuth.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { defaultProfile, validateProfile, type Profile } from './profile.ts';

export interface ProfileStore {
  get(userId: string): Promise<Profile>;
  put(userId: string, profile: Profile): Promise<void>;
}

export function defaultDataDir(): string {
  return process.env.MCPORTAL_DATA_DIR || path.join(homedir(), '.mcportal');
}

function fileName(userId: string): string {
  return `${userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default'}.json`;
}

export class FileProfileStore implements ProfileStore {
  dir: string;

  constructor(dir = defaultDataDir()) {
    this.dir = dir;
  }

  async get(userId: string): Promise<Profile> {
    try {
      const raw = await readFile(path.join(this.dir, fileName(userId)), 'utf8');
      const parsed = JSON.parse(raw) as Profile;
      // Re-validate on read so a hand-edited file can't break the workspace.
      return { ...validateProfile(parsed), updatedAt: parsed.updatedAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultProfile();
      throw error;
    }
  }

  async put(userId: string, profile: Profile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, fileName(userId));
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    await rename(temp, target);
  }
}

export class MemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, Profile>();

  async get(userId: string): Promise<Profile> {
    return structuredClone(this.profiles.get(userId) ?? defaultProfile());
  }

  async put(userId: string, profile: Profile): Promise<void> {
    this.profiles.set(userId, structuredClone(profile));
  }
}
