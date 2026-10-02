/**
 * The tool-selection eval's cases stay true to the server (offline; running the eval
 * itself calls the Claude API: scripts/eval-tools.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOL_CASES } from '../evals/tool-selection.ts';
import { schemaProblem, type JsonSchema } from '../src/lib/schema.ts';
import { forInterface, judge } from '../scripts/eval-tools.ts';
import { RENAMES } from '../evals/renames.ts';
import { surface } from '../scripts/footprint.ts';

test('eval cases: each names tools the server offers there, with arguments their schemas accept', async () => {
  const surfaces = { hosted: await surface('hosted-active'), local: await surface('local'), labs: await surface('hosted-labs') };
  for (const frozen of TOOL_CASES) {
    const { tools } = surfaces[frozen.where ?? 'hosted'];
    // Judged as the current interface would be: through evals/renames.ts.
    const c = forInterface(frozen, new Set(tools.map((t) => t.name)));
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
  for (const r of RENAMES) for (const to of r.to) assert.ok(surfaces.hosted.tools.some((t) => t.name === to), `renames: ${r.from} → ${to}, which the server doesn't offer`);
});

test('eval judge: tool names, substring arguments, lists, and "no tool"', () => {
  assert.equal(judge({ prompt: '', tool: 'save_item', args: { url: 'example.com' } }, { name: 'save_item', input: { url: 'https://EXAMPLE.com/x' } }), undefined);
  assert.match(judge({ prompt: '', tool: 'save_item' }, { name: 'clip', input: {} })!, /expected save_item/);
  assert.match(judge({ prompt: '', tool: null }, { name: 'open_room', input: {} })!, /expected no tool/);
  assert.equal(judge({ prompt: '', tool: 'build_room', args: { packs: ['ai'] } }, { name: 'build_room', input: { packs: ['developer', 'ai'] } }), undefined);
  assert.match(judge({ prompt: '', tool: 'open_room', args: { setup: true } }, { name: 'open_room', input: {} })!, /setup/);
});

test('eval renames: a frozen case is judged against what replaced a tool the server no longer offers', async () => {
  const { forInterface } = await import('../scripts/eval-tools.ts');
  const renames = [{ version: '9.9.0', from: 'old_tool', to: ['new_tool', 'other_tool'], args: { portalIds: 'remove', obsolete: null } }];
  const c = { prompt: 'p', tool: 'old_tool', args: { portalIds: ['x'], obsolete: 1, kept: 'k' } };
  assert.deepEqual(forInterface(c, new Set(['new_tool']), renames), { prompt: 'p', tool: ['new_tool', 'other_tool'], args: { remove: ['x'], kept: 'k' } });
  assert.deepEqual(forInterface(c, new Set(['old_tool']), renames), c, 'still offered: unchanged');
});

test('eval regressions: a case that got worse by more than one run, or a lower total', async () => {
  const { regressions } = await import('../scripts/eval-tools.ts');
  const before = { a: { passed: 5, runs: 5 }, b: { passed: 3, runs: 5 } };
  assert.deepEqual(regressions({ a: { passed: 4, runs: 5 }, b: { passed: 4, runs: 5 } }, before), [], 'one run of noise either way');
  assert.deepEqual(regressions({ a: { passed: 3, runs: 5 }, b: { passed: 5, runs: 5 } }, before), ['a: 3/5, was 5/5']);
  assert.match(regressions({ a: { passed: 4, runs: 5 }, b: { passed: 3, runs: 5 } }, before).join(), /overall/);
});
