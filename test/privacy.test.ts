import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { githubAuthorizeUrl } from '../src/auth/github.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { loadArticle, loadPortal } from '../src/sources.ts';
import { atomicWrite } from '../src/lib/files.ts';
import { hostedOrigin } from '../src/link/hosted-url.ts';
import { FileLinkAuth, LinkFile } from '../src/link/link-file.ts';
import { StateClient } from '../src/link/client.ts';
import { startSignIn } from '../src/link/signin.ts';
import { buildExport, parseExport } from '../src/portability.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { DocumentSocialStore, Social, type Report } from '../src/social.ts';
import { memoryPersistence } from '../src/accounts.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { raw, startApp } from './helpers.ts';

test('GitHub requests no additional permission scope for public identity', () => {
  const url = new URL(githubAuthorizeUrl({ clientId: 'client', clientSecret: 'secret' }, 'https://portal.example/oauth/callback', 'state'));
  assert.equal(url.searchParams.get('scope'), '');
  assert.equal(url.searchParams.get('state'), 'state');
});

test('HTTPS origins are required before sign-in, API tokens, or persisted link credentials can leave the computer', async () => {
  for (const url of ['http://portal.example', 'ftp://portal.example', 'https://user:secret@portal.example', 'http://localhost.evil.example']) {
    assert.throws(() => hostedOrigin(url), /HTTPS/);
    assert.throws(() => new StateClient({ server: url, auth: { token: async () => 'secret', refresh: async () => undefined } }), /HTTPS/);
    await assert.rejects(startSignIn({ server: url, link: new LinkFile('/unused'), fetch: async () => { throw new Error('must not fetch'); } }), /HTTPS/);
  }
  for (const url of ['http://127.0.0.1:1234', 'http://localhost:1234', 'http://[::1]:1234']) assert.equal(hostedOrigin(url), new URL(url).origin);
  assert.equal(hostedOrigin('https://portal.example/path'), 'https://portal.example');
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-private-link-'));
  try {
    const record = { version: 1 as const, server: 'http://portal.example', accountId: 'alice', clientId: 'client', accessToken: 'secret', refreshToken: 'refresh', expiresAt: 100, linkedAt: '' };
    await writeFile(path.join(dir, 'link.json'), JSON.stringify(record));
    assert.equal(await new LinkFile(dir).read(), undefined, 'legacy insecure link is never reused');
    assert.throws(() => new LinkFile(dir).write(record), /HTTPS/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('new local data directories and atomic files are owner-only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'portal-private-files-'));
  try {
    const dir = path.join(root, 'data', 'clips');
    await atomicWrite(path.join(dir, 'alice.json'), 'private');
    for (const folder of [path.join(root, 'data'), dir]) assert.equal((await stat(folder)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(dir, 'alice.json'))).mode & 0o777, 0o600);
    assert.equal(await readFile(path.join(dir, 'alice.json'), 'utf8'), 'private');
    await mkdir(path.join(root, 'shared'), { mode: 0o755 });
    await atomicWrite(path.join(root, 'shared', 'other.json'), 'private');
    assert.equal((await stat(path.join(root, 'shared'))).mode & 0o777, 0o755, 'configured existing directories are preserved');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('hosted HTTPS responses send HSTS including errors; local HTTP does not', async () => {
  for (const publicUrl of ['https://portal.example', 'http://localhost']) {
    const app = await startApp({ publicUrl });
    try {
      for (const requestPath of ['/health', '/missing']) {
        const response = await raw(app.port, { path: requestPath });
        assert.equal(response.headers['strict-transport-security'], publicUrl.startsWith('https:') ? 'max-age=31536000' : undefined);
      }
    } finally { await app.close(); }
  }
});

test('everything exports full Space settings, private relationships and only the account’s own reports', async () => {
  const profiles = new PublicProfiles(memoryPersistence());
  const own = (await profiles.set('alice-account', { handle: 'alice', spaceTitle: 'Alice’s Space', ink: 'atomic', reblogs: 'followers', sources: [{ title: 'News', source: 'hn', config: { feed: 'top' } }] })).profile;
  await profiles.set('bob-account', { handle: 'bob' });
  await profiles.set('carol-account', { handle: 'carol' });
  const storage = new DocumentSocialStore();
  let suspended = false;
  const social = new Social({ store: storage, profiles, hidden: (accountId) => suspended && accountId === 'carol-account' });
  await social.follow('alice-account', 'bob');
  await social.mute('alice-account', 'bob', true);
  await social.block('alice-account', 'carol', true);
  for (let i = 0; i < 125; i++) {
    const report: Report = { id: `r${i}`, reporterId: i % 2 ? 'alice-account' : 'bob-account', targetKind: 'profile', targetId: 'carol-account', reason: `reason ${i}`, status: 'resolved', createdAt: new Date(i * 1000).toISOString(), resolvedAt: new Date(i * 1000 + 100).toISOString(), resolvedBy: 'admin-account', resolution: 'moderator-only notes' };
    await storage.addReport(report);
  }
  suspended = true;
  assert.deepEqual((await social.connections('alice-account')).blocked, [], 'regular social responses still hide suspended accounts');
  const data = parseExport((await buildExport('mcportal', 'alice-account', { store: new MemoryProfileStore(), publicProfile: own, social })).body.toString());
  assert.equal(data.version, 3, 'Space appearance and store watches are included in version 3');
  assert.equal(data.publicProfile?.spaceTitle, 'Alice’s Space');
  assert.equal(data.publicProfile?.cover?.ink, 'atomic');
  assert.equal(data.publicProfile?.sources?.[0]?.title, 'News');
  assert.equal(data.publicProfile?.reblogs, 'followers');
  assert.deepEqual(data.following, ['bob']);
  assert.deepEqual(data.muted, ['bob']);
  assert.deepEqual(data.blocked, ['carol']);
  assert.equal(data.reports?.length, 62, 'reports are not truncated to the admin page’s 100-item limit');
  assert.ok(data.reports?.every((r) => Number(r.id.slice(1)) % 2 === 1 && r.targetId === 'carol'));
  assert.doesNotMatch(JSON.stringify(data), /alice-account|bob-account|carol-account|admin-account|moderator-only notes/);
});


test('refresh-token redirects fail before credentials reach another endpoint', async () => {
  let redirectedCalls = 0;
  const target = createServer((_req, res) => { redirectedCalls++; res.end('{}'); });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/oauth/token`;
  const source = createServer((_req, res) => { res.writeHead(307, { location: targetUrl }); res.end(); });
  await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-refresh-redirect-'));
  try {
    const link = new LinkFile(dir);
    await link.write({ version: 1, server: `http://127.0.0.1:${(source.address() as AddressInfo).port}`, accountId: 'alice', clientId: 'client', accessToken: 'access', refreshToken: 'private-refresh', expiresAt: 0, linkedAt: '' });
    await assert.rejects(new FileLinkAuth(link).refresh('access'), /has moved.*Sign in again/);
    assert.equal(redirectedCalls, 0, 'the refresh request and credentials never follow the redirect');
    assert.equal((await link.read())?.refreshToken, 'private-refresh', 'failed refresh preserves the link');
  } finally {
    await new Promise<void>((resolve) => source.close(() => resolve()));
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});


test('two accounts can reuse fetched content without exposing the shared cache’s timing', async () => {
  const calls: string[] = [];
  const cache = new TtlCache();
  const fetcher = createFixtureFetcher(calls);
  const alice = { cache, fetcher, userId: 'alice' };
  const bob = { cache, fetcher, userId: 'bob' };
  const portal = { id: 'news', source: 'hn' as const, config: { feed: 'top' as const, limit: 3 } };
  const first = await loadPortal(portal, alice);
  const article = await loadArticle('https://yashgarg.dev/posts/hijacking-ps5-rtmp-stream/', alice);
  const count = calls.length;
  const second = await loadPortal(portal, bob);
  const secondArticle = await loadArticle('https://yashgarg.dev/posts/hijacking-ps5-rtmp-stream/', bob);
  assert.equal(calls.length, count, 'the shared cache still avoids duplicate fetching');
  assert.deepEqual(second.items, first.items);
  for (const provenance of [first.provenance, second.provenance, article.provenance, secondArticle.provenance]) {
    assert.equal('cached' in provenance, false);
    assert.equal('fetchedAt' in provenance, false);
    assert.ok(provenance.endpoint);
    assert.ok(provenance.ttlSeconds > 0, 'the configured cache lifetime remains useful');
  }
});
