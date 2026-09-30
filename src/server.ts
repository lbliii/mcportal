/**
 * MCPortal server entry point.
 *
 *   node src/server.ts            Streamable HTTP on $PORT (default 8787) at /mcp
 *   node src/server.ts --stdio    stdio transport (used by the local plugin)
 *
 * HTTP extras: GET /health, GET / (about), GET /preview (the workspace UI in a
 * normal browser tab, talking to /mcp directly, for development and demos).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createInterface } from 'node:readline';
import { TtlCache } from './lib/cache.ts';
import { createFixtureFetcher } from './lib/fixture-fetch.ts';
import { safeFetch } from './lib/safe-fetch.ts';
import { handleMessage, RPC, rpcError, SERVER_INFO, workspaceHtml, type JsonRpcResponse } from './mcp.ts';
import { FileProfileStore, defaultDataDir } from './store.ts';
import type { ToolContext } from './tools.ts';

const log = (message: string) => process.stderr.write(`[mcportal] ${message}\n`);

export function createContext(): ToolContext {
  const fixtures = process.env.MCPORTAL_FIXTURES === '1';
  if (fixtures) log('fixtures mode: serving canned data from test/fixtures (no network)');
  return {
    store: new FileProfileStore(defaultDataDir()),
    fetcher: fixtures ? createFixtureFetcher() : safeFetch,
    cache: new TtlCache(),
    // Phase 1 is single-user per deployment. OAuth + per-user ids come with multi-tenant hosting.
    userId: process.env.MCPORTAL_USER || 'default',
  };
}

async function handlePayload(payload: unknown, ctx: ToolContext): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return rpcError(null, RPC.invalidRequest, 'Empty batch');
    const results = (await Promise.all(payload.map((m) => handleMessage(m, ctx, log)))).filter((r): r is JsonRpcResponse => r !== null);
    return results.length ? results : null;
  }
  return handleMessage(payload, ctx, log);
}

// ---------------------------------------------------------------- stdio

function runStdio(ctx: ToolContext): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let response: JsonRpcResponse | JsonRpcResponse[] | null;
    try {
      response = await handlePayload(JSON.parse(line), ctx);
    } catch {
      response = rpcError(null, RPC.parseError, 'Parse error');
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  log(`stdio ready (data: ${defaultDataDir()})`);
}

// ---------------------------------------------------------------- http

const MAX_BODY = 1_000_000;

function send(res: ServerResponse, status: number, body: string, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('Body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** DNS-rebinding protection: browsers may only call /mcp from our own origin or an allowlisted one. */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (new URL(origin).host === req.headers.host) return true;
  } catch {
    return false;
  }
  const allowed = (process.env.MCPORTAL_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function authorized(req: IncomingMessage, url: URL): boolean {
  const token = process.env.MCPORTAL_TOKEN;
  if (!token) return true;
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${token}` || url.searchParams.get('token') === token;
}

const ABOUT = (base: string) => `<!doctype html><meta charset="utf-8"><title>MCPortal</title>
<body style="font:15px/1.5 system-ui;max-width:640px;margin:48px auto;padding:0 16px">
<h1>MCPortal</h1>
<p>A personal, agent-composed workspace. This is its MCP server.</p>
<p>MCP endpoint (Streamable HTTP): <code>${base}/mcp</code></p>
<p><a href="/preview">Open the workspace preview</a> · <a href="/health">health</a></p>
</body>`;

function runHttp(ctx: ToolContext): void {
  const port = Number(process.env.PORT ?? 8787);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, ...SERVER_INFO }));
      if (url.pathname === '/' && req.method === 'GET') {
        const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
        return send(res, 200, ABOUT(`${proto}://${req.headers.host}`), 'text/html; charset=utf-8');
      }
      if (url.pathname === '/preview' && req.method === 'GET') {
        if (!authorized(req, url)) return send(res, 401, 'Add ?token=… to open the preview', 'text/plain');
        const html = await workspaceHtml({ dev: true, token: url.searchParams.get('token') ?? undefined });
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      if (url.pathname !== '/mcp') return send(res, 404, JSON.stringify({ error: 'not found' }));

      if (!originAllowed(req)) return send(res, 403, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Origin not allowed')));
      if (!authorized(req, url)) {
        res.setHeader('www-authenticate', 'Bearer');
        return send(res, 401, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Unauthorized')));
      }
      if (req.method !== 'POST') {
        // Stateless server: no server-initiated SSE stream and no sessions to delete.
        res.setHeader('allow', 'POST');
        return send(res, 405, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Method not allowed')));
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, JSON.stringify(rpcError(null, RPC.parseError, 'Parse error')));
      }
      const response = await handlePayload(payload, ctx);
      if (response === null) {
        res.writeHead(202);
        return res.end();
      }
      return send(res, 200, JSON.stringify(response));
    } catch (error) {
      log(`http error: ${(error as Error).message}`);
      return send(res, 500, JSON.stringify(rpcError(null, RPC.internal, 'Internal error')));
    }
  });
  server.listen(port, () => {
    log(`http ready on :${port}  MCP: /mcp  preview: http://localhost:${port}/preview  data: ${defaultDataDir()}`);
    if (!process.env.MCPORTAL_TOKEN) log('warning: MCPORTAL_TOKEN is not set; anyone who can reach this server can use it');
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts');
if (isMain) {
  const ctx = createContext();
  if (process.argv.includes('--stdio')) runStdio(ctx);
  else runHttp(ctx);
}
