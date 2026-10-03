/**
 * The data directory on disk, and the two primitives every file-backed store uses:
 * atomic writes (unique temp file + rename) and per-key serialization.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

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
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

/**
 * Remove the .json files in `dir` last written before `before` (ms), for stores whose
 * items all expire a fixed time after they're written: a file that old holds nothing
 * live. Returns how many went. A missing directory is nothing to remove.
 */
export async function removeStale(dir: string, before: number): Promise<number> {
  let removed = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => undefined);
    if (info && info.mtimeMs < before) { await rm(file, { force: true }); removed++; }
  }
  return removed;
}
