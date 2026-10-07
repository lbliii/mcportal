/**
 * Stored data from before the room/portal rename must load unchanged: profiles keep
 * `columns[].panels` and exports keep `"format": "mcportal-export"` (rename plan step 5).
 * These fixtures are written out literally, the way older versions saved them.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MemoryClipStore } from '../src/clips.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { handleMessage } from '../src/mcp.ts';
import { buildExport, importExport, parseExport } from '../src/portability.ts';
import { FileProfileStore, MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

/** A profile file as MCPortal 0.3 wrote it. */
const OLD_PROFILE = {
  version: 1,
  name: 'morning',
  layout: 'columns',
  openIn: 'card',
  columns: [
    { width: 2, panels: [{ id: 'hn-top', source: 'hn', title: 'Hacker News', config: { feed: 'top', limit: 12 } }] },
    {
      width: 1,
      panels: [
        { id: 'saved', source: 'saved', title: 'Saved', config: { limit: 30 } },
        { id: 'my-open-bugs', source: 'pinned', title: 'My open bugs', config: { from: 'Jira', recipe: 'jira_search with jql: assignee = currentUser()', limit: 30 } },
      ],
    },
  ],
  saved: [{ url: 'https://example.com/a', title: 'A', savedAt: '2026-09-01T00:00:00.000Z' }],
  pins: { 'my-open-bugs': { items: [{ id: 'https://jira.example.com/B-1', title: 'B-1 crash', url: 'https://jira.example.com/B-1', meta: ['open'] }], pinnedAt: '2026-09-02T00:00:00.000Z' } },
  onboarded: true,
  updatedAt: '2026-09-03T00:00:00.000Z',
};

/** An export file as MCPortal 0.3 wrote it. */
const OLD_EXPORT = {
  format: 'mcportal-export',
  version: 1,
  exportedAt: '2026-09-04T00:00:00.000Z',
  profile: OLD_PROFILE,
  clips: [],
  publicProfile: null,
};

async function call(c: ToolContext, name: string, args: Record<string, unknown> = {}) {
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c);
  return res!.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean };
}

test('compat: a profile file saved before the rename loads unchanged and keeps columns[].panels when saved again', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-compat-'));
  await writeFile(path.join(dir, 'u1.json'), JSON.stringify(OLD_PROFILE, null, 2));
  const store = new FileProfileStore(dir);

  const loaded = await store.get('u1');
  assert.equal(store.takeNotice('u1'), undefined, 'not treated as corrupt');
  assert.deepEqual(loaded, OLD_PROFILE, 'every field reads back as it was');

  const c = { store, clips: new MemoryClipStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'u1' } as ToolContext;
  const room = (await call(c, 'open_room')).structuredContent;
  assert.deepEqual(room.portals.map((p: any) => p.portalId), ['hn-top', 'saved', 'my-open-bugs']);
  assert.equal(room.portals.find((p: any) => p.portalId === 'my-open-bugs').items[0].title, 'B-1 crash', 'pinned items survive');

  assert.ok(!(await call(c, 'pin_portal', { portalId: 'my-open-bugs', items: [{ title: 'B-2 hang' }] })).isError);
  const written = JSON.parse(await readFile(path.join(dir, 'u1.json'), 'utf8'));
  assert.deepEqual(written.columns.map((col: any) => col.panels.map((p: any) => p.id)), [['hn-top'], ['saved', 'my-open-bugs']], 'still stored as panels');
  assert.ok(written.columns.every((col: any) => !('portals' in col)));
  assert.equal(written.pins['my-open-bugs'].items[0].title, 'B-2 hang');
});

test('compat: an export made before the rename imports, and new exports keep the same format', async () => {
  const data = parseExport(JSON.stringify(OLD_EXPORT));
  const store = new MemoryProfileStore();
  const result = await importExport(data, 'u2', { store, clips: new MemoryClipStore() });
  assert.equal(result.layoutAdopted, true);
  assert.equal(result.portalsAdded, 3);
  const profile = await store.get('u2');
  assert.deepEqual(profile.columns.map((col) => col.panels.map((p) => p.id)), [['hn-top'], ['saved', 'my-open-bugs']]);
  assert.equal(profile.pins['my-open-bugs']!.items[0]!.title, 'B-1 crash');
  assert.equal(profile.saved[0]!.url, 'https://example.com/a');

  const again = JSON.parse((await buildExport('mcportal', 'u2', { store })).body.toString());
  assert.equal(again.format, 'mcportal-export');
  assert.equal(again.version, 2);
  assert.deepEqual(Object.keys(again.profile.columns[0]), ['width', 'panels']);
});
