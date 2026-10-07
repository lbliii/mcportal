/**
 * MCPortal entry point.
 *
 *   node bin/mcportal.mjs            Streamable HTTP on $HOST:$PORT (default 127.0.0.1:8787) at /mcp
 *   node bin/mcportal.mjs --stdio    stdio transport (used by the local plugin)
 */
import { createInterface } from 'node:readline';
import { Accounts, bootstrapFromEnv } from './accounts.ts';
import { FileEditionStore } from './editions.ts';
import { FileHandoffStore } from './handoffs.ts';
import { FileReadingStore } from './reading.ts';
import { FileSeenStore } from './seen.ts';
import { FileClipStore } from './clips.ts';
import { deliverToFile } from './portability.ts';
import { PublicProfiles } from './public-profiles.ts';
import { Social } from './social.ts';
import { createApp, configFromEnv, type AppConfig } from './http.ts';
import { LocalSession } from './link/session.ts';
import { TtlCache } from './lib/cache.ts';
import { createFixtureFetcher } from './lib/fixture-fetch.ts';
import { safeFetch } from './lib/safe-fetch.ts';
import { retentionTasks, startHousekeeping } from './housekeeping.ts';
import { handleMessage, RPC, rpcError, type JsonRpcResponse } from './mcp.ts';
import { openStorage } from './storage.ts';
import { defaultDataDir, FileProfileStore } from './store.ts';
import { errorStack } from './lib/errors.ts';
import { loggerFromEnv, requestId } from './lib/log.ts';
import type { ToolContext } from './tools/kit.ts';

const log = loggerFromEnv();

/** Tells the stdio client to list tools again: signing in or out changes which ones apply. */
function stdioToolsChanged(): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n`);
}

/** `contextFor` is asked once per message: a local MCPortal can be signed in or out between them. */
function runStdio(contextFor: () => Promise<ToolContext>): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const work = (async () => {
      let response: JsonRpcResponse | JsonRpcResponse[] | null;
      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        payload = undefined;
      }
      if (payload === undefined) {
        response = rpcError(null, RPC.parseError, 'Parse error');
      } else {
        let base: ToolContext;
        try {
          base = await contextFor();
        } catch (error) {
          log.error('stdio.context_failed', { error: errorStack(error) });
          const id = typeof payload === 'object' && payload !== null && 'id' in payload ? (payload as { id: string | number | null }).id : null;
          if (!Array.isArray(payload) && id !== undefined) process.stdout.write(`${JSON.stringify(rpcError(id, RPC.internal, 'MCPortal could not read its settings in the data folder; see the logs.'))}\n`);
          return;
        }
        const lineCtx = { ...base, log: log.child({ req: requestId() }), toolsChanged: stdioToolsChanged };
        // Every request gets an answer: a host left waiting gives up on the whole server.
        const answer = (m: unknown) => handleMessage(m, lineCtx).catch((error: unknown) => {
          const ref = requestId();
          lineCtx.log.error('stdio.message_failed', { ref, error: errorStack(error) });
          const id = typeof m === 'object' && m !== null && 'id' in m ? (m as { id: string | number | null }).id : undefined;
          return id === undefined ? null : rpcError(id, RPC.internal, `MCPortal couldn't answer that (reference ${ref}); see the logs.`);
        });
        response = Array.isArray(payload)
          ? (await Promise.all(payload.slice(0, 20).map(answer))).filter((r): r is JsonRpcResponse => r !== null)
          : await answer(payload);
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
    const editions = new FileEditionStore(dataDir);
    const userId = process.env.MCPORTAL_USER || 'default';
    const session = new LocalSession({
      dataDir,
      localUser: userId,
      local: { store, reading, handoffs, seen, editions, clips },
      base: { fetcher, cache, log, deliver: (format) => deliverToFile(format, userId, { store, reading, clips }, dataDir) },
      hostedUrl: process.env.MCPORTAL_HOSTED_URL || undefined,
      onLinked: stdioToolsChanged,
    });
    // This computer's own handoffs and highlights expire too (a linked account's are the hosted server's to purge).
    startHousekeeping(retentionTasks({ handoffs, editions }), log);
    runStdio(() => session.context());
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
  const { store, reading, handoffs, seen, editions, clips, authPersistence, accountsPersistence, profilesPersistence, social: socialStore, storage, checkStorage } = await openStorage(dataDir, log);
  const accounts = new Accounts(accountsPersistence, { ...bootstrapFromEnv(process.env) });
  await accounts.load();
  const suspended = (id: string) => accounts.actor(id).status !== 'active';
  const publicProfiles = new PublicProfiles(profilesPersistence, { hidden: suspended });
  const social = new Social({ preferences: store, store: socialStore, profiles: publicProfiles, hidden: suspended, accountCreatedAt: (id) => accounts.createdAt(id) });
  // Running locally without auth (npm start): a local MCPortal that can sign in, like the stdio one.
  const local = storage === 'files' && !config.github && !config.staticToken && config.allowUnauthenticated;
  const session = local ? new LocalSession({
    dataDir,
    localUser: config.staticUser,
    local: { store, reading, handoffs, seen, editions, clips },
    base: { fetcher, cache, log, deliver: (format) => deliverToFile(format, config.staticUser, { store, reading, clips }, dataDir) },
    hostedUrl: process.env.MCPORTAL_HOSTED_URL || undefined,
  }) : undefined;
  const server = createApp(config, { store, reading, handoffs, seen, editions, clips, publicProfiles, social, fetcher, cache, log, authPersistence, storage, checkStorage, accounts, session });
  server.listen(config.port, config.host, () => {
    const mode = config.github ? `GitHub OAuth${config.allowedGithubUsers.length ? ` (allowed: ${config.allowedGithubUsers.join(', ')})` : ' (any GitHub user)'}` : config.staticToken ? 'static token' : 'no auth (loopback only)';
    log.info('http.ready', { host: config.host, port: config.port, publicUrl: config.publicUrl, auth: mode, storage: storage === 'postgres' ? 'postgres' : dataDir });
    if (config.allowUnauthenticated) log.info('preview.ready', { url: `${config.publicUrl}/preview` });
  });
}

const runDirectly = process.argv[1]?.endsWith('server.ts');
if (runDirectly) main();
