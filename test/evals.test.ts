/**
 * The tool-selection eval's cases stay true to the server (offline; running the eval
 * itself calls the Claude API: scripts/eval-tools.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOL_CASES } from '../evals/tool-selection.ts';
import { schemaProblem, type JsonSchema } from '../src/lib/schema.ts';
import { judge } from '../scripts/eval-tools.ts';
import { surface } from '../scripts/footprint.ts';

test('eval cases: each names tools the server offers there, with arguments their schemas accept', async () => {
  const surfaces = { hosted: await surface('hosted-active'), local: await surface('local') };
  for (const c of TOOL_CASES) {
    const { tools } = surfaces[c.where ?? 'hosted'];
    for (const name of c.tool === null ? [] : Array.isArray(c.tool) ? c.tool : [c.tool]) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `"${c.prompt}": ${name} isn't offered to the model (${c.where ?? 'hosted'})`);
      const properties = (tool.input_schema.properties ?? {}) as Record<string, JsonSchema>;
      for (const [key, value] of Object.entries(c.args ?? {})) {
        if (!Array.isArray(c.tool) || properties[key]) {
          assert.ok(properties[key], `"${c.prompt}": ${name} has no argument ${key}`);
          assert.equal(schemaProblem(properties[key]!, value, key), undefined, `"${c.prompt}": ${key}`);
        }
      }
    }
  }
  assert.ok(TOOL_CASES.length >= 25);
});

test('eval judge: tool names, substring arguments, lists, and "no tool"', () => {
  assert.equal(judge({ prompt: '', tool: 'save_item', args: { url: 'example.com' } }, { name: 'save_item', input: { url: 'https://EXAMPLE.com/x' } }), undefined);
  assert.match(judge({ prompt: '', tool: 'save_item' }, { name: 'clip', input: {} })!, /expected save_item/);
  assert.match(judge({ prompt: '', tool: null }, { name: 'open_room', input: {} })!, /expected no tool/);
  assert.equal(judge({ prompt: '', tool: 'build_room', args: { packs: ['ai'] } }, { name: 'build_room', input: { packs: ['developer', 'ai'] } }), undefined);
  assert.match(judge({ prompt: '', tool: 'open_room', args: { setup: true } }, { name: 'open_room', input: {} })!, /setup/);
});
