import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { loadArticle } from '../src/sources.ts';

test('reader cache refreshes legacy extractions and reuses structured content across accounts', async () => {
  const url = 'https://yashgarg.dev/posts/hijacking-ps5-rtmp-stream/';
  const cache = new TtlCache();
  await cache.get(`reader:${url}`, 3600, async () => ({ finalUrl: url, title: 'Old extraction', blocks: [], wordCount: 0 }));
  const calls: string[] = [];
  const fetcher = createFixtureFetcher(calls);
  const first = await loadArticle(url, { cache, fetcher });
  assert.notEqual(first.title, 'Old extraction');
  assert.ok(first.blocks.length > 0);
  const fetchCount = calls.length;
  assert.ok(fetchCount > 0);
  const second = await loadArticle(url, { cache, fetcher });
  assert.equal(calls.length, fetchCount);
  assert.deepEqual(second, first);
  assert.equal('cached' in first.provenance, false);
  assert.equal('fetchedAt' in first.provenance, false);
});
