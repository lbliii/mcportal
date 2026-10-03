import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';

test('cache peek: freshness and eviction are authoritative without extending retention', async () => {
  let now = 1000;
  const cache = new TtlCache({ maxEntries: 2, now: () => now });
  assert.equal(cache.peek('absent'), undefined);
  await cache.get('first', 2, async () => ({ body: 'one' }));
  now = 2000;
  assert.deepEqual(cache.peek('first'), { value: { body: 'one' }, cached: true, fetchedAt: new Date(1000).toISOString() });
  now = 3000;
  assert.equal(cache.peek('first'), undefined, 'peek never extends freshness');
  await cache.get('first', 20, async () => ({ body: 'new' }));
  await cache.get('second', 20, async () => ({ body: 'two' }));
  cache.peek('first');
  await cache.get('third', 20, async () => ({ body: 'three' }));
  assert.equal(cache.peek('first'), undefined, 'peek never changes oldest-first eviction');
  assert.equal(cache.peek<{ body: string }>('second')?.value.body, 'two');
});
