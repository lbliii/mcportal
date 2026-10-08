/** Opt-in host probe. Only Claude's configuration is isolated; Codex probes use a repo-scoped catalog. */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPlugin } from './plugin-package.ts';

const destination = process.env.MCPORTAL_HOST_PACKAGES || await mkdtemp(path.join(tmpdir(), 'mcportal-host-check-')); 
const local = path.join(destination, 'local');
if (!process.env.MCPORTAL_HOST_PACKAGES) {
  await buildPlugin('local', local);
  await buildPlugin('hosted', path.join(destination, 'hosted'));
}
const entries = ['local', 'hosted'].map((kind) => ({ name: kind === 'local' ? 'mcportal-local' : 'mcportal', source: `./${kind}` }));
await mkdir(path.join(destination, '.claude-plugin'), { recursive: true });
await mkdir(path.join(destination, '.agents/plugins'), { recursive: true });
await writeFile(path.join(destination, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'mcportal-host-check', owner: { name: 'MCPortal' }, plugins: entries }));
await writeFile(path.join(destination, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'mcportal-host-check', plugins: entries.map((entry) => ({ ...entry, source: { source: 'local', path: entry.source }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' })) }));
const claude = process.env.MCPORTAL_CLAUDE_CLI;
if (!claude) throw new Error('Set MCPORTAL_CLAUDE_CLI to a current Claude Code executable. No host configuration has been changed.');
const run = (...args: string[]) => execFileSync(claude, args, { cwd: destination, env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(destination, 'claude-config') }, encoding: 'utf8', timeout: 60_000 });
console.log(run('--version'));
console.log(run('plugin', 'validate', local));
console.log(run('plugin', 'validate', path.join(destination, 'hosted')));
console.log(run('plugin', 'marketplace', 'add', destination, '--json'));
console.log(run('plugin', 'install', 'mcportal-local@mcportal-host-check'));
const before = JSON.parse(run('plugin', 'list', '--json'));
if (before[0]?.version !== JSON.parse(await readFile(path.join(local, 'plugin.json'), 'utf8')).version) throw new Error('Installed version does not match package');
const data = path.join(destination, 'claude-config/plugins/data/mcportal-local-mcportal-host-check/mcportal');
await mkdir(data, { recursive: true, mode: 0o700 });
await writeFile(path.join(data, 'retained-test.json'), 'retained');
const metadataPath = path.join(local, '.claude-plugin/plugin.json');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
metadata.version = '99.0.0';
await writeFile(metadataPath, JSON.stringify(metadata));
console.log(run('plugin', 'update', 'mcportal-local@mcportal-host-check'));
const after = JSON.parse(run('plugin', 'list', '--json'));
if (after[0]?.version !== '99.0.0') throw new Error('Host did not install the changed version');
if (await readFile(path.join(data, 'retained-test.json'), 'utf8') !== 'retained') throw new Error('Update lost retained plugin data');
console.log(run('plugin', 'uninstall', 'mcportal-local@mcportal-host-check', '--keep-data'));
console.log(`Probe files and evidence remain in ${destination}. Codex catalog is available at .agents/plugins/marketplace.json; run codex plugin list from this directory to inspect discovery. Desktop reload and OAuth require manual verification.`);
