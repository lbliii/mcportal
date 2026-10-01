/**
 * Tool-selection eval: send each case in evals/tool-selection.ts to Claude with
 * MCPortal's real tool list and instructions (as a host would), and check the first
 * MCPortal tool it calls and its arguments. Costs money: it calls the Claude API.
 *
 *   node scripts/eval-tools.ts [--model=claude-opus-5-5] [--effort=medium] [--only=save]
 *
 * Needs Claude API credentials (ANTHROPIC_API_KEY, or an `ant auth login` profile).
 * The tool list and instructions are cached between cases, so after the first request
 * each case costs little more than its prompt and the model's reply.
 */
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'node:url';
import { TOOL_CASES, type ToolCase } from '../evals/tool-selection.ts';
import { handleMessage } from '../src/mcp.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; _meta?: { ui?: { visibility?: string[] } } }

/** The tools and instructions a model sees from MCPortal on a hosted or local server. */
export async function serverSurface(where: 'hosted' | 'local'): Promise<{ tools: McpTool[]; instructions: string }> {
  const ctx: ToolContext = {
    store: new MemoryProfileStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'eval',
    ...(where === 'hosted' ? { social: {} as never, publicProfiles: {} as never } : {}),
  };
  const list = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx)) as { result: { tools: McpTool[] } };
  const init = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx)) as { result: { instructions: string } };
  // App-only tools are hidden from the model by hosts.
  const tools = list.result.tools.filter((t) => !t._meta?.ui?.visibility || t._meta.ui.visibility.includes('model'));
  return { tools, instructions: init.result.instructions };
}

/** Does a call match the case? Strings match case-insensitively as substrings; lists must contain the expected entries. */
export function judge(c: ToolCase, called: { name: string; input: Record<string, unknown> } | undefined): string | undefined {
  if (c.tool === null) return called ? `called ${called.name}, expected no tool` : undefined;
  const wanted = Array.isArray(c.tool) ? c.tool : [c.tool];
  if (!called) return `called no tool, expected ${wanted.join(' or ')}`;
  if (!wanted.includes(called.name)) return `called ${called.name}, expected ${wanted.join(' or ')}`;
  for (const [key, expected] of Object.entries(c.args ?? {})) {
    const got = called.input[key];
    const matches = (e: unknown, g: unknown) => (typeof e === 'string' && typeof g === 'string' ? g.toLowerCase().includes(e.toLowerCase()) : JSON.stringify(e) === JSON.stringify(g));
    const ok = Array.isArray(expected) ? Array.isArray(got) && expected.every((e) => got.some((g) => matches(e, g))) : matches(expected, got);
    if (!ok) return `${called.name}: ${key} was ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`;
  }
  return undefined;
}

async function run(): Promise<void> {
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const model = flag('model') ?? 'claude-opus-5-5';
  const effort = (flag('effort') ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  const only = flag('only');
  const cases = TOOL_CASES.filter((c) => !only || c.prompt.includes(only) || String(c.tool).includes(only));
  const client = new Anthropic();
  const surfaces = { hosted: await serverSurface('hosted'), local: await serverSurface('local') };
  let passed = 0;
  let cacheReads = 0;
  for (const c of cases) {
    const surface = surfaces[c.where ?? 'hosted'];
    const tools: Anthropic.Beta.BetaTool[] = surface.tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      // Cache the whole tool list and instructions: the same prefix for every case.
      ...(i === surface.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      output_config: { effort },
      // If a safety classifier declines, retry on another model rather than fail the case (reported below).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: `You are an assistant in a chat app with the MCPortal connector.\n\n${surface.instructions}`, cache_control: { type: 'ephemeral' } }],
      tools,
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: c.prompt }],
    });
    cacheReads += response.usage.cache_read_input_tokens ?? 0;
    if (response.stop_reason === 'refusal') {
      console.log(`REFUSED  ${c.prompt}`);
      continue;
    }
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const problem = judge(c, call ? { name: call.name, input: call.input as Record<string, unknown> } : undefined);
    if (problem) console.log(`FAIL  ${c.prompt}\n      ${problem}`);
    else passed++;
    if (response.model !== model) console.log(`      (answered by ${response.model})`);
  }
  console.log(`\n${passed}/${cases.length} cases pass on ${model} (effort ${effort}); ${cacheReads} input tokens read from cache`);
  process.exitCode = passed === cases.length ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();
