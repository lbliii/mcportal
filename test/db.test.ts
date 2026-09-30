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
  assert.equal(await store.rev('nobody'), 0);

  const p = validateProfile({ ...defaultProfile(), name: 'Mine', onboarded: true, saved: [{ url: 'https://example.com/a', title: 'A' }] });
  await store.put('u1', p);
  assert.equal(await store.rev('u1'), 1);
  const back = await store.get('u1');
  assert.equal(back.name, 'Mine');
  assert.equal(back.saved[0]!.url, 'https://example.com/a');
  assert.equal(back.onboarded, true);

  await store.put('u1', { ...back, layout: 'shelves' });
  assert.equal(await store.rev('u1'), 2);
  assert.equal((await store.get('u1')).layout, 'shelves');
});

test('pg profiles: concurrent writes all land, last one wins, rev counts every write', { skip }, async () => {
  const store = new PgProfileStore(db);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.put('busy', { ...defaultProfile(), name: `v${i}` })));
  assert.equal(await store.rev('busy'), 20);
  assert.match((await store.get('busy')).name, /^v\d+$/);
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

test('pg clips: round-trip, search, tags, paging, isolation, limits, schema v2', { skip }, async () => {
  const { buildClip, ClipError, CLIP_LIMITS } = await import('../src/clips.ts');
  const { PgClipStore } = await import('../src/db.ts');
  const store = new PgClipStore(db);
  // A v1 database (what production had) is upgraded in place.
  await db.query(`UPDATE mcportal_meta SET value = '1' WHERE key = 'schema_version'`);
  await ensureSchema(db);
  const version = await db.query<{ value: string }>(`SELECT value FROM mcportal_meta WHERE key = 'schema_version'`);
  assert.equal(version.rows[0]!.value, '2');

  const t0 = new Date('2026-09-01T00:00:00Z');
  const a = buildClip({ kind: 'quote', text: 'Point-in-time recovery, 100% of the time', tags: ['infra'] }, t0);
  const b = buildClip({ kind: 'table', table: '| a | b |\n|---|---|\n| 1 | 2 |' }, new Date('2026-09-02T00:00:00Z'));
  await store.add('u1', a);
  await store.add('u1', b);
  await store.add('u2', buildClip({ kind: 'quote', text: 'recovery for someone else' }));

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
