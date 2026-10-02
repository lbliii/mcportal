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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { AppError } from '../lib/errors.ts';
import { escapeHtml } from '../lib/web.ts';
import { page } from '../page.ts';
import { clean } from '../lib/text.ts';
import { StateClient } from './client.ts';
import type { LinkFile, LinkRecord } from './link-file.ts';

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
  fetch?: typeof fetch;
  clientName?: string;
  now?: () => number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));


async function postForm(fetcher: typeof fetch, url: URL, form: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new AppError('upstream_unreachable', "Can't reach the hosted MCPortal to sign in. Check the connection and try again.", { cause: error });
  }
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new AppError('upstream_error', `The hosted MCPortal refused the sign-in (${clean(String(json.error_description ?? json.error ?? res.status), 120)}).`);
  return json;
}

export async function startSignIn(options: SignInOptions): Promise<PendingSignIn> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const server = new URL(options.server).origin;
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));

  const listener: Server = createServer();
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const redirectUri = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/callback`;
  const close = () => { listener.close(); listener.closeAllConnections?.(); };

  let clientId: string;
  let resource: string;
  try {
    // The resource to ask a token for is what the server says it is (RFC 9728), not a guess from its URL.
    const prm = await fetcher(new URL('/.well-known/oauth-protected-resource', server), { signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json() as Promise<{ resource?: unknown }>)
      .catch((error: unknown) => { throw new AppError('upstream_unreachable', "Can't reach the hosted MCPortal to sign in. Check the connection and try again.", { cause: error }); });
    if (typeof prm.resource !== 'string') throw new AppError('upstream_error', 'That server doesn\'t look like a hosted MCPortal with sign-in.');
    resource = prm.resource;
    const res = await fetcher(new URL('/oauth/register', server), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: clean(options.clientName ?? `MCPortal on ${hostname()}`, 80), redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => { throw new AppError('upstream_unreachable', "Can't reach the hosted MCPortal to sign in. Check the connection and try again.", { cause: error }); });
    const json = await res.json().catch(() => ({})) as { client_id?: unknown };
    if (!res.ok || typeof json.client_id !== 'string') throw new AppError('upstream_error', 'The hosted MCPortal would not register this computer for sign-in.');
    clientId = json.client_id;
  } catch (error) {
    close();
    throw error;
  }

  const authorize = new URL('/oauth/authorize', server);
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', state, resource,
  }).toString();

  let settle!: { resolve: (r: LinkRecord) => void; reject: (e: unknown) => void };
  const done = new Promise<LinkRecord>((resolve, reject) => { settle = { resolve, reject }; });
  done.catch(() => {});   // callers may never await it; failures are reported on the page and by link status
  const timer = setTimeout(() => { close(); settle.reject(new AppError('unavailable', 'The sign-in took too long; start it again.')); }, SIGN_IN_MS);
  timer.unref();
  let handled = false;

  listener.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);
    // The hosted server's own page style; its links go to the hosted server, not this listener.
    const resultPage = (title: string, body: string, ok = false) => page(title, body, ok ? { base: server, kicker: 'It\'s alive!' } : { base: server, door: 'shut', kicker: 'Signal lost' });
    const reply = (status: number, html: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' });
      res.end(html);
    };
    if (req.method !== 'GET' || url.pathname !== '/callback' || handled) return reply(404, resultPage('Not here', '<p>This page only finishes an MCPortal sign-in.</p>'));
    if (!same(url.searchParams.get('state') ?? '', state)) return reply(400, resultPage('Sign-in not finished', '<p>This link doesn\'t match the sign-in this computer started. Start it again from your agent.</p>'));
    handled = true;
    clearTimeout(timer);
    void (async () => {
      try {
        const denied = url.searchParams.get('error');
        if (denied) throw new AppError('forbidden', denied === 'access_denied' ? 'The sign-in was cancelled.' : 'The hosted MCPortal did not sign this computer in.');
        const tokens = await postForm(fetcher, new URL('/oauth/token', server), {
          grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '', client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource,
        });
        if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') throw new AppError('upstream_error', 'The hosted MCPortal sent no tokens.');
        const access = tokens.access_token;
        const client = new StateClient({ server, auth: { token: async () => access, refresh: async () => undefined }, fetch: fetcher });
        const me = await client.call<{ accountId: string; login: string | null }>('me');
        const record: LinkRecord = {
          version: 1, server, accountId: me.accountId, ...(me.login ? { login: me.login } : {}), clientId,
          accessToken: access, refreshToken: tokens.refresh_token,
          expiresAt: now() + (typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600) * 1000,
          linkedAt: new Date(now()).toISOString(),
        };
        await options.link.write(record);
        const note = await options.onLinked?.(record, client).catch(() => 'Signed in, but this computer\'s portal couldn\'t be copied to your account yet. Ask Claude to try again.');
        reply(200, resultPage('This computer is signed in', `<p>MCPortal on this computer now keeps your portal in your hosted account${me.login ? `, as <b>${escapeHtml(me.login)}</b>` : ''}.</p>${note ? `<p>${escapeHtml(note)}</p>` : ''}<p>You can close this tab and go back to your agent.</p>`, true));
        settle.resolve(record);
      } catch (error) {
        const message = error instanceof AppError ? error.message : 'Something went wrong while signing in.';
        reply(400, resultPage('Sign-in not finished', `<p>${escapeHtml(message)}</p><p>Start it again from your agent.</p>`));
        settle.reject(error);
      } finally {
        close();
      }
    })();
  });

  return { url: authorize.href, done, cancel: () => { clearTimeout(timer); close(); settle.reject(new AppError('unavailable', 'The sign-in was cancelled.')); } };
}
