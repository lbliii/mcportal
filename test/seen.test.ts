/**
 * What's new since your last visit (docs/plans/attention.md, phase 3): open_room marks
 * items the user hasn't seen, a portal's first showing is its baseline, and mark_seen
 * (the room) records what was on screen.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { handleMessage } from '../src/mcp.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { FileSeenStore, mergeSeen, SEEN_PER_PORTAL, seenHash } from '../src/seen.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

function ctx(): ToolContext {
  const room = validateProfile({
    ...defaultProfile(), onboarded: true,
    saved: [{ url: 'https://example.com/a', title: 'A saved link', savedAt: '2026-10-01T00:00:00.000Z' }],
    columns: [...defaultProfile().columns, { panels: [{ id: 'saved', source: 'saved', title: 'Saved', config: {} }] }],
  });
  return { store: new MemoryProfileStore({ default: room }), seen: new FileSeenStore(null), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'default' };
}
async function call(c: ToolContext, name: string, args: Record<string, unknown> = {}) {
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c);
  return (res as { result: { isError?: boolean; content: Array<{ text: string }>; structuredContent: any } }).result;
}
const portal = (result: any, id: string) => result.structuredContent.portals.find((p: any) => p.portalId === id);

test('seen: a first visit is the baseline (nothing new); then only what the user hasn\'t seen is new', async () => {
  const c = ctx();
  const first = await call(c, 'open_room');
  const hn = portal(first, 'hn-top');
  assert.ok(hn.items.length >= 3);
  assert.equal(hn.newCount, undefined, 'a first visit is not a flood of new');
  assert.ok(hn.items.every((i: any) => !i.new));
  assert.equal((await c.seen!.get('default', ['hn-top'])).get('hn-top')?.size, hn.items.length, 'the baseline is every item shown');

  // As if the newest two arrived since: forget them.
  const ids: string[] = hn.items.map((i: any) => i.id);
  await c.seen!.deleteAll('default');
  await c.seen!.mark('default', [{ portalId: 'hn-top', itemIds: ids.slice(2) }]);
  const again = await call(c, 'open_room');
  const now = portal(again, 'hn-top');
  assert.equal(now.newCount, 2);
  assert.deepEqual(now.items.filter((i: any) => i.new).map((i: any) => i.id), ids.slice(0, 2));
  assert.match(again.content[0]!.text, /\[hn-top\] \d+ items, 2 new/);
  assert.match(again.content[0]!.text, /portal title: Hacker News\n- [^\n]+ \(new\)\n- [^\n]+ \(new\)\n/, 'new items first, marked');
  assert.equal(portal(again, 'saved').newCount, undefined, 'your own saved items are never "new"');
});

test('seen: mark_seen records what the room had on screen; unknown and untracked portals are ignored', async () => {
  const c = ctx();
  const ids: string[] = portal(await call(c, 'open_room'), 'hn-top').items.map((i: any) => i.id);
  await c.seen!.deleteAll('default');
  await c.seen!.mark('default', [{ portalId: 'hn-top', itemIds: ids.slice(3) }]);
  const marked = await call(c, 'mark_seen', { portals: [{ portalId: 'hn-top', itemIds: [ids[0]] }, { portalId: 'nope', itemIds: ['x'] }, { portalId: 'saved', itemIds: ['y'] }] });
  assert.equal(marked.structuredContent.marked, 1);
  assert.equal(portal(await call(c, 'open_room'), 'hn-top').newCount, 2);
  assert.equal((await c.seen!.get('default', ['nope', 'saved'])).size, 0);
});

test('seen: removing a portal drops its set; refresh_portal marks new too', async () => {
  const c = ctx();
  await call(c, 'open_room');
  assert.ok((await c.seen!.get('default', ['simonw'])).has('simonw'));
  await call(c, 'remove_portal', { portals: ['simonw'] });
  await call(c, 'open_room');
  assert.equal((await c.seen!.get('default', ['simonw'])).size, 0);

  const ids: string[] = portal(await call(c, 'open_room'), 'hn-top').items.map((i: any) => i.id);
  await c.seen!.deleteAll('default');
  await c.seen!.mark('default', [{ portalId: 'hn-top', itemIds: ids.slice(1) }]);
  assert.equal((await call(c, 'refresh_portal', { portalId: 'hn-top' })).structuredContent.portal.newCount, 1);
});

test('seen: sets are capped, newest kept, ids hashed', () => {
  const many = Array.from({ length: SEEN_PER_PORTAL + 10 }, (_, i) => `h${i}`);
  const kept = mergeSeen([], many);
  assert.equal(kept.length, SEEN_PER_PORTAL);
  assert.equal(kept.at(-1), `h${SEEN_PER_PORTAL + 9}`);
  assert.deepEqual(mergeSeen(['a'], ['a', 'b', 'b']), ['a', 'b'], 'no duplicates');
  assert.match(seenHash('https://news.ycombinator.com/item?id=1'), /^[0-9a-f]{12}$/);
});
