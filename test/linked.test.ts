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
import { MemoryClipStore } from '../src/clips.ts';
import { MemoryEditionStore } from '../src/editions.ts';
import { MemoryHandoffStore } from '../src/handoffs.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { memoryPersistence } from '../src/lib/document.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { StateClient, type LinkAuth } from '../src/link/client.ts';
import { linkedStores } from '../src/link/stores.ts';
import { handleMessage } from '../src/mcp.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore } from '../src/seen.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import { startApp, type Running } from './helpers.ts';

const RESOURCE = 'http://localhost/mcp';

/** A hosted MCPortal with GitHub sign-in, and a way to sign accounts in without a browser. */
async function hosted() {
  const authPersistence = memoryPersistence();
  const store = new MemoryProfileStore();
  const clips = new MemoryClipStore();
  const publicProfiles = new PublicProfiles(memoryPersistence());
  const social = new Social({ store: new DocumentSocialStore(), profiles: publicProfiles });
  const app = await startApp({ github: { clientId: 'gh-client', clientSecret: 'gh-secret' } }, createFixtureFetcher(), {
    store, clips, publicProfiles, social, authPersistence,
    accounts: new Accounts(memoryPersistence(), makeBootstrap([], [])),
    reading: new FileReadingStore(await mkdtemp(path.join(tmpdir(), 'mcportal-linked-'))),
    seen: new FileSeenStore(null),
    handoffs: new MemoryHandoffStore(),
    editions: new MemoryEditionStore(),
  });
  const auth = new AuthStore(authPersistence);
  const signIn = async (githubId: number, login: string) => {
    const tokens = await auth.issueTokens({ userId: `github-${githubId}`, githubId, login }, 'mcpc_test_device', RESOURCE, 'mcportal');
    return { accountId: `github-${githubId}`, tokens };
  };
  return { app, store, clips, auth, signIn };
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

const fixed = (token: string): LinkAuth => ({ token: async () => token, refresh: async () => undefined });

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

    const clipped = await mac.call('clip', { kind: 'quote', content: 'from the laptop', title: 'Laptop quote' });
    assert.equal(clipped.isError, undefined, clipped.content[0]!.text);
    const id = clipped.structuredContent.clip.id;
    assert.ok((await h.clips.get(accountId, id)), 'the id the tool reports is the hosted one');
    assert.equal((await mac.call('get_clip', { id })).structuredContent.clip.data.text, 'from the laptop');
    assert.equal((await mac.call('search_clips', { query: 'laptop' })).structuredContent.clips.length, 1);

    const handoff = await mac.call('create_handoff', { url: 'https://example.com/kept', title: 'Kept', passage: 'this part' });
    assert.ok(handoff.structuredContent.handoff.code);
    assert.equal((await mac.call('record_reading', { url: 'https://example.com/kept', status: 'opened' })).isError, undefined);
    assert.equal((await mac.call('list_reading')).structuredContent.reading.length, 1);
  } finally {
    await h.app.close();
  }
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
    const shared = await mac.call('share', { savedUrl: 'https://example.com/kept', note: 'read this', audience: 'mcportal' });
    assert.equal(shared.structuredContent.share.title, 'Worth reading');
    const clip = await mac.call('clip', { kind: 'quote', content: 'quotable', title: 'A clip' });
    assert.equal((await mac.call('share', { clipId: clip.structuredContent.clip.id })).isError, undefined, 'a clip shares by its hosted id');

    await other.call('set_public_profile', { handle: 'friend' });
    assert.equal((await other.call('relationship', { action: 'follow', handle: '@lawrence' })).isError, undefined);
    const feed = await other.call('list_shares', { handle: '@lawrence' });
    assert.deepEqual(feed.structuredContent.shares.map((s: { title: string }) => s.title).sort(), ['A clip', 'Worth reading']);
    assert.match((await mac.call('list_connections')).content[0]!.text, /Followers: 1\./);
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
