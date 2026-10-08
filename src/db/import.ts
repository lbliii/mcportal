/** The one-time move from the file store into an empty database. */
import { processLogger } from '../lib/log.ts';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FileWatchStore } from '../watches.ts';
import { validateProfile } from '../profile.ts';
import type { Queryable } from './schema.ts';

/**
 * One-time import of the file store (profiles and auth.json) into an empty
 * database. Never overwrites rows; files are left in place. Returns what it did.
 */
export async function importFiles(db: Queryable, dataDir: string): Promise<{ skipped: boolean; profiles: number; auth: boolean }> {
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

/** Store follows have a separate import marker so existing databases can adopt them too. */
export async function importWatchFiles(db:Queryable,dataDir:string):Promise<number> {
  if((await db.query("SELECT 1 FROM mcportal_meta WHERE key='imported_watch_files'")).rows.length)return 0;
  const files=new FileWatchStore(dataDir);
  const {rows}=await db.query<{user_id:string}>('SELECT user_id FROM mcportal_profiles');
  let count=0;
  for(const {user_id} of rows){
    const watches=await files.list(user_id);
    if(!watches.length)continue;
    const inserted=await db.query('INSERT INTO mcportal_watches(user_id,data) VALUES($1,$2) ON CONFLICT DO NOTHING',[user_id,JSON.stringify({version:1,watches})]);
    if(inserted.rowCount)count+=watches.length;
  }
  await db.query("INSERT INTO mcportal_meta(key,value) VALUES('imported_watch_files',$1) ON CONFLICT DO NOTHING",[new Date().toISOString()]);
  return count;
}
