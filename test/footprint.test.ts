/**
 * What MCPortal costs a conversation that loads its tools up front (scripts/footprint.ts),
 * per profile, estimated. Ceilings only go down: lower them when the footprint shrinks.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { footprint, PROFILES, type Profile } from '../scripts/footprint.ts';

/** Estimated tokens of the tools (name, description, schema) and instructions the model sees. */
const CEILING: Record<Profile, number> = { local: 4730, 'hosted-new': 5419, 'hosted-active': 5961 };

for (const profile of PROFILES) {
  test(`footprint (${profile}): the tools and instructions stay within budget`, async () => {
    const f = await footprint(profile);
    assert.ok(f.total <= CEILING[profile], `${profile}: ${f.total} tokens, over the ceiling of ${CEILING[profile]}. Run node scripts/footprint.ts to see what grew.`);
    if (f.total < CEILING[profile]) console.log(`footprint (${profile}) is ${f.total} tokens: lower its CEILING in test/footprint.test.ts`);
  });
}
