/** Explicit copy migration: old storage remains intact, and existing targets are never merged. */
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
const MARKER = '.mcportal-migration.json';
export async function migrateData(source: string, destination: string): Promise<'copied' | 'already_migrated'> {
  const from = await realpath(source);
  const target = path.resolve(destination);
  if (!(await lstat(from)).isDirectory()) throw new Error('Source must be a directory');
  if (target === from || target.startsWith(from + path.sep) || from.startsWith(target + path.sep)) throw new Error('Source and destination must be separate directories');
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentReal = await realpath(parent);
  if (parentReal === from || parentReal.startsWith(from + path.sep)) throw new Error('Destination resolves inside source');
  const lock = target + '.migration-lock';
  await mkdir(lock, { mode: 0o700 });
  let staging: string | undefined;
  try {
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Destination already exists');
      const receipt = await readFile(path.join(target, MARKER), 'utf8').catch(() => '');
      if (receipt && JSON.parse(receipt).source === from) return 'already_migrated';
      throw new Error('Destination already contains data; choose a new directory');
    }
    staging = await mkdtemp(path.join(parent, '.mcportal-migration-'));
    await cp(from, staging, { recursive: true, filter: async (file) => {
      const info = await lstat(file);
      if (!info.isDirectory() && !info.isFile()) throw new Error('Migration refuses symlinks and special files');
      return true;
    } });
    await chmod(staging, 0o700);
    await writeFile(path.join(staging, MARKER), JSON.stringify({ version: 1, source: from }) + '\n', { mode: 0o600 });
    await rename(staging, target);
    staging = undefined;
    return 'copied';
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}
