/**
 * One contract for every storage backend: the same behaviour from the file (or
 * memory) stores used locally and the Postgres stores used when hosted. Postgres
 * runs only with TEST_DATABASE_URL set, in a schema of its own that is dropped after.
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { FileClipStore, MemoryClipStore, type ClipStore } from '../src/clip-stores.ts';
import { buildClip } from '../src/clips.ts';
import { memoryPersistence } from '../src/lib/document.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { FileReadingStore, READING_LIMIT, type ReadingStore } from '../src/reading.ts';
import { DocumentSocialStore, type SocialStore } from '../src/social-store.ts';
import type { Share } from '../src/social.ts';
import { FileProfileStore, MemoryProfileStore, type ProfileStore } from '../src/store.ts';
import type { Queryable } from '../src/db/schema.ts';

const URL = process.env.TEST_DATABASE_URL;
const schema = `mcportal_contract_${process.pid}_${Date.now()}`;
let admin: Queryable | undefined;
let db: Queryable | undefined;

before(async () => {
  if (!URL) return;
  const { connect, ensureSchema } = await import('../src/db.ts');
  admin = await connect(URL);
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = await connect(URL, { searchPath: schema });
  await ensureSchema(db);
});

after(async () => {
  if (!URL) return;
  await db?.end?.();
  await admin?.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin?.end?.();
});

interface Backend {
  name: string;
  skip: string | false;
  profiles: () => Promise<ProfileStore>;
  clips: () => Promise<ClipStore>;
  social: () => Promise<SocialStore>;
  reading: () => Promise<ReadingStore>;
}

const tmp = (what: string) => mkdtemp(path.join(tmpdir(), `mcportal-contract-${what}-`));
const pg = () => import('../src/db.ts');

const BACKENDS: Backend[] = [
  {
    name: 'files',
    skip: false,
    profiles: async () => new FileProfileStore(await tmp('profiles')),
    clips: async () => new FileClipStore(await tmp('clips')),
    social: async () => new DocumentSocialStore(memoryPersistence()),
    reading: async () => new FileReadingStore(await tmp('reading')),
  },
  {
    name: 'memory',
    skip: false,
    profiles: async () => new MemoryProfileStore(),
    clips: async () => new MemoryClipStore(),
    social: async () => new DocumentSocialStore(),
    reading: async () => new FileReadingStore(await tmp('reading')),
  },
  {
    name: 'postgres',
    skip: !URL && 'set TEST_DATABASE_URL to run Postgres tests',
    profiles: async () => new (await pg()).PgProfileStore(db!),
    clips: async () => new (await pg()).PgClipStore(db!),
    social: async () => new (await pg()).PgSocialStore(db!),
    reading: async () => new (await pg()).PgReadingStore(db!),
  },
];

/** User ids unique to one test, so backends that share a database don't see each other's rows. */
let n = 0;
const user = (label: string) => `${label}-${process.pid}-${++n}`;

for (const b of BACKENDS) {
  test(`contract (${b.name}): profiles`, { skip: b.skip }, async () => {
    const store = await b.profiles();
    const u = user('p');
    assert.equal((await store.get(u)).onboarded, false, 'a new user gets the default room');
    const mine = validateProfile({ ...defaultProfile(), name: 'Mine', onboarded: true });
    await store.put(u, mine);
    assert.equal((await store.get(u)).name, 'Mine');
    assert.equal(await store.update(u, () => ({ result: 'read only' })), 'read only');
    const urls = Array.from({ length: 8 }, (_, i) => `https://example.com/${i}`);
    await Promise.all(urls.map((url) => store.update(u, (p) => ({ profile: validateProfile({ ...p, saved: [{ url, title: url }, ...p.saved] }), result: undefined }))));
    assert.deepEqual((await store.get(u)).saved.map((s) => s.url).sort(), urls, 'concurrent updates all land');
    await store.delete(u);
    assert.equal((await store.get(u)).name, defaultProfile().name, 'deleted');
  });

  test(`contract (${b.name}): clips`, { skip: b.skip }, async () => {
    const store = await b.clips();
    const u = user('c');
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    for (let i = 0; i < 5; i++) {
      const clip = buildClip({ kind: i % 2 ? 'note' : 'quote', text: `quote ${i} about llamas`, markdown: `note ${i} about alpacas`, title: `clip ${i}`, tags: i < 2 ? ['zoo'] : [] });
      await store.add(u, { ...clip, createdAt: at(i), updatedAt: at(i) });
    }
    const all = await store.list(u, { limit: 50 });
    assert.deepEqual(all.map((c) => c.title), ['clip 4', 'clip 3', 'clip 2', 'clip 1', 'clip 0'], 'newest first');
    assert.deepEqual((await store.list(u, { kind: 'note' })).map((c) => c.title), ['clip 3', 'clip 1']);
    assert.deepEqual((await store.list(u, { tag: '#ZOO' })).map((c) => c.title), ['clip 1', 'clip 0'], 'tags are normalized');
    assert.deepEqual((await store.list(u, { query: 'alpacas' })).map((c) => c.title), ['clip 3', 'clip 1']);
    assert.deepEqual((await store.list(u, { limit: 2, before: all[1]!.createdAt })).map((c) => c.title), ['clip 2', 'clip 1'], 'paging');
    assert.equal((await store.list(user('other'))).length, 0, 'clips belong to their owner');
    const first = all[0]!;
    assert.equal((await store.update(u, first.id, { title: 'renamed', tags: ['New Tag'] }))?.title, 'renamed');
    assert.deepEqual((await store.get(u, first.id))?.tags, ['new-tag']);
    assert.equal(await store.update(u, 'nope', { title: 'x' }), undefined);
    assert.equal(await store.delete(u, first.id), true);
    assert.equal(await store.delete(u, first.id), false);
    const usage = await store.usage(u);
    assert.equal(usage.count, 4);
    assert.ok(usage.bytes > 0);
    assert.equal(await store.deleteAll(u), 4);
    assert.equal((await store.usage(u)).count, 0);
  });

  test(`contract (${b.name}): social`, { skip: b.skip }, async () => {
    const store = await b.social();
    const [alice, bob] = [user('alice'), user('bob')];
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    const share = (i: number): Share => ({ id: `${alice}-s${i}`, accountId: alice, kind: 'link', title: `s${i}`, url: `https://example.com/${i}`, audience: 'followers', createdAt: at(i) });
    for (let i = 0; i < 120; i++) await store.addShare(share(i));
    assert.equal(await store.countShares(alice), 120);
    const page = await store.sharesBy([alice], { limit: 500 });
    assert.equal(page.length, 100, 'pages are capped at 100 everywhere');
    assert.equal(page[0]!.title, 's119', 'newest first');
    assert.equal((await store.sharesBy([alice], {})).length, 30, 'default page');
    assert.deepEqual((await store.sharesBy([alice], { limit: 2, before: at(10) })).map((s) => s.title), ['s9', 's8']);
    assert.equal(await store.setHidden(`${alice}-s119`, at(200)), true);
    assert.equal((await store.sharesBy([alice], { limit: 1 }))[0]!.title, 's118', 'hidden shares are left out');
    assert.ok((await store.sharesBy([alice], { limit: 1, includeHidden: true }))[0]!.hiddenAt, 'unless asked for');
    assert.equal(await store.deleteShare(bob, `${alice}-s0`), false, 'only the author deletes');
    assert.equal(await store.deleteShare(alice, `${alice}-s0`), true);
    assert.equal(await store.getShare(`${alice}-s0`), undefined);

    assert.equal(await store.relate('follows', bob, alice), true);
    assert.equal(await store.relate('follows', bob, alice), false, 'relations are unique');
    assert.deepEqual(await store.outgoing('follows', bob), [alice]);
    assert.deepEqual(await store.incoming('follows', alice), [bob]);
    assert.equal(await store.unrelate('follows', bob, alice), true);
    assert.deepEqual(await store.outgoing('follows', bob), []);

    const report = { id: `${bob}-r1`, reporterId: bob, targetKind: 'share' as const, targetId: `${alice}-s5`, reason: 'spam', status: 'open' as const, createdAt: at(300) };
    await store.addReport(report);
    assert.ok((await store.reports('open')).some((r) => r.id === report.id));
    assert.equal((await store.resolveReport(report.id, 'admin:x', 'dismissed', at(301)))?.status, 'resolved');
    assert.ok((await store.reports('resolved')).some((r) => r.id === report.id));

    await store.relate('follows', alice, bob);
    await store.forget(bob);
    assert.deepEqual(await store.incoming('follows', bob), [], "a forgotten account's relations go");
    const kept = (await store.reports()).find((r) => r.id === report.id);
    assert.ok(kept && kept.reporterId !== bob, 'reports it filed stay, anonymized');
  });

  test(`contract (${b.name}): reading`, { skip: b.skip }, async () => {
    const store = await b.reading();
    const u = user('r');
    await store.record(u, { url: 'https://example.com/a#part', status: 'opened', title: 'A', progress: 0.5 });
    await store.record(u, { url: 'https://example.com/b', status: 'seen' });
    const a = await store.get(u, 'https://example.com/a');
    assert.equal(a?.status, 'opened', 'fragments share the URL identity');
    assert.equal(a?.progress, 0.5);
    assert.deepEqual((await store.list(u, { unfinished: true })).map((s) => s.url), ['https://example.com/a']);
    assert.equal((await store.list(u, { limit: 10_000 })).length, 2);
    await store.record(u, { url: 'https://example.com/a', status: 'read' });
    assert.equal((await store.get(u, 'https://example.com/a'))?.progress, 1, 'read means complete');
    assert.equal(await store.import(u, [{ url: 'https://example.com/c', status: 'seen', lastSeenAt: '2026-01-01T00:00:00.000Z' }, { url: 'https://example.com/b', status: 'seen', lastSeenAt: '2026-01-01T00:00:00.000Z' }]), 1, 'imports only what is new');
    await assert.rejects(store.import(u, new Array(READING_LIMIT + 1).fill({})), (e: { code?: string }) => e.code === 'limit_exceeded');
    await store.deleteAll(u);
    assert.equal(await store.get(u, 'https://example.com/a'), undefined);
  });
}
