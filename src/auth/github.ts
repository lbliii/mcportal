/**
 * GitHub as the identity provider: the authorize URL MCPortal sends people to, and
 * turning the code GitHub sends back into a numeric id and login. The GitHub token
 * is used for that one request and then dropped; nothing upstream is echoed.
 */
import { isAppError } from '../lib/errors.ts';
import { processLogger, requestId, type Logger } from '../lib/log.ts';
import { fetchJson } from '../lib/safe-fetch.ts';
import type { Fetcher } from '../types.ts';

export interface GithubApp {
  clientId: string;
  clientSecret: string;
}

export interface GithubIdentity {
  githubId: number;
  login: string;
}

/** Where to send the browser to sign in: public identity only, bound to `state`. */
export function githubAuthorizeUrl(app: GithubApp, redirectUri: string, state: string, options: { allowSignup?: boolean } = {}): string {
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', app.clientId);
  gh.searchParams.set('redirect_uri', redirectUri);
  gh.searchParams.set('state', state);
  gh.searchParams.set('scope', '');
  if (options.allowSignup) gh.searchParams.set('allow_signup', 'true');
  return gh.href;
}

/** Exchange a GitHub OAuth code for the user's numeric id and login. A failure is { error }, never upstream text. */
export async function githubIdentity(fetcher: Fetcher, app: GithubApp, code: string, redirectUri: string, log: Logger = processLogger()): Promise<GithubIdentity | { error: string }> {
  let step = 'token';
  const failed = (reason: string, message: string, status?: number) => {
    const reference = requestId();
    log.warn('auth.github_failed', { reference, step, reason, status });
    return { error: `${message} Reference: ${reference}.` };
  };
  try {
    const exchange = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri }).toString(),
      maxBytes: 16 * 1024,
      maxRedirects: 0,
    });
    let token: unknown;
    let oauthError: unknown;
    try {
      const json = JSON.parse(exchange.text) as { access_token?: unknown; error?: unknown } | null;
      token = json?.access_token;
      oauthError = json?.error;
    } catch {
      token = undefined;
    }
    // GitHub may return an OAuth error with HTTP 200. Only known codes select our own wording.
    if (oauthError === 'bad_verification_code') return failed('expired_code', 'The GitHub authorization code is invalid or expired. Start sign-in again with a fresh link.', exchange.status);
    if (oauthError === 'incorrect_client_credentials') return failed('client_configuration', 'GitHub rejected MCPortal’s OAuth app credentials. Contact the MCPortal server owner to check the GitHub app configuration.', exchange.status);
    if (oauthError === 'redirect_uri_mismatch') return failed('callback_configuration', 'GitHub rejected MCPortal’s callback address. Contact the MCPortal server owner to check the GitHub app callback configuration.', exchange.status);
    if (oauthError === 'unverified_user_email') return failed('unverified_email', 'GitHub requires a verified primary email address for this sign-in. Verify your email on GitHub, then try again.', exchange.status);
    if (exchange.status === 429 || exchange.status >= 500) return failed('github_unavailable', `GitHub could not complete sign-in (HTTP ${exchange.status}). Try again in a few minutes.`, exchange.status);
    if (exchange.status !== 200 || typeof token !== 'string' || !token || oauthError) return failed('token_response', `MCPortal could not obtain a GitHub sign-in token (HTTP ${exchange.status}). Start again; if it keeps failing, contact the server owner.`, exchange.status);
    step = 'profile';
    const user = await fetchJson<{ id?: number; login?: string }>(fetcher, 'https://api.github.com/user', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      maxBytes: 64 * 1024,
      maxRedirects: 0,
    });
    if (!user || typeof user.id !== 'number' || typeof user.login !== 'string') return failed('profile_response', 'GitHub returned an unreadable account profile. Try again; if it keeps failing, contact the server owner.');
    return { githubId: user.id, login: user.login };
  } catch (error) {
    // GitHub unreachable, slow or erroring: a failed sign-in, not a server error.
    if (isAppError(error)) {
      const status = typeof error.details?.status === 'number' ? error.details.status : undefined;
      const timedOut = error.code === 'fetch_timeout';
      return failed(error.code, `MCPortal ${timedOut ? 'timed out contacting' : 'could not complete a request to'} GitHub while ${step === 'token' ? 'exchanging authorization' : 'reading your account profile'}.${status ? ` HTTP ${status}.` : ''} Try again in a moment; if it keeps failing, contact the server owner.`, status);
    }
    throw error;
  }
}
