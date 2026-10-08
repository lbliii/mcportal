import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { releaseArtifacts } from '../scripts/release-artifacts.ts';
test('release archives contain root manifests and runtime assets and their checksums match', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcportal-release-test-'));
  try {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const files = await releaseArtifacts(directory, pkg.version);
    const checksums = await readFile(files[2]!, 'utf8');
    for (const archive of files.slice(0, 2)) {
      const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
      assert.ok(checksums.includes(`${digest}  ${path.basename(archive)}\n`));
      const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
      assert.match(entries, /\.\/plugin.json/);
      assert.match(entries, /\.\/mcp.json/);
      assert.doesNotMatch(entries, /node_modules|\.env|\.git\//);
      if (archive.includes('local')) {
        assert.match(entries, /\.\/bin\/mcportal.mjs/);
        assert.match(entries, /\.\/brand\/lockup-on-dark.svg/);
      } else assert.doesNotMatch(entries, /\.\/src\//);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
