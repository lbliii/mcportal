import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { connect, ensureSchema, PgSocialStore } from '../src/db.ts';
import type { Report } from '../src/social.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('Postgres report exports read only the filing account and include more than one admin-page worth', { skip: !databaseUrl && 'set TEST_DATABASE_URL to run Postgres tests' }, async () => {
  const schema = `mcportal_privacy_${randomUUID().replaceAll('-', '')}`;
  const admin = await connect(databaseUrl!);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = await connect(databaseUrl!, { searchPath: schema });
  try {
    await ensureSchema(db);
    const store = new PgSocialStore(db);
    for (let i = 0; i < 215; i++) {
      const report: Report = { id: `report-${i}`, reporterId: i % 2 ? 'alice' : 'bob', targetKind: 'share', targetId: 'share', reason: `reason ${i}`, status: i % 3 ? 'open' : 'resolved', createdAt: new Date(i * 1000).toISOString() };
      await store.addReport(report);
    }
    const alice = await store.reportsFiled('alice');
    assert.equal(alice.length, 107);
    assert.ok(alice.every((r) => r.reporterId === 'alice'));
    assert.ok(alice.some((r) => r.status === 'resolved'));
    assert.deepEqual(await store.reportsFiled('nobody'), []);
    await store.forget('alice', new Date().toISOString());
    assert.deepEqual(await store.reportsFiled('alice'), [], 'anonymized reports no longer belong to the deleted account');
    assert.equal((await store.reportsFiled('bob')).length, 108);
  } finally {
    await db.end?.();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end?.();
  }
});
