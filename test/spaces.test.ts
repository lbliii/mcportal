import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Accounts, makeBootstrap, memoryPersistence } from '../src/accounts.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { buildClip } from '../src/clips.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { SPACE_DESIGN } from '../src/space-design.ts';
import { publicSpacePage, publicSpaceFeed } from '../src/spaces.ts';
import { buildExport, importExport, parseExport } from '../src/portability.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { raw, startApp } from './helpers.ts';
import type { Fetcher } from '../src/types.ts';

const origin = 'https://mcportal.example';
async function world() {
  let at = Date.parse('2026-10-07T20:00:00Z');
  const profiles = new PublicProfiles(memoryPersistence(), { now: () => at });
  const store = new DocumentSocialStore();
  const social = new Social({ store, profiles, now: () => at, accountCreatedAt: () => Date.parse('2026-10-06T12:00:00Z') });
  await profiles.set('a', { handle: 'alice', ink: 'atomic', motif: 'arches', listed: true });
  await profiles.set('b', { handle: 'bob', listed: true });
  const advance = (ms = 1000) => { at += ms; };
  const space = async (viewer = 'a') => {
    const p = (await profiles.get('a'))!;
    const { accountId: _id, travelers: _travelers, ...pub } = p;
    return { ...pub, ...await social.spaceDetails(viewer, 'a'), mine: viewer === 'a', followers: 7, following: false, posts: await social.sharesOf(viewer, 'a', { limit: 50 }), sources: p.sources ?? [], link: `${origin}/@alice` };
  };
  return { profiles, store, social, advance, space };
}

test('covers: random stored seeds survive reads, handle changes and formats; re-roll preserves ink and motif', async () => {
  const { profiles } = await world();
  const before = (await profiles.get('a'))!.cover!;
  assert.equal((await profiles.get('a'))!.cover!.seed, before.seed);
  const changed = (await profiles.set('a', { handle: 'alice_new', format: 'patch', frequency: ['space opera'] })).profile;
  assert.deepEqual(changed.cover, before);
  const rolled = (await profiles.set('a', { reroll: true })).profile.cover!;
  assert.equal(rolled.ink, before.ink); assert.equal(rolled.motif, before.motif);
  assert.notEqual(rolled.seed, before.seed);
  const copy = (await profiles.get('a'))!; copy.cover!.seed = 1;
  assert.equal((await profiles.get('a'))!.cover!.seed, rolled.seed, 'readers cannot mutate stored cover data');
  await assert.rejects(profiles.set('a', { ink: 'url(javascript:evil)' }));
  await assert.rejects(profiles.set('a', { frequency: ['x'.repeat(25)] }));
  await assert.rejects(profiles.set('a', { format: 'html' }));
  const exported = parseExport((await buildExport('mcportal', 'a', { store: new MemoryProfileStore(), publicProfile: await profiles.get('a') })).body.toString());
  assert.deepEqual(exported.publicProfile?.cover, rolled);
  assert.equal(exported.publicProfile?.format, 'patch');
  assert.equal(parseExport(JSON.stringify({ format: 'mcportal-export', version: 1, publicProfile: { handle: 'alice', accent: 'violet' } })).publicProfile?.cover?.ink, 'pink-moon');
});

test('authored choices: own pins only, ordered listed travelers, live block/unlist removal; unsharing unpins', async () => {
  const { profiles, social, space } = await world();
  const own = await social.share('a', { kind: 'link', title: 'Own', audience: 'everyone' });
  const other = await social.share('b', { kind: 'link', title: 'Other', audience: 'everyone' });
  await assert.rejects(social.setSpace('a', { pinnedShareId: other.id }));
  await social.setSpace('a', { pinnedShareId: own.id, travelers: ['bob'] });
  assert.equal((await space()).pinned?.id, own.id);
  assert.deepEqual((await space()).travelers.map((p) => p.handle), ['bob']);
  await profiles.set('b', { listed: false });
  assert.deepEqual((await space()).travelers, []);
  await assert.rejects(social.setSpace('a', { travelers: ['bob'] }));
  await profiles.set('b', { listed: true });
  await social.block('b', 'alice', true);
  assert.deepEqual((await space()).travelers, []);
  await social.unshare('a', own.id);
  assert.equal((await profiles.get('a'))?.pinnedShareId, undefined);
});

test('import: appearance round-trips while privacy, handle, authored words and factual stamps cannot be overwritten', async () => {
  const { profiles } = await world();
  const store = new MemoryProfileStore();
  const exported = parseExport((await buildExport('mcportal', 'a', { store, publicProfile: await profiles.get('a') })).body.toString());
  const cover = exported.publicProfile!.cover!;
  await profiles.set('a', { ink: 'mars', reroll: true, public: false, bio: 'Keep my words', format: 'patch' });
  delete exported.publicProfile!.private;
  exported.publicProfile!.broughtAboard = 1000;
  exported.publicProfile!.bio = 'Unapproved text';
  const result = await importExport(exported, 'a', { store, publicProfiles: profiles });
  assert.equal(result.spaceAppearanceRestored, true);
  const p = (await profiles.get('a'))!;
  assert.deepEqual(p.cover, cover); assert.equal(p.private, true); assert.equal(p.bio, 'Keep my words'); assert.equal(p.broughtAboard, undefined);
  const malformed = structuredClone(exported); malformed.publicProfile!.cover!.seed = NaN;
  assert.match((await importExport(malformed, 'a', { store, publicProfiles: profiles })).spaceError!, /invalid/);
  await importExport(exported, 'unclaimed', { store, publicProfiles: profiles });
  assert.equal(await profiles.get('unclaimed'), undefined);
});

test('public pagination: fifty visible posts survive newer private pages and timestamp ties', async () => {
  const { social, store, space } = await world();
  for (let i = 0; i < 175; i++) await store.addShare({ id: `s_${String(i).padStart(4, '0')}`, accountId: 'a', kind: 'link', title: `Post ${i}`, audience: i < 55 ? 'everyone' : 'followers', createdAt: '2026-10-07T20:00:00.000Z' });
  const visible = await social.sharesOf('', 'a', { limit: 50 });
  assert.equal(visible.length, 50); assert.equal(visible[0]!.title, 'Post 54'); assert.equal(visible.at(-1)!.title, 'Post 5');
  assert.equal((publicSpaceFeed(await space(''), origin).match(/<item>/g) ?? []).length, 50);
});

test('stamps: facts rather than scores; join aggregate survives one-time notes; hidden stamps remain hidden', async () => {
  const { profiles, social, advance, space } = await world();
  await social.introduce('b', 'alice', true);
  assert.deepEqual((await social.takeIntros('a')).joined, ['bob']);
  assert.equal((await profiles.get('a'))?.broughtAboard, 1);
  assert.deepEqual((await social.takeIntros('a')).joined, []);
  for (let i = 0; i < 10; i++) { await social.share('a', { kind: 'link', title: `Week ${i}` }); advance(7 * 86400_000); }
  const names = (await space()).stamps.map((s) => s.name);
  assert.ok(names.includes('charter')); assert.ok(names.includes('brought')); assert.ok(names.includes('signal'));
  await social.setSpace('a', { hiddenStamps: ['brought', 'charter'] });
  assert.deepEqual((await space()).stamps.map((s) => s.name), ['signal']);
});

test('public renderer: all formats escape text; clips are bounded and tombstones leak no original title, URL or note', async () => {
  const { profiles, social, advance, space } = await world();
  await profiles.set('a', { spaceTitle: '<script>alert(1)</script>', bio: '<img src=x onerror=evil>' });
  await social.share('a', { kind: 'link', title: 'Safe link', url: 'javascript:alert(1)', audience: 'everyone' }); advance();
  const quote = buildClip({ kind: 'quote', text: 'q'.repeat(600), title: 'Quote' });
  await social.share('a', { kind: 'clip', title: quote.title, clip: quote, audience: 'everyone' }); advance();
  const note = buildClip({ kind: 'note', title: 'A note', text: 'SECRET NOTE BODY' });
  await social.share('a', { kind: 'clip', title: note.title, clip: note, audience: 'everyone' }); advance();
  const original = await social.share('b', { kind: 'link', title: 'SECRET ORIGINAL TITLE', url: 'https://secret.example/', note: 'SECRET ORIGINAL NOTE', audience: 'everyone' });
  await social.reblog('a', { id: original.id, audience: 'everyone', note: 'My public commentary' });
  await profiles.set('b', { public: false });
  for (const format of SPACE_DESIGN.formats) {
    await profiles.set('a', { format });
    const data = await space('');
    const html = publicSpacePage(data, origin);
    const feed = publicSpaceFeed(data, origin);
    assert.match(html, new RegExp(`data-space-format="${format}"`));
    assert.match(html, /&lt;script&gt;alert/);
    assert.doesNotMatch(html, /<script|javascript:|SECRET NOTE BODY|SECRET ORIGINAL|secret\.example|7 followers/);
    assert.doesNotMatch(feed, /SECRET NOTE BODY|SECRET ORIGINAL|secret\.example|javascript:/);
    assert.match(feed, /My public commentary/);
    assert.match(html, /Sign in to see this clip/);
    assert.ok(html.includes('q'.repeat(400)) && !html.includes('q'.repeat(401)));
    assert.match(html, /rel="alternate" type="application\/rss\+xml"/);
  }
});

test('public endpoints: followers stay private; cached content invalidates on hide, unshare, privacy and suspension; feeds 404 when private', async () => {
  const { profiles, social, store, advance } = await world();
  const accounts = new Accounts(memoryPersistence(), makeBootstrap([], [], true));
  const account = await accounts.admit({ githubId: 1, login: 'Alice' }); assert.ok(account.ok);
  await profiles.set(account.account.id, { handle: 'webalice', spaceTitle: 'Public title' });
  const open = await social.share(account.account.id, { kind: 'link', title: 'Public article', url: 'https://example.com/story', audience: 'everyone' }); advance();
  await social.share(account.account.id, { kind: 'link', title: 'SECRET FOLLOWERS TITLE', audience: 'followers' });
  const app = await startApp({ github: { clientId: 'client', clientSecret: 'secret' } }, undefined, { accounts, publicProfiles: profiles, social });
  try {
    for (const path of ['/@webalice', '/@webalice/feed']) {
      const result = await raw(app.port, { path });
      assert.equal(result.status, 200); assert.equal(result.headers['x-robots-tag'], 'noindex, nofollow');
      assert.match(result.body, /Public article/); assert.doesNotMatch(result.body, /SECRET FOLLOWERS TITLE/);
    }
    await store.setHidden(open.id, new Date().toISOString());
    assert.doesNotMatch((await raw(app.port, { path: '/@webalice' })).body, /Public article/);
    await store.setHidden(open.id, null);
    await social.unshare(account.account.id, open.id);
    assert.doesNotMatch((await raw(app.port, { path: '/@webalice/feed' })).body, /Public article/);
    await profiles.set(account.account.id, { public: false });
    assert.equal((await raw(app.port, { path: '/@webalice/feed' })).status, 404);
    assert.doesNotMatch((await raw(app.port, { path: '/@webalice' })).body, /Public title|SECRET FOLLOWERS/);
    await accounts.setStatus(account.account.id, 'suspended', 'admin');
    assert.equal((await raw(app.port, { path: '/@webalice' })).status, 404);
  } finally { await app.close(); }
});

test('link previews render separately from notes in all formats and RSS; private or detached originals lose their previews', async () => {
  const { social, profiles, space } = await world();
  const original = await social.share('b', { kind: 'link', title: 'A visual story', url: 'https://example.com/story',
    description: 'Source <description>', image: { url: 'https://example.com/cover.png', kind: 'thumb' }, note: 'Author commentary', audience: 'everyone' });
  const reblog = await social.reblog('a', { id: original.id, note: 'My commentary', audience: 'everyone' });
  const scripts = (await Promise.all(['space-inks.js', 'art.js', 'space-format.js'].map((f) => readFile(new URL(`../src/ui/${f}`, import.meta.url), 'utf8')))).join('\n');
  const renderer = runInNewContext(`${scripts}; spaceFormat`, { URL }) as { render: (space: unknown) => string };
  for (const format of SPACE_DESIGN.formats) {
    await profiles.set('a', { format });
    const data = await space('');
    const html = publicSpacePage(data, origin);
    assert.match(html, /class="space-description">Source &lt;description&gt;/);
    assert.match(html, new RegExp(`src="/@alice/image/${reblog.id}"`));
    assert.doesNotMatch(html, /src="https:\/\/example.com\/cover.png/);
    assert.match(html, /Author commentary/); assert.match(html, /My commentary/);
    const room = renderer.render(await space());
    assert.match(room, /data-img="https:\/\/example.com\/cover.png"/);
    const feed = publicSpaceFeed(data, origin);
    assert.match(feed, /Source &lt;description&gt;/);
    assert.match(feed, new RegExp(`<media:thumbnail url="${origin}/@alice/image/${reblog.id}"`));
  }
  await profiles.set('b', { public: false });
  for (const body of [publicSpacePage(await space(''), origin), publicSpaceFeed(await space(''), origin)]) {
    assert.doesNotMatch(body, /Source &lt;description&gt;|cover.png|\/image\//);
    assert.match(body, /My commentary/);
  }
  await profiles.set('b', { public: true });
  await social.shareSettings('b', original.id, { detach: reblog.id });
  const room = renderer.render(await space());
  assert.doesNotMatch(room, /Source &lt;description&gt;|cover.png/);
});

test('public thumbnail endpoints fetch only visible posts in their Space and revoke originals live', async () => {
  const { profiles, social, store } = await world();
  const accounts = new Accounts(memoryPersistence(), makeBootstrap([], [], true));
  const alice = await accounts.admit({ githubId: 10, login: 'Alice' }); assert.ok(alice.ok);
  const bob = await accounts.admit({ githubId: 11, login: 'Bob' }); assert.ok(bob.ok);
  await profiles.set(alice.account.id, { handle: 'webalice' });
  await profiles.set(bob.account.id, { handle: 'webbob' });
  const image = { url: 'https://example.com/cover.png', kind: 'thumb' as const };
  const original = await social.share(bob.account.id, { kind: 'link', title: 'A story', image, description: 'Source context', audience: 'everyone' });
  const reblog = await social.reblog(alice.account.id, { id: original.id, audience: 'everyone' });
  const secret = await social.share(alice.account.id, { kind: 'link', title: 'Private', image, audience: 'followers' });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  let requests = 0;
  const fetcher: Fetcher = async (url, options) => {
    requests++;
    assert.equal(url, image.url); assert.equal(options?.binary, true);
    return { status: 200, url, contentType: 'image/png', text: png.toString('base64'), truncated: false };
  };
  const app = await startApp({ github: { clientId: 'client', clientSecret: 'secret' } }, fetcher, { accounts, publicProfiles: profiles, social });
  const path = `/@webalice/image/${reblog.id}`;
  try {
    assert.equal((await raw(app.port, { path: `/@webalice/image/${original.id}` })).status, 404, "another Space's post cannot supply a thumbnail");
    assert.equal((await raw(app.port, { path: `/@webalice/image/${secret.id}` })).status, 404);
    assert.equal(requests, 0, 'inaccessible images are never fetched');
    const response = await raw(app.port, { path });
    assert.equal(response.status, 200); assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(response.headers['cache-control'], 'no-store');
    const head = await raw(app.port, { path, method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.body, '');
    assert.equal(requests, 1, 'the guarded thumbnail cache is reused');
    const page = await raw(app.port, { path: '/@webalice' });
    assert.match(String(page.headers['content-security-policy']), /img-src 'self' data:/);
    assert.match(page.body, /Source context/);
    await store.setHidden(original.id, new Date().toISOString());
    assert.equal((await raw(app.port, { path })).status, 404);
    assert.doesNotMatch((await raw(app.port, { path: '/@webalice' })).body, /Source context|\/image\//);
    await store.setHidden(original.id, null);
    await profiles.set(bob.account.id, { public: false });
    assert.equal((await raw(app.port, { path })).status, 404);
    await profiles.set(bob.account.id, { public: true });
    await profiles.set(alice.account.id, { public: false });
    assert.equal((await raw(app.port, { path })).status, 404);
    await profiles.set(alice.account.id, { public: true });
    await social.shareSettings(bob.account.id, original.id, { detach: reblog.id });
    assert.equal((await raw(app.port, { path })).status, 404);
    assert.equal(requests, 1, 'revocation prevents even cached thumbnails from being served');
    await social.unshare(alice.account.id, reblog.id);
    assert.equal((await raw(app.port, { path })).status, 404);
  } finally { await app.close(); }
});

const rgb = (hex: string) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16) / 255);
const lum = (xs: number[]) => xs.map((x) => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((n, x, i) => n + x * [ .2126, .7152, .0722 ][i]!, 0);
const contrast = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
test('all ink sets in light and dark pass AA for body, muted text and primary buttons; preview plates are 1200×630 PNGs', async () => {
  for (const set of SPACE_DESIGN.sets) {
    for (const dark of [false, true]) {
      const foreground = rgb(set.colors[dark ? 0 : 3]); const background = rgb(set.colors[dark ? 3 : 0]);
      const muted = foreground.map((x, i) => x * .78 + background[i]! * .22);
      assert.ok(contrast(foreground, background) >= 4.5, `${set.name} body/button ${dark}`);
      assert.ok(contrast(muted, background) >= 4.5, `${set.name} muted ${dark}`);
    }
    for (const motif of SPACE_DESIGN.motifs) {
      const png = await readFile(new URL(`../src/site/space-${set.name}-${motif}.png`, import.meta.url));
      assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
    }
  }
});

test('same seeded cover engine drives previews, avatars and formats without private identifiers', async () => {
  const scripts = (await Promise.all(['space-inks.js', 'art.js', 'space-format.js'].map((f) => readFile(new URL(`../src/ui/${f}`, import.meta.url), 'utf8')))).join('\n');
  const renderer = runInNewContext(`${scripts}; spaceFormat`, { URL }) as { coverArt: (cover: unknown) => string };
  const cover = { ink: 'atomic', motif: 'arches', seed: 123 };
  const normalize = (s: string) => s.replace(/sc\d+pa\d+/g, 'pattern').replace(/pa\d+/g, 'pattern');
  assert.equal(normalize(renderer.coverArt(cover)), normalize(renderer.coverArt(cover)));
  assert.notEqual(normalize(renderer.coverArt(cover)), normalize(renderer.coverArt({ ...cover, seed: 456 })));
});
