/**
 * MCPortal entry point.
 *
 *   node bin/mcportal.mjs            Streamable HTTP on $HOST:$PORT (default 127.0.0.1:8787) at /mcp
 *   node bin/mcportal.mjs --stdio    stdio transport (used by the local plugin)
 */
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Accounts, bootstrapFromEnv } from './accounts.ts';
import { FileHandoffStore, type HandoffStore } from './handoffs.ts';
import { FileReadingStore, type ReadingStore } from './reading.ts';
import { FileSeenStore, type SeenStore } from './seen.ts';
import { FileClipStore, type ClipStore } from './clips.ts';
import { deliverToFile } from './portability.ts';
import { PublicProfiles } from './public-profiles.ts';
import { DocumentSocialStore, Social, type SocialStore } from './social.ts';
import { fileAuthPersistence, type AuthPersistence } from './auth/store.ts';
import { createApp, configFromEnv, type AppConfig } from './http.ts';
import { TtlCache } from './lib/cache.ts';
import { createFixtureFetcher } from './lib/fixture-fetch.ts';
import { safeFetch } from './lib/safe-fetch.ts';
import { handleMessage, RPC, rpcError, type JsonRpcResponse } from './mcp.ts';
import { defaultDataDir, FileProfileStore, type ProfileStore } from './store.ts';
import { errorStack } from './lib/errors.ts';
import { loggerFromEnv, requestId } from './lib/log.ts';
import type { ToolContext } from './tools/kit.ts';

const log = loggerFromEnv();

function runStdio(ctx: ToolContext): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const lineCtx = { ...ctx, log: log.child({ req: requestId() }) };
    const work = (async () => {
      let response: JsonRpcResponse | JsonRpcResponse[] | null;
      try {
        const payload: unknown = JSON.parse(line);
        response = Array.isArray(payload)
          ? (await Promise.all(payload.slice(0, 20).map((m) => handleMessage(m, lineCtx)))).filter((r): r is JsonRpcResponse => r !== null)
          : await handleMessage(payload, lineCtx);
      } catch {
        response = rpcError(null, RPC.parseError, 'Parse error');
      }
      if (response && (!Array.isArray(response) || response.length)) process.stdout.write(`${JSON.stringify(response)}\n`);
    })();
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  // When the client closes stdin, finish in-flight requests before exiting.
  rl.on('close', () => {
    void Promise.allSettled([...pending]).then(() => process.exit(0));
  });
  log.info('stdio.ready', { data: defaultDataDir() });
}

/** The data directory exists (a fresh install creates it) and can be written. */
async function writableDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await access(dir, constants.W_OK);
}

/** Postgres when DATABASE_URL is set (hosted), otherwise files in the data directory. */
async function openStorage(dataDir: string): Promise<{ store: ProfileStore; reading: ReadingStore; handoffs: HandoffStore; seen: SeenStore; clips: ClipStore; authPersistence?: AuthPersistence; accountsPersistence: AuthPersistence; profilesPersistence: AuthPersistence; social: SocialStore; storage: 'files' | 'postgres'; checkStorage: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (!url) return { store: new FileProfileStore(dataDir), reading: new FileReadingStore(dataDir), handoffs: new FileHandoffStore(dataDir), seen: new FileSeenStore(dataDir), clips: new FileClipStore(dataDir), accountsPersistence: fileAuthPersistence(dataDir, 'accounts.json'), profilesPersistence: fileAuthPersistence(dataDir, 'public-profiles.json'), social: new DocumentSocialStore(fileAuthPersistence(dataDir, 'social.json')), storage: 'files', checkStorage: () => writableDir(dataDir) };
  const { connect, ensureSchema, importFiles, PgClipStore, PgHandoffStore, PgReadingStore, PgSeenStore, PgProfileStore, PgSocialStore, pgAuthPersistence } = await import('./db.ts');
  const db = await connect(url);
  await ensureSchema(db);
  const imported = await importFiles(db, dataDir);
  if (!imported.skipped) log.info('storage.imported', { from: dataDir, profiles: imported.profiles, auth: imported.auth });
  return { store: new PgProfileStore(db), reading: new PgReadingStore(db), handoffs: new PgHandoffStore(db), seen: new PgSeenStore(db), clips: new PgClipStore(db), authPersistence: pgAuthPersistence(db), accountsPersistence: pgAuthPersistence(db, 'accounts'), profilesPersistence: pgAuthPersistence(db, 'public-profiles'), social: new PgSocialStore(db), storage: 'postgres', checkStorage: async () => { await db.query('SELECT 1'); } };
}

export function main(argv = process.argv): void {
  void start(argv).catch((error) => {
    log.error('startup.failed', { error: errorStack(error) });
    process.exitCode = 1;
  });
}

async function start(argv: string[]): Promise<void> {
  const adminAt = argv.indexOf('admin');
  if (adminAt !== -1 && adminAt <= 2) {
    const { runAdmin } = await import('./admin-cli.ts');
    process.exitCode = await runAdmin(argv.slice(adminAt + 1), defaultDataDir());
    return;
  }
  process.on('unhandledRejection', (error) => log.error('process.unhandled_rejection', { error: errorStack(error) }));
  process.on('uncaughtException', (error) => log.error('process.uncaught_exception', { error: errorStack(error) }));

  const fixtures = process.env.MCPORTAL_FIXTURES === '1';
  if (fixtures) log.info('fixtures.on', { note: 'serving canned data from test/fixtures (no network)' });
  const dataDir = defaultDataDir();
  const fetcher = fixtures ? createFixtureFetcher() : safeFetch;
  const cache = new TtlCache();

  if (argv.includes('--stdio')) {
    // Local, single user: always files, never the hosted database.
    const store = new FileProfileStore(dataDir);
    const clips = new FileClipStore(dataDir);
    const reading = new FileReadingStore(dataDir);
    const handoffs = new FileHandoffStore(dataDir);
    const seen = new FileSeenStore(dataDir);
    const userId = process.env.MCPORTAL_USER || 'default';
    runStdio({ store, reading, handoffs, seen, clips, fetcher, cache, userId, localFiles: true, deliver: (format) => deliverToFile(format, userId, { store, reading, clips }, dataDir) });
    return;
  }

  let config: AppConfig;
  try {
    config = configFromEnv(process.env, dataDir);
  } catch (error) {
    log.error('config.invalid', { error: (error as Error).message });
    process.exitCode = 1;
    return;
  }
  const { store, reading, handoffs, seen, clips, authPersistence, accountsPersistence, profilesPersistence, social: socialStore, storage, checkStorage } = await openStorage(dataDir);
  const accounts = new Accounts(accountsPersistence, { ...bootstrapFromEnv(process.env) });
  await accounts.load();
  const suspended = (id: string) => accounts.actor(id).status !== 'active';
  const publicProfiles = new PublicProfiles(profilesPersistence, { hidden: suspended });
  const social = new Social({ store: socialStore, profiles: publicProfiles, hidden: suspended });
  const server = createApp(config, { store, reading, handoffs, seen, clips, publicProfiles, social, fetcher, cache, log, authPersistence, storage, checkStorage, accounts });
  server.listen(config.port, config.host, () => {
    const mode = config.github ? `GitHub OAuth${config.allowedGithubUsers.length ? ` (allowed: ${config.allowedGithubUsers.join(', ')})` : ' (any GitHub user)'}` : config.staticToken ? 'static token' : 'no auth (loopback only)';
    log.info('http.ready', { host: config.host, port: config.port, publicUrl: config.publicUrl, auth: mode, storage: storage === 'postgres' ? 'postgres' : dataDir });
    if (config.allowUnauthenticated) log.info('preview.ready', { url: `${config.publicUrl}/preview` });
  });
}

const runDirectly = process.argv[1]?.endsWith('server.ts');
if (runDirectly) main();
