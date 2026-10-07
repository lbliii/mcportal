/** The release script's pure parts: versions, the changelog, and editing version strings in place. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { changelogSection, nextVersion, releaseChangelog, statedVersions, withVersion } from '../scripts/release.ts';

test('release: the next version, explicit or bumped', () => {
  assert.equal(nextVersion('0.5.0', '0.6.0'), '0.6.0');
  assert.equal(nextVersion('0.5.3', 'patch'), '0.5.4');
  assert.equal(nextVersion('0.5.3', 'minor'), '0.6.0');
  assert.equal(nextVersion('0.5.3', 'major'), '1.0.0');
  assert.throws(() => nextVersion('0.5.0', 'v0.6'), /isn't a version/);
});

const CHANGELOG = `# Changelog

## Unreleased

### New
- A thing.

## v0.3.0 — 2026-09-30

Older.
`;

test('release: "Unreleased" moves under the version, and a fresh one stays on top', () => {
  const out = releaseChangelog(CHANGELOG, '0.5.0', '2026-10-02');
  assert.equal(out, `# Changelog

## Unreleased

## v0.5.0 — 2026-10-02

### New
- A thing.

## v0.3.0 — 2026-09-30

Older.
`);
  assert.equal(changelogSection(out, '0.5.0'), '### New\n- A thing.');
  assert.equal(changelogSection(out, '0.3.0'), 'Older.');
  assert.throws(() => releaseChangelog(out, '0.6.0', '2026-10-03'), /empty/, 'nothing new since the last release');
  assert.throws(() => releaseChangelog(CHANGELOG, '0.3.0', '2026-10-03'), /already has a v0\.3\.0/);
  assert.throws(() => changelogSection(CHANGELOG, '0.4.0'), /no v0\.4\.0/);
});

test('release: versions are edited in place, keeping each file as it is', async () => {
  const plugin = '{\n  "name": "mcportal",\n  "version": "0.5.0",\n  "keywords": ["a", "b"]\n}\n';
  assert.equal(withVersion('.claude-plugin/plugin.json', plugin, '0.6.0'), plugin.replace('0.5.0', '0.6.0'), 'one-line arrays stay one line');

  const lock = await readFile(new URL('../package-lock.json', import.meta.url), 'utf8');
  const bumped = withVersion('package-lock.json', lock, '9.9.9');
  assert.deepEqual(statedVersions('package-lock.json', bumped), ['9.9.9', '9.9.9'], 'the top and the root package');
  assert.equal(bumped.split('"version": "9.9.9"').length - 1, 2, 'dependencies keep their versions');

  const mcp = await readFile(new URL('../src/mcp.ts', import.meta.url), 'utf8');
  const server = withVersion('src/mcp.ts', mcp, '9.9.9');
  assert.deepEqual(statedVersions('src/mcp.ts', server), ['9.9.9']);
  assert.equal(withVersion('src/mcp.ts', server, statedVersions('src/mcp.ts', mcp)[0]!), mcp, 'only the version changed, including when its length changes');
});
