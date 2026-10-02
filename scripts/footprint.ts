/**
 * What MCPortal costs a conversation that loads its tools up front: the tool
 * definitions and server instructions a host puts in the model's context. (Hosts that
 * defer tools behind search, like Claude Code, pay names up front and a definition only
 * when it's found.) Counted as the model sees a tool: name, description, input schema.
 *
 *   node scripts/footprint.ts            per-tool estimates (~4 characters a token)
 *   node scripts/footprint.ts --exact    the Claude API's token counter (needs credentials)
 *   node scripts/footprint.ts --ceilings write test/footprint-ceilings.json from today's sizes
 *
 * Profiles: a local server; a hosted account that hasn't used sharing yet; an active one.
 */
import Anthropic from '@anthropic-ai/sdk';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handleMessage } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import type { ToolContext } from '../src/tools/kit.ts';

export const tokens = (text: string) => Math.ceil(text.length / 4);

export const PROFILES = ['local', 'linked', 'hosted-new', 'hosted-active'] as const;
export type Profile = (typeof PROFILES)[number];

/** A tool as hosts pass it to a model. */
export interface ModelTool { name: string; description: string; input_schema: Record<string, unknown> }

export interface Footprint {
  tools: Array<{ name: string; tokens: number }>;
  toolTokens: number;
  instructionTokens: number;
  total: number;
}

/** A caller in each profile: social stubs answer only the questions the tool list asks. */
function contextFor(profile: Profile): ToolContext {
  const base: ToolContext = { store: new MemoryProfileStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'footprint' };
  // A local MCPortal (stdio) can sign in; once it has, it's social like a hosted one.
  const link = (linked: boolean) => ({ linked, server: 'https://mcportal.example', start: async () => ({ url: '' }), unlink: async () => '' });
  if (profile === 'local') return { ...base, link: link(false) };
  const active = profile === 'hosted-active' || profile === 'linked';
  if (profile === 'linked') return { ...base, link: link(true), publicProfiles: { get: async () => ({ handle: 'someone' }) } as never, social: { uses: async () => true } as never };
  return {
    ...base,
    publicProfiles: { get: async () => (active ? { handle: 'someone' } : undefined) } as never,
    social: { uses: async () => active } as never,
  };
}

/** The tools (as the model sees them) and instructions a profile gets. */
export async function surface(profile: Profile): Promise<{ tools: ModelTool[]; instructions: string }> {
  const ctx = contextFor(profile);
  const list = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx)) as { result: { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; _meta?: { ui?: { visibility?: string[] } } }> } };
  const init = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx)) as { result: { instructions: string } };
  // App-only tools aren't shown to the model.
  const tools = list.result.tools
    .filter((t) => !t._meta?.ui?.visibility || t._meta.ui.visibility.includes('model'))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  return { tools, instructions: init.result.instructions };
}

/** Estimated tokens per tool (name, description, schema) and in total. */
export async function footprint(profile: Profile): Promise<Footprint> {
  const { tools, instructions } = await surface(profile);
  const sized = tools.map((t) => ({ name: t.name, tokens: tokens(t.name) + tokens(t.description) + tokens(JSON.stringify(t.input_schema)) })).sort((a, b) => b.tokens - a.tokens);
  const toolTokens = sized.reduce((n, t) => n + t.tokens, 0);
  const instructionTokens = tokens(instructions);
  return { tools: sized, toolTokens, instructionTokens, total: toolTokens + instructionTokens };
}

/** Exact tokens from the Claude API's counter: the request with the tools and instructions, minus without. */
async function exact(profile: Profile, model: string): Promise<number> {
  const client = new Anthropic();
  const { tools, instructions } = await surface(profile);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'hi' }];
  const withTools = await client.messages.countTokens({ model, system: instructions, tools: tools as Anthropic.Tool[], messages });
  const bare = await client.messages.countTokens({ model, messages });
  return withTools.input_tokens - bare.input_tokens;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = Object.fromEntries(await Promise.all(PROFILES.map(async (p) => [p, await footprint(p)] as const))) as Record<Profile, Footprint>;
  const active = results['hosted-active'];
  for (const t of active.tools) {
    const where = results.local.tools.some((l) => l.name === t.name) ? '' : results['hosted-new'].tools.some((l) => l.name === t.name) ? '  (hosted)' : '  (hosted, once social is used)';
    console.log(`${String(t.tokens).padStart(5)}  ${t.name}${where}`);
  }
  console.log('');
  for (const p of PROFILES) console.log(`${p.padEnd(14)} ${String(results[p].tools.length).padStart(2)} tools, ${results[p].toolTokens} + ${results[p].instructionTokens} instructions = ${results[p].total} tokens (estimate)`);
  if (process.argv.includes('--ceilings')) {
    const ceilings = {
      totals: Object.fromEntries(PROFILES.map((p) => [p, results[p].total])),
      tools: Object.fromEntries(active.tools.map((t) => [t.name, t.tokens]).sort(([a], [b]) => String(a).localeCompare(String(b)))),
    };
    await writeFile(new URL('../test/footprint-ceilings.json', import.meta.url), `${JSON.stringify(ceilings, null, 2)}\n`);
    console.log('Wrote test/footprint-ceilings.json');
  }
  if (process.argv.includes('--exact')) {
    const model = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'claude-opus-5-5';
    for (const p of PROFILES) console.log(`${p.padEnd(14)} ${await exact(p, model)} tokens (counted by the API for ${model})`);
  }
}
