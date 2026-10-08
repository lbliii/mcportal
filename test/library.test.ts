import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildClip, FileClipStore } from '../src/clips.ts';
import { searchLibrary } from '../src/library.ts';
import { defaultProfile } from '../src/profile.ts';
import { FileReadingStore } from '../src/reading.ts';
import { MemoryProfileStore } from '../src/store.ts';

test('Recall merges saved/history, searches retained bodies, ranks titles and keeps URL selectors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-recall-'));
  try {
    const store = new MemoryProfileStore({ alice: { ...defaultProfile(), saved: [
      { url: 'https://example.com/guide?mode=one#section', title: 'Heartbeat guide', note: 'Persistence', savedAt: '2026-01-01T00:00:00Z' },
      { url: 'https://example.com/guide?mode=two', title: 'Other guide', savedAt: '2026-01-01T00:00:00Z' },
    ] } });
    const clips = new FileClipStore(dir), reading = new FileReadingStore(dir);
    const old = buildClip({ kind: 'quote', text: 'A retained passage '.repeat(80) + 'heartbeat', title: 'Persistence', tags: ['memory'], source: { kind: 'article', url: 'https://example.com/guide?mode=one' } });
    await clips.add('alice', old);
    for (let i = 0; i < 60; i++) await clips.add('alice', buildClip({ kind: 'note', markdown: `Unrelated note ${i}` }));
    await reading.record('alice', { url: 'https://example.com/guide?mode=one#different', status: 'opened', title: 'Guide', progress: .3 });
    await reading.record('alice', { url: 'https://example.com/seen', status: 'seen', title: 'Heartbeat never opened' });
    const sources = { store, clips: new FileClipStore(dir), reading: new FileReadingStore(dir) };
    const found = await searchLibrary('alice', { query: 'heartbeat' }, sources);
    assert.equal(found.total, 2);
    assert.equal(found.hits[0]!.saved, true);
    assert.equal(found.hits[0]!.reading?.progress, .3);
    assert.equal(found.hits[0]!.url, 'https://example.com/guide?mode=one');
    assert.equal(found.hits[1]!.clipId, old.id, 'old full-body match outside preview and first clip page');
    assert.deepEqual(found.hits[1]!.matched, ['Clip text']);
    assert.equal((await searchLibrary('alice', { kind: 'saved' }, sources)).total, 2, 'query parameters distinguish documents');
    assert.equal((await searchLibrary('alice', { tag: 'memory', site: 'example.com' }, sources)).hits[0]!.clipId, old.id);
    assert.equal((await searchLibrary('alice', { status: 'seen' }, sources)).total, 1);
    assert.equal((await searchLibrary('bob', { query: 'heartbeat' }, sources)).total, 0, 'caller data only');
    await clips.delete('alice', old.id);
    assert.equal((await searchLibrary('alice', { query: 'heartbeat', kind: 'quote' }, sources)).total, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Recall pagination is deterministic across kinds, and empty queries show recent retained material', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-recall-pages-'));
  try {
    const clips = new FileClipStore(dir), reading = new FileReadingStore(dir), store = new MemoryProfileStore();
    for (let i = 0; i < 8; i++) {
      await clips.add('u', buildClip({ kind: 'note', markdown: `heartbeat ${i}`, title: `Heartbeat ${i}` }));
      await reading.record('u', { url: `https://example.com/${i}`, title: `Heartbeat ${i}`, status: 'opened' });
    }
    const sources = { store, clips, reading };
    const all = await searchLibrary('u', { query: 'heartbeat', limit: 50 }, sources);
    const first = await searchLibrary('u', { query: 'heartbeat', limit: 7 }, sources);
    const second = await searchLibrary('u', { query: 'heartbeat', limit: 7, offset: first.nextOffset! }, sources);
    const third = await searchLibrary('u', { query: 'heartbeat', limit: 7, offset: second.nextOffset! }, sources);
    assert.deepEqual([...first.hits, ...second.hits, ...third.hits], all.hits);
    assert.equal(third.nextOffset, null);
    assert.equal((await searchLibrary('u', {}, sources)).total, 16);
    await assert.rejects(searchLibrary('u', { limit: 51 }, sources), /limit/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
