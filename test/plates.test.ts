/** Plates and lenses (lab `plates`, docs/plans/plates.md): validation, refs, text forms and lab gating. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryClipStore } from '../src/clip-stores.ts';
import { buildClip } from '../src/clips.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { readingActivity, weekOf } from '../src/lenses.ts';
import { handleMessage } from '../src/mcp.ts';
import { plateFrom, plateText } from '../src/plates.ts';
import { defaultProfile } from '../src/profile.ts';
import type { ReadingState, ReadingStore } from '../src/reading.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { store: new MemoryProfileStore({ test: { ...defaultProfile(), onboarded: true } }), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'test', labs: ['plates'], ...overrides };
}
async function call(c: ToolContext, name: string, args: Record<string, unknown>) {
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c);
  return res!.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean };
}
async function names(c: ToolContext) {
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, c);
  return (res!.result as any).tools as Array<{ name: string; outputSchema?: unknown; _meta?: any }>;
}

const TIMELINE = { kind: 'timeline', entries: [{ at: '2026-10-02', label: 'Time the restore', ref: 'url:https://example.com/drills' }, { at: '2026-09-14', label: 'Snapshots are enough' }] };

test('plates: the lab lists both tools; off, neither is listed and a call says why', async () => {
  const on = await names(ctx());
  const lens = on.find((t) => t.name === 'get_lens')!, plate = on.find((t) => t.name === 'show_plate')!;
  assert.ok(lens.outputSchema, 'get_lens declares its output for hosts that draw');
  assert.equal(lens._meta, undefined, 'get_lens attaches no room UI, so the host draws');
  assert.ok(plate._meta.ui.resourceUri, 'show_plate renders in the room');
  const off = ctx({ labs: [] });
  assert.ok(!(await names(off)).some((t) => t.name === 'show_plate' || t.name === 'get_lens'));
  const refused = await call(off, 'show_plate', { title: 'x', spec: TIMELINE });
  assert.equal(refused.isError, true);
  assert.equal(refused.structuredContent.error.code, 'unavailable');
});

test('plates: a timeline is sorted, cited by number and readable as text', async () => {
  const res = await call(ctx(), 'show_plate', { title: 'How the debate moved', caption: 'From cost to restore time.', spec: TIMELINE, refs: ['url:https://example.com/drills'] });
  assert.equal(res.isError, undefined);
  const { plate } = res.structuredContent;
  assert.deepEqual(plate.spec.entries.map((e: any) => e.at), ['2026-09-14', '2026-10-02']);
  assert.deepEqual(plate.refs, [{ ref: 'url:https://example.com/drills', title: 'example.com/drills', url: 'https://example.com/drills' }]);
  assert.match(res.content[0]!.text, /Sep 14, 2026: Snapshots are enough\nOct 2, 2026: Time the restore \[1\]/);
  assert.match(res.content[0]!.text, /\[1\] https:\/\/example\.com\/drills$/m);
});

test('plates: specs are refused when they cite unlisted refs, mix axes, carry other kinds\' fields or misshape a matrix', async () => {
  const c = ctx();
  const bad = async (spec: Record<string, unknown>, refs?: string[]) => (await call(c, 'show_plate', { title: 't', spec, ...(refs ? { refs } : {}) })).content[0]!.text;
  assert.match(await bad(TIMELINE), /must also be listed in refs/);
  assert.match(await bad({ kind: 'series', series: [{ name: 'a', points: [{ x: '2026-10-01', y: 1 }, { x: 'Monday', y: 2 }] }] }), /not both/);
  assert.match(await bad({ kind: 'steps', steps: [{ label: 'a' }, { label: 'b' }], entries: TIMELINE.entries }), /doesn't use entries/);
  assert.match(await bad({ kind: 'matrix', columns: [{ label: 'A' }, { label: 'B' }], rows: [{ label: 'r', cells: [{ mark: 'good', text: 'x' }] }] }), /exactly 2 cells/);
  assert.match(await bad({ kind: 'timeline', entries: [{ at: 'yesterday', label: 'a' }, { at: '2026-10-01', label: 'b' }] }), /ISO date/);
  assert.match(await bad({ kind: 'steps', steps: [{ label: 'a' }, { label: 'b' }] }, ['javascript:alert(1)']), /clip:ID or url:URL/);
});

test('plates: a missing clip stays visibly missing; a present one shows its own title', async () => {
  const clips = new MemoryClipStore();
  const clip = await clips.add('test', buildClip({ kind: 'quote', title: 'A backup you never restored is a hope', text: 'quote', source: { kind: 'article', url: 'https://example.com/q' } }));
  const plate = await plateFrom({ title: 'Steps', spec: { kind: 'steps', steps: [{ label: 'Dump' }, { label: 'Restore', emphasis: true }] }, refs: [`clip:${clip.id}`, 'clip:gone'] }, { clips, userId: 'test' });
  assert.deepEqual(plate.refs.map((r) => [r.title, r.missing ?? false]), [['A backup you never restored is a hope', false], ['Unavailable clip', true]]);
  assert.match(plateText(plate), /2\. Restore \(key step\)/);
});

test('plates: series and matrix text forms carry the numbers and marks', async () => {
  const series = await plateFrom({ title: 'Price', spec: { kind: 'series', unit: '$', series: [{ name: 'price', points: [{ x: '2026-10-05', y: 182 }, { x: '2026-09-07', y: 214 }] }], events: [{ at: '2026-10-05', label: 'Sale' }] } }, { userId: 'test' });
  assert.match(plateText(series), /first \$214, last \$182, low \$182, high \$214/);
  assert.match(plateText(series), /Events: Sale \(Oct 5, 2026\)/);
  const matrix = await plateFrom({ title: 'Trade-offs', spec: { kind: 'matrix', columns: [{ label: 'Dumps' }], rows: [{ label: 'Effort', cells: [{ mark: 'good', text: 'One script' }] }] } }, { userId: 'test' });
  assert.match(plateText(matrix), /\| Effort \| One script \(good\) \|/);
});

test('lens: reading_activity buckets opened, read and clipped by Monday week, and hands back a plate that show_plate accepts', async () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  assert.equal(weekOf(now), '2026-10-05');
  const states: ReadingState[] = [
    { url: 'https://www.example.com/a', status: 'read', lastSeenAt: '2026-10-06T09:00:00Z', lastOpenedAt: '2026-10-06T09:00:00Z', readAt: '2026-10-07T09:00:00Z' },
    { url: 'https://example.com/b', status: 'opened', lastSeenAt: '2026-09-29T09:00:00Z', lastOpenedAt: '2026-09-29T09:00:00Z' },
    { url: 'https://other.example/c', status: 'opened', lastSeenAt: '2026-06-01T09:00:00Z', lastOpenedAt: '2026-06-01T09:00:00Z' },
  ];
  const reading = { list: async () => states } as unknown as ReadingStore;
  const clips = new MemoryClipStore();
  await clips.add('test', buildClip({ kind: 'note', title: 'n', markdown: 'note' }, new Date('2026-10-08T10:00:00Z')));
  const lens = await readingActivity({ reading, clips, userId: 'test' }, 4, now);
  assert.deepEqual(lens.weeks, [
    { week: '2026-09-14', opened: 0, read: 0, clipped: 0 },
    { week: '2026-09-21', opened: 0, read: 0, clipped: 0 },
    { week: '2026-09-28', opened: 1, read: 0, clipped: 0 },
    { week: '2026-10-05', opened: 1, read: 1, clipped: 1 },
  ]);
  assert.deepEqual(lens.topSites, [{ site: 'example.com', opened: 2 }]);
  const shown = await call(ctx({ reading, clips }), 'show_plate', lens.plate as unknown as Record<string, unknown>);
  assert.equal(shown.isError, undefined, shown.content[0]!.text);
  const res = await call(ctx({ reading, clips }), 'get_lens', { lens: 'reading_activity', weeks: 4 });
  assert.match(res.content[0]!.text, /pages opened/);
  assert.equal(res.structuredContent.lens.name, 'reading_activity');
});
