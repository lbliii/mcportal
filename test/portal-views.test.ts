import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_METHODS } from '../src/api/methods.ts';
import { arrange } from '../src/layout.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

test('portal view is a preference independent of source settings, placement and room layout', () => {
  const original = defaultProfile();
  const changed = arrange(original, { view: [{ portal: 'hn-top', view: 'cards' }] });
  assert.equal(changed.columns[0]!.panels[0]!.view, 'cards');
  assert.deepEqual(changed.columns.map(c => c.panels.map(p => p.id)), original.columns.map(c => c.panels.map(p => p.id)));
  assert.deepEqual(changed.columns[0]!.panels[0]!.config, original.columns[0]!.panels[0]!.config);
  assert.equal(changed.layout, original.layout);
  assert.deepEqual(validateProfile(changed, new Date(changed.updatedAt)), changed);
  assert.equal(arrange(changed, { configure: [{ portal: 'hn-top', config: { feed: 'new' } }] }).columns[0]!.panels[0]!.view, 'cards');
  assert.throws(() => validateProfile({ ...changed, columns: [{ panels: [{ ...changed.columns[0]!.panels[0], view: 'a-future-view' }] }] }), /update MCPortal/);
});

test('hosted profile writes preserve views omitted by older clients; explicit default resets', async () => {
  const profile = arrange(defaultProfile(), { view: [{ portal: 'hn-top', view: 'cards' }] });
  const store = new MemoryProfileStore({ u: profile });
  const ctx: ToolContext = { store, userId: 'u', fetcher: createFixtureFetcher(), cache: new TtlCache() };
  const before = await store.versioned('u');
  const oldClient = structuredClone(before.profile);
  delete oldClient.columns[0]!.panels[0]!.view;
  oldClient.name = 'Changed on an older client';
  await API_METHODS['room.put']!.run({ profile: oldClient, ifMatch: before.rev }, ctx);
  assert.equal((await store.get('u')).columns[0]!.panels[0]!.view, 'cards');
  oldClient.columns[0]!.panels[0]!.view = 'default';
  await API_METHODS['room.put']!.run({ profile: oldClient }, ctx);
  assert.equal((await store.get('u')).columns[0]!.panels[0]!.view, 'default');
});
