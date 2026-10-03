/**
 * Postgres storage tests. Run with TEST_DATABASE_URL set (skipped otherwise);
 * each run uses its own schema and drops it afterwards.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { AuthStore } from '../src/auth/store.ts';
import { connect, ensureSchema, importFiles, PgProfileStore, pgAuthPersistence, type Queryable } from '../src/db.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';

const URL = process.env.TEST_DATABASE_URL;
const schema = `mcportal_test_${process.pid}_${Date.now()}`;
let admin: Queryable;
let db: Queryable;

before(async () => {
  if (!URL) return;
  admin = await connect(URL);
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = await connect(URL, { searchPath: schema });
  await ensureSchema(db);
});

after(async () => {
  if (!URL) return;
  await db.end?.();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end?.();
});

const skip = !URL && 'set TEST_DATABASE_URL to run Postgres tests';

test('pg profiles: default for new users, round-trip, rev increments, schema is idempotent', { skip }, async () => {
  await ensureSchema(db);   // second run is a no-op
  const store = new PgProfileStore(db);
  assert.deepEqual((await store.get('nobody')).columns, defaultProfile().columns);
  assert.equal((await store.versioned('nobody')).rev, 0);

  const p = validateProfile({ ...defaultProfile(), name: 'Mine', onboarded: true, saved: [{ url: 'https://example.com/a', title: 'A' }] });
  await store.put('u1', p);
  assert.equal((await store.versioned('u1')).rev, 1);
  const back = await store.get('u1');
  assert.equal(back.name, 'Mine');
  assert.equal(back.saved[0]!.url, 'https://example.com/a');
  assert.equal(back.onboarded, true);

  await store.put('u1', { ...back, layout: 'shelves' });
  assert.equal((await store.versioned('u1')).rev, 2);
  assert.equal((await store.get('u1')).layout, 'shelves');
});

test('pg profiles: concurrent writes all land, last one wins, rev counts every write', { skip }, async () => {
  const store = new PgProfileStore(db);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.put('busy', { ...defaultProfile(), name: `v${i}` })));
  assert.equal((await store.versioned('busy')).rev, 20);
  assert.match((await store.get('busy')).name, /^v\d+$/);
});

test('pg profiles: concurrent updates from two instances all land (per-user lock)', { skip }, async () => {
  const a = new PgProfileStore(db);
  const b = new PgProfileStore(db);
  const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
  await Promise.all(urls.map((url, i) => (i % 2 ? a : b).update('racy', (p) => {
    const profile = validateProfile({ ...p, saved: [{ url, title: url }, ...p.saved] });
    return { profile, result: undefined };
  })));
  assert.deepEqual((await a.get('racy')).saved.map((s) => s.url).sort(), urls);
  assert.equal((await a.versioned('racy')).rev, urls.length, 'one revision per change, none lost');
  // A change that decides not to write leaves the row alone.
  assert.equal(await a.update('racy', () => ({ result: 'kept' })), 'kept');
  assert.equal((await a.versioned('racy')).rev, urls.length);
});

test('pg documents: two instances share OAuth and accounts without losing or missing changes', { skip }, async () => {
  const { Accounts, makeBootstrap } = await import('../src/accounts.ts');
  let now = Date.parse('2026-10-01T00:00:00Z');
  const clock = () => now;
  const [a, b] = [new AuthStore(pgAuthPersistence(db, 'auth-multi'), clock), new AuthStore(pgAuthPersistence(db, 'auth-multi'), clock)];
  const client = await a.registerClient({ redirect_uris: ['https://app.example/cb'] });
  assert.ok(await b.getClient(client.client_id), 'a client registered on one instance is found on the other at once');
  const who = { userId: 'multi', login: 'multi' };
  const issued = await a.issueTokens(who as never, client.client_id, 'https://mcp.example/mcp', 'mcportal');
  assert.ok(await b.verifyAccess(issued.access_token, 'https://mcp.example/mcp'), 'so is a token');
  await a.revokeUser('multi');
  now += 5_000;
  assert.equal(await b.verifyAccess(issued.access_token, 'https://mcp.example/mcp'), undefined, 'a revocation reaches the other instance within its cache age');

  const [x, y] = [new Accounts(pgAuthPersistence(db, 'accounts-multi'), makeBootstrap([], [])), new Accounts(pgAuthPersistence(db, 'accounts-multi'), makeBootstrap([], []))];
  await Promise.all(['ann', 'ben', 'cat', 'dan'].map((login, i) => (i % 2 ? x : y).invite(login, 'test')));
  await x.load(true);
  assert.deepEqual((await x.list()).invites.map((i) => i.login).sort(), ['ann', 'ben', 'cat', 'dan'], 'concurrent invites from two instances all land');
});

test('pg profiles: an unreadable row is kept aside and the user gets the default plus a notice', { skip }, async () => {
  await db.query(`INSERT INTO mcportal_profiles (user_id, data) VALUES ('broken', $1)`, [JSON.stringify({ columns: 'nope' })]);
  const store = new PgProfileStore(db);
  const p = await store.get('broken');
  assert.deepEqual(p.columns, defaultProfile().columns);
  assert.match(store.takeNotice('broken') ?? '', /couldn't be read/);
  const kept = await db.query(`SELECT count(*)::int AS n FROM mcportal_kv WHERE key LIKE 'corrupt-profile:broken:%'`);
  assert.equal((kept.rows[0] as { n: number }).n, 1);
});

test('pg auth: OAuth state survives a restart (new AuthStore on the same database)', { skip }, async () => {
  const first = new AuthStore(pgAuthPersistence(db, 'auth-test'));
  const client = await first.registerClient({ client_name: 'Test', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
  const tokens = await first.issueTokens({ userId: 'github-1', githubId: 1, login: 'octo' }, client.client_id, 'https://x/mcp', 'mcportal');

  const restarted = new AuthStore(pgAuthPersistence(db, 'auth-test'));
  assert.equal((await restarted.getClient(client.client_id))?.client_name, 'Test');
  assert.equal((await restarted.verifyAccess(tokens.access_token, 'https://x/mcp'))?.userId, 'github-1');
  const stored = await db.query(`SELECT value::text AS v FROM mcportal_kv WHERE key = 'auth-test'`);
  assert.doesNotMatch((stored.rows[0] as { v: string }).v, new RegExp(tokens.access_token), 'only hashes are stored');
});

test('pg import: copies file profiles and auth.json once, never overwrites, skips junk', { skip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-import-'));
  try {
    await writeFile(path.join(dir, 'github-42.json'), JSON.stringify({ ...defaultProfile(), name: 'From file', onboarded: true }));
    await writeFile(path.join(dir, 'u1.json'), JSON.stringify({ ...defaultProfile(), name: 'Should not overwrite' }));
    await writeFile(path.join(dir, 'auth.json'), JSON.stringify({ clients: {}, tokens: {} }));
    await writeFile(path.join(dir, 'bad.json'), '{not json');
    await writeFile(path.join(dir, 'github-42.corrupt-1.json'), '{}');

    const first = await importFiles(db, dir);
    assert.deepEqual(first, { skipped: false, profiles: 1, auth: true });
    const store = new PgProfileStore(db);
    assert.equal((await store.get('github-42')).name, 'From file');
    assert.equal((await store.get('u1')).name, 'Mine', 'existing rows win');

    assert.deepEqual(await importFiles(db, dir), { skipped: true, profiles: 0, auth: false }, 'runs once');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pg clips: round-trip, search, tags, paging, isolation, limits; v1 upgrades in place', { skip }, async () => {
  const { buildClip, ClipError, CLIP_LIMITS } = await import('../src/clips.ts');
  const { PgClipStore } = await import('../src/db.ts');
  const store = new PgClipStore(db);
  // A v1 database (what production had) is upgraded in place.
  await db.query(`UPDATE mcportal_meta SET value = '1' WHERE key = 'schema_version'`);
  await ensureSchema(db);
  const version = await db.query<{ value: string }>(`SELECT value FROM mcportal_meta WHERE key = 'schema_version'`);
  assert.equal(version.rows[0]!.value, (await import('../src/db/schema.ts')).SCHEMA_VERSION);

  const t0 = new Date('2026-09-01T00:00:00Z');
  const a = buildClip({ kind: 'quote', text: 'Point-in-time recovery, 100% of the time', tags: ['infra'] }, t0);
  const b = buildClip({ kind: 'table', table: '| a | b |\n|---|---|\n| 1 | 2 |' }, new Date('2026-09-02T00:00:00Z'));
  await store.add('u1', a);
  await store.add('u1', b);
  await store.add('u2', buildClip({ kind: 'quote', text: 'recovery for someone else' }));
  await store.add('literal_owner', buildClip({ kind: 'quote', text: '100 days' }));
  assert.deepEqual(await store.list('literal_owner', { query: '100%' }), [], 'full-text parser must not strip literal percent');

  assert.deepEqual((await store.get('u1', b.id))?.data, b.data);
  assert.equal(await store.get('u2', a.id), undefined, 'scoped by user');
  assert.deepEqual((await store.list('u1')).map((c) => c.id), [b.id, a.id], 'newest first');
  assert.equal((await store.list('u1'))[0]!.hasOwnProperty('data'), false, 'lists carry no content');
  assert.deepEqual((await store.list('u1', { query: 'RECOVERY time' })).map((c) => c.id), [a.id]);
  assert.deepEqual((await store.list('u1', { query: '100%' })).map((c) => c.id), [a.id], 'wildcards match literally');
  assert.equal((await store.list('u1', { query: '_' })).length, 0);
  assert.deepEqual((await store.list('u1', { tag: '#Infra' })).map((c) => c.id), [a.id]);
  assert.deepEqual((await store.list('u1', { kind: 'table' })).map((c) => c.id), [b.id]);
  assert.deepEqual((await store.list('u1', { before: b.createdAt })).map((c) => c.id), [a.id]);

  const updated = await store.update('u1', a.id, { title: 'PITR', tags: ['ops'] });
  assert.equal(updated?.title, 'PITR');
  assert.deepEqual((await store.list('u1', { tag: 'ops' })).map((c) => c.title), ['PITR']);
  assert.equal(await store.update('u2', a.id, { title: 'stolen' }), undefined);
  assert.equal(await store.delete('u2', a.id), false);
  assert.deepEqual(await store.usage('u1'), { count: 2, bytes: updated!.bytes + b.bytes });
  assert.equal(await store.delete('u1', a.id), true);

  const cap = CLIP_LIMITS.bytesPerUser;
  (CLIP_LIMITS as any).bytesPerUser = 10;
  try {
    await assert.rejects(store.add('u1', buildClip({ kind: 'quote', text: 'over' })), ClipError);
  } finally {
    (CLIP_LIMITS as any).bytesPerUser = cap;
  }
});

test('pg deletion: a profile (and its kept corrupt copies) and all clips of one user', { skip }, async () => {
  const { buildClip } = await import('../src/clips.ts');
  const { PgClipStore } = await import('../src/db.ts');
  const profiles = new PgProfileStore(db);
  const clips = new PgClipStore(db);
  await profiles.put('del_1', validateProfile({ ...defaultProfile(), name: 'Doomed' }));
  await profiles.put('keep', validateProfile({ ...defaultProfile(), name: 'Kept' }));
  await db.query(`INSERT INTO mcportal_kv (key, value) VALUES ('corrupt-profile:del_1:1', '{}'), ('corrupt-profile:del%1:1', '{}')`);
  await clips.add('del_1', buildClip({ kind: 'quote', text: 'a' }));
  await clips.add('del_1', buildClip({ kind: 'quote', text: 'b' }));
  await clips.add('keep', buildClip({ kind: 'quote', text: 'c' }));
  await profiles.delete('del_1');
  assert.equal(await clips.deleteAll('del_1'), 2);
  assert.equal((await profiles.versioned('del_1')).rev, 0);
  assert.equal((await profiles.get('keep')).name, 'Kept');
  assert.equal((await clips.list('keep')).length, 1);
  const kv = await db.query<{ key: string }>(`SELECT key FROM mcportal_kv WHERE key LIKE 'corrupt-profile:del%' ORDER BY key`);
  assert.deepEqual(kv.rows.map((r) => r.key), ['corrupt-profile:del%1:1'], 'the LIKE pattern is escaped: only del_1\'s copies go');
});

test('pg social: shares, feed rules, relations, hiding, reports, forget; schema version recorded', { skip }, async () => {
  const { PgSocialStore } = await import('../src/db.ts');
  const { Social } = await import('../src/social.ts');
  const { PublicProfiles } = await import('../src/public-profiles.ts');
  const { memoryPersistence } = await import('../src/accounts.ts');
  const { SCHEMA_VERSION } = await import('../src/db/schema.ts');
  const version = await db.query<{ value: string }>(`SELECT value FROM mcportal_meta WHERE key = 'schema_version'`);
  assert.equal(version.rows[0]!.value, SCHEMA_VERSION, 'ensureSchema records the current version');
  let now = Date.parse('2026-10-01T00:00:00Z');
  const profiles = new PublicProfiles(memoryPersistence());
  for (const [id, handle] of [['pa', 'pg_alice'], ['pb', 'pg_bob'], ['pc', 'pg_carol']]) await profiles.set(id!, { handle });
  const store = new PgSocialStore(db);
  const social = new Social({ store, profiles, now: () => (now += 1000) });
  for (let i = 0; i < 45; i++) await social.share('pa', { kind: 'link', title: `f${i}`, url: `https://example.com/${i}` });
  const pub = await social.share('pa', { kind: 'link', title: 'public', url: 'https://example.com/p', audience: 'mcportal' });
  await social.follow('pb', 'pg_alice');
  const first = await social.feed('pb', { limit: 30 });
  assert.equal(first.length, 30);
  assert.equal(first[0]!.title, 'public');
  const second = await social.feed('pb', { limit: 30, before: first[29]!.createdAt });
  assert.equal(second.length, 16, 'paging reaches the rest');
  assert.equal(await social.get('pc', first[1]!.id), undefined);
  assert.equal((await social.get('pc', pub.id))?.title, 'public');
  await store.setHidden(pub.id, new Date(now).toISOString());
  assert.equal(await social.get('pc', pub.id), undefined);
  assert.ok((await social.get('pa', pub.id))?.hiddenAt);
  assert.equal(await store.relate('follows', 'pb', 'pa'), false, 'follows are unique');
  await social.block('pa', 'pg_bob', true);
  assert.deepEqual(await store.outgoing('follows', 'pb'), []);
  const r = await social.report('pc', { shareId: (await social.sharesOf('pc', 'pa'))[0]?.id ?? pub.id }, 'x').catch(() => social.report('pc', { handle: 'pg_alice' }, 'x'));
  const resolved = await social.resolveReport(r.id, 'admin:t', 'dismissed');
  assert.equal(resolved?.status, 'resolved');
  await social.forget('pc');
  assert.equal((await store.reports())[0]!.reporterId, 'deleted');
  await social.forget('pa');
  assert.equal(await store.countShares('pa'), 0);
  assert.deepEqual(await store.outgoing('blocks', 'pa'), []);
});


test('pg reading: concurrent incremental events, restart, isolation, import and deletion', { skip }, async () => {
  const { PgReadingStore } = await import('../src/db.ts');
  const store = new PgReadingStore(db);
  const url = 'https://example.com/docs';
  await store.record('reader', { url, status: 'opened', anchor: { heading: 'Install', block: 2 }, progress: 0.3 });
  await Promise.all(Array.from({ length: 10 }, () => new PgReadingStore(db).record('reader', { url: url + '#heading', status: 'seen' })));
  const restarted = new PgReadingStore(db);
  assert.equal((await restarted.get('reader', url))?.progress, 0.3);
  assert.equal((await restarted.get('reader', url))?.status, 'opened');
  await store.record('reader', { url, status: 'read' });
  assert.deepEqual(await restarted.list('reader', { unfinished: true }), []);
  await store.record('reader', { url, status: 'opened', anchor: null });
  assert.equal((await restarted.get('reader', url))?.readAt, undefined);
  assert.equal((await restarted.get('reader', url))?.anchor, undefined);
  assert.equal(await store.import('reader2', await store.list('reader')), 1);
  assert.equal(await store.import('reader2', await store.list('reader')), 0);
  await store.deleteAll('reader');
  assert.deepEqual(await store.list('reader'), []);
  assert.equal((await store.list('reader2')).length, 1);
});

test('pg clips: full-text ranking, literal fallback, generated updates and v8 backfill', { skip }, async () => {
  const { buildClip } = await import('../src/clips.ts');
  const { PgClipStore } = await import('../src/db.ts');
  const store = new PgClipStore(db);
  const title = buildClip({ kind: 'quote', title: 'Backup strategy', text: 'Snapshots keep the system safe', tags: ['infra'] }, new Date('2026-09-01'));
  const body = buildClip({ kind: 'quote', title: 'Incident note', text: 'Store backups every day', tags: ['ops'] }, new Date('2026-09-02'));
  await store.add('fts_owner', title);
  await store.add('fts_owner', body);
  await store.add('fts_other', buildClip({ kind: 'quote', title: 'Backup secret', text: 'Private' }));

  // Recreate a genuine v8 table with data but no vector, then migrate twice.
  await db.query('ALTER TABLE mcportal_clips DROP COLUMN search_vector');
  await db.query(`UPDATE mcportal_meta SET value = '8' WHERE key = 'schema_version'`);
  await ensureSchema(db);
  await ensureSchema(db);
  const indexed = await db.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'mcportal_clips_search'`, [schema]);
  assert.match(indexed.rows[0]!.indexdef, /USING gin \(search_vector\)/i);
  assert.deepEqual((await store.list('fts_owner', { query: 'backups' })).map((c) => c.id), [title.id, body.id], 'stems match and title relevance outranks recency');
  assert.deepEqual((await store.list('fts_owner', { query: 'back' })).map((c) => c.id), [body.id, title.id], 'literal substring matches remain newest first');
  assert.deepEqual((await store.list('fts_owner', { query: 'the' })).map((c) => c.id), [title.id], 'stopword-only queries retain literal semantics');
  assert.deepEqual((await store.list('fts_owner', { query: 'backups', tag: 'ops' })).map((c) => c.id), [body.id]);
  assert.deepEqual((await store.list('fts_owner', { query: 'backups', before: body.createdAt, limit: 1 })).map((c) => c.id), [title.id]);
  assert.deepEqual((await store.list('fts_other', { query: 'backup' })).map((c) => c.title), ['Backup secret'], 'no other user results');

  await store.update('fts_owner', title.id, { title: 'Disaster recovery', note: 'Rehearsing restores' });
  assert.deepEqual((await store.list('fts_owner', { query: 'backups' })).map((c) => c.id), [body.id], 'generated vector removes old title');
  assert.deepEqual((await store.list('fts_owner', { query: 'restore' })).map((c) => c.id), [title.id], 'updated note is indexed');
  assert.deepEqual((await store.get('fts_owner', title.id))?.data, title.data, 'migration leaves content intact');
});
