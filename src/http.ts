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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { OAuthServer } from './auth/oauth.ts';
import { AuthStore, fileAuthPersistence, type AuthPersistence } from './auth/store.ts';
import { Accounts, bootstrapFromEnv } from './accounts.ts';
import { AccountPage, MAX_UPLOAD } from './account.ts';
import { AdminPanel } from './admin.ts';
import { buildExport, deliverToFile, describeImport, EXPORT_FORMATS, importExport, parseExport, type ExportFormat } from './portability.ts';
import type { PublicProfiles } from './public-profiles.ts';
import type { Social } from './social.ts';
import { DEFAULT_SUPPORT_URL, serveSite, type SiteConfig } from './site.ts';
import { budgetMessage, limitsFromEnv, UsageBudget, type BudgetLimits } from './lib/budget.ts';
import { authorize, localActor } from './access.ts';
import type { TtlCache } from './lib/cache.ts';
import { isLoopbackHost } from './lib/ip.ts';
import { errorCode, errorMessage, errorStack, isAppError } from './lib/errors.ts';
import { safeEqual } from './lib/ids.ts';
import { createLogger, requestId, type Logger } from './lib/log.ts';
import { ToolMetrics } from './lib/metrics.ts';
import { readBody, sendHtml } from './lib/web.ts';
import { page } from './page.ts';
import { handleMessage, RPC, rpcError, SERVER_INFO, roomHtml, type JsonRpcResponse } from './mcp.ts';
import { API_EXPORT_PATH, API_IMPORT_PATH, API_PATH, CLIENT_HEADER, handleCalls, MIN_CLIENT_VERSION, versionAtLeast } from './api/calls.ts';
import { API_METHODS } from './api/methods.ts';
import { FileClipStore, type ClipStore } from './clips.ts';
import { FileEditionStore, type EditionStore } from './editions.ts';
import { FileHandoffStore, type HandoffStore } from './handoffs.ts';
import { FileReadingStore, type ReadingStore } from './reading.ts';
import { FileSeenStore, type SeenStore } from './seen.ts';
import type { ProfileStore } from './store.ts';
import type { LocalSession } from './link/session.ts';
import type { ToolContext } from './tools/kit.ts';
import { retentionTasks, startHousekeeping } from './housekeeping.ts';
import type { Fetcher } from './types.ts';

export const MAX_BODY_BYTES = 1_000_000;
export const MAX_BATCH = 20;
/** A state API request: room for one clip image (500 KB, base64) plus a full batch of small calls. */
export const MAX_API_BODY_BYTES = 2_000_000;

export interface AppConfig {
  host: string;
  port: number;
  publicUrl: string;
  staticToken?: string | undefined;
  staticUser: string;
  github?: { clientId: string; clientSecret: string } | undefined;
  allowedGithubUsers: string[];
  allowedHosts: string[];
  allowedOrigins: string[];
  allowUnauthenticated: boolean;
  /** Behind a reverse proxy (Railway): use the last X-Forwarded-For hop for per-IP limits. */
  trustProxy: boolean;
  dataDir: string;
  /** Per-user tool budget (MCPORTAL_LIMIT_PER_MINUTE / _PER_DAY / _GLOBAL_PER_DAY). */
  limits?: Partial<BudgetLimits> | undefined;
  /**
   * The public pages: the contact address for support and security reports
   * (MCPORTAL_CONTACT_EMAIL), the support link (MCPORTAL_SUPPORT_URL, default: that
   * address), the operator's name (MCPORTAL_OPERATOR) and the law the terms are under
   * (MCPORTAL_JURISDICTION, e.g. "the State of Oregon, USA"). Links to the source code only
   * with MCPORTAL_SOURCE_URL, since the repo isn't public yet.
   */
  site?: Pick<SiteConfig, 'supportUrl' | 'operator' | 'contactEmail' | 'jurisdiction' | 'sourceUrl'> | undefined;
}

export interface AppDeps {
  store: ProfileStore;
  reading?: ReadingStore | undefined;
  handoffs?: HandoffStore | undefined;
  seen?: SeenStore | undefined;
  editions?: EditionStore | undefined;
  /** Clips; defaults to files under the data directory. */
  clips?: ClipStore | undefined;
  /** The labs on (default MCPORTAL_LABS). */
  labs?: readonly string[] | undefined;
  /** Handles and public profiles (only with GitHub sign-in: a single-token server has no social layer). */
  publicProfiles?: PublicProfiles | undefined;
  /** Shares and follows (also only with GitHub sign-in). */
  social?: Social | undefined;
  fetcher: Fetcher;
  cache: TtlCache;
  log?: Logger | undefined;
  now?: (() => number) | undefined;
  budget?: UsageBudget | undefined;
  /** Where OAuth state persists; defaults to auth.json in the data directory. */
  authPersistence?: AuthPersistence | undefined;
  /** Accounts, invites and roles; defaults to accounts.json in the data directory with bootstrap from the env. */
  accounts?: Accounts | undefined;
  /** Reported by /health. */
  storage?: 'files' | 'postgres' | undefined;
  /** Throws when storage can't be reached; /health then answers 503. */
  checkStorage?: (() => Promise<void>) | undefined;
  /**
   * A local MCPortal served over HTTP (npm start, /preview): no auth, loopback only. Its
   * requests take their context from the session, so it can sign in to a hosted one
   * like the stdio server does.
   */
  session?: LocalSession | undefined;
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
    site: siteFromEnv(env),
  };
  if (!hasAuth && !isLoopbackHost(host) && env.MCPORTAL_ALLOW_UNAUTHENTICATED !== '1') {
    throw new Error(
      `Refusing to listen on ${host} without authentication. Set GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET (OAuth) or MCPORTAL_TOKEN, or MCPORTAL_ALLOW_UNAUTHENTICATED=1 if you really mean it.`,
    );
  }
  return config;
}

function siteFromEnv(env: NodeJS.ProcessEnv): NonNullable<AppConfig['site']> {
  const email = env.MCPORTAL_CONTACT_EMAIL?.trim();
  if (email && !/^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i.test(email)) throw new Error(`MCPORTAL_CONTACT_EMAIL isn't an email address: ${email}`);
  return {
    supportUrl: env.MCPORTAL_SUPPORT_URL || (email ? `mailto:${email}` : DEFAULT_SUPPORT_URL),
    ...(email ? { contactEmail: email } : {}),
    ...(env.MCPORTAL_OPERATOR ? { operator: env.MCPORTAL_OPERATOR } : {}),
    ...(env.MCPORTAL_JURISDICTION ? { jurisdiction: env.MCPORTAL_JURISDICTION } : {}),
    ...(env.MCPORTAL_SOURCE_URL ? { sourceUrl: env.MCPORTAL_SOURCE_URL } : {}),
  };
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'application/json', extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(body);
}

/** How long a storage check's answer is reused: platform health checks can be frequent. */
const HEALTH_TTL_MS = 5_000;
const HEALTH_TIMEOUT_MS = 2_000;

/** The /health storage check: ok, or failing (logged), answered from a short cache. */
function healthCheck(deps: AppDeps, log: Logger): () => Promise<'ok' | 'failing'> {
  const now = deps.now ?? Date.now;
  let last: { at: number; result: Promise<'ok' | 'failing'> } | undefined;
  return () => {
    if (last && now() - last.at < HEALTH_TTL_MS) return last.result;
    const check = deps.checkStorage;
    const result: Promise<'ok' | 'failing'> = !check ? Promise.resolve('ok') : Promise.race([
      check().then(() => 'ok' as const),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${HEALTH_TIMEOUT_MS} ms`)), HEALTH_TIMEOUT_MS).unref()),
    ]).catch((error: unknown) => {
      log.error('health.storage_failing', { error: errorMessage(error) });
      return 'failing' as const;
    });
    last = { at: now(), result };
    return result;
  };
}

/**
 * A plain-HTTP error (not JSON-RPC, not an HTML page), in the same shape as the OAuth
 * endpoints: { error: code, error_description: message }.
 */
function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, JSON.stringify({ error: code, error_description: message }));
}

/** A path for logs: one-time tokens and other long opaque segments are masked. */
function loggablePath(pathname: string): string {
  return pathname.split('/').map((seg) => (seg.length >= 16 ? ':token' : seg)).join('/').slice(0, 120);
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
  const log = deps.log ?? createLogger();
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
  const budget = deps.budget ?? new UsageBudget(config.limits ?? {}, deps.now);
  const metrics = new ToolMetrics(deps.now);
  const admin = oauth ? new AdminPanel(accounts, oauth, config.publicUrl, deps.now, { social: oauth && deps.publicProfiles ? deps.social : undefined, profiles: deps.publicProfiles, budget, metrics }) : undefined;
  const health = healthCheck(deps, log);
  const site: SiteConfig = { supportUrl: DEFAULT_SUPPORT_URL, ...config.site, publicUrl: config.publicUrl, inviteOnly: Boolean(oauth) && !accounts.openSignup };
  const reading = deps.reading ?? new FileReadingStore(config.dataDir);
  const handoffs = deps.handoffs ?? new FileHandoffStore(config.dataDir);
  const seen = deps.seen ?? new FileSeenStore(config.dataDir);
  const editions = deps.editions ?? new FileEditionStore(config.dataDir);
  const clips = deps.clips ?? new FileClipStore(config.dataDir);
  const publicProfiles = oauth ? deps.publicProfiles : undefined;
  const social = oauth && publicProfiles ? deps.social : undefined;
  // The account page needs GitHub sign-in; without it, exports are written to the data directory.
  const account = oauth ? new AccountPage({ accounts, oauth, store: deps.store, reading, handoffs, seen, editions, clips, publicProfiles, social, publicUrl: config.publicUrl, log, now: deps.now, trustProxy: config.trustProxy }) : undefined;
  // Retention on a schedule: what's kept only for a while goes even on a quiet server.
  const stopHousekeeping = startHousekeeping(retentionTasks({ handoffs, editions, social, accounts, oauth }), log);
  const context = (userId: string, reqLog: Logger): ToolContext => ({
    log: reqLog,
    store: deps.store, reading, handoffs, seen, editions, clips, publicProfiles, social, fetcher: deps.fetcher, cache: deps.cache, userId, budget, metrics, actor: accounts.actor(userId),
    labs: deps.labs,
    accountUrl: account?.url,
    uploadLink: account ? () => account.uploadLink(userId) : undefined,
    localFiles: !account && config.allowUnauthenticated && isLoopbackHost(config.host),
    deliver: async (format) => {
      if (!account) return deliverToFile(format, userId, { store: deps.store, reading, clips }, config.dataDir);
      // Built when the link is opened, so it's current and the big ones aren't built twice.
      const summary = { mcportal: 'everything', bookmarks: 'saved items', clips: 'clips as Markdown', opml: 'sources as OPML' }[format];
      return { kind: 'link', where: account.downloadLink(userId, format), summary };
    },
  });

  /** The user for a request, or undefined if it isn't authenticated. */
  async function authenticate(req: IncomingMessage): Promise<string | undefined> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token) {
      if (config.staticToken && safeEqual(token, config.staticToken)) return config.staticUser;
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
      const results = (await Promise.all(payload.map((m) => handleMessage(m, ctx)))).filter((r): r is JsonRpcResponse => r !== null);
      return results.length ? results : null;
    }
    return handleMessage(payload, ctx);
  }

  /**
   * The state API a linked local MCPortal uses (src/api/calls.ts), with the same tokens,
   * Host and Origin rules as /mcp. The client names its version; old ones are told to update.
   *
   *   POST /api/v1/call     a batch of method calls
   *   GET  /api/v1/export   an export, any format (?format=), as the export_data tool builds it
   *   POST /api/v1/import   add an MCPortal export (JSON body), as the account page's import does
   */
  async function stateApi(req: IncomingMessage, res: ServerResponse, url: URL, reqLog: Logger): Promise<void> {
    const server = { 'mcportal-server': SERVER_INFO.version };
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => send(res, status, JSON.stringify(body), 'application/json', { ...server, ...extra });
    const want = url.pathname === API_EXPORT_PATH ? 'GET' : 'POST';
    if (req.method !== want) return json(405, { error: 'method_not_allowed', error_description: `Use ${want}` }, { allow: want });
    const userId = await authenticate(req);
    if (!userId) {
      const challenge = oauth ? `Bearer resource_metadata="${oauth.resourceMetadataUrl}", scope="mcportal"` : 'Bearer';
      return json(401, { error: 'unauthorized', error_description: 'Sign in again: this device is not linked, or its link was revoked.' }, { 'www-authenticate': challenge });
    }
    if (!versionAtLeast(String(req.headers[CLIENT_HEADER] ?? ''), MIN_CLIENT_VERSION)) {
      return json(426, { error: 'upgrade_required', error_description: `Update MCPortal to ${MIN_CLIENT_VERSION} or later to keep using your linked portal.`, minClientVersion: MIN_CLIENT_VERSION });
    }
    const ctx = context(userId, reqLog);

    if (url.pathname !== API_PATH) {
      // Whole exports and imports: one gate decision and one charge each, like export_data and import_portal.
      const action = url.pathname === API_EXPORT_PATH ? 'read' : 'write';
      const decision = authorize(ctx.actor ?? localActor(userId), action, { ownerId: userId });
      if (!decision.ok) return json(403, { error: 'forbidden', error_description: decision.reason });
      const verdict = budget.take(userId, action === 'read' ? 5 : 20);
      if (!verdict.ok) return json(429, { error: 'rate_limited', error_description: budgetMessage(verdict) }, { 'retry-after': String(verdict.retryAfterSeconds) });
      if (url.pathname === API_EXPORT_PATH) {
        const format = url.searchParams.get('format') ?? 'mcportal';
        if (!EXPORT_FORMATS.includes(format as ExportFormat)) return json(400, { error: 'bad_request', error_description: `format must be one of ${EXPORT_FORMATS.join(', ')}` });
        const file = await buildExport(format as ExportFormat, userId, { store: deps.store, reading, clips, publicProfile: await publicProfiles?.get(userId), social });
        return send(res, 200, file.body, file.contentType, { ...server, 'content-disposition': `attachment; filename="${file.filename}"`, 'x-mcportal-summary': file.summary });
      }
      let text: string;
      try {
        text = (await readBody(req, MAX_UPLOAD)).toString('utf8');
      } catch (error) {
        const tooLarge = errorCode(error) === 'limit_exceeded';
        return json(tooLarge ? 413 : 400, { error: tooLarge ? 'too_large' : 'bad_request', error_description: tooLarge ? 'Over 60 MB' : 'Unreadable body' }, tooLarge ? { connection: 'close' } : {});
      }
      try {
        const result = await importExport(parseExport(text), userId, { store: deps.store, reading, clips, publicProfiles: deps.publicProfiles });
        return json(200, { result, summary: describeImport(result) });
      } catch (error) {
        if (!isAppError(error) || error.code === 'internal') throw error;
        return json(400, { error: error.code, error_description: error.message });
      }
    }

    let body: unknown;
    try {
      body = JSON.parse((await readBody(req, MAX_API_BODY_BYTES)).toString('utf8'));
    } catch (error) {
      const tooLarge = errorCode(error) === 'limit_exceeded';
      return json(tooLarge ? 413 : 400, { error: tooLarge ? 'too_large' : 'bad_request', error_description: tooLarge ? 'Body too large' : 'Body must be JSON' }, tooLarge ? { connection: 'close' } : {});
    }
    const results = await handleCalls(body, ctx, API_METHODS);
    if (!results) return json(400, { error: 'bad_request', error_description: 'Send { calls: [{ id, method, params }] } with 1-20 calls' });
    return json(200, { results });
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL, reqLog: Logger): Promise<void> {
    const hostname = hostnameOf(req.headers.host);
    // Health checks come from the platform with its own Host header.
    if (url.pathname === '/health') {
      const storage = await health();
      return send(res, storage === 'ok' ? 200 : 503, JSON.stringify({ ok: storage === 'ok', ...SERVER_INFO, storage: deps.storage ?? 'files', checks: { storage } }));
    }
    if (!hostname || !config.allowedHosts.includes(hostname)) {
      return sendError(res, 421, 'unknown_host', 'Unknown host; set MCPORTAL_PUBLIC_URL or MCPORTAL_ALLOWED_HOSTS');
    }
    const origin = req.headers.origin;
    if (origin && (url.pathname === '/mcp' || url.pathname.startsWith('/api/'))) {
      const originHost = hostnameOf(origin.replace(/^[a-z]+:\/\//i, ''));
      if (!config.allowedOrigins.includes(origin) && !(originHost && config.allowedHosts.includes(originHost))) {
        return send(res, 403, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Origin not allowed')));
      }
    }
    if (oauth && (await oauth.handle(req, res, url))) return;
    if (admin && (await admin.handle(req, res, url))) return;
    if (account && (await account.handle(req, res, url))) return;

    if (req.method === 'GET' && (await serveSite(res, url.pathname, site, req.headers.range))) return;

    if (url.pathname === '/preview' && req.method === 'GET') {
      // The page itself holds no secrets. With a static token, the page asks for it
      // (kept in sessionStorage), so it never lands in a URL, history or logs.
      if (!config.allowUnauthenticated && !config.staticToken) {
        return sendHtml(res, 404, page('Preview unavailable', '<p>The preview is available locally or with MCPORTAL_TOKEN set.</p><p><a href="/">Go to MCPortal</a></p>'));
      }
      const html = await roomHtml({ dev: true, needsToken: !config.allowUnauthenticated });
      return send(res, 200, html, 'text/html; charset=utf-8', {
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      });
    }

    if (url.pathname === API_PATH || url.pathname === API_EXPORT_PATH || url.pathname === API_IMPORT_PATH) return stateApi(req, res, url, reqLog);
    if (url.pathname !== '/mcp') {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && req.headers.accept?.includes('text/html')) {
        return sendHtml(res, 404, page('Page not found', '<p>This doorway does not lead to a page.</p><p><a class="button primary" href="/">Go to MCPortal</a></p>', { door: 'shut', kicker: 'Lost in the ether' }));
      }
      return sendError(res, 404, 'not_found', 'Not found');
    }
    const userId = await authenticate(req);
    if (!userId) return unauthorized(res);
    if (req.method !== 'POST') {
      // Stateless server: no server-initiated SSE stream and no sessions to delete.
      return send(res, 405, JSON.stringify(rpcError(null, RPC.invalidRequest, 'Method not allowed')), 'application/json', { allow: 'POST' });
    }
    let payload: unknown;
    try {
      payload = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString('utf8'));
    } catch (error) {
      const tooLarge = errorCode(error) === 'limit_exceeded';
      // An unread body stays on the socket: close it, so a reused connection can't read it as the next request.
      return send(res, tooLarge ? 413 : 400, JSON.stringify(rpcError(null, RPC.parseError, tooLarge ? 'Body too large' : 'Parse error')), 'application/json', tooLarge ? { connection: 'close' } : {});
    }
    const local = deps.session && !oauth && !config.staticToken && config.allowUnauthenticated && isLoopbackHost(config.host);
    const response = await handlePayload(payload, local ? { ...(await deps.session!.context()), log: reqLog } : context(userId, reqLog));
    if (response === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    return send(res, 200, JSON.stringify(response));
  }

  const server = createServer((req, res) => {
    const id = requestId();
    const reqLog = log.child({ req: id });
    const started = Date.now();
    res.setHeader('x-request-id', id);
    if (new URL(config.publicUrl).protocol === 'https:') res.setHeader('strict-transport-security', 'max-age=31536000');
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://placeholder');
    } catch {
      return sendError(res, 400, 'bad_request', 'Bad request');
    }
    res.on('finish', () => reqLog.debug('http.request', { method: req.method, path: loggablePath(url.pathname), status: res.statusCode, ms: Date.now() - started }));
    route(req, res, url, reqLog).catch((error) => {
      reqLog.error('http.crashed', { method: req.method, path: loggablePath(url.pathname), error: errorStack(error) });
      send(res, 500, JSON.stringify(rpcError(null, RPC.internal, `Internal error (reference ${id})`)));
    });
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.on('close', stopHousekeeping);
  server.requestTimeout = 300_000;   // room for an export upload on a slow connection; headersTimeout still guards slow-drip requests
  server.headersTimeout = 20_000;
  return server;
}
