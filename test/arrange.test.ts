/**
 * arrange_room's semantics (src/layout.ts arrange): every layout request the /portal
 * skill routes, and every way one can fail, which must change nothing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrange, type Arrangement } from '../src/layout.ts';
import { errorCode } from '../src/lib/errors.ts';
import { labsFrom } from '../src/labs.ts';
import { handleMessage } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { defaultProfile, offeredLayouts, validateProfile, type Profile } from '../src/profile.ts';

/** Three columns: HN | GitHub, a blog | a pinned list. */
function room(): Profile {
  return validateProfile({
    name: 'morning',
    onboarded: true,
    columns: [
      { width: 1, panels: [{ id: 'hn', source: 'hn', title: 'Hacker News', config: {} }] },
      { width: 1, panels: [{ id: 'gh', source: 'github', title: 'GitHub', config: { query: 'topic:mcp' } }, { id: 'blog', source: 'rss', title: 'The Blog', config: { url: 'https://example.com/feed' } }] },
      { width: 2, panels: [{ id: 'bugs', source: 'pinned', title: 'Bugs', config: { from: 'Jira', recipe: 'jira_search' } }] },
    ],
    pins: { bugs: { items: [{ title: 'Crash', meta: [] }], pinnedAt: '2026-10-01T00:00:00.000Z' } },
  });
}
const layout = (p: Profile) => p.columns.map((c) => c.panels.map((x) => x.id));
const refused = (change: Arrangement, code: string, message: RegExp) =>
  assert.throws(() => arrange(room(), change), (e: unknown) => errorCode(e) === code && message.test((e as Error).message));

test('arrange: "put GitHub on the left" moves only GitHub, to the top of column 1', () => {
  const p = arrange(room(), { move: [{ portal: 'GitHub', column: 1, position: 1 }] });
  assert.deepEqual(layout(p), [['gh', 'hn'], ['blog'], ['bugs']]);
});

test('arrange: "make GitHub wider" sets its column width, nothing else', () => {
  const p = arrange(room(), { width: [{ column: 2, width: 3 }] });
  assert.deepEqual(p.columns.map((c) => c.width), [1, 3, 2]);
  assert.deepEqual(layout(p), layout(room()));
});

test('arrange: "remove the blog" removes only it; a removed pinned portal takes its items', () => {
  const p = arrange(room(), { remove: ['the blog', 'bugs'] });
  assert.deepEqual(layout(p), [['hn'], ['gh']]);
  assert.deepEqual(p.pins, {}, 'its pinned items go with it');
  assert.deepEqual(arrange(room(), { remove: ['blog'] }).pins.bugs?.items[0]?.title, 'Crash', 'other pins stay');
});

test('arrange: a new column, a rename, layout and openIn, a retitle and new source settings', () => {
  const p = arrange(room(), {
    move: [{ portal: 'hn', column: 4 }, { portal: 'blog', column: 4, position: 1 }],
    retitle: [{ portal: 'gh', title: 'MCP repos' }],
    configure: [{ portal: 'gh', config: { sort: 'updated' } }],
    name: 'mornings', layout: 'shelves', openIn: 'chat',
  });
  assert.deepEqual(layout(p), [['gh'], ['bugs'], ['blog', 'hn']], 'the emptied column 1 is dropped at the end');
  const gh = p.columns[0]!.panels[0]!;
  assert.equal(gh.title, 'MCP repos');
  assert.ok(gh.source === 'github' && gh.config.mode === 'search' && gh.config.query === 'topic:mcp' && gh.config.sort === 'updated', 'settings merge, then validate');
  assert.deepEqual([p.name, p.layout, p.openIn], ['mornings', 'shelves', 'chat']);
});

test('arrange: column numbers mean the room as it was, even after a column empties', () => {
  // Moving HN out empties column 1; column 3 still means the pinned column.
  const p = arrange(room(), { move: [{ portal: 'hn', column: 2 }, { portal: 'blog', column: 3 }] });
  assert.deepEqual(layout(p), [['gh', 'hn'], ['bugs', 'blog']]);
});

test('arrange: saved items pass through untouched', () => {
  const before = { ...room(), saved: [{ url: 'https://example.com/a', title: 'A', savedAt: '2026-01-01T00:00:00.000Z' }] };
  assert.equal(arrange(before, { name: 'x' }).saved, before.saved);
});

test('arrange: refusals change nothing and say why', () => {
  refused({ remove: ['nope'] }, 'not_found', /No portal "nope"/);
  refused({ move: [{ portal: 'hn', column: 9 }] }, 'invalid_argument', /column 9 isn't in the room \(1 to 3, or 4 for a new one\)/);
  refused({ remove: ['hn', 'gh', 'blog', 'bugs'] }, 'invalid_argument', /leave the room empty/);
  refused({ remove: ['hn'], move: [{ portal: 'hn', column: 2 }] }, 'invalid_argument', /being removed/);
  refused({ width: [{ column: 1, width: 5 }] }, 'invalid_argument', /1 to 4/);
  refused({ configure: [{ portal: 'bugs', config: { recipe: 'x' } }] }, 'invalid_argument', /pin_portal/);
  refused({ configure: [{ portal: 'blog', config: { url: 'not a url' } }] }, 'invalid_argument', /rss needs a valid/);
  const full = room();
  full.columns[1]!.panels.push(...['a', 'b'].map((id) => ({ id, source: 'hn' as const, config: { feed: 'top' as const, limit: 10 } })));
  assert.throws(() => arrange(full, { move: [{ portal: 'hn', column: 2 }] }), (e: unknown) => errorCode(e) === 'limit_exceeded');
});

test('arrange: a title that names two portals is refused with their ids', () => {
  const twins = arrange(room(), { retitle: [{ portal: 'blog', title: 'GitHub' }] });
  assert.throws(() => arrange(twins, { remove: ['github'] }), /names 2 portals \(gh, blog\); use an id/);
});

test('labs: the front page and the river are offered only while their labs are on, and a room that chose one stays valid', async () => {
  assert.deepEqual(labsFrom(' FrontPage , nonsense'), ['frontpage']);
  assert.deepEqual(labsFrom(undefined), []);
  assert.deepEqual(offeredLayouts([]), ['columns', 'shelves']);
  assert.deepEqual(offeredLayouts(['frontpage']), ['columns', 'shelves', 'frontpage']);
  assert.deepEqual(offeredLayouts(['river']), ['columns', 'shelves', 'river']);
  assert.deepEqual(labsFrom('frontpage,river'), ['frontpage', 'river']);
  assert.equal(validateProfile({ ...defaultProfile(), layout: 'frontpage' }).layout, 'frontpage');
  assert.equal(validateProfile({ ...defaultProfile(), layout: 'river' }).layout, 'river');
  // These tests run without MCPORTAL_LABS: the model can't pick it.
  const ctx = { store: new MemoryProfileStore({ default: { ...defaultProfile(), onboarded: true } }), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'default' };
  for (const layout of ['frontpage', 'river']) {
    const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'arrange_room', arguments: { layout } } }, ctx) as { result: { structuredContent: { error?: { code: string } } } };
    assert.equal(res.result.structuredContent.error?.code, 'invalid_argument', layout);
  }
  assert.equal((await ctx.store.get('default')).layout, 'columns');
});
