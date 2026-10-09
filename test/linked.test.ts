/**
 * A linked local MCPortal: the real tools, run with the remote stores (src/link),
 * against an in-process hosted server over HTTP with real tokens. The contract that
 * matters is that tools behave the same whether the state is local or hosted.
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Accounts, makeBootstrap } from '../src/accounts.ts';
import { AuthStore } from '../src/auth/store.ts';
import { buildClip, CLIP_LIMITS, FileClipStore, MemoryClipStore } from '../src/clips.ts';
import { FileEditionStore, MemoryEditionStore } from '../src/editions.ts';
import { FileHandoffStore, MemoryHandoffStore } from '../src/handoffs.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { memoryPersistence } from '../src/lib/document.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { StateClient, type LinkAuth } from '../src/link/client.ts';
import { LinkFile, type LinkRecord } from '../src/link/link-file.ts';
import { LocalSession } from '../src/link/session.ts';
import { linkedStores } from '../src/link/stores.ts';
import { handleMessage } from '../src/mcp.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore } from '../src/seen.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { FileProfileStore, MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import { startApp, type Running } from './helpers.ts';

const RESOURCE = 'http://localhost/mcp';

/** A hosted MCPortal with GitHub sign-in, and a way to sign accounts in without a browser. */
async function hosted() {
  const authPersistence = memoryPersistence();
  const store = new MemoryProfileStore();
  const clips = new MemoryClipStore();
  const publicProfiles = new PublicProfiles(memoryPersistence());
  const social = new Social({ store: new DocumentSocialStore(), profiles: publicProfiles, preferences: store });
  const reading = new FileReadingStore(await mkdtemp(path.join(tmpdir(), 'mcportal-linked-')));
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, createFixtureFetcher(), {
    store, clips, publicProfiles, social, authPersistence,
    accounts: new Accounts(memoryPersistence(), makeBootstrap([], [])),
    reading,
    seen: new FileSeenStore(null),
    handoffs: new MemoryHandoffStore(),
    editions: new MemoryEditionStore(),
    labs: ['reblog'],
  });
  const auth = new AuthStore(authPersistence);
  const signIn = async (githubId: number, login: string) => {
    const tokens = await auth.issueTokens({ userId: `github-${githubId}`, githubId, login }, 'mcpc_test_device', RESOURCE, 'mcportal');
    return { accountId: `github-${githubId}`, tokens };
  };
  return { app, store, clips, reading, auth, signIn };
}

/** A linked device: its own client, cache and stores, as one local MCPortal process would have. */
function device(app: Running, accountId: string, auth: LinkAuth, options: { now?: () => number; fetch?: typeof fetch } = {}) {
  const client = new StateClient({ server: app.base, auth, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const ctx: ToolContext = { ...linkedStores(client, accountId, options), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: accountId };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
    return res!.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean };
  };
  return { ctx, call };
}

/** A local MCPortal (stdio's LocalSession) whose link.json says what `link` says. */
async function linkedLocal(link: Partial<LinkRecord> & { server: string }, fetcher?: typeof fetch) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mcportal-linked-local-'));
  const record: LinkRecord = { version: 1, accountId: 'github-42', login: 'lawrence', clientId: 'mcpc_test_device', accessToken: 'mcpat_old', refreshToken: 'mcprt_old', expiresAt: 0, linkedAt: new Date().toISOString(), ...link };
  await new LinkFile(dataDir).write(record);
  const local = { store: new FileProfileStore(dataDir), clips: new FileClipStore(dataDir), reading: new FileReadingStore(dataDir), seen: new FileSeenStore(dataDir), handoffs: new FileHandoffStore(dataDir), editions: new FileEditionStore(dataDir) };
  const session = new LocalSession({ dataDir, localUser: 'default', local, base: { fetcher: createFixtureFetcher(), cache: new TtlCache() }, ...(fetcher ? { fetch: fetcher } : {}) });
  const rpc = async (method: string, params: Record<string, unknown> = {}) => (await handleMessage({ jsonrpc: '2.0', id: 1, method, params }, await session.context()))!;
  const call = async (name: string, args: Record<string, unknown> = {}) => (await rpc('tools/call', { name, arguments: args })).result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean };
  /** tools/list, timed. */
  const list = async () => {
    const started = Date.now();
    const res = await rpc('tools/list');
    return { ms: Date.now() - started, names: (res.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name), error: res.error };
  };
  return { session, rpc, call, list };
}

const fixed = (token: string): LinkAuth => ({ token: async () => token, refresh: async () => undefined });

test('linked: Recall searches beyond linked list caps and refuses another account', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    const clip = buildClip({ kind: 'quote', text: 'An older heartbeat passage' });
    await h.clips.add(accountId, clip);
    await h.reading.record(accountId, { url: 'https://example.com/older', title: 'Heartbeat page', status: 'opened' });
    for (let i = 0; i < 110; i++) {
      await h.clips.add(accountId, buildClip({ kind: 'note', markdown: `Unrelated ${i}` }));
      await h.reading.record(accountId, { url: `https://example.com/${i}`, status: 'opened' });
    }
    const mac = device(h.app, accountId, fixed(tokens.access_token));
    const result = await mac.call('search_library', { query: 'heartbeat' });
    assert.ok(!result.isError, result.content[0]?.text);
    assert.equal(result.structuredContent.library.total, 2);
    assert.ok(result.structuredContent.library.hits.some((hit: any) => hit.clipId === clip.id));
    await assert.rejects(mac.ctx.library!.search('github-7', {}), { code: 'forbidden' });
    const other = await h.signIn(7, 'friend');
    assert.equal((await device(h.app, other.accountId, fixed(other.tokens.access_token)).call('search_library', { query: 'heartbeat' })).structuredContent.library.total, 0);
  } finally { await h.app.close(); }
});

test('linked: the room, saved items and clips live on the hosted account; tools behave as they do locally', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    const mac = device(h.app, accountId, fixed(tokens.access_token));
    const welcome = await mac.call('open_room');
    assert.ok(welcome.structuredContent.onboarding, 'a new account gets the welcome');
    assert.equal((await mac.call('build_room', { packs: ['developer'] })).isError, undefined);
    const room = await mac.call('open_room');
    assert.ok(room.structuredContent.portals.length > 0);
    assert.equal((await h.store.get(accountId)).onboarded, true, 'built on the hosted server');

    await mac.call('save_item', { url: 'https://example.com/kept', title: 'Kept' });
    assert.deepEqual((await h.store.get(accountId)).saved.map((s) => s.url), ['https://example.com/kept']);

    const clipped = await mac.call('clip', { kind: 'quote', content: 'from the laptop', title: 'Laptop quote', source: { kind: 'article', url: 'https://example.com/v2', locator: { text: 'from the laptop', prefix: 'before ', suffix: ' after', digest: 'a'.repeat(64), revision: 'v2' } } });
    assert.equal(clipped.isError, undefined, clipped.content[0]!.text);
    const id = clipped.structuredContent.clip.id;
    assert.ok((await h.clips.get(accountId, id)), 'the id the tool reports is the hosted one');
    assert.equal((await h.clips.get(accountId, id))?.source.locator?.digest, 'a'.repeat(64));
    assert.equal((await mac.call('get_clip', { id })).structuredContent.clip.data.text, 'from the laptop');
    assert.equal((await mac.call('search_clips', { query: 'laptop' })).structuredContent.clips.length, 1);

    const handoff = await mac.call('create_handoff', { url: 'https://example.com/kept', title: 'Kept', passage: 'this part' });
    assert.ok(handoff.structuredContent.handoff.code);
    assert.equal((await mac.call('record_reading', { url: 'https://example.com/kept', status: 'opened' })).isError, undefined);
    assert.equal((await mac.call('list_reading')).structuredContent.reading.length, 1);
    const desk = await mac.call('update_collection', { action: 'create', title: 'Linked desk', entries: [{ ref: `clip:${id}`, title: 'Laptop quote' }] });
    assert.equal(desk.isError, undefined, desk.content[0]?.text);
    const deskId = desk.structuredContent.collection.id;
    const reopened = await mac.call('open_collection', { id: deskId });
    assert.equal(reopened.structuredContent.desk.collection.title, 'Linked desk');
    assert.equal(reopened.structuredContent.desk.collection.entries[0].ref, `clip:${id}`);
  } finally {
    await h.app.close();
  }
});

test('linked: clip quota failures keep their code and metadata across the state API', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    const mac = device(h.app, accountId, fixed(tokens.access_token));
    const clip = await h.clips.add(accountId, buildClip({ kind: 'quote', text: 'Kept passage', note: 'Removable' }));
    // Test stored-byte accounting without filling the HTTP fixture with 50 MB of content.
    await h.clips.add(accountId, { ...buildClip({ kind: 'quote', text: 'Quota fixture' }), bytes: CLIP_LIMITS.bytesPerUser - clip.bytes });
    const refused = await mac.call('update_clip', { id: clip.id, note: 'More context than fits' });
    assert.equal(refused.isError, true);
    assert.equal(refused.structuredContent.error.code, 'limit_exceeded');
    assert.deepEqual(await h.clips.get(accountId, clip.id), clip);
    await assert.rejects(mac.ctx.clips!.add(accountId, buildClip({ kind: 'quote', text: 'Too much' })), { code: 'limit_exceeded' });
    const shrunk = await mac.call('update_clip', { id: clip.id, note: '' });
    assert.equal(shrunk.isError, undefined);
    assert.ok((await h.clips.usage(accountId)).bytes < CLIP_LIMITS.bytesPerUser);
  } finally { await h.app.close(); }
});

test('linked: two devices on one account; concurrent edits both land, and a stale cache is caught by revisions', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    let clock = 0;
    const now = () => clock;
    const mac = device(h.app, accountId, fixed(tokens.access_token), { now });
    const office = device(h.app, accountId, fixed(tokens.access_token), { now });
    await mac.call('build_room', { packs: ['developer'] });
    await office.call('open_room');   // both have the room cached now
    // Both save at once, from caches at the same revision: one conflicts, re-reads and re-runs; both land.
    await Promise.all([
      mac.call('save_item', { url: 'https://example.com/from-mac', title: 'Mac' }),
      office.call('save_item', { url: 'https://example.com/from-office', title: 'Office' }),
    ]);
    assert.deepEqual((await h.store.get(accountId)).saved.map((s) => s.url).sort(), ['https://example.com/from-mac', 'https://example.com/from-office']);
    // Within the freshness window a device reads its cache; after it, it asks (and gets the other's change).
    await mac.call('arrange_room', { name: 'Renamed on the Mac' });
    assert.notEqual((await office.ctx.store.get(accountId)).name, 'Renamed on the Mac', 'cached for up to 30 s');
    clock += 31_000;
    assert.equal((await office.ctx.store.get(accountId)).name, 'Renamed on the Mac');
  } finally {
    await h.app.close();
  }
});

test('linked: sharing and following work from a local MCPortal, as the linked account only', async () => {
  const h = await hosted();
  try {
    const lawrence = await h.signIn(42, 'lawrence');
    const friend = await h.signIn(7, 'friend');
    const mac = device(h.app, lawrence.accountId, fixed(lawrence.tokens.access_token));
    const other = device(h.app, friend.accountId, fixed(friend.tokens.access_token));
    await mac.call('build_room', { packs: ['developer'] });
    await mac.call('save_item', { url: 'https://example.com/kept', title: 'Worth reading' });
    assert.equal((await mac.call('set_public_profile', { handle: 'lawrence' })).isError, undefined);
    const shared = await mac.call('share', { savedUrl: 'https://example.com/kept', note: 'read this', audience: 'everyone' });
    assert.equal(shared.structuredContent.share.title, 'Worth reading');
    const clip = await mac.call('clip', { kind: 'quote', content: 'quotable', title: 'A clip' });
    assert.equal((await mac.call('share', { clipId: clip.structuredContent.clip.id })).isError, undefined, 'a clip shares by its hosted id');

    await other.call('set_public_profile', { handle: 'friend' });
    assert.equal((await other.call('relationship', { action: 'follow', handle: '@lawrence' })).isError, undefined);
    const feed = await other.call('list_shares', { handle: '@lawrence' });
    assert.deepEqual(feed.structuredContent.shares.map((s: { title: string }) => s.title).sort(), ['A clip', 'Worth reading']);
    assert.match((await mac.call('list_connections')).content[0]!.text, /Followers: 1\./);
    // Reblogging goes through the hosted API too (the tools come in reblog phase 2).
    const reblog = await other.ctx.social!.reblog(friend.accountId, { id: shared.structuredContent.share.id, note: 'passing it on' });
    assert.deepEqual(reblog.reblogOf, { root: shared.structuredContent.share.id });
    await mac.ctx.social!.shareSettings(lawrence.accountId, shared.structuredContent.share.id, { reblogs: 'nobody' });
    assert.deepEqual((await mac.ctx.social!.reblogsOf(lawrence.accountId, shared.structuredContent.share.id)).map((r) => r.handle), ['friend']);
    assert.equal((await mac.ctx.social!.get(lawrence.accountId, shared.structuredContent.share.id))?.reblogCount, 1);
    // A choice made on one device is loaded and used by a new linked device.
    await mac.call('share', { savedUrl: 'https://example.com/kept', audience: 'followers' });
    const secondDevice = device(h.app, lawrence.accountId, fixed(lawrence.tokens.access_token));
    assert.equal((await secondDevice.call('account_settings')).structuredContent.shareAudience, 'followers');
    const remembered = await secondDevice.call('share', { clipId: clip.structuredContent.clip.id });
    assert.equal(remembered.structuredContent.share.audience, 'followers');
    assert.equal((await secondDevice.ctx.social!.get(lawrence.accountId, shared.structuredContent.share.id))?.audience, 'everyone', 'earlier posts are unchanged');
    // The stores refuse to act as anyone else, whatever a caller passes.
    await assert.rejects(mac.ctx.social!.feed(friend.accountId), /only as its linked account/);
    await assert.rejects(mac.ctx.store.get(friend.accountId), /only its linked account/);
  } finally {
    await h.app.close();
  }
});

test('linked: one round trip for a tool\'s parallel reads; clear errors offline, signed out, or on a newer room', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    let requests = 0;
    const counting: typeof fetch = (input, init) => { requests++; return fetch(input, init); };
    const mac = device(h.app, accountId, fixed(tokens.access_token), { fetch: counting });
    await mac.call('build_room', { packs: ['developer'] });
    requests = 0;
    await Promise.all([mac.ctx.clips!.usage(accountId), mac.ctx.reading!.list(accountId), mac.ctx.handoffs!.list(accountId)]);
    assert.equal(requests, 1, 'calls in the same tick go as one batch');

    // A refused token gets one refresh; a link that's gone says to sign in again.
    let refreshed = 0;
    const revoked = device(h.app, accountId, { token: async () => 'mcpat_revoked', refresh: async () => { refreshed++; return undefined; } });
    const signedOut = await revoked.call('search_clips');
    assert.equal(signedOut.isError, true);
    assert.equal(signedOut.structuredContent.error.code, 'unauthenticated');
    assert.match(signedOut.content[0]!.text, /Sign in again/);
    assert.equal(refreshed, 1);
    const rescued = device(h.app, accountId, { token: async () => 'mcpat_stale', refresh: async () => tokens.access_token });
    assert.equal((await rescued.call('search_clips')).isError, undefined, 'a refreshed token is used for the retry');

    // The hosted server can't be reached: nothing changes, and the user is told so.
    const offline = device({ ...h.app, base: 'http://127.0.0.1:9' }, accountId, fixed(tokens.access_token));
    const failed = await offline.call('save_item', { url: 'https://example.com/x', title: 'x' });
    assert.equal(failed.structuredContent.error.code, 'upstream_unreachable');
    assert.match(failed.content[0]!.text, /Can't reach your hosted MCPortal/);

    // A room saved by a newer MCPortal is readable here, but not writable.
    await h.store.put(accountId, { ...(await h.store.get(accountId)), version: 2 } as never);
    const old = device(h.app, accountId, fixed(tokens.access_token));
    assert.ok((await old.call('open_room')).structuredContent.portals.length > 0, 'still readable');
    const refused = await old.call('save_item', { url: 'https://example.com/y', title: 'y' });
    assert.equal(refused.structuredContent.error.code, 'unavailable');
    assert.match(refused.content[0]!.text, /newer MCPortal/);
  } finally {
    await h.app.close();
  }
});

test('linked offline: the room as last synced, with a notice; seen marks are dropped quietly; changes fail clearly', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    let clock = 0, down = false;
    const flaky: typeof fetch = (input, init) => (down ? Promise.reject(new TypeError('fetch failed')) : fetch(input, init));
    const mac = device(h.app, accountId, fixed(tokens.access_token), { now: () => clock, fetch: flaky });
    await mac.call('build_room', { packs: ['developer'] });
    const online = await mac.call('open_room');
    clock += 60_000;
    down = true;
    const offline = await mac.call('open_room');
    assert.equal(offline.isError, undefined, offline.content[0]!.text);
    assert.equal(offline.structuredContent.portals.length, online.structuredContent.portals.length, 'the room as last synced, feeds still fetched');
    assert.match(offline.structuredContent.notice ?? '', /^Offline:/);
    assert.equal((mac.ctx.store as unknown as { health(): { offline: boolean } }).health().offline, true);
    const hn = online.structuredContent.portals.find((p: { source: string }) => p.source === 'hn');
    assert.equal((await mac.call('mark_seen', { portals: [{ portalId: hn.portalId, itemIds: ['1'] }] })).isError, undefined, 'seen marks are best effort');
    const save = await mac.call('save_item', { url: 'https://example.com/offline', title: 'x' });
    assert.equal(save.structuredContent.error.code, 'upstream_unreachable', 'changes need the server');
    down = false;
    clock += 60_000;
    assert.equal((await mac.call('open_room')).structuredContent.notice, undefined, 'back online, nothing to say');
    assert.equal((mac.ctx.store as unknown as { health(): { offline: boolean } }).health().offline, false);
  } finally {
    await h.app.close();
  }
});

test('linked: highlights picked on one device lead the room on another', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    const mac = device(h.app, accountId, fixed(tokens.access_token));
    const office = device(h.app, accountId, fixed(tokens.access_token));
    await mac.call('build_room', { packs: ['developer'] });
    const [first, second] = (await mac.call('list_new_items')).structuredContent.items;
    const shown = await mac.call('show_highlights', { title: 'Morning', picks: [{ ref: second.ref, why: 'Yours.' }, { ref: first.ref, why: 'Also.' }] });
    assert.match(shown.content[0]!.text, /The room leads with them/);
    const room = await office.call('open_room');
    assert.deepEqual(room.structuredContent.edition.picks.map((p: any) => p.ref), [second.ref, first.ref]);
    assert.deepEqual(room.structuredContent.lead, { ref: second.ref, portalId: second.portalId, itemId: second.item.id, by: 'agent', why: 'Yours.' });
  } finally {
    await h.app.close();
  }
});

test('hosted end to end: three accounts over /mcp share, follow, reblog, see it through a follow, detach and undo', async () => {
  const h = await hosted();
  try {
    /** A signed-in account calling the hosted server's tools over HTTP, as a host would. */
    const account = async (githubId: number, login: string) => {
      const { tokens } = await h.signIn(githubId, login);
      let id = 0;
      const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${h.app.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
        assert.equal(res.status, 200, `${method}: HTTP ${res.status}`);
        return (await res.json()).result;
      };
      const call = async (name: string, args: Record<string, unknown> = {}) => rpc('tools/call', { name, arguments: args }) as Promise<{ content: Array<{ text: string }>; structuredContent?: any; isError?: boolean }>;
      await call('set_public_profile', { handle: login });
      await call('build_room', { packs: ['developer'] });
      return { rpc, call };
    };
    const alice = await account(1, 'alice');
    const bob = await account(2, 'bob');
    const carol = await account(3, 'carol');
    assert.ok((await bob.rpc('tools/list')).tools.some((t: { name: string }) => t.name === 'share_settings'), 'the lab is on: its tools are listed');

    await alice.call('save_item', { url: 'https://example.com/found', title: 'A find' });
    const post = (await alice.call('share', { savedUrl: 'https://example.com/found', note: 'Look at this.', audience: 'everyone' })).structuredContent.share;
    await bob.call('relationship', { handle: 'alice', action: 'follow' });
    const seenByBob = (await bob.call('open_room')).structuredContent.portals.find((p: any) => p.source === 'following').items[0];
    assert.equal(seenByBob.share.canReblog, true);
    const reblog = await bob.call('share', { reblogOf: seenByBob.share.id, note: 'Agreed.', audience: 'everyone' });
    assert.ok(!reblog.isError, reblog.content[0]!.text);

    await carol.call('relationship', { handle: 'bob', action: 'follow' });
    const seenByCarol = (await carol.call('open_room')).structuredContent.portals.find((p: any) => p.source === 'following').items[0];
    assert.deepEqual(seenByCarol.meta, ['@bob', 'reblogged @alice', 'link']);
    assert.deepEqual(seenByCarol.share.reblog, { root: post.id, by: 'alice', note: 'Look at this.' });
    assert.equal(seenByCarol.share.reblogs, 1);
    assert.match((await alice.call('get_share', { id: post.id })).content[0]!.text, /Reblogged by @bob\./);

    await alice.call('share_settings', { id: post.id, detach: reblog.structuredContent.share.id });
    assert.deepEqual((await carol.call('get_share', { id: reblog.structuredContent.share.id })).structuredContent.share.original, { removed: 'detached' });
    assert.match((await bob.call('unshare', { id: reblog.structuredContent.share.id })).content[0]!.text, /Removed/);
    assert.equal((await alice.call('get_share', { id: post.id })).structuredContent.share.reblogCount, 0);
  } finally {
    await h.app.close();
  }
});

test('linked: catch-up, watch subscriptions and findings are hosted, survive another device and isolate accounts', async () => {
  const h = await hosted();
  try {
    const a = await h.signIn(31,'reader'), b = await h.signIn(32,'other');
    let clock = Date.now();
    const mac = device(h.app,a.accountId,fixed(a.tokens.access_token)), office = device(h.app,a.accountId,fixed(a.tokens.access_token), { now: () => clock }), other = device(h.app,b.accountId,fixed(b.tokens.access_token));
    // Use the same LinkAuth contract as the surrounding tests.
    await mac.call('build_room',{packs:[]});
    const start=await mac.call('catch_up',{action:'start',count:3,portalIds:['hn-top']});
    assert.ok(!start.isError,start.content[0]!.text);
    const session=start.structuredContent.session;
    assert.equal((await office.call('catch_up',{action:'open'})).structuredContent.session.id,session.id);
    assert.equal((await other.call('catch_up',{action:'open'})).structuredContent.session,null);
    if (!session.finishedAt) {const end=await office.call('catch_up',{action:'end',sessionId:session.id,index:0});assert.ok(end.structuredContent.session.acknowledgedAt);}
    const added=await mac.call('watch_reading',{action:'add',kind:'releases',repo:'acme/manual',title:'Manual releases'});
    assert.ok(!added.isError,added.content[0]!.text);
    const id=added.structuredContent.watches.watches[0].id;
    assert.equal((await office.call('watch_reading',{action:'list'})).structuredContent.watches.watches[0].id,id);
    assert.deepEqual((await other.call('watch_reading',{action:'list'})).structuredContent.watches.watches,[]);
    assert.equal((await other.call('watch_reading',{action:'delete',id})).isError,true);
    const checked=await office.call('watch_reading',{action:'check',id});
    assert.equal(checked.structuredContent.watches.inbox[0].kind,'availability','a provider failure is retained rather than a fake deletion');
    await mac.call('watch_reading',{action:'pause',id,paused:true});
    assert.equal((await office.call('watch_reading',{action:'list'})).structuredContent.watches.watches[0].paused,true);
    const changes = await mac.call('add_portal',{source:'changes',config:{}}); assert.ok(!changes.isError, changes.content[0]!.text); await mac.call('add_portal',{source:'upcoming',config:{}}); clock += 60000;
    const room=await office.call('open_room');assert.ok(room.structuredContent.portals.some((p:any)=>p.source==='changes'&&p.items.length===1));
    await mac.call('watch_reading',{action:'delete',id});assert.deepEqual((await office.call('watch_reading',{action:'list'})).structuredContent.watches.inbox,[]);
  } finally {await h.app.close();}
});

test('linked, hosted side down: initialize and tools/list answer at once; calls say they can\'t reach it', async () => {
  // Nothing listens on port 9, so the token refresh fails to connect (as with DNS blocked).
  const down = await linkedLocal({ server: 'http://127.0.0.1:9' });
  assert.ok((await down.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })).result);
  const listed = await down.list();
  assert.equal(listed.error, undefined);
  assert.ok(listed.ms < 2_000, `tools/list took ${listed.ms} ms`);
  for (const name of ['open_room', 'unlink_account', 'list_shares']) assert.ok(listed.names.includes(name), `${name} is listed`);
  const room = await down.call('open_room');
  assert.equal(room.isError, true);
  assert.equal(room.structuredContent.error.code, 'upstream_unreachable');
  assert.match(room.content[0]!.text, /Can't reach your hosted MCPortal/);

  // A server that never answers: the listing waits a moment, not the host's whole timeout.
  const hung = await linkedLocal({ server: 'http://127.0.0.1:9' }, () => new Promise<Response>(() => {}));
  const slow = await hung.list();
  assert.equal(slow.error, undefined);
  assert.ok(slow.ms < 5_000, `tools/list took ${slow.ms} ms`);
  assert.ok(slow.names.includes('unlink_account'));
});

test('linked, sign-in gone: a refused refresh or a moved host means sign in again, and unlink_account still works', async () => {
  const h = await hosted();
  try {
    // The hosted server refuses the refresh token (spent, revoked).
    const refused = await linkedLocal({ server: h.app.base });
    const listed = await refused.list();
    assert.ok(listed.names.includes('unlink_account'));
    const failed = await refused.call('search_clips');
    assert.equal(failed.isError, true);
    assert.equal(failed.structuredContent.error.code, 'unauthenticated');
    assert.match(failed.content[0]!.text, /Sign in again.*link_account/);
    const out = await refused.call('unlink_account');
    assert.equal(out.isError, undefined, out.content[0]!.text);
    assert.match(out.content[0]!.text, /already ended/);
    assert.equal((await refused.session.context()).link?.linked, false, 'back in ghost mode, so link_account is offered');
  } finally {
    await h.app.close();
  }

  // link.json names a host that no longer serves MCPortal (421 Misdirected Request, or a redirect elsewhere).
  for (const status of [421, 301]) {
    const answer: typeof fetch = async () => new Response('', { status, headers: status === 301 ? { location: 'https://elsewhere.example/' } : {} });
    for (const expiresAt of [0, Date.now() + 3_600_000]) {   // refreshing, and calling with a live token
      const moved = await linkedLocal({ server: 'https://old-host.example', expiresAt }, answer);
      assert.ok((await moved.list()).names.includes('unlink_account'));
      const failed = await moved.call('open_room');
      assert.equal(failed.structuredContent.error.code, 'unauthenticated', `${status}, expiresAt ${expiresAt}`);
      assert.match(failed.content[0]!.text, /has moved.*Sign in again/);
    }
  }
});


test('linked: reading preferences follow the account across devices and preserve room layout', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    const a = device(h.app, accountId, fixed(tokens.access_token));
    const before = await h.store.get(accountId);
    const result = await a.call('set_reading_preferences', { size: 'larger', measure: 'focused' });
    assert.ok(!result.isError, result.content[0]?.text);
    const b = device(h.app, accountId, fixed(tokens.access_token));
    assert.deepEqual((await b.call('get_reading_preferences')).structuredContent.readerComfort, { size: 'larger', measure: 'focused' });
    assert.deepEqual((await h.store.get(accountId)).columns, before.columns);
    const other = await h.signIn(7, 'friend');
    assert.equal((await device(h.app, other.accountId, fixed(other.tokens.access_token)).call('get_reading_preferences')).structuredContent.readerComfort.size, 'standard');
    const oldProfile = { ...await b.ctx.store.get(accountId) };
    delete oldProfile.readerComfort;
    await b.ctx.store.put(accountId, oldProfile);
    assert.equal((await h.store.get(accountId)).readerComfort?.size, 'larger');
    await b.call('set_reading_preferences', { size: 'standard', measure: 'comfortable' });
    assert.equal((await h.store.get(accountId)).readerComfort?.size, 'standard');
  } finally { await h.app.close(); }
});


test('linked: a lost clip/share response is retried using the original request key', async () => {
  const h = await hosted();
  try {
    const { accountId, tokens } = await h.signIn(42, 'lawrence');
    let drop = 'clips.add';
    const flaky = device(h.app, accountId, fixed(tokens.access_token), { fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (drop && String(init?.body).includes(drop)) { drop = ''; throw new Error('injected response loss after commit'); }
      return response;
    } });
    const args = { kind: 'quote', content: 'A durable retry test', requestKey: 'linked-clip-retry' };
    const first = await flaky.call('clip', args);
    assert.equal(first.isError, true);
    const next = await flaky.call('clip', args);
    assert.ok(!next.isError, next.content[0]?.text);
    assert.equal((await h.clips.usage(accountId)).count, 1);
    await flaky.call('set_public_profile', { handle: 'retry_user', displayName: 'Retry test' });
    drop = 'social.share';
    const share = { clipId: next.structuredContent.clip.id, requestKey: 'linked-share-retry', audience: 'everyone' };
    assert.equal((await flaky.call('share', share)).isError, true);
    const retried = await flaky.call('share', share);
    assert.ok(!retried.isError, retried.content[0]?.text);
    const again = await flaky.call('share', share);
    assert.equal(again.structuredContent.share.id, retried.structuredContent.share.id);
  } finally { await h.app.close(); }
});
