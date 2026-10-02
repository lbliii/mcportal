/**
 * The hosted state API (src/api): the transport (auth, versions, Origin, bodies) over
 * HTTP, and each method's rules through the dispatcher with in-memory stores.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryPersistence } from '../src/accounts.ts';
import { API_PATH, handleCalls, MIN_CLIENT_VERSION, versionAtLeast, type ApiResult } from '../src/api/calls.ts';
import { API_METHODS } from '../src/api/methods.ts';
import { buildClip, MemoryClipStore } from '../src/clips.ts';
import { MemoryEditionStore } from '../src/editions.ts';
import { MemoryHandoffStore } from '../src/handoffs.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { UsageBudget } from '../src/lib/budget.ts';
import { defaultProfile, validateProfile, type Profile } from '../src/profile.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore } from '../src/seen.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { raw, startApp } from './helpers.ts';

const room = (extra: Partial<Profile> = {}) => validateProfile({
  ...defaultProfile(),
  onboarded: true,
  columns: [{ width: 1, panels: [{ id: 'hn', source: 'hn', config: { feed: 'top' } }, { id: 'saved', source: 'saved', config: {} }] }],
  saved: [{ url: 'https://example.com/kept', title: 'Kept link' }],
  ...extra,
});

/** Two accounts on one hosted server; `ctx(id)` is what the API gives a request from that account. */
async function hosted() {
  const store = new MemoryProfileStore({ alice: room(), bob: room() });
  const profiles = new PublicProfiles(memoryPersistence());
  const social = new Social({ store: new DocumentSocialStore(), profiles });
  await profiles.set('alice', { handle: 'alice' });
  await profiles.set('bob', { handle: 'bob' });
  const shared = { store, clips: new MemoryClipStore(), reading: new FileReadingStore(await mkdtemp(path.join(tmpdir(), 'mcportal-api-'))), seen: new FileSeenStore(null), handoffs: new MemoryHandoffStore(), editions: new MemoryEditionStore(), publicProfiles: profiles, social, fetcher: createFixtureFetcher(), cache: new TtlCache() };
  const ctx = (userId: string, extra: Partial<ToolContext> = {}): ToolContext => ({ ...shared, userId, actor: { accountId: userId, role: 'user', status: 'active' }, ...extra });
  return { ...shared, ctx };
}

async function call(ctx: ToolContext, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const [r] = (await handleCalls({ calls: [{ id: 1, method, params }] }, ctx, API_METHODS))!;
  if ('error' in r!) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r!.result;
}

const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code?: string }) => e.code);

test('api versions: x.y.z compare numerically; anything else is too old', () => {
  assert.ok(versionAtLeast('0.10.0', '0.9.9'));
  assert.ok(versionAtLeast('0.5.0', '0.5.0'));
  assert.ok(!versionAtLeast('0.4.9', '0.5.0'));
  assert.ok(!versionAtLeast('', '0.5.0'));
  assert.ok(!versionAtLeast('1.0', '0.5.0'));
  assert.ok(!versionAtLeast('0.5.0-beta', '0.5.0'));
});

test('api transport: bearer auth, client version, Origin, method and body checks', async () => {
  const app = await startApp({ staticToken: 'secret-token-for-tests', staticUser: 'owner' });
  const post = (body: unknown, headers: Record<string, string> = {}) => raw(app.port, {
    method: 'POST', path: API_PATH,
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token-for-tests', 'mcportal-client': MIN_CLIENT_VERSION, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  try {
    const me = await post({ calls: [{ id: 'a', method: 'me' }] });
    assert.equal(me.status, 200, me.body);
    assert.equal(me.headers['mcportal-server'], JSON.parse(me.body).results[0].result.server.version);
    assert.equal(JSON.parse(me.body).results[0].result.accountId, 'owner');
    assert.equal((await post({ calls: [{ id: 1, method: 'me' }] }, { authorization: 'Bearer wrong' })).status, 401);
    const old = await post({ calls: [{ id: 1, method: 'me' }] }, { 'mcportal-client': '0.4.0' });
    assert.equal(old.status, 426);
    assert.match(JSON.parse(old.body).error_description, /Update MCPortal/);
    assert.equal((await post({ calls: [{ id: 1, method: 'me' }] }, { 'mcportal-client': '' })).status, 426, 'the version is required');
    assert.equal((await post({ calls: [{ id: 1, method: 'me' }] }, { origin: 'https://evil.example' })).status, 403, 'not for browsers on other sites');
    assert.equal((await raw(app.port, { path: API_PATH, headers: { authorization: 'Bearer secret-token-for-tests' } })).status, 405);
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post({ calls: [] })).status, 400);
    assert.equal((await post({ calls: Array.from({ length: 21 }, (_, i) => ({ id: i, method: 'me' })) })).status, 400);
    const tooLarge = await post('', { 'content-length': String(2_100_000) });
    assert.equal(tooLarge.status, 413, 'a declared size over the cap is refused before reading');
    assert.equal(tooLarge.headers.connection, 'close', 'and the connection closed, so its unread body is never taken for the next request');

    // A batch answers every call, in order, each on its own.
    const batch = JSON.parse((await post({ calls: [
      { id: 1, method: 'room.get' },
      { id: 2, method: 'nope' },
      { id: 3, method: 'room.get', params: { ifNoneMatch: 'zero' } },
      { method: 'me' },
    ] })).body).results as ApiResult[];
    assert.deepEqual(batch.map((r) => r.id), [1, 2, 3, null]);
    assert.equal((batch[0] as { result: { rev: number } }).result.rev, 0);
    assert.deepEqual(batch.slice(1).map((r) => 'error' in r && r.error.code), ['not_found', 'invalid_argument', 'invalid_argument']);
  } finally {
    await app.close();
  }
});

test('api room: revisions, 304-style unchanged reads, conflicts, and validation on the way in', async () => {
  const h = await hosted();
  const alice = h.ctx('alice');
  const first = await call(alice, 'room.get');
  assert.equal(first.rev, 1);
  assert.equal(first.profile.saved[0].url, 'https://example.com/kept');
  assert.deepEqual(await call(alice, 'room.get', { ifNoneMatch: 1 }), { unchanged: true, rev: 1 });
  const renamed = { ...first.profile, name: 'Renamed' };
  assert.deepEqual(await call(alice, 'room.put', { profile: renamed, ifMatch: 1 }), { rev: 2 });
  assert.equal(await code(call(alice, 'room.put', { profile: { ...first.profile, name: 'Stale' }, ifMatch: 1 })), 'conflict');
  assert.equal((await h.store.get('alice')).name, 'Renamed');
  // Whatever arrives is validated: junk is dropped and limits apply, as on import.
  await call(alice, 'room.put', { profile: { ...renamed, name: 'x'.repeat(500), evil: true, saved: [{ url: 'javascript:alert(1)', title: 'bad' }] } });
  const stored = await h.store.get('alice') as Profile & { evil?: boolean };
  assert.equal(stored.name.length <= 60, true);
  assert.equal(stored.evil, undefined);
  assert.deepEqual(stored.saved, []);
  assert.equal((await h.store.get('bob')).name, room().name, "only the caller's room");
});

test('api clips: rebuilt on the server with its own id and size; never stored as sent', async () => {
  const h = await hosted();
  const alice = h.ctx('alice');
  const local = buildClip({ kind: 'quote', text: 'keep this', title: 'A quote', tags: ['Zoo'] });
  const forged = { ...local, id: 'cforgedforged', bytes: 1, data: { ...local.data, text: 'keep this' }, title: 'x'.repeat(400) };
  const stored = await call(alice, 'clips.add', { clip: forged });
  assert.notEqual(stored.id, 'cforgedforged', 'the server picks the id');
  assert.ok(stored.bytes > 1, 'and measures it');
  assert.ok(stored.title.length <= 120, 'and applies the limits');
  assert.deepEqual(stored.tags, ['zoo']);
  assert.equal((await call(alice, 'clips.get', { id: stored.id })).data.text, 'keep this');
  assert.equal(await call(h.ctx('bob'), 'clips.get', { id: stored.id }), null, "only the caller's clips");
  assert.equal(await code(call(alice, 'clips.add', { clip: { kind: 'script', text: 'x' } })), 'invalid_argument');
  assert.equal(await code(call(alice, 'clips.add', { clip: { kind: 'image', image: { mime: 'image/png', data: '!!!' } } })), 'invalid_argument');
  assert.equal((await call(alice, 'clips.list', { query: 'keep' })).length, 1);
  assert.equal(await code(call(alice, 'clips.list', { before: 'yesterday' })), 'invalid_argument');
  assert.equal((await call(alice, 'clips.update', { id: stored.id, patch: { title: 'Renamed' } })).title, 'Renamed');
  assert.equal(await call(alice, 'clips.delete', { id: stored.id }), true);
  assert.deepEqual(await call(alice, 'clips.usage'), { count: 0, bytes: 0 });
});

test('api seen, reading and handoffs: the tools\' limits, and seen marks only for portals in the room', async () => {
  const h = await hosted();
  const alice = h.ctx('alice');
  const marked = await call(alice, 'seen.mark', { marks: [{ portalId: 'hn', itemIds: ['1', '2'] }, { portalId: 'made-up', itemIds: ['x'] }, { portalId: 'saved', itemIds: ['y'] }] });
  assert.deepEqual(marked, { marked: 2 }, 'made-up portals and ones that track nothing are ignored');
  const seen = await call(alice, 'seen.get', { portalIds: ['hn', 'made-up'] });
  assert.equal(seen.hn.length, 2);
  assert.equal(seen['made-up'], undefined);
  assert.equal(await code(call(alice, 'seen.mark', { marks: Array.from({ length: 41 }, () => ({ portalId: 'hn', itemIds: ['1'] })) })), 'invalid_argument');
  await h.store.put('alice', validateProfile({ ...room(), columns: [{ width: 1, panels: [{ id: 'saved', source: 'saved', config: {} }] }] }));
  await call(alice, 'seen.prune');
  assert.deepEqual(await call(alice, 'seen.get', { portalIds: ['hn'] }), {}, 'pruned against the room on the server');

  const read = await call(alice, 'reading.record', { url: 'https://example.com/a#part', status: 'opened', progress: 0.5 });
  assert.equal(read.url, 'https://example.com/a');
  assert.equal(await code(call(alice, 'reading.record', { url: 'not a url', status: 'opened' })), 'invalid_argument');
  assert.equal(await code(call(alice, 'reading.record', { url: 'https://example.com/', status: 'opened', progress: 2 })), 'invalid_argument');
  assert.equal((await call(alice, 'reading.list')).length, 1);
  assert.equal(await call(h.ctx('bob'), 'reading.get', { url: 'https://example.com/a' }), null);

  const handoff = await call(alice, 'handoffs.create', { url: 'https://example.com/a', title: 'A', passage: 'this part' });
  assert.equal((await call(alice, 'handoffs.get', { code: handoff.code })).passage, 'this part');
  assert.equal(await call(h.ctx('bob'), 'handoffs.get', { code: handoff.code }), null);
  assert.equal(await code(call(alice, 'handoffs.create', { url: 'https://example.com/a', passage: 'x'.repeat(4001) })), 'invalid_argument');
});

test('api social: shares name a clip or saved item the server looks up; always as the token\'s account', async () => {
  const h = await hosted();
  const alice = h.ctx('alice'), bob = h.ctx('bob');
  assert.equal(await code(call(alice, 'social.share', { savedUrl: 'https://example.com/not-saved' })), 'invalid_argument');
  const link = await call(alice, 'social.share', { savedUrl: 'https://example.com/kept', note: 'worth it', audience: 'mcportal' });
  assert.equal(link.title, 'Kept link', 'the title comes from the saved item, not the request');
  assert.equal(await code(call(alice, 'social.share', { clipId: 'cnope' })), 'not_found');
  assert.equal(await code(call(alice, 'social.share', { savedUrl: 'https://example.com/kept', title: 'Forged' })), 'invalid_argument', 'no content from the request');
  await call(bob, 'social.follow', { handle: '@alice' });
  assert.deepEqual((await call(bob, 'social.feed')).map((s: { title: string }) => s.title), ['Kept link']);
  assert.deepEqual((await call(bob, 'social.connections')).following, ['alice']);
  assert.equal(await call(alice, 'social.unshare', { id: link.id }), true);
  assert.equal(await call(bob, 'social.unshare', { id: link.id }), false, "can't remove someone else's");
  assert.equal(await code(call(bob, 'social.uses', { accountId: 'alice' })), 'invalid_argument', 'no method takes an account to act as');

  // Featured sources must be portals in the caller's room.
  const hn = (await h.store.get('alice')).columns[0]!.panels[0]!;
  const set = await call(alice, 'profiles.set', { bio: 'hi', sources: [{ title: 'HN', source: hn.source, config: hn.config }] });
  assert.equal(set.profile.sources.length, 1);
  assert.equal(await code(call(alice, 'profiles.set', { sources: [{ title: 'Elsewhere', source: 'rss', config: { url: 'https://evil.example/feed' } }] })), 'invalid_argument');
  assert.equal((await call(alice, 'profiles.mine')).handle, 'alice');
  assert.equal((await call(bob, 'profiles.byHandle', { handle: 'alice' })).profile.bio, 'hi');

  // Other people's account ids never leave the server: they're @handles, resolved again on the way in.
  assert.equal((await call(bob, 'social.resolve', { handle: 'alice' })).accountId, '@alice');
  assert.equal((await call(bob, 'profiles.byHandle', { handle: 'alice' })).profile.accountId, '@alice');
  assert.equal((await call(alice, 'profiles.byHandle', { handle: 'alice' })).profile.accountId, 'alice', 'your own stays, so tools can tell you apart');
  assert.equal((await call(bob, 'social.stats', { accountId: '@alice' })).following, true);
  assert.equal(await code(call(bob, 'social.sharesOf', { accountId: 'alice' })), 'invalid_argument', 'raw ids of others are refused');
});

test('api access: suspended accounts are refused, budgets apply, and bugs are reported by reference', async () => {
  const h = await hosted();
  const suspended = h.ctx('alice', { actor: { accountId: 'alice', role: 'user', status: 'suspended' } });
  assert.equal(await code(call(suspended, 'room.get')), 'forbidden');
  const budget = new UsageBudget({ perMinute: 2, perDay: 100, globalPerDay: 1000 });
  const limited = h.ctx('alice', { budget });
  await call(limited, 'room.get');
  await call(limited, 'room.get');
  assert.equal(await code(call(limited, 'room.get')), 'rate_limited');
  const broken = h.ctx('alice', { clips: { ...new MemoryClipStore(), usage: async () => { throw new TypeError('secret internal detail'); } } as never });
  const [r] = (await handleCalls({ calls: [{ id: 1, method: 'clips.usage' }] }, broken, API_METHODS))!;
  assert.ok('error' in r! && r.error.code === 'internal' && !r.error.message.includes('secret'));
});

test('api editions: rebuilt and dated by the server, refs checked, per account', async () => {
  const h = await hosted();
  const alice = h.ctx('alice');
  assert.equal(await call(alice, 'editions.get'), null);
  assert.equal(await call(alice, 'editions.put', { title: ' Morning ', picks: [{ ref: 'hn/0123abcd', why: 'Yours.' }] }), null);
  const edition = await call(alice, 'editions.get');
  assert.equal(edition.title, 'Morning');
  assert.deepEqual(edition.picks, [{ ref: 'hn/0123abcd', why: 'Yours.' }]);
  assert.ok(Date.parse(edition.expiresAt) > Date.now(), 'the server sets the dates');
  assert.equal(await call(h.ctx('bob'), 'editions.get'), null, 'per account');
  assert.equal(await code(call(alice, 'editions.put', { title: 'x', picks: [{ ref: 'not a ref', why: 'x' }] })), 'invalid_argument');
  assert.equal(await code(call(alice, 'editions.put', { title: 'x', picks: [{ ref: 'hn/0123abcd', why: 'x' }], createdAt: '2020-01-01' })), 'invalid_argument', 'no dates from the caller');
});
