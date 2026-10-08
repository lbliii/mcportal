/** Real, independent Postgres connections: pause one read to force competing writes. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { buildClip, CLIP_LIMITS, patchClip, summaryOf, type Clip } from '../src/clips.ts';
import { connect, ensureSchema, PgClipStore, type Queryable } from '../src/db.ts';

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run Postgres tests';
const schema = `mcportal_clip_quota_${process.pid}_${Date.now()}`;
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
  await db?.end?.();
  await admin?.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin?.end?.();
});

/** Seed quota accounting directly, without allocating 50 MB of irrelevant content. */
async function seed(user: string, count: number, bytes: number): Promise<void> {
  const clip = buildClip({ kind: 'quote', text: 'Quota fixture' });
  await db.query(`INSERT INTO mcportal_clips
    (id, user_id, kind, title, data, summary, bytes, created_at, updated_at)
    SELECT $1 || '-' || n, $1, $2, $3, $4, $5, $6, $7, $7 FROM generate_series(1, $8) n`,
  [user, clip.kind, clip.title, JSON.stringify(clip.data), JSON.stringify(summaryOf(clip)), bytes, clip.createdAt, count]);
}

type Write = (store: PgClipStore) => Promise<Clip | undefined>;

function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/**
 * Hold the first write after its real read; the other connection either finishes
 * (the old race) or waits on a database lock. Release only after observing that
 * competing operation, so success never depends on lucky request scheduling.
 */
async function raceWrites(first: Write, second: Write, read = /SELECT count\(\*\)/, independent = false) {
  const a = await db.connect!();
  const b = await db.connect!();
  await a.query("SET statement_timeout = '10s'");
  await b.query("SET statement_timeout = '10s'");
  const { rows: [{ pid } = { pid: 0 }] } = await b.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const reached = signal();
  const resume = signal();
  let held = false;
  const clientA: Queryable & { release(): void } = {
    async query<R>(sql: string, values?: unknown[]) {
      const result = await a.query<R>(sql, values);
      if (!held && read.test(sql)) {
        held = true;
        reached.resolve();
        await resume.promise;
      }
      return result;
    },
    release() {}, // The harness releases both dedicated connections in finally.
  };
  const clientB = { query: b.query.bind(b), release() {} };
  const store = (client: typeof clientA) => new PgClipStore({
    query: client.query.bind(client), connect: async () => client,
  });
  const pending: Array<Promise<PromiseSettledResult<Clip | undefined>>> = [];
  const settle = async (write: Promise<Clip | undefined>) => (await Promise.allSettled([write]))[0]!;
  try {
    pending.push(settle(first(store(clientA))));
    await Promise.race([
      reached.promise,
      pending[0]!.then(() => { throw new Error('first write finished before the read barrier'); }),
    ]);
    let finished = false;
    pending.push(settle(second(store(clientB))).then(result => { finished = true; return result; }));
    const deadline = Date.now() + 5_000;
    let blocked = false;
    while (!finished && Date.now() < deadline) {
      const { rows } = await db.query<{ waiting: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted) AS waiting', [pid]);
      blocked = rows[0]!.waiting;
      if (blocked) break;
      await delay(10);
    }
    assert.ok(finished || blocked, 'observed the competing write finish or wait on a real database lock');
    if (independent) assert.ok(finished, 'a different account finishes while the first account is paused');
    resume.resolve();
    return await Promise.all(pending);
  } finally {
    resume.resolve();
    await Promise.all(pending);
    a.release();
    b.release();
  }
}

function oneRefused(results: Array<PromiseSettledResult<Clip | undefined>>): void {
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, 'only one write fits');
  const refused = results.find(r => r.status === 'rejected');
  assert.ok(refused?.status === 'rejected');
  assert.equal(refused.reason.code, 'limit_exceeded');
}

test('pg clip quota: concurrent creates cannot exceed the count cap', { skip }, async () => {
  const user = 'count-race';
  await seed(user, CLIP_LIMITS.perUser - 1, 1);
  const clips = [buildClip({ kind: 'quote', text: 'A' }), buildClip({ kind: 'quote', text: 'B' })];
  oneRefused(await raceWrites(s => s.add(user, clips[0]!), s => s.add(user, clips[1]!)));
  const store = new PgClipStore(db);
  assert.equal((await store.usage(user)).count, CLIP_LIMITS.perUser);
  assert.equal((await Promise.all(clips.map(c => store.get(user, c.id)))).filter(Boolean).length, 1);
});

test('pg clip quota: concurrent creates cannot exceed the byte cap', { skip }, async () => {
  const user = 'byte-race';
  const clips = [buildClip({ kind: 'quote', text: 'A' }), buildClip({ kind: 'quote', text: 'B' })];
  assert.equal(clips[0]!.bytes, clips[1]!.bytes);
  await seed(user, 1, CLIP_LIMITS.bytesPerUser - clips[0]!.bytes);
  oneRefused(await raceWrites(s => s.add(user, clips[0]!), s => s.add(user, clips[1]!)));
  const store = new PgClipStore(db);
  assert.deepEqual(await store.usage(user), { count: 2, bytes: CLIP_LIMITS.bytesPerUser });
  assert.equal((await Promise.all(clips.map(c => store.get(user, c.id)))).filter(Boolean).length, 1);
});

test('pg clip quota: edits and creates share the byte budget', { skip }, async () => {
  const user = 'mixed-race';
  const store = new PgClipStore(db);
  const existing = await store.add(user, buildClip({ kind: 'quote', text: 'Existing' }));
  const incoming = buildClip({ kind: 'quote', text: 'Incoming' });
  await seed(user, 1, CLIP_LIMITS.bytesPerUser - existing.bytes - incoming.bytes);
  oneRefused(await raceWrites(s => s.add(user, incoming), s => s.update(user, existing.id, { note: 'Larger' })));
  assert.deepEqual(await store.get(user, existing.id), existing, 'refused edits leave all metadata intact');
  assert.equal((await store.usage(user)).bytes, CLIP_LIMITS.bytesPerUser);
});

test('pg clip quota: concurrent growing edits cannot exceed the byte cap', { skip }, async () => {
  const user = 'update-race';
  const store = new PgClipStore(db);
  const clips = await Promise.all(['A', 'B'].map(text => store.add(user, buildClip({ kind: 'quote', text }))));
  const patch = { note: 'More context' };
  const growth = patchClip(clips[0]!, patch).bytes - clips[0]!.bytes;
  await seed(user, 1, CLIP_LIMITS.bytesPerUser - clips.reduce((sum, c) => sum + c.bytes, 0) - growth);
  oneRefused(await raceWrites(s => s.update(user, clips[0]!.id, patch), s => s.update(user, clips[1]!.id, patch), /SELECT summary, data/));
  assert.equal((await store.usage(user)).bytes, CLIP_LIMITS.bytesPerUser);
  const actual = await Promise.all(clips.map(c => store.get(user, c.id)));
  assert.equal(actual.filter(c => c?.note === patch.note).length, 1);
});

test('pg clip quota: account locks are independent and concurrent patches are preserved', { skip }, async () => {
  const clip = buildClip({ kind: 'quote', text: 'Original' });
  const independent = await raceWrites(s => s.add('first-account', clip),
    s => s.add('second-account', buildClip({ kind: 'quote', text: 'Other' })), undefined, true);
  assert.ok(independent.every(r => r.status === 'fulfilled'));
  const results = await raceWrites(s => s.update('first-account', clip.id, { title: 'New title' }),
    s => s.update('first-account', clip.id, { tags: ['preserved'] }), /SELECT summary, data/);
  assert.ok(results.every(r => r.status === 'fulfilled'));
  const actual = await new PgClipStore(db).get('first-account', clip.id);
  assert.equal(actual?.title, 'New title');
  assert.deepEqual(actual?.tags, ['preserved']);
});

test('pg clip quota: an insert error rolls back and releases the account lock', { skip }, async () => {
  const store = new PgClipStore(db);
  const clip = await store.add('rollback', buildClip({ kind: 'quote', text: 'Original' }));
  await assert.rejects(store.add('rollback', clip), { code: '23505' });
  assert.deepEqual(await store.usage('rollback'), { count: 1, bytes: clip.bytes });
  await store.add('rollback', buildClip({ kind: 'quote', text: 'Still usable' }));
  assert.equal(await store.deleteAll('rollback'), 2);
});
