/**
 * What MCPortal costs a conversation just by being connected: the tool list and the
 * server instructions the host puts in the model's context, in approximate tokens.
 *
 *   node scripts/footprint.ts        per-tool sizes, largest first, hosted and local totals
 *
 * Tokens are estimated at 4 characters each (close for English and JSON); the budget
 * test (test/footprint.test.ts) uses the same estimate, so the numbers compare.
 */
import { fileURLToPath } from 'node:url';
import { handleMessage } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import type { ToolContext } from '../src/tools/kit.ts';

export const tokens = (text: string) => Math.ceil(text.length / 4);

export interface Footprint {
  tools: Array<{ name: string; tokens: number }>;
  toolTokens: number;
  instructionTokens: number;
  total: number;
}

/** The footprint as a hosted server (social layer on) or a local one presents it. */
export async function footprint(where: 'hosted' | 'local'): Promise<Footprint> {
  const ctx: ToolContext = {
    store: new MemoryProfileStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'footprint',
    ...(where === 'hosted' ? { social: {} as never, publicProfiles: {} as never } : {}),
  };
  const list = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx);
  const init = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx);
  // Tools only the room app calls aren't shown to the model.
  const visible = ((list as { result: { tools: Array<{ name: string; _meta?: { ui?: { visibility?: string[] } } }> } }).result.tools)
    .filter((t) => !t._meta?.ui?.visibility || t._meta.ui.visibility.includes('model'));
  const tools = visible.map((t) => ({ name: t.name, tokens: tokens(JSON.stringify(t)) })).sort((a, b) => b.tokens - a.tokens);
  const toolTokens = tools.reduce((n, t) => n + t.tokens, 0);
  const instructionTokens = tokens((init as { result: { instructions: string } }).result.instructions);
  return { tools, toolTokens, instructionTokens, total: toolTokens + instructionTokens };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hosted = await footprint('hosted');
  const local = await footprint('local');
  for (const t of hosted.tools) console.log(`${String(t.tokens).padStart(5)}  ${t.name}${local.tools.some((l) => l.name === t.name) ? '' : '  (hosted only)'}`);
  console.log(`\nhosted: ${hosted.tools.length} tools, ${hosted.toolTokens} + ${hosted.instructionTokens} instructions = ${hosted.total} tokens`);
  console.log(`local:  ${local.tools.length} tools, ${local.toolTokens} + ${local.instructionTokens} instructions = ${local.total} tokens`);
}
