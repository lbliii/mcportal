/**
 * The browser scripts type-check like the server does (scripts/check-ui.ts): the room's
 * fragments assembled as the page runs them, and the admin page.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUi } from '../scripts/check-ui.ts';

test('ui: the room and admin scripts type-check', async () => {
  const problems = await checkUi();
  assert.deepEqual(problems.map((p) => `${p.file}:${p.line} ${p.message}`), []);
});
