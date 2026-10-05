/**
 * Signing a local MCPortal in to a hosted one: OAuth 2.1 authorization code with PKCE
 * and a loopback redirect (RFC 8252), against the hosted server's own OAuth endpoints.
 *
 *   1. Listen once on 127.0.0.1 (a random port) and register "MCPortal on <computer>"
 *      with that exact redirect URI.
 *   2. The user opens the authorize URL: MCPortal's consent screen, then GitHub.
 *   3. The browser comes back to the listener with a code; it's exchanged (with the
 *      PKCE verifier) for tokens, the account is looked up, and link.json is written.
 *
 * The listener takes one request with the expected state, answers with a page that
 * says what happened, and closes. Nothing here is reachable from off the machine.
 */
import { hostedOrigin } from './hosted-url.ts';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { AppError } from '../lib/errors.ts';
import { requestId, silentLogger, type Logger } from '../lib/log.ts';
import { escapeHtml, PAGE_CSP } from '../lib/web.ts';
import { page } from '../page.ts';
import { clean } from '../lib/text.ts';
import { StateClient } from './client.ts';
import type { LinkFile, LinkRecord } from './link-file.ts';
import { signInError, type SignInStage } from './signin-errors.ts';

/** How long a sign-in can take before the listener gives up. */
export const SIGN_IN_MS = 10 * 60 * 1000;

export interface PendingSignIn {
  /** Where the user signs in. */
  url: string;
  /** Settles when the browser comes back (or the time runs out). */
  done: Promise<LinkRecord>;
  cancel(): void;
}

export interface SignInOptions {
  server: string;
  link: LinkFile;
  /** After link.json is written, before the browser is told it worked (the first-link merge). Its text goes on the page. */
  onLinked?: (record: LinkRecord, client: StateClient) => Promise<string | undefined>;
  /** A failed first import does not undo sign-in. Make its safe warning available in the room too. */
  onSyncFailure?: (message: string) => void;
  fetch?: typeof fetch;
  clientName?: string;
  now?: () => number;
  log?: Logger;
  /** The browser has ten minutes by default. Shorter deadlines are useful to callers and tests. */
  timeoutMs?: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const same = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

async function requestJson(fetcher: typeof fetch, url: URL, init: RequestInit, action: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new AppError(timedOut ? 'fetch_timeout' : 'upstream_unreachable', `${timedOut ? 'The hosted MCPortal took too long' : "Can't reach the hosted MCPortal"} while ${action}. Check the connection and try again.`, { cause: error });
  }
  const body: unknown = await res.json().catch(() => null);
  const json = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  if (!res.ok) {
    const reason = clean(json?.error_description, 200);
    const actionHint = res.status === 429 ? 'Wait a minute before trying again.' : res.status >= 500 ? 'Try again in a moment; if it keeps failing, contact the server owner.' : 'Start again with a fresh sign-in link; if it keeps failing, contact the server owner.';
    throw new AppError(res.status === 429 ? 'rate_limited' : 'upstream_error', `The hosted MCPortal refused the request while ${action} (HTTP ${res.status}).${reason ? ` ${reason}` : ''} ${actionHint}`, { details: { status: res.status } });
  }
  if (!json) throw new AppError('upstream_error', `The hosted MCPortal returned an unreadable response while ${action}. Try again; if it keeps failing, contact the server owner.`, { details: { status: res.status } });
  return json;
}

export async function startSignIn(options: SignInOptions): Promise<PendingSignIn> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? silentLogger;
  const reference = requestId();
  const server = hostedOrigin(options.server);
  // Good news opens the door; anything else is a failure that says what to do next.
  const resultPage = (title: string, body: string, ok = false) => page(title, body, ok ? { siteUrl: server, door: 'open', kicker: 'It\'s alive!' } : { siteUrl: server, door: 'shut', kicker: 'Signal lost' });
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));

  const listener: Server = createServer();
  try {
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  } catch (error) {
    throw signInError(error, 'callback', reference, log);
  }
  const redirectUri = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/callback`;
  const close = () => { listener.close(); listener.closeAllConnections?.(); };

  let clientId: string;
  let resource: string;
  let stage: SignInStage = 'discovery';
  try {
    // The resource to ask a token for is what the server says it is (RFC 9728), not a guess from its URL.
    const prm = await requestJson(fetcher, new URL('/.well-known/oauth-protected-resource', server), {}, 'reading sign-in settings');
    if (typeof prm.resource !== 'string' || !prm.resource) throw new AppError('upstream_error', 'That server doesn\'t look like a hosted MCPortal with sign-in. Check the hosted server address.');
    resource = prm.resource;
    stage = 'registration';
    const json = await requestJson(fetcher, new URL('/oauth/register', server), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: clean(options.clientName ?? `MCPortal on ${hostname()}`, 80), redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
    }, 'registering this computer');
    if (typeof json.client_id !== 'string' || !json.client_id) throw new AppError('upstream_error', 'The hosted MCPortal did not return a registration for this computer. Contact the server owner if retrying does not help.');
    clientId = json.client_id;
  } catch (error) {
    close();
    throw signInError(error, stage, reference, log);
  }

  const authorize = new URL('/oauth/authorize', server);
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', state, resource,
  }).toString();

  let settle!: { resolve: (r: LinkRecord) => void; reject: (e: unknown) => void };
  const done = new Promise<LinkRecord>((resolve, reject) => { settle = { resolve, reject }; });
  done.catch(() => {});   // callers may never await it; failures are reported on the page and by link status
  const timer = setTimeout(() => { close(); settle.reject(signInError(new AppError('fetch_timeout', 'The sign-in link expired before authorization finished. Start again from MCPortal on this computer with a fresh link.'), 'authorization', reference, log)); }, options.timeoutMs ?? SIGN_IN_MS);
  timer.unref();
  let handled = false;

  listener.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);
    const reply = (status: number, html: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer' });
      res.end(html);
    };
    if (req.method !== 'GET' || url.pathname !== '/callback' || handled) return reply(404, resultPage('Not here', '<p>This page only finishes an MCPortal sign-in.</p>'));
    if (!same(url.searchParams.get('state') ?? '', state)) {
      log.warn('signin.callback_refused', { reference, stage: 'authorization', reason: 'state_mismatch' });
      return reply(400, resultPage('Sign-in not finished', `<p>This link doesn't match the sign-in this computer started. Start it again from MCPortal in your app, and open the new link on this same computer.</p><p>Reference: ${reference}.</p>`));
    }
    handled = true;
    clearTimeout(timer);
    void (async () => {
      let stage: SignInStage = 'authorization';
      try {
        const denied = url.searchParams.get('error');
        // The hosted server's reason is display text: bounded here, escaped in the error page below.
        const reason = clean(url.searchParams.get('error_description') ?? '', 300);
        if (denied) throw new AppError('forbidden', reason || (denied === 'access_denied' ? 'Authorization was declined or cancelled. You can retry from MCPortal and choose Continue with GitHub.' : 'The hosted MCPortal did not authorize this computer. Start again; if it keeps failing, contact the server owner.'));
        if (!url.searchParams.get('code')) throw new AppError('upstream_error', 'The sign-in callback arrived without an authorization code. Start again with a fresh link on this computer.');
        stage = 'token';
        const tokens = await requestJson(fetcher, new URL('/oauth/token', server), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
          grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '', client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource,
        }).toString() }, 'finishing this computer’s sign-in');
        if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw new AppError('upstream_error', 'The hosted MCPortal did not return usable sign-in credentials. Start again; if it keeps failing, contact the server owner.');
        const access = tokens.access_token;
        const client = new StateClient({ server, auth: { token: async () => access, refresh: async () => undefined }, fetch: fetcher });
        stage = 'account';
        const me = await client.call<{ accountId: string; login: string | null }>('me');
        if (!me || typeof me.accountId !== 'string' || !me.accountId || (me.login !== null && typeof me.login !== 'string')) throw new AppError('upstream_error', 'The hosted MCPortal returned an unreadable account identity. Contact the server owner if retrying does not help.');
        const record: LinkRecord = {
          version: 1, server, accountId: me.accountId, ...(me.login ? { login: me.login } : {}), clientId,
          accessToken: access, refreshToken: tokens.refresh_token,
          expiresAt: now() + (typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600) * 1000,
          linkedAt: new Date(now()).toISOString(),
        };
        stage = 'save';
        await options.link.write(record);
        const note = await options.onLinked?.(record, client).catch((error: unknown) => {
          const warning = signInError(error, 'sync', reference, log).message;
          options.onSyncFailure?.(warning);
          return warning;
        });
        reply(200, resultPage('This computer is signed in', `<p>MCPortal on this computer now keeps your portal in your hosted account${me.login ? `, as <b>${escapeHtml(me.login)}</b>` : ''}.</p>${note ? `<p>${escapeHtml(note)}</p>` : ''}<p>You can close this tab and go back to your app.</p>`, true));
        settle.resolve(record);
        log.info('signin.completed', { reference });
      } catch (error) {
        const failure = signInError(error, stage, reference, log);
        reply(400, resultPage('Sign-in not finished', `<p>${escapeHtml(failure.message)}</p><p>Start it again from MCPortal in your app using a fresh link on this computer.</p>`));
        settle.reject(failure);
      } finally {
        close();
      }
    })();
  });

  return { url: authorize.href, done, cancel: () => { clearTimeout(timer); close(); settle.reject(signInError(new AppError('unavailable', 'The sign-in was cancelled. Start again from MCPortal when you are ready.'), 'authorization', reference, log)); } };
}
