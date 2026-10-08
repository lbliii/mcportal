/**
 * Where a server keeps its data: Postgres when DATABASE_URL is set (hosted), otherwise
 * files in the data directory. The server and the admin CLI open it the same way.
 */
import { FileWatchStore, type WatchStore } from './watches.ts';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { fileAuthPersistence, type AuthPersistence } from './auth/store.ts';
import { FileClipStore, type ClipStore } from './clips.ts';
import { DocumentCollectionStore, FileCollectionStore, type CollectionStore } from './collections.ts';
import { DocumentExperienceStore, FileExperienceStore, type ExperienceStore } from './experiences.ts';
import { FileEditionStore, type EditionStore } from './editions.ts';
import { FileHandoffStore, type HandoffStore } from './handoffs.ts';
import type { Logger } from './lib/log.ts';
import { FileReadingStore, type ReadingStore } from './reading.ts';
import { FileSeenStore, type SeenStore } from './seen.ts';
import { DocumentSocialStore, type SocialStore } from './social.ts';
import { FileProfileStore, type ProfileStore } from './store.ts';

export interface Storage {
  store: ProfileStore;
  reading: ReadingStore;
  watchStore: WatchStore;
  handoffs: HandoffStore;
  seen: SeenStore;
  editions: EditionStore;
  clips: ClipStore;
  collections: CollectionStore;
  experiences: ExperienceStore;
  /** OAuth state; absent with files, where it's auth.json in the data directory. */
  authPersistence?: AuthPersistence;
  accountsPersistence: AuthPersistence;
  profilesPersistence: AuthPersistence;
  social: SocialStore;
  storage: 'files' | 'postgres';
  checkStorage: () => Promise<void>;
  /** Close the database connection (the CLI does; the server runs until it exits). */
  close: () => Promise<void>;
}

/** The data directory exists (a fresh install creates it) and can be written. */
async function writableDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await access(dir, constants.W_OK);
}

export async function openStorage(dataDir: string, log: Logger): Promise<Storage> {
  const url = process.env.DATABASE_URL;
  if (!url) return { store: new FileProfileStore(dataDir), reading: new FileReadingStore(dataDir), watchStore: new FileWatchStore(dataDir), handoffs: new FileHandoffStore(dataDir), seen: new FileSeenStore(dataDir), editions: new FileEditionStore(dataDir), clips: new FileClipStore(dataDir), collections: new FileCollectionStore(dataDir), experiences: new FileExperienceStore(dataDir), accountsPersistence: fileAuthPersistence(dataDir, 'accounts.json'), profilesPersistence: fileAuthPersistence(dataDir, 'public-profiles.json'), social: new DocumentSocialStore(fileAuthPersistence(dataDir, 'social.json')), storage: 'files', checkStorage: () => writableDir(dataDir), close: async () => {} };
  const { connect, ensureSchema, importFiles, importWatchFiles, PgClipStore, PgEditionStore, PgHandoffStore, PgReadingStore, PgWatchStore, PgSeenStore, PgProfileStore, PgSocialStore, pgAuthPersistence } = await import('./db.ts');
  const db = await connect(url);
  await ensureSchema(db);
  const imported = await importFiles(db, dataDir);
  await importWatchFiles(db, dataDir);
  if (!imported.skipped) log.info('storage.imported', { from: dataDir, profiles: imported.profiles, auth: imported.auth });
  return { store: new PgProfileStore(db), reading: new PgReadingStore(db), watchStore: new PgWatchStore(db), handoffs: new PgHandoffStore(db), seen: new PgSeenStore(db), editions: new PgEditionStore(db), clips: new PgClipStore(db), collections: new DocumentCollectionStore(pgAuthPersistence(db, 'collections')), experiences: new DocumentExperienceStore(pgAuthPersistence(db, 'reading-experiences')), authPersistence: pgAuthPersistence(db), accountsPersistence: pgAuthPersistence(db, 'accounts'), profilesPersistence: pgAuthPersistence(db, 'public-profiles'), social: new PgSocialStore(db), storage: 'postgres', checkStorage: async () => { await db.query('SELECT 1'); }, close: async () => { await db.end?.(); } };
}
