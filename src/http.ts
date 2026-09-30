/**
 * Streamable HTTP transport + OAuth + preview, as a testable app factory.
 *
 * Security posture:
 *   - binds to 127.0.0.1 unless HOST is set; refuses to listen on a public
 *     interface without auth (static token or GitHub OAuth) unless explicitly allowed;
 *   - Host header allowlist (real DNS-rebinding protection; the Origin check
 *     alone can't stop it because an attacker controls both headers);
 *   - never lets a malformed request crash the process.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { OAuthServer } from './auth/oauth.ts';
import { AuthStore, fileAuthPersistence, type AuthPersistence } from './auth/store.ts';
import { Accounts, bootstrapFromEnv } from './accounts.ts';
import { AdminPanel } from './admin.ts';
import { DEFAULT_SUPPORT_URL, serveSite, type SiteConfig } from './site.ts';
import { limitsFromEnv, UsageBudget, type BudgetLimits } from './lib/budget.ts';
import type { TtlCache } from './lib/cache.ts';
import { isLoopbackHost } from './lib/ip.ts';
import { handleMessage, RPC, rpcError, SERVER_INFO, workspaceHtml, type JsonRpcResponse, type Log } from './mcp.ts';
import { FileClipStore, type ClipStore } from './clips.ts';
import type { ProfileStore } from './store.ts';
import type { ToolContext } from './tools.ts';
import type { Fetcher } from './types.ts';

export const MAX_BODY_BYTES = 1_000_000;
export const MAX_BATCH = 20;

export interface AppConfig {
  host: string;
  port: number;
  publicUrl: string;
  staticToken?: string;
  staticUser: string;
  github?: { clientId: string; clientSecret: string };
  allowedGithubUsers: string[];
  allowedHosts: string[];
  allowedOrigins: string[];
  allowUnauthenticated: boolean;
  /** Behind a reverse proxy (Railway): use the last X-Forwarded-For hop for per-IP limits. */
  trustProxy: boolean;
  dataDir: string;
  /** Per-user tool budget (MCPORTAL_LIMIT_PER_MINUTE / _PER_DAY / _GLOBAL_PER_DAY). */
  limits?: Partial<BudgetLimits>;
  /** The public pages: support link (MCPORTAL_SUPPORT_URL) and operator name (MCPORTAL_OPERATOR). */
  site?: Pick<SiteConfig, 'supportUrl' | 'operator'>;
}

export interface AppDeps {
  store: ProfileStore;
  /** Clips; defaults to files under the data directory. */
  clips?: ClipStore;
  fetcher: Fetcher;
  cache: TtlCache;
  log?: Log;
  now?: () => number;
  budget?: UsageBudget;
  /** Where OAuth state persists; defaults to auth.json in the data directory. */
  authPersistence?: AuthPersistence;
  /** Accounts, invites and roles; defaults to accounts.json in the data directory with bootstrap from the env. */
  accounts?: Accounts;
  /** Reported by /health. */
  storage?: 'files' | 'postgres';
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function configFromEnv(env: NodeJS.ProcessEnv, dataDir: string): AppConfig {
  const port = Number(env.PORT ?? 8787);
  const host = env.HOST || '127.0.0.1';
  const railway = env.RAILWAY_PUBLIC_DOMAIN;
  const publicUrl = (env.MCPORTAL_PUBLIC_URL || (railway ? `https://${railway}` : `http://localhost:${port}`)).replace(/\/+$/, '');
  const github = env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : undefined;
  const staticToken = env.MCPORTAL_TOKEN || undefined;
  const hasAuth = Boolean(staticToken || github);
  const config: AppConfig = {
    host,
    port,
    publicUrl,
    staticToken,
    staticUser: env.MCPORTAL_USER || 'default',
    github,
    allowedGithubUsers: list(env.MCPORTAL_ALLOWED_GITHUB_USERS).map((u) => u.toLowerCase()),
    allowedHosts: ['localhost', '127.0.0.1', '::1', new URL(publicUrl).hostname, ...(railway ? [railway] : []), ...list(env.MCPORTAL_ALLOWED_HOSTS)].map((h) =>
      h.toLowerCase().replace(/^\[|\]$/g, ''),
    ),
    allowedOrigins: list(env.MCPORTAL_ALLOWED_ORIGINS),
    allowUnauthenticated: env.MCPORTAL_ALLOW_UNAUTHENTICATED === '1' || (!hasAuth && isLoopbackHost(host)),
    trustProxy: env.MCPORTAL_TRUST_PROXY === '1' || Boolean(env.RAILWAY_ENVIRONMENT),
    dataDir,
    limits: limitsFromEnv(env),
    site: { supportUrl: env.MCPORTAL_SUPPORT_URL || DEFAULT_SUPPORT_URL, operator: env.MCPORTAL_OPERATOR || undefined },
  };
  if (!hasAuth && !isLoopbackHost(host) && env.MCPORTAL_ALLOW_UNAUTHENTICATED !== '1') {
    throw new Error(
      `Refusing to listen on ${host} without authentication. Set GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET (OAuth) or MCPORTAL_TOKEN, or MCPORTAL_ALLOW_UNAUTHENTICATED=1 if you really mean it.`,
    );
  }
  return config;
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json', extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function hostnameOf(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return undefined;
  }
}

export function createApp(config: AppConfig, deps: AppDeps): Server {
  const log = deps.log ?? ((m: string) => process.stderr.write(`[mcportal] ${m}\n`));
  // Normally passed in by server.ts; otherwise accounts.json next to the other data, bootstrapped from the env.
  const accounts = deps.accounts ?? new Accounts(fileAuthPersistence(config.dataDir, 'accounts.json'), bootstrapFromEnv(process.env, config.allowedGithubUsers), deps.now);
  const oauth = config.github
    ? new OAuthServer(
        { publicUrl: config.publicUrl, github: config.github, allowedGithubUsers: config.allowedGithubUsers, trustProxy: config.trustProxy },
        new AuthStore(deps.authPersistence ?? config.dataDir, deps.now),
        deps.fetcher,
        deps.now,
        accounts,
      )
    : undefined;

  // The admin page needs GitHub sign-in; without it, admins use the `mcportal admin` CLI.
  const admin = oauth ? new AdminPanel(accounts, oauth, config.publicUrl, deps.now) : undefined;
  const budget = deps.budget ?? new UsageBudget(config.limits ?? {}, deps.now);
  const site: SiteConfig = { supportUrl: DEFAULT_SUPPORT_URL, ...config.site, publicUrl: config.publicUrl, inviteOnly: Boolean(oauth) && !accounts.openSignup };
  const clips = deps.clips ?? new FileClipStore(config.dataDir);
  const context = (userId: string): ToolContext => ({ store: deps.store, clips, fetcher: deps.fetcher, cache: deps.cache, userId, budget, actor: accounts.actor(userId) });

  /** The user for a request, or undefined if it isn't authenticated. */
  async function authenticate(req: IncomingMessage): Promise<string | undefined> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token) {
      if (config.staticToken && tokenMatches(token, config.staticToken)) return config.staticUser;
      if (oauth) return oauth.authenticate(token);
      return undefined;
    }
    return config.allowUnauthenticated ? config.staticUser : undefined;
  }

  function unauthorized(res: ServerResponse): void {
    const challenge = oauth ? `Bearer resource_metadata="${oauth.resourceMetadataUrl}", scope="mcportal"` : 'Bearer';
    send(res, 401, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Unauthorized')), 'application/json', { 'www-authenticate': challenge });
  }

  async function handlePayload(payload: unknown, ctx: ToolContext): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
      if (payload.length === 0 || payload.length > MAX_BATCH) return rpcError(null, RPC.invalidRequest, `Batch must have 1-${MAX_BATCH} messages`);
      const results = (await Promise.all(payload.map((m) => handleMessage(m, ctx, log)))).filter((r): r is JsonRpcResponse => r !== null);
      return results.length ? results : null;
    }
    return handleMessage(payload, ctx, log);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const hostname = hostnameOf(req.headers.host);
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://placeholder');
    } catch {
      return send(res, 400, JSON.stringify({ error: 'bad request' }));
    }
    // Health checks come from the platform with its own Host header.
    if (url.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, ...SERVER_INFO, storage: deps.storage ?? 'files' }));
    if (!hostname || !config.allowedHosts.includes(hostname)) {
      return send(res, 421, JSON.stringify({ error: 'unknown host; set MCPORTAL_PUBLIC_URL or MCPORTAL_ALLOWED_HOSTS' }));
    }
    const origin = req.headers.origin;
    if (origin && url.pathname === '/mcp') {
      const originHost = hostnameOf(origin.replace(/^[a-z]+:\/\//i, ''));
      if (!config.allowedOrigins.includes(origin) && !(originHost && config.allowedHosts.includes(originHost))) {
        return send(res, 403, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Origin not allowed')));
      }
    }
    if (oauth && (await oauth.handle(req, res, url))) return;
    if (admin && (await admin.handle(req, res, url))) return;

    if (req.method === 'GET' && (await serveSite(res, url.pathname, site))) return;

    if (url.pathname === '/preview' && req.method === 'GET') {
      // The page itself holds no secrets. With a static token, the page asks for it
      // (kept in sessionStorage), so it never lands in a URL, history or logs.
      if (!config.allowUnauthenticated && !config.staticToken) {
        return send(res, 404, 'The preview is available locally or with MCPORTAL_TOKEN set.', 'text/plain; charset=utf-8');
      }
      const html = await workspaceHtml({ dev: true, needsToken: !config.allowUnauthenticated });
      return send(res, 200, html, 'text/html; charset=utf-8', {
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      });
    }

    if (url.pathname !== '/mcp') return send(res, 404, JSON.stringify({ error: 'not found' }));
    const userId = await authenticate(req);
    if (!userId) return unauthorized(res);
    if (req.method !== 'POST') {
      // Stateless server: no server-initiated SSE stream and no sessions to delete.
      return send(res, 405, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Method not allowed')), 'application/json', { allow: 'POST' });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      const status = (error as { status?: number }).status ?? 400;
      return send(res, status, JSON.stringify(rpcError(null, RPC.parseError, status === 413 ? 'Body too large' : 'Parse error')));
    }
    const response = await handlePayload(payload, context(userId));
    if (response === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    return send(res, 200, JSON.stringify(response));
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      log(`http error: ${(error as Error).stack ?? error}`);
      send(res, 500, JSON.stringify(rpcError(null, RPC.internal, 'Internal error')));
    });
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  return server;
}
