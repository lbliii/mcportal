/**
 * MCPortal entry point.
 *
 *   node bin/mcportal.mjs            Streamable HTTP on $HOST:$PORT (default 127.0.0.1:8787) at /mcp
 *   node bin/mcportal.mjs --stdio    stdio transport (used by the local plugin)
 */
import { createInterface } from 'node:readline';
import { createApp, configFromEnv, type AppConfig } from './http.ts';
import { TtlCache } from './lib/cache.ts';
import { createFixtureFetcher } from './lib/fixture-fetch.ts';
import { safeFetch } from './lib/safe-fetch.ts';
import { handleMessage, RPC, rpcError, type JsonRpcResponse } from './mcp.ts';
import { defaultDataDir, FileProfileStore } from './store.ts';
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

export function main(argv = process.argv): void {
  process.on('unhandledRejection', (error) => log(`unhandled rejection: ${(error as Error)?.stack ?? error}`));
  process.on('uncaughtException', (error) => log(`uncaught exception: ${error.stack ?? error}`));

  const fixtures = process.env.MCPORTAL_FIXTURES === '1';
  if (fixtures) log('fixtures mode: serving canned data from test/fixtures (no network)');
  const dataDir = defaultDataDir();
  const store = new FileProfileStore(dataDir);
  const fetcher = fixtures ? createFixtureFetcher() : safeFetch;
  const cache = new TtlCache();

  if (argv.includes('--stdio')) {
    runStdio({ store, fetcher, cache, userId: process.env.MCPORTAL_USER || 'default' });
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
  const server = createApp(config, { store, fetcher, cache, log });
  server.listen(config.port, config.host, () => {
    const mode = config.github ? `GitHub OAuth${config.allowedGithubUsers.length ? ` (allowed: ${config.allowedGithubUsers.join(', ')})` : ' (any GitHub user)'}` : config.staticToken ? 'static token' : 'no auth (loopback only)';
    log(`http on ${config.host}:${config.port}  public URL: ${config.publicUrl}  auth: ${mode}  data: ${dataDir}`);
    if (config.allowUnauthenticated) log(`preview: ${config.publicUrl}/preview`);
  });
}

const runDirectly = process.argv[1]?.endsWith('server.ts');
if (runDirectly) main();
