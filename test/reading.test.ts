import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileReadingStore, canonicalReadingUrl, nextReading } from '../src/reading.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { buildExport, importExport, parseExport } from '../src/portability.ts';
import { READING_TOOLS } from '../src/reading-tools.ts';
import { TtlCache } from '../src/lib/cache.ts';

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-reading-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, reading: new FileReadingStore(dir) };
}
test('canonical URL removes fragment, normalizes host/default port, preserves meaningful queries', () => {
  assert.equal(canonicalReadingUrl('https://EXAMPLE.com:443/a?q=1#heading'), 'https://example.com/a?q=1');
  assert.notEqual(canonicalReadingUrl('https://example.com/a?q=1'), canonicalReadingUrl('https://example.com/a?q=2'));
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'file:///tmp/a']) assert.throws(() => canonicalReadingUrl(url));
});
test('explicit events distinguish visibility, opening and completion', () => {
  const url = 'https://example.com/docs';
  const seen = nextReading(undefined, { url, status: 'seen' });
  assert.equal(seen.lastOpenedAt, undefined);
  const opened = nextReading(seen, { url, status: 'opened', progress: 1, anchor: { heading: 'Installation', block: 4 } });
  assert.equal(opened.status, 'opened');
  assert.equal(opened.readAt, undefined);
  const read = nextReading(opened, { url, status: 'read' });
  assert.equal(read.status, 'read');
  assert.ok(read.readAt);
  const againSeen = nextReading(read, { url, status: 'seen' });
  assert.equal(againSeen.status, 'read');
  assert.deepEqual(againSeen.anchor, opened.anchor);
  const reopened = nextReading(read, { url, status: 'opened', anchor: null, progress: 0.2 });
  assert.equal(reopened.readAt, undefined);
  assert.equal(reopened.anchor, undefined);
  assert.throws(() => nextReading(undefined, { url, status: 'opened', progress: 2 }));
  assert.throws(() => nextReading(undefined, { url, status: 'seen', progress: 0.5 }));
});
test('file restart, user isolation, unfinished list, concurrent events and account deletion', async t => {
  const { dir, reading } = await fixture(t);
  await reading.record('a/b', { url: 'https://example.com/a#x', status: 'opened', anchor: { block: 9 } });
  await reading.record('a_b', { url: 'https://example.com/a', status: 'read' });
  await Promise.all(Array.from({ length: 12 }, (_, i) => reading.record('a/b', { url: `https://example.com/${i}`, status: 'seen' })));
  const restarted = new FileReadingStore(dir);
  assert.equal((await restarted.get('a/b', 'https://example.com/a#y'))?.anchor?.block, 9);
  assert.equal((await restarted.get('a_b', 'https://example.com/a'))?.status, 'read');
  assert.equal((await restarted.list('a/b', { limit: 1000 })).length, 13);
  assert.equal((await restarted.list('a/b', { unfinished: true })).length, 1);
  await restarted.deleteAll('a/b');
  assert.deepEqual(await restarted.list('a/b'), []);
  assert.equal((await restarted.list('a_b')).length, 1);
});
test('export/import includes validated reading records without overwriting existing position', async t => {
  const { reading } = await fixture(t);
  const store = new MemoryProfileStore();
  await reading.record('a', { url: 'https://example.com/doc', status: 'opened', progress: 0.4 });
  const data = parseExport((await buildExport('mcportal', 'a', { reading, store })).body.toString());
  await importExport(data, 'b', { reading, store });
  assert.equal((await reading.get('b', 'https://example.com/doc'))?.progress, 0.4);
  await reading.record('b', { url: 'https://example.com/doc', status: 'read' });
  await importExport(data, 'b', { reading, store });
  assert.equal((await reading.get('b', 'https://example.com/doc'))?.status, 'read');
  await assert.rejects(reading.import('c', [{ ...data.reading![0], url: 'file:///etc/passwd' }]));
  assert.deepEqual(await reading.list('c'), []);
});
test('tools return scoped structured contract and unfinished excludes seen/completed', async t => {
  const { reading } = await fixture(t);
  const ctx = { reading, store: new MemoryProfileStore(), userId: 'a', fetcher: async () => { throw new Error('No network expected'); }, cache: new TtlCache() };
  const record = READING_TOOLS.find(t => t.name === 'record_reading')!;
  assert.equal((await record.handler({ url: 'https://example.com', status: 'opened' }, ctx)).isError, undefined);
  await record.handler({ url: 'https://example.com/seen', status: 'seen' }, ctx);
  const result = await READING_TOOLS.find(t => t.name === 'list_reading')!.handler({}, ctx);
  assert.equal((result.structuredContent!.reading as unknown[]).length, 1);
  assert.equal((await record.handler({ url: 'https://example.com', status: 'opened', anchor: { block: -1 } }, ctx)).isError, true);
});

test('retention and resume list are bounded; newest opened survives eviction', async t => {
  const { reading } = await fixture(t);
  const states = Array.from({ length: 1000 }, (_, i) => nextReading(undefined, { url: `https://example.com/doc/${i}`, status: 'opened' }, new Date(1700000000000 + i * 1000).toISOString()));
  assert.equal(await reading.import('a', states), 1000);
  assert.equal((await reading.list('a', { unfinished: true, limit: 3 })).length, 3);
  await reading.record('a', { url: 'https://example.com/new', status: 'opened' });
  assert.equal((await reading.list('a', { limit: 1000 })).length, 1000);
  assert.equal(await reading.get('a', states[0]!.url), undefined);
  assert.ok(await reading.get('a', 'https://example.com/new'));
});
