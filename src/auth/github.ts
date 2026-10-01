/**
 * GitHub as the identity provider: the authorize URL MCPortal sends people to, and
 * turning the code GitHub sends back into a numeric id and login. The GitHub token
 * is used for that one request and then dropped; nothing upstream is echoed.
 */
import { isAppError } from '../lib/errors.ts';
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

/** Where to send the browser to sign in: read:user only, bound to `state`. */
export function githubAuthorizeUrl(app: GithubApp, redirectUri: string, state: string, options: { allowSignup?: boolean } = {}): string {
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', app.clientId);
  gh.searchParams.set('redirect_uri', redirectUri);
  gh.searchParams.set('state', state);
  gh.searchParams.set('scope', 'read:user');
  if (options.allowSignup) gh.searchParams.set('allow_signup', 'true');
  return gh.href;
}

/** Exchange a GitHub OAuth code for the user's numeric id and login. A failure is { error }, never upstream text. */
export async function githubIdentity(fetcher: Fetcher, app: GithubApp, code: string, redirectUri: string): Promise<GithubIdentity | { error: string }> {
  try {
    const exchange = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri }).toString(),
      maxBytes: 16 * 1024,
      maxRedirects: 0,
    });
    let token: string | undefined;
    try {
      token = (JSON.parse(exchange.text) as { access_token?: string }).access_token;
    } catch {
      token = undefined;
    }
    if (exchange.status !== 200 || !token) return { error: 'GitHub sign-in failed' };
    const user = await fetchJson<{ id?: number; login?: string }>(fetcher, 'https://api.github.com/user', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      maxBytes: 64 * 1024,
      maxRedirects: 0,
    });
    if (typeof user.id !== 'number' || typeof user.login !== 'string') return { error: 'Could not read GitHub profile' };
    return { githubId: user.id, login: user.login };
  } catch (error) {
    // GitHub unreachable, slow or erroring: a failed sign-in, not a server error.
    if (isAppError(error)) return { error: 'GitHub sign-in failed; try again in a moment' };
    throw error;
  }
}
