import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryPersistence } from '../src/accounts.ts';
import { API_METHODS } from '../src/api/methods.ts';
import { handleCalls } from '../src/api/calls.ts';
import { remoteProfiles, remoteSocial } from '../src/link/stores.ts';
import type { StateClient } from '../src/link/client.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { Social, DocumentSocialStore } from '../src/social.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { MemoryClipStore } from '../src/clips.ts';
import { handleMessage } from '../src/mcp.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import type { Fetcher } from '../src/types.ts';
import { buildExport } from '../src/portability.ts';

async function world() {
  const persistence = memoryPersistence();
  const profiles = new PublicProfiles(persistence);
  const hidden = new Set<string>();
  for (const handle of ['alice', 'bob', 'carol', 'visitor']) await profiles.set(handle, { handle });
  const store = new MemoryProfileStore();
  const requests: Array<{ url: string; authorization?: string }> = [];
  const fetcher: Fetcher = async (url, options) => {
    requests.push({ url, ...(options?.headers?.authorization ? { authorization: options.headers.authorization } : {}) });
    const privateRepo = url.includes('private-repo');
    return { status: url.includes('/restricted') ? 401 : 200, url, contentType: 'application/xml', truncated: false,
      text: url.startsWith('https://api.github.com') ? JSON.stringify({ private: privateRepo }) : '<rss><channel><title>Public feed</title></channel></rss>' };
  };
  const cache = new TtlCache();
  const social = new Social({ store: new DocumentSocialStore(), profiles, preferences: store, hidden: (id) => hidden.has(id), fetcher, cache });
  const ctx = (userId: string): ToolContext => ({ userId, store, social, publicProfiles: profiles, fetcher, cache, clips: new MemoryClipStore() });
  const call = async (viewer: string, method: string, params = {}) => {
    const [result] = (await handleCalls({ calls: [{ id: 1, method, params }] }, ctx(viewer), API_METHODS))!;
    if ('error' in result!) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result!.result as any;
  };
  const tool = async (viewer: string, name: string, args = {}) => {
    const result = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx(viewer));
    return result!.result as any;
  };
  return { profiles, persistence, store, social, hidden, requests, call, tool, ctx };
}

const room = (panels: unknown[]) => validateProfile({ ...defaultProfile(), onboarded: true, columns: [{ panels }] });
const rss = (id: string, url = `https://feeds.example.com/${id}`, title = id) => ({ id, title, source: 'rss', config: { url } });

test('automatic Space sections are opt-in; owner preview is private and room/follow changes appear on the next read', async () => {
  const w = await world();
  await w.store.put('alice', room([rss('Alpha'), rss('Beta')]));
  await w.social.follow('alice', 'bob');
  const before = (await w.tool('alice', 'open_space')).structuredContent.space;
  assert.deepEqual(before.sources, []);
  assert.deepEqual(before.people, []);
  assert.equal(before.sectionPreview.sources.length, 2);
  assert.deepEqual(before.sectionPreview.people.map((p: any) => p.handle), ['bob']);
  assert.equal((await w.tool('visitor', 'open_space', { handle: 'alice' })).structuredContent.space.sectionPreview, undefined);
  await assert.rejects(w.social.spaceSections('visitor', 'alice', true), /Only your own/);
  await w.tool('alice', 'set_public_profile', { showSources: true, showPeople: true });
  assert.equal((await w.social.spaceSections('visitor', 'alice')).sources.length, 2);
  await w.store.put('alice', room([rss('Gamma')]));
  await w.social.unfollow('alice', 'bob');
  await w.social.follow('alice', 'carol');
  const updated = await w.social.spaceSections('visitor', 'alice');
  assert.deepEqual(updated.sources.map((s) => s.title), ['Gamma']);
  assert.deepEqual(updated.people.map((s) => s.handle), ['carol']);
});

test('legacy explicit recommendations stay pinned and visibility/curation survive edits and persistence reload', async () => {
  const w = await world();
  await w.store.put('alice', room([rss('Alpha'), rss('Zebra')]));
  await w.tool('alice', 'set_public_profile', { featuredPortalIds: ['zebra'] });
  assert.deepEqual((await w.social.spaceSections('visitor', 'alice')).sources.map((s) => [s.title, s.pinned]), [['Zebra', true]]);
  await w.profiles.set('alice', { showSources: true });
  assert.deepEqual((await w.social.spaceSections('visitor', 'alice')).sources.map((s) => s.title), ['Zebra', 'Alpha']);
  const alpha = (await w.social.spaceSections('alice', 'alice', true)).sources.find((s) => s.title === 'Alpha')!;
  await w.profiles.set('alice', { sourceCuration: { hidden: [alpha.key] }, showPeople: false });
  assert.equal((await w.social.spaceSections('visitor', 'alice')).sources[0]!.pinned, true, 'hiding does not erase legacy pins');
  await w.profiles.set('alice', { bio: 'Changed' });
  const reloaded = await new PublicProfiles(w.persistence).get('alice');
  assert.equal(reloaded!.showSources, true);
  assert.equal(reloaded!.showPeople, false);
  assert.deepEqual(reloaded!.sourceCuration!.hidden, [alpha.key]);
  await w.profiles.set('alice', { showSources: false });
  assert.deepEqual((await w.social.spaceSections('visitor', 'alice')).sources, []);
  assert.equal((await w.profiles.get('alice'))!.sources!.length, 1, 'turning off preserves explicit recommendations');
});

test('pins, order and hides are stable across portal IDs, limits, handle changes and unfollow/refollow', async () => {
  const w = await world();
  await w.store.put('alice', room([rss('Alpha'), rss('Beta'), rss('Gamma')]));
  await w.social.follow('alice', 'bob');
  await w.social.follow('alice', 'carol');
  await w.profiles.set('alice', { showSources: true, showPeople: true });
  const preview = await w.social.spaceSections('alice', 'alice', true);
  const [a, b, c] = preview.sources;
  await w.profiles.set('alice', { sourceCuration: { pinned: [c!.key], order: [b!.key, a!.key], hidden: [a!.key] },
    peopleCuration: { pinned: [preview.people[1]!.key], hidden: [preview.people[0]!.key] } });
  assert.deepEqual((await w.social.spaceSections('visitor', 'alice')).sources.map((s) => s.title), ['Gamma', 'Beta']);
  await w.store.put('alice', room([{ ...rss('renamed', 'https://feeds.example.com/Alpha'), config: { url: 'https://feeds.example.com/Alpha', limit: 20 } }, rss('Beta'), rss('Gamma')]));
  assert.equal((await w.social.spaceSections('visitor', 'alice')).sources.length, 2);
  await w.profiles.set('carol', { handle: 'new_carol' });
  const people = (await w.social.spaceSections('visitor', 'alice')).people;
  assert.deepEqual(people.map((p) => [p.handle, p.pinned]), [['new_carol', true]]);
  await w.social.unfollow('alice', 'new_carol');
  assert.equal((await w.social.spaceSections('visitor', 'alice')).people.length, 0);
  await w.social.follow('alice', 'new_carol');
  assert.equal((await w.social.spaceSections('visitor', 'alice')).people[0]!.pinned, true);
});

test('restricted sources and private room content never reach either public lists or previews; probes carry no credentials', async () => {
  const w = await world();
  await w.store.put('alice', validateProfile({ ...defaultProfile(), columns: [
    { panels: [rss('Public'), rss('query', 'https://feeds.example.com/feed?token=abc'), rss('local', 'http://127.0.0.1/feed'), rss('auth', 'https://user:pass@feeds.example.com/feed')] },
    { panels: [rss('Restricted', 'https://feeds.example.com/restricted'), rss('opaque', 'https://feeds.example.com/abcd1234abcd1234abcd1234abcd1234/feed'), { id: 'private-repo', source: 'github', config: { mode: 'releases', repo: 'me/private-repo' } }, { id: 'public-repo', source: 'github', title: 'public-repo', config: { mode: 'releases', repo: 'me/public-repo' } }] },
    { panels: [{ id: 'saved', source: 'saved', config: {} }, { id: 'clips', source: 'clips', config: {} }, { id: 'integration', source: 'pinned', config: { from: 'Slack', recipe: 'private token here' } }, { id: 'docs', source: 'docs', config: { url: 'https://private.example.com/docs' } }] },
  ], saved: [{ url: 'https://private.example.com/secret', title: 'Secret' }] }));
  await w.profiles.set('alice', { showSources: true });
  for (const preview of [false, true]) assert.deepEqual((await w.social.spaceSections('alice', 'alice', preview)).sources.map((s) => s.title), ['Public', 'public-repo']);
  assert.ok(w.requests.every((r) => !r.authorization && !/token=|user:pass|127\.0\.0\.1|abcd1234/.test(r.url)));
});

test('public people lists respect suspension, profile removal and visitor blocks; hidden curation is owner-only across API/tool/linked reads', async () => {
  const w = await world();
  await w.social.follow('alice', 'bob');
  await w.social.follow('alice', 'carol');
  await w.profiles.set('alice', { showPeople: true, showSources: true });
  const preview = await w.social.spaceSections('alice', 'alice', true);
  await w.profiles.set('alice', { peopleCuration: { hidden: [preview.people[0]!.key] } });
  const visit = (await w.tool('visitor', 'open_space', { handle: 'alice' })).structuredContent.space;
  assert.equal(visit.peopleCuration, undefined);
  assert.equal((await w.call('visitor', 'profiles.byHandle', { handle: 'alice' })).profile.peopleCuration, undefined);
  assert.equal((await w.tool('visitor', 'get_public_profile', { handle: 'alice' })).structuredContent.profile.peopleCuration, undefined);
  await w.social.block('visitor', 'carol', true);
  assert.deepEqual((await w.social.spaceSections('visitor', 'alice')).people, []);
  w.hidden.add('carol');
  assert.equal((await w.social.spaceSections('alice', 'alice', true)).people.length, 1);
  await w.profiles.remove('bob');
  assert.equal((await w.social.spaceSections('alice', 'alice', true)).people.length, 0);
});

test('linked clients use hosted room/follows and enforce owner-only previews; exports retain explicit visibility and curation', async () => {
  const w = await world();
  await w.store.put('alice', room([rss('Alpha')]));
  await w.social.follow('alice', 'bob');
  const client = { call: (method: string, params = {}) => w.call('alice', method, params) } as unknown as StateClient;
  const profiles = remoteProfiles(client, 'alice');
  const social = remoteSocial(client, 'alice');
  await profiles.set('alice', { showSources: true, showPeople: true });
  const sections = await social.spaceSections('alice', 'alice');
  assert.equal(sections.sources.length, 1);
  assert.equal(sections.people.length, 1);
  await profiles.set('alice', { showSources: false, sourceCuration: { hidden: [sections.sources[0]!.key] } });
  assert.deepEqual((await social.spaceSections('alice', 'alice')).sources, []);
  const exported = JSON.parse((await buildExport('mcportal', 'alice', { store: w.store, publicProfile: await w.profiles.get('alice') })).body.toString());
  assert.equal(exported.publicProfile.showSources, false);
  assert.equal(exported.publicProfile.showPeople, true);
  assert.deepEqual(exported.publicProfile.sourceCuration.hidden, [sections.sources[0]!.key]);
  await assert.rejects(w.call('visitor', 'social.spaceSections', { accountId: '@alice', preview: true }), /Only your own/);
});


test('automatic sources are not capped by the old featured list; canonical identity deduplicates variants and recognizes public selectors', async () => {
  const w = await world();
  const panels = Array.from({ length: 16 }, (_, i) => rss(`Feed${i}`));
  const youtube = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv';
  panels.push(rss('YouTube', youtube));
  panels.push(rss('YouTube duplicate', youtube.replace('www.youtube.com', 'WWW.YOUTUBE.COM')));
  panels.push(rss('Public format', 'https://feeds.example.com/feed?format=rss'));
  const columns = Array.from({ length: Math.ceil(panels.length / 4) }, (_, i) => ({ panels: panels.slice(i * 4, i * 4 + 4) }));
  await w.store.put('alice', validateProfile({ ...defaultProfile(), columns }));
  await w.profiles.set('alice', { showSources: true });
  const sources = (await w.social.spaceSections('visitor', 'alice')).sources;
  assert.equal(sources.length, 18);
  assert.equal(sources.filter((source) => source.title.startsWith('YouTube')).length, 1);
});

test('repository searches are verified without the room token and blocking through the API still succeeds', async () => {
  const w = await world();
  await w.store.put('alice', room([
    { id: 'private-search', source: 'github', config: { query: 'repo:me/private-repo' } },
    { id: 'public-search', source: 'github', config: { query: 'repo:me/public-repo' } },
    { id: 'restricted-search', source: 'github', config: { query: 'is:private' } },
  ]));
  await w.profiles.set('alice', { showSources: true });
  assert.deepEqual((await w.social.spaceSections('visitor', 'alice')).sources.map((s) => s.title), ['public-search']);
  assert.ok(w.requests.every((request) => !request.authorization));
  await w.social.follow('alice', 'bob');
  const blocked = await w.call('alice', 'social.block', { handle: 'bob', on: true });
  assert.equal(blocked.handle, 'bob');
  assert.deepEqual(blocked.sources, []);
  assert.deepEqual((await w.social.connections('alice')).following, []);
});
