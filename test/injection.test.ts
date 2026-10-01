/**
 * Poisoned content can't escape its fence. A feed, an article and a docs page that try
 * to close the untrusted-content fence early or fake a new one reach the model with
 * every word of the attack still inside a fence the server opened. (Whether a
 * model then obeys fenced text is the injection eval in scripts/eval-tools.ts.)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';
import { handleMessage } from '../src/mcp.ts';
import { defaultProfile } from '../src/profile.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { CallToolResult, ToolContext } from '../src/tools/kit.ts';
import { MARKER, poisonedFetcher as fetcher } from '../evals/poisoned.ts';

function ctx(): ToolContext {
  return { store: new MemoryProfileStore({ u: { ...defaultProfile(), onboarded: true } }), fetcher, cache: new TtlCache(), userId: 'u' };
}

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const res = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx())) as { result: CallToolResult };
  assert.equal(res.result.isError, undefined, res.result.content[0]!.text);
  return res.result.content[0]!.text;
}

/** Every occurrence of the attack sits inside a fence whose id the attack didn't choose. */
function assertFenced(text: string, what: string): void {
  const opens = [...text.matchAll(/<untrusted-content id="([0-9a-f]{8})" source="[^"\n]*">/g)];
  assert.ok(opens.length > 0, `${what}: third-party text is fenced`);
  for (const open of opens) assert.ok(!['00000000', '11111111'].includes(open[1]!), `${what}: the fence id is the server's, not the attacker's`);
  let from = 0;
  for (let at = text.indexOf(MARKER); at !== -1; at = text.indexOf(MARKER, at + 1)) {
    const fence = opens.filter((o) => o.index! < at).at(-1);
    assert.ok(fence, `${what}: attack text before any fence`);
    const close = text.indexOf(`</untrusted-content id="${fence[1]}">`, fence.index);
    assert.ok(close > at, `${what}: attack text outside its fence`);
    from = at;
  }
  assert.ok(from > 0, `${what}: the attack text reached the model (so the check means something)`);
}

test('injection: a poisoned feed stays fenced (read_source)', async () => {
  assertFenced(await call('read_source', { source: 'rss', config: { url: 'https://evil.example/feed.xml' } }), 'feed');
});

test('injection: a poisoned article stays fenced (read_article)', async () => {
  assertFenced(await call('read_article', { url: 'https://evil.example/article' }), 'article');
});

test('injection: a poisoned docs index and page stay fenced (open_docs, read_doc_page)', async () => {
  assertFenced(await call('open_docs', { docs: 'https://docs.evil.example/llms.txt' }), 'docs index');
  assertFenced(await call('read_doc_page', { docs: 'https://docs.evil.example/llms.txt', url: 'https://docs.evil.example/one.md' }), 'docs page');
});
