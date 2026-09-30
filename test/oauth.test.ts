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
    profile.name = 'lawrence-workspace';
    await mcp(tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'update_profile', arguments: { profile } } });

    // A different GitHub user gets their own profile.
    const other = await authorize(app, clientId, challenge, 'gh-code-mallory');
    const otherTokens = JSON.parse((await raw(app.port, { method: 'POST', path: '/oauth/token', ...form({ grant_type: 'authorization_code', code: other.searchParams.get('code')!, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier }) })).body);
    const mallory = JSON.parse((await mcp(otherTokens.access_token, getProfile)).body);
    assert.equal(mallory.result.structuredContent.profile.name, 'morning');
    const mine = JSON.parse((await mcp(tokens.access_token, getProfile)).body);
    assert.equal(mine.result.structuredContent.profile.name, 'lawrence-workspace');

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
