/** The one-time move from the file store into an empty database. */
import { processLogger } from '../lib/log.ts';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DocumentExperienceStore } from '../experiences.ts';
import { DocumentCollectionStore } from '../collections.ts';
import { memoryPersistence } from '../lib/document.ts';
import { validateProfile } from '../profile.ts';
import type { Queryable } from './schema.ts';

/**
 * One-time import of the file store (profiles and auth.json) into an empty
 * database. Never overwrites rows; files are left in place. Returns what it did.
 */
export async function importFiles(db: Queryable, dataDir: string): Promise<{ skipped: boolean; profiles: number; auth: boolean }> {
  // Additive new stores migrate even on databases whose older profile import already ran.
  for (const [file, key, validate] of [
    ['collections/data.json','collections',async (raw: string) => { const store = new DocumentCollectionStore(memoryPersistence(raw)); await store.list('__validate__'); }],
    ['experiences/data.json','reading-experiences',async (raw: string) => { const store = new DocumentExperienceStore(memoryPersistence(raw)); await store.owners(); }],
  ] as const) {
    let raw: string;
    try { raw = await readFile(path.join(dataDir,file),'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    await validate(raw);
    await db.query('INSERT INTO mcportal_kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',[key,raw]);
  }
  const done = await db.query(`SELECT 1 FROM mcportal_meta WHERE key = 'imported_files'`);
  if (done.rows.length) return { skipped: true, profiles: 0, auth: false };
  let names: string[] = [];
  try {
    names = await readdir(dataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let profiles = 0;
  let auth = false;
  for (const name of names) {
    if (!name.endsWith('.json') || name.includes('.corrupt-') || name.endsWith('.tmp')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
    } catch {
      processLogger().warn('storage.import_skipped', { file: name, why: 'unreadable' });
      continue;   // unreadable files stay on the volume for a human to look at
    }
    if (name === 'auth.json') {
      const r = await db.query(`INSERT INTO mcportal_kv (key, value) VALUES ('auth', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(parsed)]);
      auth = (r.rowCount ?? 0) > 0;
      continue;
    }
    try {
      validateProfile(parsed);
    } catch {
      processLogger().warn('storage.import_skipped', { file: name, why: 'not a valid profile' });
      continue;
    }
    const userId = name.slice(0, -'.json'.length);
    const r = await db.query(`INSERT INTO mcportal_profiles (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, JSON.stringify(parsed)]);
    profiles += r.rowCount ?? 0;
  }
  await db.query(`INSERT INTO mcportal_meta (key, value) VALUES ('imported_files', $1) ON CONFLICT (key) DO NOTHING`, [new Date().toISOString()]);
  return { skipped: false, profiles, auth };
}
