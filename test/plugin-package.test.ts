import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { buildPlugin } from '../scripts/plugin-package.ts';

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
test('Agent Plugins: both packages validate against official 1.0.0 schemas and local runtime boots outside source tree', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'mcportal-package-'));
  try {
    const ajv = new Ajv2020({ strict: false });
    const manifest = ajv.compile(await json(new URL('schemas/agent-plugin-1.0.0.json', import.meta.url).pathname));
    const mcp = ajv.compile(await json(new URL('schemas/agent-mcp-1.0.0.json', import.meta.url).pathname));
    const version = (await json(new URL('../package.json', import.meta.url).pathname)).version;
    for (const variant of ['hosted', 'local'] as const) {
      const dest = path.join(temp, variant);
      await buildPlugin(variant, dest);
      const metadata = await json(path.join(dest, 'plugin.json'));
      assert.ok(manifest(metadata), JSON.stringify(manifest.errors));
      assert.equal((metadata as { version: string }).version, version);
      assert.ok(mcp(await json(path.join(dest, 'mcp.json'))), JSON.stringify(mcp.errors));
      await access(path.join(dest, 'skills/portal/SKILL.md'));
      await assert.rejects(access(path.join(dest, '.env')));
      await assert.rejects(buildPlugin(variant, dest), /EEXIST/);
    }
    await assert.rejects(access(path.join(temp, 'hosted/src')));
    const child = spawn(process.execPath, [path.join(temp, 'local/bin/mcportal.mjs'), '--stdio'], {
      cwd: temp, env: { ...process.env, MCPORTAL_DATA_DIR: path.join(temp, 'data') }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const result = await new Promise<string>((resolve, reject) => {
        let output = '', errors = '';
        child.stderr.on('data', (chunk) => { errors += String(chunk); });
        const timer = setTimeout(() => reject(new Error('Packaged MCP initialization timed out')), 10_000);
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => { clearTimeout(timer); if (!output.includes('\n')) reject(new Error(`Packaged server exited ${code}: ${errors}`)); });
        child.stdout.on('data', (chunk) => { output += String(chunk); if (output.includes('\n')) { clearTimeout(timer); resolve(output.split('\n')[0]!); } });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'package-test', version: '1' } } }) + '\n');
      });
      assert.equal(JSON.parse(result).result.serverInfo.version, version);
    } finally { child.kill(); }
  } finally { await rm(temp, { recursive: true, force: true }); }
});
