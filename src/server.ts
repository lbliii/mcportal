/**
 * MCPortal entry point.
 *
 *   node bin/mcportal.mjs            Streamable HTTP on $HOST:$PORT (default 127.0.0.1:8787) at /mcp
 *   node bin/mcportal.mjs --stdio    stdio transport (used by the local plugin)
 */
import { createInterface } from 'node:readline';
import { Accounts, bootstrapFromEnv } from './accounts.ts';
import { FileClipStore, type ClipStore } from './clips.ts';
import { deliverToFile } from './portability.ts';
import { PublicProfiles } from './public-profiles.ts';
import { fileAuthPersistence, type AuthPersistence } from './auth/store.ts';
import { createApp, configFromEnv, type AppConfig } from './http.ts';
import { TtlCache } from './lib/cache.ts';
import { createFixtureFetcher } from './lib/fixture-fetch.ts';
import { safeFetch } from './lib/safe-fetch.ts';
import { handleMessage, RPC, rpcError, type JsonRpcResponse } from './mcp.ts';
import { defaultDataDir, FileProfileStore, type ProfileStore } from './store.ts';
import type { ToolContext } from './tools.ts';

const log = (message: string) => process.stderr.write(`[mcportal] ${message}\n`);

function runStdio(ctx: ToolContext): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const work = (async () => {
      let response: JsonRpcResponse | JsonRpcResponse[] | null;
      try {
        const payload: unknown = JSON.parse(line);
        response = Array.isArray(payload)
          ? (await Promise.all(payload.slice(0, 20).map((m) => handleMessage(m, ctx, log)))).filter((r): r is JsonRpcResponse => r !== null)
          : await handleMessage(payload, ctx, log);
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
  log(`stdio ready (data: ${defaultDataDir()})`);
}

/** Postgres when DATABASE_URL is set (hosted), otherwise files in the data directory. */
async function openStorage(dataDir: string): Promise<{ store: ProfileStore; clips: ClipStore; authPersistence?: AuthPersistence; accountsPersistence: AuthPersistence; profilesPersistence: AuthPersistence; storage: 'files' | 'postgres' }> {
  const url = process.env.DATABASE_URL;
  if (!url) return { store: new FileProfileStore(dataDir), clips: new FileClipStore(dataDir), accountsPersistence: fileAuthPersistence(dataDir, 'accounts.json'), profilesPersistence: fileAuthPersistence(dataDir, 'public-profiles.json'), storage: 'files' };
  const { connect, ensureSchema, importFiles, PgClipStore, PgProfileStore, pgAuthPersistence } = await import('./db.ts');
  const db = await connect(url);
  await ensureSchema(db);
  const imported = await importFiles(db, dataDir);
  if (!imported.skipped) log(`imported from ${dataDir}: ${imported.profiles} profile(s)${imported.auth ? ', OAuth state' : ''}`);
  return { store: new PgProfileStore(db), clips: new PgClipStore(db), authPersistence: pgAuthPersistence(db), accountsPersistence: pgAuthPersistence(db, 'accounts'), profilesPersistence: pgAuthPersistence(db, 'public-profiles'), storage: 'postgres' };
}

export function main(argv = process.argv): void {
  void start(argv).catch((error) => {
    log(`startup failed: ${(error as Error).stack ?? error}`);
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
  process.on('unhandledRejection', (error) => log(`unhandled rejection: ${(error as Error)?.stack ?? error}`));
  process.on('uncaughtException', (error) => log(`uncaught exception: ${error.stack ?? error}`));

  const fixtures = process.env.MCPORTAL_FIXTURES === '1';
  if (fixtures) log('fixtures mode: serving canned data from test/fixtures (no network)');
  const dataDir = defaultDataDir();
  const fetcher = fixtures ? createFixtureFetcher() : safeFetch;
  const cache = new TtlCache();

  if (argv.includes('--stdio')) {
    // Local, single user: always files, never the hosted database.
    const store = new FileProfileStore(dataDir);
    const clips = new FileClipStore(dataDir);
    const userId = process.env.MCPORTAL_USER || 'default';
    runStdio({ store, clips, fetcher, cache, userId, localFiles: true, deliver: (format) => deliverToFile(format, userId, { store, clips }, dataDir) });
    return;
  }

  let config: AppConfig;
  try {
    config = configFromEnv(process.env, dataDir);
  } catch (error) {
    log((error as Error).message);
    process.exitCode = 1;
    return;
  }
  const { store, clips, authPersistence, accountsPersistence, profilesPersistence, storage } = await openStorage(dataDir);
  const accounts = new Accounts(accountsPersistence, { ...bootstrapFromEnv(process.env) });
  await accounts.load();
  const publicProfiles = new PublicProfiles(profilesPersistence, { hidden: (id) => accounts.actor(id).status !== 'active' });
  const server = createApp(config, { store, clips, publicProfiles, fetcher, cache, log, authPersistence, storage, accounts });
  server.listen(config.port, config.host, () => {
    const mode = config.github ? `GitHub OAuth${config.allowedGithubUsers.length ? ` (allowed: ${config.allowedGithubUsers.join(', ')})` : ' (any GitHub user)'}` : config.staticToken ? 'static token' : 'no auth (loopback only)';
    log(`http on ${config.host}:${config.port}  public URL: ${config.publicUrl}  auth: ${mode}  storage: ${storage === 'postgres' ? 'postgres' : dataDir}`);
    if (config.allowUnauthenticated) log(`preview: ${config.publicUrl}/preview`);
  });
}

const runDirectly = process.argv[1]?.endsWith('server.ts');
if (runDirectly) main();
