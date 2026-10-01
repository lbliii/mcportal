/**
 * What MCPortal costs a conversation that loads its tools up front (scripts/footprint.ts):
 * each tool, and each profile's total, stays within test/footprint-ceilings.json. The
 * ceilings only go down: when something shrinks, run node scripts/footprint.ts --ceilings.
 * A new tool needs a ceiling too, which makes its cost a decision.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { footprint, PROFILES, type Profile } from '../scripts/footprint.ts';

const ceilings = JSON.parse(await readFile(new URL('./footprint-ceilings.json', import.meta.url), 'utf8')) as { totals: Record<Profile, number>; tools: Record<string, number> };

for (const profile of PROFILES) {
  test(`footprint (${profile}): the tools and instructions stay within budget`, async () => {
    const f = await footprint(profile);
    assert.ok(f.total <= ceilings.totals[profile], `${profile}: ${f.total} tokens, over the ceiling of ${ceilings.totals[profile]}. Run node scripts/footprint.ts to see what grew.`);
  });
}

test('footprint: every tool has a ceiling and stays within it', async () => {
  const f = await footprint('hosted-active');
  const over = f.tools.filter((t) => t.tokens > (ceilings.tools[t.name] ?? 0)).map((t) => `${t.name}: ${t.tokens} tokens, ceiling ${ceilings.tools[t.name] ?? 'none'}`);
  assert.deepEqual(over, [], 'shrink it, or raise its ceiling in test/footprint-ceilings.json on purpose');
});
