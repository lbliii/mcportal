import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildClip, FileClipStore } from '../src/clips.ts';
import { FileCollectionStore } from '../src/collections.ts';
import { changeCollection, collectionData } from '../src/collection-service.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { buildExport, importExport, parseExport } from '../src/portability.ts';
import { defaultProfile } from '../src/profile.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

test('private desks persist, cite actual evidence, separate membership and trail completion from clips', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-desks-'));
  try {
    const clips = new FileClipStore(dir), collections = new FileCollectionStore(dir), store = new MemoryProfileStore({ alice: { ...defaultProfile(), onboarded: true } });
    const ctx: ToolContext = { userId: 'alice', clips, collections, store, fetcher: createFixtureFetcher(), cache: new TtlCache() };
    const clip = buildClip({ kind: 'quote', text: 'A heartbeat resumes work.', source: { kind: 'article', url: 'https://example.com/heartbeat', locator: { text: 'A heartbeat resumes work.', block: 5 } } });
    await clips.add('alice', clip);
    const created = (await changeCollection({ action: 'create', title: 'Agents that remember', purpose: 'How work resumes', entries: [{ ref: `clip:${clip.id}`, title: clip.title, excerpt: 'An unwanted shadow copy' }, { ref: 'url:https://example.com/intro#where', title: 'Introduction' }], livePortals: ['hn-top'] }, ctx))!;
    assert.equal(created.entries[0]!.excerpt, undefined);
    assert.equal(created.entries[0]!.url, clip.source.url);
    assert.equal(created.entries[1]!.ref, 'url:https://example.com/intro');
    const restarted = new FileCollectionStore(dir);
    assert.deepEqual(await restarted.get('alice', created.id), created);
    assert.equal(await restarted.get('bob', created.id), undefined);
    await assert.rejects(changeCollection({ action: 'add', id: created.id, entries: [{ ref: `clip:${clip.id}`, title: 'Stolen' }] }, { ...ctx, userId: 'bob' }), { code: 'not_found' });
    await assert.rejects(changeCollection({ action: 'orientation', id: created.id, orientation: { text: 'A claim', refs: ['url:https://example.com/invented'] } }, ctx), /current collection evidence/);
    await changeCollection({ action: 'orientation', id: created.id, orientation: { text: 'Start with the retained explanation.', refs: [`clip:${clip.id}`] } }, ctx);
    assert.equal((await collectionData(created.id, ctx)).orientationStale, false);
    await changeCollection({ action: 'edit', id: created.id, kind: 'trail' }, ctx);
    await changeCollection({ action: 'complete', id: created.id, refs: [`clip:${clip.id}`], completed: true }, ctx);
    const trail = (await restarted.get('alice', created.id))!;
    assert.ok(trail.entries[0]!.completedAt);
    await changeCollection({ action: 'complete', id: created.id, refs: [`clip:${clip.id}`], completed: true, skipped: true }, ctx);
    assert.equal((await restarted.get('alice', created.id))!.entries[0]!.completion, 'skipped');
    assert.ok(await clips.get('alice', clip.id), 'completion does not remove content');
    await changeCollection({ action: 'reorder', id: created.id, refs: trail.entries.map(e => e.ref).reverse() }, ctx);
    await assert.rejects(changeCollection({ action: 'reorder', id: created.id, refs: [`clip:${clip.id}`] }, ctx), /every|exactly once/);
    await clips.delete('alice', clip.id);
    const missing = await collectionData(created.id, ctx);
    assert.deepEqual(missing.unavailableRefs, [`clip:${clip.id}`]);
    assert.equal(missing.orientationStale, true);
    assert.equal(missing.collection.entries.find(e => e.ref.startsWith('clip:'))!.excerpt, undefined, 'deleted clips leave no copied body');
    await changeCollection({ action: 'remove', id: created.id, refs: [`clip:${clip.id}`] }, ctx);
    assert.equal((await store.get('alice')).columns[0]!.panels[0]!.id, 'hn-top', 'membership removal leaves room layout');
    await restarted.deleteAll('alice');
    assert.deepEqual(await collections.list('alice'), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('collection export/import remaps clip citations and live sources without changing the destination room', async () => {
  const fromDir = await mkdtemp(path.join(tmpdir(), 'mcportal-collection-from-'));
  const toDir = await mkdtemp(path.join(tmpdir(), 'mcportal-collection-to-'));
  try {
    const from = { store: new MemoryProfileStore(), clips: new FileClipStore(fromDir), collections: new FileCollectionStore(fromDir) };
    const clip = buildClip({ kind: 'quote', text: 'Keep the actual evidence.' });
    await from.clips.add('alice', clip);
    const desk = (await from.collections.change('alice', { action: 'create', title: 'Evidence', entries: [{ ref: `clip:${clip.id}`, title: clip.title }], livePortals: ['hn-top'], orientation: { text: 'Read this passage.', refs: [`clip:${clip.id}`] } }))!;
    const original = defaultProfile();
    const to = { store: new MemoryProfileStore({ bob: { ...original, name: 'Existing room', onboarded: true } }), clips: new FileClipStore(toDir), collections: new FileCollectionStore(toDir) };
    const data = parseExport((await buildExport('mcportal', 'alice', from)).body.toString());
    assert.equal(data.collections!.length, 1);
    const result = await importExport(data, 'bob', to);
    assert.equal(result.collectionsAdded, 1);
    const imported = (await to.collections.get('bob', desk.id))!;
    const newId = (await to.clips.list('bob'))[0]!.id;
    assert.notEqual(newId, clip.id);
    assert.equal(imported.entries[0]!.ref, `clip:${newId}`);
    assert.deepEqual(imported.orientation!.refs, [`clip:${newId}`]);
    assert.deepEqual(imported.livePortals, ['hn-top']);
    assert.equal((await to.store.get('bob')).name, 'Existing room');
    assert.equal((await importExport(data, 'bob', to)).collectionsAdded, 0, 'reimport adds no duplicate desk');
    assert.equal((await to.clips.usage('bob')).count, 1);
    assert.deepEqual((await new FileCollectionStore(toDir).get('bob', desk.id))!.orientation!.refs, [`clip:${newId}`]);
  } finally { await rm(fromDir, { recursive: true, force: true }); await rm(toDir, { recursive: true, force: true }); }
});

test('comparison evidence replacement is atomic and rejects invalid sources without losing the previous comparison', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-comparison-'));
  try {
    const store = new FileCollectionStore(dir);
    const entries = [{ ref: 'url:https://example.com/a', title: 'A', excerpt: 'A kept passage' }, { ref: 'url:https://example.com/b', title: 'B' }];
    const c = (await store.change('u', { action: 'create', kind: 'comparison', title: 'Compare approaches', entries }))!;
    await assert.rejects(store.change('u', { action: 'replace', id: c.id, entries: [{ ref: 'url:javascript:bad', title: 'Bad' }] }));
    assert.deepEqual((await store.get('u', c.id))!.entries, c.entries);
    await assert.rejects(store.change('u', { action: 'create', kind: 'comparison', title: 'Too many', entries: [...entries, { ref: 'url:https://example.com/c', title: 'C' }, { ref: 'url:https://example.com/d', title: 'D' }] }), /three sources/);
    assert.equal((await store.list('u')).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
