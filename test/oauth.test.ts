import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import type { Fetcher, FetchOptions } from '../src/types.ts';
import { pkce, raw, startApp, type Running } from './helpers.ts';

const CLIENT_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

/** Fixture fetcher plus a fake GitHub and a fake client metadata document. */
function fakeUpstreams(users: Record<string, { id: number; login: string }>): { fetcher: Fetcher; calls: Array<{ url: string; options?: FetchOptions }> } {
  const fixtures = createFixtureFetcher();
  const calls: Array<{ url: string; options?: FetchOptions }> = [];
  const fetcher: Fetcher = async (url, options) => {
    calls.push({ url, options });
    const reply = (status: number, body: unknown) => ({ status, url, contentType: 'application/json', text: JSON.stringify(body), truncated: false });
    if (url === 'https://github.com/login/oauth/access_token') {
      const code = new URLSearchParams(options?.body ?? '').get('code') ?? '';
      return users[code] ? reply(200, { access_token: `gho_${code}`, token_type: 'bearer' }) : reply(200, { error: 'bad_verification_code' });
    }
    if (url === 'https://api.github.com/user') {
      const code = (options?.headers?.authorization ?? '').replace('Bearer gho_', '');
      return reply(200, users[code]);
    }
    if (url === 'https://client.example/meta.json') {
      return reply(200, { client_id: 'https://client.example/meta.json', client_name: 'Example CIMD Client', redirect_uris: ['https://client.example/cb'] });
    }
    return fixtures(url, options);
  };
  return { fetcher, calls };
}

async function startOAuth(allowed: string[] = []): Promise<Running> {
  const { fetcher } = fakeUpstreams({ 'gh-code-lawrence': { id: 42, login: 'Lawrence' }, 'gh-code-mallory': { id: 666, login: 'mallory' } });
  return startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' }, allowedGithubUsers: allowed }, fetcher);
}

const form = (data: Record<string, string>) => ({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });

async function register(app: Running, redirectUris = [CLIENT_REDIRECT]): Promise<string> {
  const res = await raw(app.port, { method: 'POST', path: '/oauth/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: redirectUris }) });
  assert.equal(res.status, 201, res.body);
  return JSON.parse(res.body).client_id;
}

interface Consent {
  txn: string;
  cookie: string;
}

/** Load the consent page like a browser: returns the transaction id and the browser-binding cookie. */
async function openConsent(app: Running, params: Record<string, string>): Promise<Consent> {
  const consent = await raw(app.port, { path: `/oauth/authorize?${new URLSearchParams(params)}` });
  assert.equal(consent.status, 200, consent.body);
  assert.equal(consent.headers['x-frame-options'], 'DENY');
  const txn = consent.body.match(/name="txn" value="([^"]+)"/)?.[1];
  const setCookie = String(consent.headers['set-cookie'] ?? '');
  assert.match(setCookie, /HttpOnly; SameSite=Lax/);
  assert.ok(txn);
  return { txn: txn!, cookie: setCookie.split(';')[0]! };
}

const sameOrigin = (port: number) => ({ origin: 'http://localhost', 'sec-fetch-site': 'same-origin', host: `localhost:${port}` });

/** Walk the whole browser flow; returns the final redirect back to the client. */
async function authorize(app: Running, clientId: string, challenge: string, ghCode: string, redirectUri = CLIENT_REDIRECT): Promise<URL> {
  const { txn, cookie } = await openConsent(app, { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-123', resource: 'http://localhost/mcp' });
  const f = form({ txn, decision: 'approve' });
  const approve = await raw(app.port, { method: 'POST', path: '/oauth/authorize', headers: { ...f.headers, ...sameOrigin(app.port), cookie }, body: f.body });
  assert.equal(approve.status, 302, approve.body);
  const gh = new URL(String(approve.headers.location));
  assert.equal(gh.origin + gh.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(gh.searchParams.get('client_id'), 'gh-client');
  const back = await raw(app.port, { path: `/oauth/callback?code=${ghCode}&state=${gh.searchParams.get('state')}`, headers: { cookie } });
  assert.equal(back.status, 302, back.body);
  return new URL(String(back.headers.location));
}

test('discovery: 401 challenge points at protected-resource metadata, which points at the AS', async () => {
  const app = await startOAuth();
  try {
    const res = await raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    assert.equal(res.status, 401);
    assert.match(String(res.headers['www-authenticate']), /resource_metadata="http:\/\/localhost\/\.well-known\/oauth-protected-resource"/);
    const prm = JSON.parse((await raw(app.port, { path: '/.well-known/oauth-protected-resource' })).body);
    assert.equal(prm.resource, 'http://localhost/mcp');
    assert.deepEqual(prm.authorization_servers, ['http://localhost']);
    const as = JSON.parse((await raw(app.port, { path: '/.well-known/oauth-authorization-server' })).body);
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
    assert.equal(as.registration_endpoint, 'http://localhost/oauth/register');
    assert.equal(as.client_id_metadata_document_supported, true);
  } finally {
    await app.close();
  }
});

test('full flow: register → consent → GitHub → code → token → per-user /mcp → refresh rotation', async () => {
  const app = await startOAuth();
  try {
    const clientId = await register(app);
    const { verifier, challenge } = pkce();
    const back = await authorize(app, clientId, challenge, 'gh-code-lawrence');
    assert.equal(back.origin + back.pathname, CLIENT_REDIRECT);
    assert.equal(back.searchParams.get('state'), 'st-123');
    assert.equal(back.searchParams.get('iss'), 'http://localhost');
    const code = back.searchParams.get('code')!;

    const wrongVerifier = await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: pkce().verifier }) });
    assert.equal(JSON.parse(wrongVerifier.body).error, 'invalid_grant');
    const reused = await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier }) });
    assert.equal(JSON.parse(reused.body).error, 'invalid_grant', 'codes are single-use, even after a failed attempt');

    // Fresh code, correct verifier.
    const code2 = (await authorize(app, clientId, challenge, 'gh-code-lawrence')).searchParams.get('code')!;
    const tokenRes = await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier, resource: 'http://localhost/mcp' }) });
    assert.equal(tokenRes.status, 200, tokenRes.body);
    assert.equal(tokenRes.headers['cache-control'], 'no-store');
    const tokens = JSON.parse(tokenRes.body);
    assert.equal(tokens.token_type, 'Bearer');

    const mcp = (token: string, body: unknown) =>
      raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const getProfile = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_profile', arguments: {} } };
    const first = await mcp(tokens.access_token, getProfile);
    assert.equal(first.status, 200);
    // Save a custom layout for this user.
    const profile = JSON.parse(first.body).result.structuredContent.profile;
    profile.name = 'lawrence-room';
    await mcp(tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'update_profile', arguments: { profile } } });

    // A different GitHub user gets their own profile.
    const other = await authorize(app, clientId, challenge, 'gh-code-mallory');
    const otherTokens = JSON.parse((await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code: other.searchParams.get('code')!, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier }) })).body);
    const mallory = JSON.parse((await mcp(otherTokens.access_token, getProfile)).body);
    assert.equal(mallory.result.structuredContent.profile.name, 'morning');
    const mine = JSON.parse((await mcp(tokens.access_token, getProfile)).body);
    assert.equal(mine.result.structuredContent.profile.name, 'lawrence-room');

    // Refresh rotates; the old refresh token dies.
    const refreshed = await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }) });
    assert.equal(refreshed.status, 200);
    assert.equal((await mcp(JSON.parse(refreshed.body).access_token, getProfile)).status, 200);
    const again = await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }) });
    assert.equal(JSON.parse(again.body).error, 'invalid_grant');
    assert.equal((await mcp(JSON.parse(refreshed.body).access_token, getProfile)).status, 401, 'replay revoked the grant');
    assert.equal((await mcp('mcpat_forged', getProfile)).status, 401);
  } finally {
    await app.close();
  }
});

test('authorize: pre-consent errors never redirect (no open redirect)', async () => {
  const app = await startOAuth();
  try {
    const clientId = await register(app);
    const base = { response_type: 'code', client_id: clientId, code_challenge_method: 'S256', code_challenge: pkce().challenge };
    const cases = [
      { ...base, redirect_uri: 'https://evil.example/cb' },
      { response_type: 'code', client_id: clientId, redirect_uri: CLIENT_REDIRECT },
      { ...base, redirect_uri: CLIENT_REDIRECT, resource: 'https://other.example/mcp' },
      { ...base, response_type: 'token', redirect_uri: CLIENT_REDIRECT },
    ];
    for (const params of cases) {
      const res = await raw(app.port, { path: `/oauth/authorize?${new URLSearchParams(params)}` });
      assert.equal(res.status, 400, JSON.stringify(params));
      assert.ok(!res.headers.location, 'error page, not a redirect');
    }
    const badRegistration = await raw(app.port, { method: 'POST', path: '/oauth/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
    assert.equal(badRegistration.status, 400);
    const unknownClient = await raw(app.port, { path: `/oauth/authorize?${new URLSearchParams({ ...base, client_id: 'nope', redirect_uri: CLIENT_REDIRECT })}` });
    assert.equal(unknownClient.status, 400);
    // Consent page escapes the client-controlled name.
    const xss = await raw(app.port, { method: 'POST', path: '/oauth/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: '<img src=x onerror=alert(1)>', redirect_uris: [CLIENT_REDIRECT] }) });
    const xssId = JSON.parse(xss.body).client_id;
    const page = await raw(app.port, { path: `/oauth/authorize?${new URLSearchParams({ ...base, client_id: xssId, redirect_uri: CLIENT_REDIRECT })}` });
    assert.ok(!page.body.includes('<img src=x'), 'client name is escaped');
  } finally {
    await app.close();
  }
});

test('allowlist: a private server rejects other GitHub users; deny returns access_denied', async () => {
  const app = await startOAuth(['lawrence']);
  try {
    const clientId = await register(app);
    const { challenge } = pkce();
    const rejected = await authorize(app, clientId, challenge, 'gh-code-mallory');
    assert.equal(rejected.searchParams.get('error'), 'access_denied');
    assert.equal(rejected.searchParams.get('code'), null);
    const allowed = await authorize(app, clientId, challenge, 'gh-code-lawrence');
    assert.ok(allowed.searchParams.get('code'), 'login match is case-insensitive');

    const { txn, cookie } = await openConsent(app, { response_type: 'code', client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
    const deny = form({ txn, decision: 'deny' });
    const denied = await raw(app.port, { method: 'POST', path: '/oauth/authorize', headers: { ...deny.headers, ...sameOrigin(app.port), cookie }, body: deny.body });
    assert.equal(new URL(String(denied.headers.location)).searchParams.get('error'), 'access_denied');
    const approve = form({ txn, decision: 'approve' });
    const replay = await raw(app.port, { method: 'POST', path: '/oauth/authorize', headers: { ...approve.headers, ...sameOrigin(app.port), cookie }, body: approve.body });
    assert.equal(replay.status, 400, 'a used consent can not be replayed');
  } finally {
    await app.close();
  }
});

test('consent is bound to the browser: a pre-fetched txn cannot be approved cross-site (account takeover)', async () => {
  const app = await startOAuth();
  try {
    // Attacker registers a client and loads the consent page themselves.
    const clientId = await register(app, ['https://evil.example/cb']);
    const { challenge } = pkce();
    const attacker = await openConsent(app, { response_type: 'code', client_id: clientId, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' });
    const f = form({ txn: attacker.txn, decision: 'approve' });
    // Victim's browser auto-submits from evil.example: no cookie for this txn, cross-site headers.
    const crossSite = await raw(app.port, { method: 'POST', path: '/oauth/authorize', headers: { ...f.headers, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: f.body });
    assert.equal(crossSite.status, 403);
    // Even with the attacker's own cookie planted, a cross-origin POST is refused.
    const planted = await raw(app.port, { method: 'POST', path: '/oauth/authorize', headers: { ...f.headers, origin: 'https://evil.example', cookie: attacker.cookie }, body: f.body });
    assert.equal(planted.status, 403);
    // Same origin but a different browser (no/other cookie) is refused too.
    const otherBrowser = await raw(app.port, { method: 'POST', path: '/oauth/authorize', headers: { ...f.headers, ...sameOrigin(app.port), cookie: 'mcportal_signin=someone-else' }, body: f.body });
    assert.equal(otherBrowser.status, 403);
  } finally {
    await app.close();
  }
});

test('removing a user from the allowlist revokes their access and refresh; refresh reuse kills the grant', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dataDir = await mkdtemp(`${tmpdir()}/mcportal-allow-`);
  const users = { 'gh-code-lawrence': { id: 42, login: 'Lawrence' }, 'gh-code-mallory': { id: 666, login: 'mallory' } };
  const github = { clientId: 'gh-client', clientSecret: 'gh-secret' };
  const getProfile = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_profile', arguments: {} } });
  const mcp = (app: Running, token: string) => raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: getProfile });
  const exchange = async (app: Running, clientId: string, code: string, verifier: string) =>
    JSON.parse((await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier }) })).body);

  const open = await startApp({ github, dataDir }, fakeUpstreams(users).fetcher);
  let clientId: string;
  let mallory: { access_token: string; refresh_token: string };
  let lawrence: { access_token: string; refresh_token: string };
  try {
    clientId = await register(open);
    const { verifier, challenge } = pkce();
    mallory = await exchange(open, clientId, (await authorize(open, clientId, challenge, 'gh-code-mallory')).searchParams.get('code')!, verifier);
    lawrence = await exchange(open, clientId, (await authorize(open, clientId, challenge, 'gh-code-lawrence')).searchParams.get('code')!, verifier);
    assert.equal((await mcp(open, mallory.access_token)).status, 200);
  } finally {
    await open.close();
  }

  // Restart with an allowlist (by login for one user, by numeric id works too).
  const closed = await startApp({ github, dataDir, allowedGithubUsers: ['42'] }, fakeUpstreams(users).fetcher);
  try {
    assert.equal((await mcp(closed, mallory.access_token)).status, 401, 'access token stops working immediately');
    const refresh = await raw(closed.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: mallory.refresh_token, client_id: clientId }) });
    assert.equal(JSON.parse(refresh.body).error, 'invalid_grant', 'and cannot be refreshed');
    assert.equal((await mcp(closed, lawrence.access_token)).status, 200, 'allowed by numeric id');

    // Refresh rotation revokes the old access token; replaying a spent refresh token kills the grant.
    const r1 = JSON.parse((await raw(closed.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: lawrence.refresh_token, client_id: clientId }) })).body);
    assert.ok(r1.access_token);
    assert.equal((await mcp(closed, lawrence.access_token)).status, 401, 'old access token revoked on refresh');
    assert.equal((await mcp(closed, r1.access_token)).status, 200);
    const replay = await raw(closed.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: lawrence.refresh_token, client_id: clientId }) });
    assert.equal(JSON.parse(replay.body).error, 'invalid_grant');
    assert.equal((await mcp(closed, r1.access_token)).status, 401, 'reuse of a spent refresh token revokes the whole grant');
  } finally {
    await closed.close();
  }
});

test('registration and authorize are rate limited; register input is bounded', async () => {
  const app = await startOAuth();
  try {
    const long = `https://claude.ai/${'x'.repeat(3000)}`;
    const tooLong = await raw(app.port, { method: 'POST', path: '/oauth/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [long] }) });
    assert.equal(tooLong.status, 400);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await raw(app.port, { method: 'POST', path: '/oauth/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CLIENT_REDIRECT] }) })).status);
    }
    assert.ok(statuses.includes(429), `got ${statuses.join(',')}`);
  } finally {
    await app.close();
  }
});

test('client ID metadata documents work without registration', async () => {
  const app = await startOAuth();
  try {
    const { challenge } = pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: 'https://client.example/meta.json', redirect_uri: 'https://client.example/cb', code_challenge: challenge, code_challenge_method: 'S256' });
    const consent = await raw(app.port, { path: `/oauth/authorize?${q}` });
    assert.equal(consent.status, 200);
    assert.match(consent.body, /Example CIMD Client/);
    const q2 = new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: 'https://evil.example/cb' });
    assert.equal((await raw(app.port, { path: `/oauth/authorize?${q2}` })).status, 400);
  } finally {
    await app.close();
  }
});

test('invite-only: admins and invited logins get in and get accounts; others are refused; suspension cuts off at once', async () => {
  const { Accounts, makeBootstrap, memoryPersistence } = await import('../src/accounts.ts');
  const users = { 'gh-code-lawrence': { id: 42, login: 'Lawrence' }, 'gh-code-mallory': { id: 666, login: 'mallory' }, 'gh-code-eve': { id: 7, login: 'eve' } };
  const accounts = new Accounts(memoryPersistence(), makeBootstrap(['lawrence'], []));
  await accounts.invite('Mallory', 'test');
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, fakeUpstreams(users).fetcher, { accounts });
  const getProfile = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_profile', arguments: {} } });
  const call = (token: string) => raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: getProfile });
  try {
    const clientId = await register(app);
    const { verifier, challenge } = pkce();
    const signIn = async (code: string) => {
      const back = await authorize(app, clientId, challenge, code);
      const granted = back.searchParams.get('code');
      if (!granted) return { error: back.searchParams.get('error_description') };
      const res = await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code: granted, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier }) });
      return JSON.parse(res.body) as { access_token: string; refresh_token: string };
    };

    const lawrence = await signIn('gh-code-lawrence');
    const mallory = await signIn('gh-code-mallory');
    const eve = await signIn('gh-code-eve');
    assert.match(String((eve as { error: string }).error), /invite-only/);
    assert.equal((await call((lawrence as { access_token: string }).access_token)).status, 200);
    assert.equal((await call((mallory as { access_token: string }).access_token)).status, 200);

    const { accounts: all, invites } = await accounts.list();
    assert.deepEqual(all.map((a) => [a.id, a.role, a.via]).sort(), [['github-42', 'admin', 'bootstrap'], ['github-666', 'user', 'invite']]);
    assert.equal(invites.length, 0, 'the invite is used up');

    await accounts.setStatus('mallory', 'suspended', 'test', 'spam');
    assert.equal((await call((mallory as { access_token: string }).access_token)).status, 401, 'suspension applies on the next request');
    const refresh = await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: (mallory as { refresh_token: string }).refresh_token, client_id: clientId }) });
    assert.equal(JSON.parse(refresh.body).error, 'invalid_grant');
    assert.match(String(((await signIn('gh-code-mallory')) as { error: string }).error), /suspended/);

    await accounts.setStatus('github-666', 'active', 'test');
    assert.ok('access_token' in (await signIn('gh-code-mallory')), 'reinstated');
    const audit = (await accounts.auditLog()).map((e) => e.action);
    assert.deepEqual(audit.slice(0, 2), ['account.reinstated', 'account.suspended']);
  } finally {
    await app.close();
  }
});

test('admin page: browser-bound GitHub sign-in, admins only, CSRF and same-origin on every change', async () => {
  const { Accounts, makeBootstrap, memoryPersistence } = await import('../src/accounts.ts');
  const users = { 'gh-code-lawrence': { id: 42, login: 'Lawrence' }, 'gh-code-mallory': { id: 666, login: 'mallory' } };
  const accounts = new Accounts(memoryPersistence(), makeBootstrap(['lawrence'], []));
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, fakeUpstreams(users).fetcher, { accounts });
  const cookieOf = (res: { headers: Record<string, string | string[] | undefined> }, name: string) => {
    const all = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    return all.map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
  };
  const signIn = async (ghCode: string, withBrowserCookie = true) => {
    const start = await raw(app.port, { path: '/admin/login' });
    assert.equal(start.status, 302);
    const gh = new URL(String(start.headers.location));
    assert.match(gh.searchParams.get('state')!, /^pg_/);
    const browser = cookieOf(start, 'mcportal_page')!;
    return raw(app.port, { path: `/oauth/callback?code=${ghCode}&state=${gh.searchParams.get('state')}`, headers: withBrowserCookie ? { cookie: browser } : {} });
  };
  try {
    assert.match((await raw(app.port, { path: '/admin' })).body, /Sign in with GitHub/);
    assert.equal((await raw(app.port, { path: '/admin/api/state' })).status, 401);
    assert.equal((await signIn('gh-code-lawrence', false)).status, 400, 'a callback without the starting browser cookie is refused');

    const done = await signIn('gh-code-lawrence');
    assert.equal(done.status, 302);
    assert.equal(done.headers.location, '/admin');
    const session = cookieOf(done, 'mcportal_admin')!;
    assert.ok(session);
    const page = await raw(app.port, { path: '/admin', headers: { cookie: session } });
    assert.match(String(page.headers['content-security-policy']), /script-src 'nonce-/);
    assert.match(page.body, /Invite someone/);

    const state = JSON.parse((await raw(app.port, { path: '/admin/api/state', headers: { cookie: session } })).body);
    assert.equal(state.me.login, 'Lawrence');
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      raw(app.port, { method: 'POST', path, headers: { 'content-type': 'application/json', cookie: session, ...headers }, body: JSON.stringify(body) });

    assert.equal((await post('/admin/api/invite', { who: 'mallory' }, sameOrigin(app.port))).status, 403, 'CSRF token required');
    assert.equal((await post('/admin/api/invite', { who: 'mallory' }, { 'x-csrf': state.csrf, origin: 'https://evil.example' })).status, 403, 'same origin required');
    const invited = await post('/admin/api/invite', { who: 'mallory' }, { ...sameOrigin(app.port), 'x-csrf': state.csrf });
    assert.equal(invited.status, 200);
    assert.deepEqual(JSON.parse(invited.body).invites.map((i: { login: string }) => i.login), ['mallory']);
    const code = JSON.parse(invited.body).invites[0].code as string;
    assert.match(code, /^[A-Za-z0-9_-]{24}$/);

    // The public join page explains the steps for exactly that person; no script, not indexed.
    const join = await raw(app.port, { path: `/join/${code}` });
    assert.equal(join.status, 200);
    assert.match(join.body, /@Lawrence invited <b>@mallory<\/b>/);
    assert.match(join.body, /sign in with GitHub as <b>@mallory<\/b>/);
    assert.match(join.body, /http:\/\/localhost\/mcp/);
    assert.equal(join.headers['x-robots-tag'], 'noindex, nofollow');
    assert.doesNotMatch(String(join.headers['content-security-policy']), /script-src/);
    assert.equal((await raw(app.port, { path: '/join/not-a-real-code-at-all-000' })).status, 404);

    // Mallory can now sign in to MCPortal, but not to the admin page.
    const mallory = await signIn('gh-code-mallory');
    assert.equal(mallory.status, 403);
    assert.match(mallory.body, /isn.t an admin/);
    assert.equal(cookieOf(mallory, 'mcportal_admin'), undefined);
    assert.match((await raw(app.port, { path: `/join/${code}` })).body, /@mallory is already in/, 'the link reflects that the invite was used');
    const reinvite = await post('/admin/api/invite', { who: 'mallory' }, { ...sameOrigin(app.port), 'x-csrf': state.csrf });
    assert.match(JSON.parse(reinvite.body).error_description, /already has an account/);

    const self = await post('/admin/api/suspend', { who: 'lawrence' }, { ...sameOrigin(app.port), 'x-csrf': state.csrf });
    assert.equal(self.status, 400, "can't suspend yourself");
    const suspended = await post('/admin/api/suspend', { who: 'mallory', reason: 'spam' }, { ...sameOrigin(app.port), 'x-csrf': state.csrf });
    assert.equal(JSON.parse(suspended.body).accounts.find((a: { login: string }) => a.login === 'mallory').status, 'suspended');
    assert.equal(JSON.parse(suspended.body).audit[0].action, 'account.suspended');

    const out = await raw(app.port, { method: 'POST', path: '/admin/logout', headers: { cookie: session, ...sameOrigin(app.port) } });
    assert.equal(out.status, 302);
    assert.equal((await raw(app.port, { path: '/admin/api/state', headers: { cookie: session } })).status, 401, 'session ended');
  } finally {
    await app.close();
  }
});

test('account page: download everything, one-time links, and delete the account (CSRF, typed confirmation, tokens revoked)', async () => {
  const { Accounts, makeBootstrap, memoryPersistence } = await import('../src/accounts.ts');
  const { PublicProfiles } = await import('../src/public-profiles.ts');
  const { MemoryClipStore } = await import('../src/clips.ts');
  const users = { 'gh-code-lawrence': { id: 42, login: 'Lawrence' }, 'gh-code-mallory': { id: 666, login: 'mallory' } };
  const accounts = new Accounts(memoryPersistence(), makeBootstrap([], ['lawrence']));
  const publicProfiles = new PublicProfiles(memoryPersistence());
  const clips = new MemoryClipStore();
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, fakeUpstreams(users).fetcher, { accounts, publicProfiles, clips });
  const cookieOf = (res: { headers: Record<string, string | string[] | undefined> }, name: string) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
  try {
    // Connect as an MCP client and put some data in.
    const clientId = await register(app);
    const { verifier, challenge } = pkce();
    const code = (await authorize(app, clientId, challenge, 'gh-code-lawrence')).searchParams.get('code')!;
    const tokens = JSON.parse((await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier, resource: 'http://localhost/mcp' }) })).body);
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      return { status: res.status, result: res.status === 200 ? JSON.parse(res.body).result : undefined };
    };
    assert.equal((await tool('clip', { kind: 'quote', text: 'keep me' })).status, 200);
    assert.equal((await tool('set_public_profile', { handle: 'lawrence' })).result.structuredContent.profile.handle, 'lawrence');
    assert.match((await tool('account_settings')).result.content[0].text, /http:\/\/localhost\/account/);

    // export_data hands out a link that works once.
    const link = new URL((await tool('export_data', { format: 'mcportal' })).result.structuredContent.where);
    const download = await raw(app.port, { path: link.pathname });
    assert.equal(download.status, 200);
    assert.match(String(download.headers['content-disposition']), /attachment; filename="mcportal-export-/);
    assert.equal(JSON.parse(download.body).clips[0].data.text, 'keep me');
    assert.equal((await raw(app.port, { path: link.pathname })).status, 410, 'one use');
    assert.equal((await raw(app.port, { path: '/download/not-a-real-token-at-all' })).status, 410);

    // The account page: sign in (browser-bound), see your data, download.
    assert.match((await raw(app.port, { path: '/account' })).body, /Sign in with GitHub/);
    assert.equal((await raw(app.port, { path: '/account/export/mcportal' })).status, 302, 'downloads need a session');
    const start = await raw(app.port, { path: '/account/login' });
    const gh = new URL(String(start.headers.location));
    const done = await raw(app.port, { path: `/oauth/callback?code=gh-code-lawrence&state=${gh.searchParams.get('state')}`, headers: { cookie: cookieOf(start, 'mcportal_page')! } });
    assert.equal(done.headers.location, '/account');
    const session = cookieOf(done, 'mcportal_account')!;
    const home = await raw(app.port, { path: '/account', headers: { cookie: session } });
    assert.match(home.body, /Signed in as <b>@Lawrence<\/b>\. Public profile: <b>@lawrence<\/b>/);
    assert.match(home.body, /1 clip\(s\)/);
    assert.doesNotMatch(String(home.headers['content-security-policy']), /script-src/);
    const csrf = home.body.match(/name="csrf" value="([^"]+)"/)![1]!;
    const bookmarks = await raw(app.port, { path: '/account/export/bookmarks', headers: { cookie: session } });
    assert.match(bookmarks.body, /NETSCAPE-Bookmark-file-1/);

    // Deleting needs same origin, the CSRF token and the typed confirmation.
    const del = (data: Record<string, string>, headers: Record<string, string> = sameOrigin(app.port)) => {
      const f = form(data);
      return raw(app.port, { method: 'POST', path: '/account/delete', headers: { ...f.headers, ...headers, cookie: session }, body: f.body });
    };
    assert.equal((await del({ csrf, confirm: 'delete @lawrence' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await del({ csrf: 'wrong', confirm: 'delete @lawrence' })).status, 403);
    assert.equal((await del({ csrf, confirm: 'delete' })).status, 400);
    assert.equal((await tool('search_clips')).result.structuredContent.clips.length, 1, 'nothing deleted yet');
    const gone = await del({ csrf, confirm: 'Delete @Lawrence' });
    assert.equal(gone.status, 200, gone.body);
    assert.match(gone.body, /Your account is deleted/);

    assert.equal((await tool('search_clips')).status, 401, 'tokens are revoked');
    assert.equal((await clips.list('github-42')).length, 0);
    assert.equal(await publicProfiles.get('github-42'), undefined);
    assert.equal((await accounts.list()).accounts.length, 0);
    assert.equal((await accounts.auditLog(5))[0]!.action, 'account.deleted');
    assert.equal((await raw(app.port, { path: '/account', headers: { cookie: session } })).body.includes('Signed in'), false, 'the session is gone');
  } finally {
    await app.close();
  }
});

test('import uploads: one-time links from import_portal and the account page, CSRF, size cap', async () => {
  const { Accounts, makeBootstrap, memoryPersistence } = await import('../src/accounts.ts');
  const { MemoryClipStore, buildClip } = await import('../src/clips.ts');
  const { buildExport } = await import('../src/portability.ts');
  const { MemoryProfileStore } = await import('../src/store.ts');
  const users = { 'gh-code-lawrence': { id: 42, login: 'Lawrence' } };
  const accounts = new Accounts(memoryPersistence(), makeBootstrap([], ['lawrence']));
  const clips = new MemoryClipStore();
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, fakeUpstreams(users).fetcher, { accounts, clips });
  // An export from somewhere else, with a clip.
  const elsewhere = { store: new MemoryProfileStore(), clips: new MemoryClipStore() };
  await elsewhere.clips.add('x', buildClip({ kind: 'quote', text: 'brought along' }));
  const exported = (await buildExport('mcportal', 'x', elsewhere)).body.toString();
  const multipart = (fields: Record<string, string>) => {
    const b = 'mcportal-test-boundary';
    const body = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"${k === 'file' ? '; filename="export.json"' : ''}\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`;
    return { headers: { 'content-type': `multipart/form-data; boundary=${b}` }, body };
  };
  const cookieOf = (res: { headers: Record<string, string | string[] | undefined> }, name: string) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
  try {
    const clientId = await register(app);
    const { verifier, challenge } = pkce();
    const code = (await authorize(app, clientId, challenge, 'gh-code-lawrence')).searchParams.get('code')!;
    const tokens = JSON.parse((await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier, resource: 'http://localhost/mcp' }) })).body);
    const tool = async (name: string, args: Record<string, unknown> = {}) => JSON.parse((await raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).body).result;

    // import_portal with no arguments: an upload link. The file never passes through the model.
    const link = new URL((await tool('import_portal')).structuredContent.uploadUrl);
    const pageRes = await raw(app.port, { path: link.pathname });
    assert.equal(pageRes.status, 200);
    assert.match(pageRes.body, /enctype="multipart\/form-data"/);
    assert.doesNotMatch(String(pageRes.headers['content-security-policy']), /script-src/);
    const upload = (path: string, fields: Record<string, string>, extra: Record<string, string> = sameOrigin(app.port)) => {
      const m = multipart(fields);
      return raw(app.port, { method: 'POST', path, headers: { ...m.headers, ...extra }, body: m.body });
    };
    assert.equal((await upload(link.pathname, { file: exported }, { origin: 'https://evil.example' })).status, 403, 'same origin');
    const done = await upload(link.pathname, { file: exported });
    assert.equal(done.status, 200, done.body);
    assert.match(done.body, /1 clip\(s\) added/);
    assert.equal((await tool('search_clips', { query: 'brought' })).structuredContent.clips.length, 1);
    assert.equal((await upload(link.pathname, { file: exported })).status, 410, 'one use');

    const bad = new URL((await tool('import_portal')).structuredContent.uploadUrl);
    const refused = await upload(bad.pathname, { file: '{"format":"nope"}' });
    assert.equal(refused.status, 400);
    assert.match(refused.body, /not an MCPortal export/);

    const big = new URL((await tool('import_portal')).structuredContent.uploadUrl);
    const tooBig = await raw(app.port, { method: 'POST', path: big.pathname, headers: { ...sameOrigin(app.port), 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(61 * 1024 * 1024) }, body: '' });
    assert.equal(tooBig.status, 413);

    // The account page's import needs the session's CSRF token.
    const start = await raw(app.port, { path: '/account/login' });
    const gh = new URL(String(start.headers.location));
    const signedIn = await raw(app.port, { path: `/oauth/callback?code=gh-code-lawrence&state=${gh.searchParams.get('state')}`, headers: { cookie: cookieOf(start, 'mcportal_page')! } });
    const session = cookieOf(signedIn, 'mcportal_account')!;
    const home = await raw(app.port, { path: '/account', headers: { cookie: session } });
    assert.match(home.body, /action="\/account\/import"/);
    const csrf = home.body.match(/name="csrf" value="([^"]+)"/)![1]!;
    assert.equal((await upload('/account/import', { csrf: 'wrong', file: exported }, { ...sameOrigin(app.port), cookie: session })).status, 403);
    const again = await upload('/account/import', { csrf, file: exported }, { ...sameOrigin(app.port), cookie: session });
    assert.equal(again.status, 200);
    assert.match(again.body, /0 clip\(s\) added \(1 already here\)/, 'importing twice changes nothing');
  } finally {
    await app.close();
  }
});

test('admin moderation: reports show on the admin page; hide, unhide and dismiss are CSRF-protected and audited', async () => {
  const { Accounts, makeBootstrap, memoryPersistence } = await import('../src/accounts.ts');
  const { PublicProfiles } = await import('../src/public-profiles.ts');
  const { DocumentSocialStore, Social } = await import('../src/social.ts');
  const users = { 'gh-code-lawrence': { id: 42, login: 'Lawrence' } };
  const accounts = new Accounts(memoryPersistence(), makeBootstrap(['lawrence'], []));
  const publicProfiles = new PublicProfiles(memoryPersistence());
  const social = new Social({ store: new DocumentSocialStore(), profiles: publicProfiles });
  await publicProfiles.set('github-7', { handle: 'spammer' });
  await publicProfiles.set('github-8', { handle: 'reader' });
  const share = await social.share('github-7', { kind: 'link', title: 'Buy now', url: 'https://spam.example/', note: 'cheap', audience: 'mcportal' });
  const report = await social.report('github-8', { shareId: share.id }, 'spam');
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, fakeUpstreams(users).fetcher, { accounts, publicProfiles, social });
  const cookieOf = (res: { headers: Record<string, string | string[] | undefined> }, name: string) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
  try {
    const start = await raw(app.port, { path: '/admin/login' });
    const gh = new URL(String(start.headers.location));
    const done = await raw(app.port, { path: `/oauth/callback?code=gh-code-lawrence&state=${gh.searchParams.get('state')}`, headers: { cookie: cookieOf(start, 'mcportal_page')! } });
    const session = cookieOf(done, 'mcportal_admin')!;
    const state = JSON.parse((await raw(app.port, { path: '/admin/api/state', headers: { cookie: session } })).body);
    assert.equal(state.reports.length, 1);
    assert.equal(state.reports[0].target.title, 'Buy now');
    assert.equal(state.reports[0].target.account.handle, 'spammer');
    assert.equal(state.reports[0].reporter.handle, 'reader');
    const post = (path: string, body: unknown, headers: Record<string, string> = { ...sameOrigin(app.port), 'x-csrf': state.csrf }) =>
      raw(app.port, { method: 'POST', path, headers: { 'content-type': 'application/json', cookie: session, ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/admin/api/report', { id: report.id, action: 'hide' }, sameOrigin(app.port))).status, 403, 'CSRF');
    const hidden = JSON.parse((await post('/admin/api/report', { id: report.id, action: 'hide' })).body);
    assert.equal(hidden.reports[0].status, 'resolved');
    assert.equal(hidden.reports[0].target.hidden, true);
    assert.equal(await social.get('github-8', share.id), undefined, 'hidden from everyone else');
    assert.equal(hidden.audit[0].action, 'share.hidden');
    assert.equal(hidden.audit[0].actor, 'admin:Lawrence');
    const shown = JSON.parse((await post('/admin/api/unhide', { id: share.id })).body);
    assert.equal(shown.audit[0].action, 'share.unhidden');
    assert.equal((await social.get('github-8', share.id))?.title, 'Buy now');
    assert.equal((await post('/admin/api/report', { id: 'nope', action: 'dismiss' })).status, 404);
  } finally {
    await app.close();
  }
});
