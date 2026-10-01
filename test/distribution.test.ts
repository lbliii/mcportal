/** The registry entry and the bundle manifest match the server, and every place that states a version agrees. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { SERVER_INFO } from '../src/mcp.ts';
import { staleDistributionFiles } from '../scripts/distribution.ts';

const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')) as { version: string };

test('distribution: server.json and manifest.json are generated and current', async () => {
  assert.deepEqual(await staleDistributionFiles(), [], 'run node scripts/distribution.ts and commit what it writes');
});

test('distribution: one version everywhere', async () => {
  const version = (await read('package.json')).version;
  assert.equal(SERVER_INFO.version, version, 'src/mcp.ts SERVER_INFO');
  assert.equal((await read('.claude-plugin/plugin.json')).version, version, '.claude-plugin/plugin.json');
  assert.equal((await read('server.json')).version, version);
  assert.equal((await read('manifest.json')).version, version);
});
