/**
 * Signing a local MCPortal in and out, end to end: a local session with its own data,
 * an in-process hosted MCPortal with (fake) GitHub sign-in, the browser's part played
 * by raw requests, and the loopback listener for real.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Accounts, makeBootstrap } from '../src/accounts.ts';
import { buildClip, FileClipStore } from '../src/clips.ts';
import { FileHandoffStore } from '../src/handoffs.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { memoryPersistence } from '../src/lib/document.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { FileLinkAuth, LinkFile } from '../src/link/link-file.ts';
import { LocalSession } from '../src/link/session.ts';
import { handleMessage } from '../src/mcp.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore } from '../src/seen.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { FileProfileStore, MemoryProfileStore } from '../src/store.ts';
import type { Fetcher } from '../src/types.ts';
import { raw, startApp } from './helpers.ts';

/** Fixtures, plus a fake GitHub that knows one user. */
function fakeGithub(): Fetcher {
  const fixtures = createFixtureFetcher();
  return async (url, options) => {
    const reply = (body: unknown) => ({ status: 200, url, contentType: 'application/json', text: JSON.stringify(body), truncated: false });
    if (url === 'https://github.com/login/oauth/access_token') return reply({ access_token: 'gho_lawrence', token_type: 'bearer' });
    if (url === 'https://api.github.com/user') return reply({ id: 42, login: 'lawrence' });
    return fixtures(url, options);
  };
}

async function setUp() {
  const hostedStore = new MemoryProfileStore();
  const publicProfiles = new PublicProfiles(memoryPersistence());
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, fakeGithub(), {
    store: hostedStore, publicProfiles, social: new Social({ store: new DocumentSocialStore(), profiles: publicProfiles }),
    accounts: new Accounts(memoryPersistence(), makeBootstrap([], [])),
  });
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mcportal-link-'));
  const local = { store: new FileProfileStore(dataDir), clips: new FileClipStore(dataDir), reading: new FileReadingStore(dataDir), seen: new FileSeenStore(dataDir), handoffs: new FileHandoffStore(dataDir) };
  const session = new LocalSession({ dataDir, localUser: 'default', local, base: { fetcher: createFixtureFetcher(), cache: new TtlCache() }, hostedUrl: app.base });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, await session.context());
    return res!.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean };
  };
  const toolNames = async () => ((await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, await session.context()))!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  return { app, hostedStore, dataDir, local, session, call, toolNames };
}

/** The browser's part: consent, approve, GitHub, back to the loopback listener. Resolves to the page this computer shows. */
async function signInInBrowser(port: number, authorizeUrl: string): Promise<string> {
  const url = new URL(authorizeUrl);
  const consent = await raw(port, { path: url.pathname + url.search });
  assert.equal(consent.status, 200, consent.body);
  assert.match(consent.body, /MCPortal on /, 'the consent screen names this computer');
  const txn = consent.body.match(/name="txn" value="([^"]+)"/)![1]!;
  const cookie = String(consent.headers['set-cookie']).split(';')[0]!;
  const form = new URLSearchParams({ txn, decision: 'approve' }).toString();
  const approve = await raw(port, { method: 'POST', path: '/oauth/authorize', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', host: `localhost:${port}`, cookie }, body: form });
  const gh = new URL(String(approve.headers.location));
  const back = await raw(port, { path: `/oauth/callback?code=gh-code&state=${gh.searchParams.get('state')}`, headers: { cookie } });
  const loopback = new URL(String(back.headers.location));
  assert.equal(loopback.hostname, '127.0.0.1', 'back to this computer only');
  return (await fetch(loopback)).text();
}

test('sign in from ghost mode: the local portal merges into the account, and the same tools now act on it', async () => {
  const s = await setUp();
  try {
    // A local portal with something in it.
    await s.local.store.put('default', validateProfile({ ...defaultProfile(), onboarded: true, name: 'Laptop', saved: [{ url: 'https://example.com/local', title: 'From the laptop' }] }));
    await s.local.clips.add('default', buildClip({ kind: 'quote', text: 'a local clip', title: 'Local clip' }));
    assert.equal((await s.call('account_settings')).structuredContent.identity.mode, 'ghost');
    assert.ok((await s.toolNames()).includes('link_account'));
    assert.ok(!(await s.toolNames()).includes('share'), 'no sharing in ghost mode');

    const started = await s.call('link_account');
    assert.equal(started.isError, undefined, started.content[0]!.text);
    assert.equal((await s.call('link_account')).structuredContent.url, started.structuredContent.url, 'asking again gives the same pending sign-in');
    const page = await signInInBrowser(s.app.port, started.structuredContent.url);
    assert.match(page, /This computer is signed in/);
    assert.match(page, /added to your account/);

    const link = await stat(path.join(s.dataDir, 'link.json'));
    assert.equal(link.mode & 0o777, 0o600, 'credentials are private to the user');
    const settings = await s.call('account_settings');
    assert.equal(settings.structuredContent.identity.mode, 'linked');
    assert.match(settings.content[0]!.text, /Signed in as lawrence/);
    const names = await s.toolNames();
    assert.ok(names.includes('unlink_account') && !names.includes('link_account'));
    assert.ok(names.includes('set_public_profile'), 'the ways into sharing appear');

    // The merge happened on the hosted account, and the room says so once.
    const hosted = await s.hostedStore.get('github-42');
    assert.deepEqual(hosted.saved.map((x) => x.url), ['https://example.com/local']);
    const room = await s.call('open_room');
    assert.match(room.structuredContent.notice ?? '', /added to your account/);
    assert.equal((await s.call('open_room')).structuredContent.notice, undefined, 'only once');
    assert.equal(room.structuredContent.identity.mode, 'linked');
    assert.equal((await s.call('search_clips', { query: 'local' })).structuredContent.clips.length, 1);

    // From here, changes go to the account; the local files are left as they were.
    await s.call('save_item', { url: 'https://example.com/while-linked', title: 'Saved while linked' });
    assert.ok((await s.hostedStore.get('github-42')).saved.some((x) => x.url === 'https://example.com/while-linked'));
    assert.ok(!(await s.local.store.get('default')).saved.some((x) => x.url === 'https://example.com/while-linked'));

    // Sign out: copied back, revoked, ghost mode again.
    const token = JSON.parse(await readFile(path.join(s.dataDir, 'link.json'), 'utf8')).accessToken;
    const out = await s.call('unlink_account');
    assert.equal(out.isError, undefined, out.content[0]!.text);
    assert.match(out.content[0]!.text, /Signed out\. Your portal was copied to this computer/);
    assert.ok((await s.local.store.get('default')).saved.some((x) => x.url === 'https://example.com/while-linked'), 'nothing disappears');
    assert.equal((await s.call('account_settings')).structuredContent.identity.mode, 'ghost');
    const ping = await raw(s.app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    assert.equal(ping.status, 401, "this computer's sign-in is revoked");
  } finally {
    await s.app.close();
  }
});

test('sign-in refused or tampered with: nothing is linked', async () => {
  const s = await setUp();
  try {
    const { url } = (await s.call('link_account')).structuredContent;
    const redirect = new URL(new URL(url).searchParams.get('redirect_uri')!);
    const wrong = await fetch(new URL(`${redirect.pathname}?code=x&state=not-the-state`, redirect));
    assert.equal(wrong.status, 400, 'a callback with the wrong state is refused');
    const elsewhere = await fetch(new URL('/somewhere', redirect));
    assert.equal(elsewhere.status, 404);
    assert.equal((await s.call('account_settings')).structuredContent.identity.mode, 'ghost');
    const state = new URL(url).searchParams.get('state')!;
    const denied = await fetch(new URL(`${redirect.pathname}?error=access_denied&state=${state}`, redirect));
    assert.match(await denied.text(), /cancelled/);
    assert.equal((await s.call('account_settings')).structuredContent.identity.mode, 'ghost');
  } finally {
    await s.app.close();
  }
});

test('token refresh: two processes refreshing at once spend the refresh token once, and both get the new token', async () => {
  const s = await setUp();
  try {
    const { url } = (await s.call('link_account')).structuredContent;
    await signInInBrowser(s.app.port, url);
    const file = new LinkFile(s.dataDir);
    const record = (await file.read())!;
    await file.write({ ...record, expiresAt: Date.now() - 1000 });   // expired: both will refresh
    let refreshes = 0;
    const counting: typeof fetch = (input, init) => {
      if (String(input).endsWith('/oauth/token')) refreshes++;
      return fetch(input, init);
    };
    const [a, b] = [new FileLinkAuth(new LinkFile(s.dataDir), { fetch: counting }), new FileLinkAuth(new LinkFile(s.dataDir), { fetch: counting })];
    const [ta, tb] = await Promise.all([a.token(), b.token()]);
    assert.equal(refreshes, 1, 'the second waited for the lock, then used the first one\'s token');
    assert.equal(ta, tb);
    assert.notEqual(ta, record.accessToken);
    assert.equal((await s.call('search_clips')).isError, undefined, 'the grant is intact');
  } finally {
    await s.app.close();
  }
});

test('linked identity and nudges: the account menu learns it is offline, and a newer hosted MCPortal is mentioned once', async () => {
  const s = await setUp();
  try {
    const { url } = (await s.call('link_account')).structuredContent;
    await signInInBrowser(s.app.port, url);
    let down = false;
    const newer: typeof fetch = async (input, init) => {
      if (down) throw new TypeError('fetch failed');
      const res = await fetch(input, init);
      const headers = new Headers(res.headers);
      if (headers.has('mcportal-server')) headers.set('mcportal-server', '9.9.9');
      return new Response(await res.arrayBuffer(), { status: res.status, headers });
    };
    let clock = Date.now();
    const session = new LocalSession({ dataDir: s.dataDir, localUser: 'default', local: s.local, base: { fetcher: createFixtureFetcher(), cache: new TtlCache() }, hostedUrl: s.app.base, fetch: newer, now: () => clock });
    const call = async (name: string) => (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }, await session.context()))!.result as any;
    await call('open_room');
    const second = await call('open_room');
    assert.match(second.structuredContent.notice, /MCPortal 9\.9\.9 is out/);
    assert.doesNotMatch((await call('open_room')).structuredContent.notice ?? '', /is out/, 'once');
    clock += 60_000;
    down = true;
    const offline = await call('open_room');
    assert.equal(offline.structuredContent.identity.mode, 'linked');
    assert.equal(offline.structuredContent.identity.offline, true);
    assert.ok(offline.structuredContent.identity.syncedAt);
  } finally {
    await s.app.close();
  }
});
