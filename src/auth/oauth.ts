/**
 * OAuth 2.1 for the hosted MCP server, following the MCP authorization spec:
 *
 *   - MCPortal is the protected resource (RFC 9728 metadata at
 *     /.well-known/oauth-protected-resource) and also runs a small
 *     authorization server (RFC 8414 metadata at /.well-known/oauth-authorization-server).
 *   - Clients register dynamically (RFC 7591) or identify themselves with a
 *     Client ID Metadata Document (an https client_id URL).
 *   - Authorization code + PKCE (S256 only), tokens bound to the resource
 *     (RFC 8707), rotating single-use refresh tokens with reuse detection.
 *   - Users sign in with GitHub, after MCPortal's own consent screen, which
 *     names the client and its redirect host.
 *
 * Consent is bound to the browser that loaded it (a SameSite cookie checked on
 * the POST and again on the GitHub callback) and the POST must be same-origin,
 * so an attacker can't pre-fetch a consent transaction and make a victim's
 * browser approve it. Before consent, errors render a page and never redirect.
 *
 * The GitHub token is used once to learn who the user is and then discarded.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, errorCode, errorStack, type ErrorCode } from '../lib/errors.ts';
import { safeEqual, secretToken, sha256Url } from '../lib/ids.ts';
import { processLogger } from '../lib/log.ts';
import { cookies, escapeHtml, readBody, redirect, sendHtml, sendJson } from '../lib/web.ts';
import { page } from '../page.ts';
import { fetchJson } from '../lib/safe-fetch.ts';
import { clean } from '../lib/text.ts';
import type { Fetcher } from '../types.ts';
import { Accounts, makeBootstrap, memoryPersistence } from '../accounts.ts';
import { CLIENT_LIMITS, type AuthStore, type Identity, type TokenRecord } from './store.ts';

export const SCOPE = 'mcportal';
const TXN_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_TXNS = 2000;
const MAX_CODES = 2000;
const MAX_CIMD = 200;

export interface OAuthConfig {
  publicUrl: string;
  github: { clientId: string; clientSecret: string };
  /** GitHub logins (lowercase) or numeric ids allowed to sign in. Empty means anyone. */
  allowedGithubUsers: string[];
  /** Trust the last X-Forwarded-For hop for per-IP limits (true behind Railway's proxy). */
  trustProxy?: boolean;
}

interface Txn {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  resource: string;
  browserKey: string;
  decided: boolean;
  expiresAt: number;
}

interface Code extends Identity {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: number;
}

interface ClientInfo {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

/** RFC 6749 error codes, and the AppError code each one is. */
const OAUTH_CODES: Record<string, ErrorCode> = {
  access_denied: 'forbidden',
  slow_down: 'rate_limited',
  invalid_target: 'not_found',
  server_error: 'internal',
};

/** An OAuth endpoint's refusal: `error` is the RFC 6749 code the client sees, with its HTTP status. */
export class OAuthError extends AppError {
  override name = 'OAuthError';
  readonly error: string;
  readonly status: number;

  constructor(error: string, description: string, status = 400) {
    super(OAUTH_CODES[error] ?? 'invalid_argument', description);
    this.error = error;
    this.status = status;
  }
}

export function isAllowedRedirectUri(value: string): boolean {
  if (typeof value !== 'string' || value.length > CLIENT_LIMITS.uriLength) return false;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    // Native / CLI clients use loopback redirects (RFC 8252).
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Fixed-window counters per key, bounded in size. */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private limit: number;
  private windowMs: number;
  private now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  take(key: string): boolean {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size > 10_000) this.windows.clear();
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count <= this.limit;
  }
}

function setLimited<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}

/** A token or registration request body: url-encoded, or JSON with every value as a string. */
async function readForm(req: IncomingMessage, limit = 32 * 1024): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = (await readBody(req, limit)).toString('utf8');
  } catch (error) {
    throw errorCode(error) === 'limit_exceeded' ? new OAuthError('invalid_request', 'Request body too large', 413) : error;
  }
  const type = String(req.headers['content-type'] ?? '');
  if (type.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    } catch {
      throw new OAuthError('invalid_request', 'Body is not valid JSON');
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** Called with the GitHub identity (or an error) when a page sign-in completes; must send the response. */
export type PageSignInHandler = (who: { githubId: number; login: string } | { error: string }, res: ServerResponse, clearCookie: Record<string, string>) => Promise<void>;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

export class OAuthServer {
  private config: OAuthConfig;
  private store: AuthStore;
  private accounts: Accounts;
  private fetcher: Fetcher;
  private now: () => number;
  private txns = new Map<string, Txn>();
  private githubStates = new Map<string, string>();
  /** Sign-ins started by server pages (e.g. /admin), keyed by GitHub state. */
  private pageSignIns = new Map<string, { browser: string; expiresAt: number; done: PageSignInHandler }>();
  private codes = new Map<string, Code>();
  private cimdCache = new Map<string, { info: ClientInfo; expiresAt: number }>();
  private limits: { register: RateLimiter; registerGlobal: RateLimiter; authorize: RateLimiter; token: RateLimiter };

  constructor(config: OAuthConfig, store: AuthStore, fetcher: Fetcher, now: () => number = Date.now, accounts?: Accounts) {
    this.config = config;
    this.store = store;
    this.fetcher = fetcher;
    this.now = now;
    // Without an accounts store, the allowlist alone decides (empty = anyone), as before accounts existed.
    this.accounts = accounts ?? new Accounts(memoryPersistence(), makeBootstrap([], config.allowedGithubUsers), now);
    this.limits = {
      register: new RateLimiter(10, 60 * 60 * 1000, now),
      registerGlobal: new RateLimiter(200, 60 * 60 * 1000, now),
      authorize: new RateLimiter(60, 10 * 60 * 1000, now),
      token: new RateLimiter(120, 10 * 60 * 1000, now),
    };
  }

  get resource(): string {
    return `${this.config.publicUrl}/mcp`;
  }

  get resourceMetadataUrl(): string {
    return `${this.config.publicUrl}/.well-known/oauth-protected-resource`;
  }

  private get secure(): boolean {
    return this.config.publicUrl.startsWith('https://');
  }

  private get cookieName(): string {
    return this.secure ? '__Host-mcportal_signin' : 'mcportal_signin';
  }

  protectedResourceMetadata() {
    return {
      resource: this.resource,
      authorization_servers: [this.config.publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'MCPortal',
    };
  }

  authorizationServerMetadata() {
    const base = this.config.publicUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    };
  }

  /** Is this GitHub identity (still) let in? Checked on every request, on token exchange and on refresh. */
  isAllowed(identity: Pick<Identity, 'githubId' | 'login'>): boolean {
    return this.accounts.isActive({ githubId: identity.githubId, login: identity.login });
  }

  /** Sign a user out everywhere (account deletion). */
  revokeUser(userId: string): Promise<number> {
    return this.store.revokeUser(userId);
  }

  /** Access-token check for /mcp. Returns the user id or undefined. */
  async authenticate(token: string): Promise<string | undefined> {
    const record = await this.store.verifyAccess(token, this.resource);
    return record && this.isAllowed(record) ? record.userId : undefined;
  }

  private clientIp(req: IncomingMessage): string {
    if (this.config.trustProxy) {
      const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (hops.length) return hops[hops.length - 1]!;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  private canonicalResource(value: string | undefined): string {
    if (!value) return this.resource;
    const normalized = value.replace(/\/+$/, '');
    if (normalized === this.resource || normalized === this.config.publicUrl) return this.resource;
    throw new OAuthError('invalid_target', 'Unknown resource');
  }

  private prune(): void {
    const now = this.now();
    for (const [k, v] of this.txns) if (v.expiresAt <= now) this.txns.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt <= now) this.codes.delete(k);
    for (const [k, id] of this.githubStates) if (!this.txns.has(id)) this.githubStates.delete(k);
    for (const [k, v] of this.cimdCache) if (v.expiresAt <= now) this.cimdCache.delete(k);
  }

  /** Resolve a client from registration or from a Client ID Metadata Document. */
  private async resolveClient(clientId: string): Promise<ClientInfo> {
    if (/^https:\/\//i.test(clientId)) {
      if (clientId.length > CLIENT_LIMITS.uriLength) throw new OAuthError('invalid_client', 'client_id is too long');
      const hit = this.cimdCache.get(clientId);
      if (hit && hit.expiresAt > this.now()) return hit.info;
      let doc: Record<string, unknown>;
      try {
        // No redirects: the document must be served at exactly the client_id URL.
        const res = await this.fetcher(clientId, { maxBytes: 16 * 1024, maxRedirects: 0, headers: { accept: 'application/json' }, timeoutMs: 5000 });
        if (res.status !== 200 || !/json/i.test(res.contentType)) throw new Error('not a JSON document');
        doc = JSON.parse(res.text) as Record<string, unknown>;
      } catch {
        throw new OAuthError('invalid_client', 'Could not load the client metadata document');
      }
      if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) throw new OAuthError('invalid_client', 'Client metadata document is invalid');
      const redirectUris = doc.redirect_uris.filter((u): u is string => typeof u === 'string' && isAllowedRedirectUri(u)).slice(0, CLIENT_LIMITS.redirectUris);
      const info = { clientId, clientName: clean(doc.client_name, 80) || new URL(clientId).host, redirectUris };
      setLimited(this.cimdCache, clientId, { info, expiresAt: this.now() + 10 * 60 * 1000 }, MAX_CIMD);
      return info;
    }
    const record = await this.store.getClient(clientId);
    if (!record) throw new OAuthError('invalid_client', 'Unknown client');
    return { clientId, clientName: clean(record.client_name, 80) || 'An MCP client', redirectUris: record.redirect_uris };
  }

  /** Returns true if the request was an OAuth route and has been answered. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const route = url.pathname;
    const isOAuthRoute =
      route.startsWith('/.well-known/oauth-protected-resource') || route === '/.well-known/oauth-authorization-server' || route.startsWith('/oauth/');
    if (!isOAuthRoute) return false;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return true;
    }
    this.prune();
    try {
      if (route.startsWith('/.well-known/oauth-protected-resource')) return sendJson(res, 200, this.protectedResourceMetadata(), CORS), true;
      if (route === '/.well-known/oauth-authorization-server') return sendJson(res, 200, this.authorizationServerMetadata(), CORS), true;
      if (route === '/oauth/register' && req.method === 'POST') return await this.register(req, res), true;
      if (route === '/oauth/authorize' && req.method === 'GET') return await this.authorizeStart(req, res, url), true;
      if (route === '/oauth/authorize' && req.method === 'POST') return await this.authorizeDecision(req, res), true;
      if (route === '/oauth/callback' && req.method === 'GET') return await this.githubCallback(req, res, url), true;
      if (route === '/oauth/token' && req.method === 'POST') return await this.token(req, res), true;
      sendJson(res, 404, { error: 'not_found' });
      return true;
    } catch (error) {
      const e = error instanceof OAuthError ? error : new OAuthError('server_error', 'Unexpected error', 500);
      if (!(error instanceof OAuthError)) processLogger().error('oauth.crashed', { route, error: errorStack(error) });
      if (route === '/oauth/authorize' || route === '/oauth/callback') {
        sendHtml(res, e.status, page('Sign-in problem', `<h1>Sign-in problem</h1><p>${escapeHtml(e.message)}</p>`));
      } else {
        sendJson(res, e.status, { error: e.error, error_description: e.message }, route === '/oauth/token' || route === '/oauth/register' ? CORS : {});
      }
      return true;
    }
  }

  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.limits.register.take(this.clientIp(req)) || !this.limits.registerGlobal.take('*')) {
      throw new OAuthError('slow_down', 'Too many registrations, try again later', 429);
    }
    const body = await readForm(req);
    let redirectUris: unknown;
    try {
      redirectUris = JSON.parse(body.redirect_uris ?? '[]');
    } catch {
      redirectUris = undefined;
    }
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > CLIENT_LIMITS.redirectUris ||
      !redirectUris.every((u) => typeof u === 'string' && isAllowedRedirectUri(u))
    ) {
      throw new OAuthError('invalid_redirect_uri', `redirect_uris must be 1-${CLIENT_LIMITS.redirectUris} https (or loopback http) URLs without fragments`);
    }
    const method = body.token_endpoint_auth_method;
    if (method && method !== 'none') throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported');
    const record = await this.store.registerClient({ client_name: clean(body.client_name, 80) || undefined, redirect_uris: redirectUris as string[] });
    sendJson(
      res,
      201,
      {
        client_id: record.client_id,
        client_id_issued_at: record.created_at,
        client_name: record.client_name,
        redirect_uris: record.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      CORS,
    );
  }

  /** Validate the request and show MCPortal's consent screen. Errors here never redirect. */
  private async authorizeStart(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!this.limits.authorize.take(this.clientIp(req))) throw new OAuthError('slow_down', 'Too many sign-in attempts, try again in a few minutes', 429);
    const q = url.searchParams;
    const client = await this.resolveClient(q.get('client_id') ?? '');
    const redirectUri = q.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : '');
    if (!client.redirectUris.includes(redirectUri)) throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
    if (q.get('response_type') !== 'code') throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported');
    const challenge = q.get('code_challenge') ?? '';
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      throw new OAuthError('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    const resource = this.canonicalResource(q.get('resource') ?? undefined);
    const state = q.get('state') ?? undefined;
    if (state && state.length > 512) throw new OAuthError('invalid_request', 'state is too long');

    const txnId = secretToken(24);
    const browserSecret = secretToken(24);
    setLimited(
      this.txns,
      txnId,
      { clientId: client.clientId, clientName: client.clientName, redirectUri, ...(state !== undefined ? { state } : {}), codeChallenge: challenge, resource, browserKey: sha256Url(browserSecret), decided: false, expiresAt: this.now() + TXN_TTL_MS },
      MAX_TXNS,
    );
    const cookie = `${this.cookieName}=${browserSecret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TXN_TTL_MS / 1000}${this.secure ? '; Secure' : ''}`;
    const redirectHost = new URL(redirectUri).host;
    sendHtml(
      res,
      200,
      page(
        'Connect to MCPortal',
        `<h1>Connect to MCPortal?</h1>
<p><strong>${escapeHtml(client.clientName)}</strong> wants to open and change your MCPortal room.</p>
<p class="muted">After you approve, you'll sign in with GitHub, then be sent back to <code>${escapeHtml(redirectHost)}</code>. Only continue if you started this from that app.</p>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="txn" value="${txnId}">
<button class="primary" name="decision" value="approve" type="submit">Continue with GitHub</button>
<button name="decision" value="deny" type="submit">Cancel</button>
</form>`,
      ),
      { 'set-cookie': cookie },
    );
  }

  /** The consent POST must come from our own page, in the same browser that loaded it. */
  private assertSameBrowser(req: IncomingMessage, txn: Txn, checkOrigin: boolean): void {
    if (checkOrigin) {
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin') throw new OAuthError('access_denied', 'Cross-site request refused', 403);
      const origin = req.headers.origin;
      if (origin && origin !== new URL(this.config.publicUrl).origin) throw new OAuthError('access_denied', 'Cross-site request refused', 403);
    }
    const secret = cookies(req)[this.cookieName] ?? '';
    if (!secret || !safeEqual(sha256Url(secret), txn.browserKey)) {
      throw new OAuthError('access_denied', 'This sign-in was started in a different browser. Start again from your app.', 403);
    }
  }

  private async authorizeDecision(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readForm(req);
    const txnId = body.txn ?? '';
    const txn = this.txns.get(txnId);
    if (!txn || txn.expiresAt <= this.now() || txn.decided) throw new OAuthError('invalid_request', 'This sign-in link has expired. Start again from your app.');
    this.assertSameBrowser(req, txn, true);
    txn.decided = true; // single decision per consent screen
    if (body.decision !== 'approve') {
      this.txns.delete(txnId);
      const target = new URL(txn.redirectUri);
      target.searchParams.set('error', 'access_denied');
      if (txn.state) target.searchParams.set('state', txn.state);
      target.searchParams.set('iss', this.config.publicUrl);
      return redirect(res, target.href);
    }
    const ghState = secretToken(24);
    this.githubStates.set(ghState, txnId);
    const gh = new URL('https://github.com/login/oauth/authorize');
    gh.searchParams.set('client_id', this.config.github.clientId);
    gh.searchParams.set('redirect_uri', `${this.config.publicUrl}/oauth/callback`);
    gh.searchParams.set('state', ghState);
    gh.searchParams.set('scope', 'read:user');
    gh.searchParams.set('allow_signup', 'true');
    redirect(res, gh.href);
  }

  /**
   * Sign in with GitHub for one of the server's own pages (not an MCP client).
   * The GitHub state is bound to this browser with a short-lived cookie, so a
   * callback started in someone else's browser is refused (login CSRF).
   */
  beginPageSignIn(req: IncomingMessage, res: ServerResponse, done: PageSignInHandler): void {
    if (!this.config.github) return sendHtml(res, 404, page('Not available', '<p>GitHub sign-in is not configured.</p>'));
    if (!this.limits.authorize.take(this.clientIp(req))) return sendHtml(res, 429, page('Slow down', '<p>Too many sign-in attempts. Try again in a few minutes.</p>'));
    const now = this.now();
    for (const [k, v] of this.pageSignIns) if (v.expiresAt <= now) this.pageSignIns.delete(k);
    const ghState = `pg_${secretToken(24)}`;
    const browser = secretToken(24);
    setLimited(this.pageSignIns, ghState, { browser: sha256Url(browser), expiresAt: now + TXN_TTL_MS, done }, MAX_TXNS);
    const gh = new URL('https://github.com/login/oauth/authorize');
    gh.searchParams.set('client_id', this.config.github.clientId);
    gh.searchParams.set('redirect_uri', `${this.config.publicUrl}/oauth/callback`);
    gh.searchParams.set('state', ghState);
    gh.searchParams.set('scope', 'read:user');
    redirect(res, gh.href, { 'set-cookie': `${this.pageCookieName}=${browser}; Path=/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=${TXN_TTL_MS / 1000}${this.secure ? '; Secure' : ''}` });
  }

  private get pageCookieName(): string {
    return this.secure ? '__Secure-mcportal_page' : 'mcportal_page';
  }

  private async pageCallback(req: IncomingMessage, res: ServerResponse, url: URL, ghState: string): Promise<void> {
    const pending = this.pageSignIns.get(ghState);
    this.pageSignIns.delete(ghState);
    const browser = cookies(req)[this.pageCookieName] ?? '';
    const clear = { 'set-cookie': `${this.pageCookieName}=; Path=/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0${this.secure ? '; Secure' : ''}` };
    if (!pending || pending.expiresAt <= this.now() || !browser || !safeEqual(sha256Url(browser), pending.browser)) {
      return sendHtml(res, 400, page('Sign-in expired', '<p>This sign-in link expired or was started in another browser. Start again.</p>'), clear);
    }
    const ghCode = url.searchParams.get('code');
    const who = ghCode ? await this.githubIdentity(ghCode) : { error: 'GitHub sign-in was cancelled' };
    await pending.done(who, res, clear);
  }

  private async githubCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const ghState = url.searchParams.get('state') ?? '';
    if (ghState.startsWith('pg_')) return this.pageCallback(req, res, url, ghState);
    const txnId = this.githubStates.get(ghState);
    this.githubStates.delete(ghState);
    const txn = txnId ? this.txns.get(txnId) : undefined;
    if (!txn || !txnId || txn.expiresAt <= this.now()) throw new OAuthError('invalid_request', 'This sign-in link has expired. Start again from your app.');
    this.txns.delete(txnId);
    this.assertSameBrowser(req, txn, false);
    const clearCookie = { 'set-cookie': `${this.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.secure ? '; Secure' : ''}` };
    const toClient = (params: Record<string, string>) => {
      const target = new URL(txn.redirectUri);
      for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
      if (txn.state) target.searchParams.set('state', txn.state);
      target.searchParams.set('iss', this.config.publicUrl);
      redirect(res, target.href, clearCookie);
    };
    const ghCode = url.searchParams.get('code');
    if (!ghCode) return toClient({ error: 'access_denied', error_description: 'GitHub sign-in was cancelled' });
    const who = await this.githubIdentity(ghCode);
    if ('error' in who) return toClient({ error: 'access_denied', error_description: who.error });
    const user = { id: who.githubId, login: who.login };
    const identity: Identity = { userId: `github-${user.id}`, githubId: user.id, login: user.login };
    const admission = await this.accounts.admit({ githubId: user.id, login: user.login });
    if (!admission.ok) {
      const why = admission.reason === 'suspended' ? 'This account is suspended' : 'This MCPortal server is invite-only. Ask its owner for an invite.';
      return toClient({ error: 'access_denied', error_description: why });
    }
    const code = secretToken(32);
    setLimited(
      this.codes,
      code,
      { ...identity, clientId: txn.clientId, redirectUri: txn.redirectUri, codeChallenge: txn.codeChallenge, resource: txn.resource, expiresAt: this.now() + CODE_TTL_MS },
      MAX_CODES,
    );
    toClient({ code });
  }

  /** Exchange a GitHub OAuth code for the user's numeric id and login. Never echoes upstream content. */
  private async githubIdentity(ghCode: string): Promise<{ githubId: number; login: string } | { error: string }> {
    if (!this.config.github) return { error: 'GitHub sign-in is not configured' };
    const exchange = await this.fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.github.clientId,
        client_secret: this.config.github.clientSecret,
        code: ghCode,
        redirect_uri: `${this.config.publicUrl}/oauth/callback`,
      }).toString(),
      maxBytes: 16 * 1024,
      maxRedirects: 0,
    });
    let ghToken: string | undefined;
    try {
      ghToken = (JSON.parse(exchange.text) as { access_token?: string }).access_token;
    } catch {
      ghToken = undefined;
    }
    if (exchange.status !== 200 || !ghToken) return { error: 'GitHub sign-in failed' };
    const user = await fetchJson<{ id?: number; login?: string }>(this.fetcher, 'https://api.github.com/user', {
      headers: { authorization: `Bearer ${ghToken}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      maxBytes: 64 * 1024,
      maxRedirects: 0,
    });
    if (typeof user.id !== 'number' || typeof user.login !== 'string') return { error: 'Could not read GitHub profile' };
    return { githubId: user.id, login: user.login };
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.limits.token.take(this.clientIp(req))) throw new OAuthError('slow_down', 'Too many token requests', 429);
    const body = await readForm(req);
    const clientId = body.client_id ?? '';
    if (body.grant_type === 'authorization_code') {
      const code = this.codes.get(body.code ?? '');
      this.codes.delete(body.code ?? ''); // single use, even on failure
      if (!code || code.expiresAt <= this.now()) throw new OAuthError('invalid_grant', 'Authorization code is invalid or expired');
      if (code.clientId !== clientId) throw new OAuthError('invalid_grant', 'Code was issued to a different client');
      if (code.redirectUri !== (body.redirect_uri ?? '')) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
      const verifier = body.code_verifier ?? '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(sha256Url(verifier), code.codeChallenge)) {
        throw new OAuthError('invalid_grant', 'PKCE verification failed');
      }
      if (body.resource && this.canonicalResource(body.resource) !== code.resource) throw new OAuthError('invalid_target', 'resource does not match');
      if (!this.isAllowed(code)) throw new OAuthError('invalid_grant', 'This MCPortal server is private');
      if (!/^https:\/\//i.test(clientId)) await this.store.touchClient(clientId);
      const identity: Identity = { userId: code.userId, githubId: code.githubId, login: code.login };
      return sendJson(res, 200, await this.store.issueTokens(identity, clientId, code.resource, SCOPE), CORS);
    }
    if (body.grant_type === 'refresh_token') {
      const tokens = await this.store.rotateRefresh(body.refresh_token ?? '', clientId, (r: TokenRecord) => this.isAllowed(r));
      if (!tokens) throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired');
      return sendJson(res, 200, tokens, CORS);
    }
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }
}
