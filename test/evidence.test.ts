import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { passageLocator, type PassageLocator } from '../src/evidence.ts';
import { buildHandoff } from '../src/handoffs.ts';
import { buildClip } from '../src/clips.ts';
import { clipInput } from '../src/portability.ts';

const script = await readFile(new URL('../src/ui/room/locator.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(script, context);
const resolve = (blocks: string[], locator: PassageLocator, digest?: string, revision?: string): { status: string; block?: number } =>
  JSON.parse(JSON.stringify(context.resolvePassageTexts(blocks, locator, digest, revision)));
const digest = 'a'.repeat(64);

test('passages retain bounded context and revision through clip reconstruction and handoffs', () => {
  const locator = { text: 'Quoted sentence.', prefix: 'Before ', suffix: ' After', block: 1, digest, revision: 'commit-123' };
  assert.deepEqual(passageLocator(locator), locator);
  const clip = buildClip({ kind: 'quote', text: 'Quoted sentence.', source: { kind: 'article', url: 'https://example.com/v2', locator } });
  const imported = buildClip(clipInput(clip as unknown as Record<string, unknown>));
  assert.deepEqual(imported.source.locator, locator);
  assert.deepEqual(buildHandoff({ url: 'https://example.com/v2', passage: 'Quoted sentence.', locator }).locator, locator);
  assert.deepEqual(passageLocator({ text: 'Legacy text', block: 4 }), { text: 'Legacy text', block: 4 });
  for (const bad of [{ prefix: 'x'.repeat(121) }, { suffix: 5 }, { revision: 'x'.repeat(201) }, { digest: 'fake' }]) {
    assert.throws(() => passageLocator({ text: 'Quoted sentence.', ...bad }), { code: 'invalid_argument' });
  }
});

test('passages distinguish unchanged, moved, revised, repeated and missing source text', () => {
  const blocks = ['Introduction', 'Quoted sentence.', 'After'];
  const locator = { text: 'Quoted sentence.', block: 1, prefix: 'Introduction ', suffix: ' After', digest };
  assert.deepEqual(resolve(blocks, locator, digest), { status: 'exact', block: 1 });
  assert.deepEqual(resolve(['New section', ...blocks], locator, 'b'.repeat(64)), { status: 'relocated', block: 2 });
  assert.deepEqual(resolve(blocks, { ...locator, revision: 'v1' }, digest, 'v2'), { status: 'relocated', block: 1 });
  assert.deepEqual(resolve(['Nothing remains'], locator, digest), { status: 'unavailable' });
  assert.deepEqual(resolve(['Quoted sentence.', 'Quoted sentence.'], { text: 'Quoted sentence.', block: 0 }), { status: 'ambiguous' });
  assert.deepEqual(resolve(['Before', 'Quoted sentence.', 'After', 'Quoted sentence.'], { text: 'Quoted sentence.', prefix: 'Before ', suffix: ' After' }), { status: 'exact', block: 1 });
  assert.deepEqual(resolve(['Quoted sentence. Quoted sentence.'], { text: 'Quoted sentence.', block: 0 }), { status: 'ambiguous' });
  assert.deepEqual(resolve(blocks, { ...locator, prefix: 'Removed context ' }, digest), { status: 'relocated', block: 1 });
  assert.deepEqual(resolve(['One sentence', 'across blocks'], { text: 'sentence across', block: 0 }), { status: 'exact', block: 0 });
  assert.deepEqual(resolve(blocks, { text: 'Quoted   sentence.', block: 9 }), { status: 'relocated', block: 1 });
});
