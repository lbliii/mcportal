/**
 * The tool contract that hosts and directory review read: names, titles and all three
 * hints stated, and the hints agreeing with what each tool does (its access level).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOLS } from '../src/tools/index.ts';
import { publicToolList } from '../src/tools/kit.ts';

test('every tool states a title and all three hints', () => {
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z][a-z0-9_]{0,63}$/, `${t.name}: short snake_case name`);
    assert.ok(t.title.trim(), `${t.name}: title`);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) {
      assert.equal(typeof t.annotations[hint], 'boolean', `${t.name}: ${hint} stated`);
    }
  }
});

test('the hints agree with what each tool does', () => {
  for (const t of TOOLS) {
    const a = t.annotations;
    if (t.access === 'write') assert.equal(a.readOnlyHint, false, `${t.name} changes data, so it isn't read-only`);
    if (a.readOnlyHint) assert.equal(a.destructiveHint, false, `${t.name}: a read-only tool can't destroy anything`);
    if (t.access === 'fetch') assert.equal(a.openWorldHint, true, `${t.name} fetches the web, so it's open-world`);
  }
});

test('tools/list carries the annotations to hosts', () => {
  for (const t of publicToolList(TOOLS)) assert.ok(t.annotations && 'openWorldHint' in t.annotations, t.name);
});
