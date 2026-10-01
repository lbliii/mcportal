/**
 * What MCPortal costs every conversation it's connected to (scripts/footprint.ts).
 * These ceilings only go down: lower them when the footprint shrinks.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { footprint } from '../scripts/footprint.ts';

/** Approximate tokens of tool list plus instructions, as the model sees them. */
const CEILING = { hosted: 7321, local: 5691 };

for (const where of ['hosted', 'local'] as const) {
  test(`footprint (${where}): the tool list and instructions stay within budget`, async () => {
    const f = await footprint(where);
    assert.ok(f.total <= CEILING[where], `${where}: ${f.total} tokens, over the ceiling of ${CEILING[where]}. Run node scripts/footprint.ts to see what grew.`);
    if (f.total < CEILING[where]) console.log(`footprint (${where}) is ${f.total} tokens: lower CEILING.${where} in test/footprint.test.ts`);
  });
}
