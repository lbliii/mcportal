/** Build self-contained Agent Plugins directories; no user data or development dependencies. */
import { cp, mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/';
export type PluginVariant = 'hosted' | 'local';
export async function pluginMetadata(variant: PluginVariant, root = ROOT) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  return {
    $schema: `${SCHEMA}plugin.schema.json`, name: variant === 'hosted' ? 'mcportal' : 'mcportal-local',
    version: pkg.version, description: pkg.description,
    author: { name: 'Lawrence Lane' }, homepage: 'https://mcportal.lol',
    repository: 'https://github.com/lbliii/mcportal', license: 'AGPL-3.0-only',
  };
}
export function pluginMcp(variant: PluginVariant) {
  return { $schema: `${SCHEMA}mcp.schema.json`, mcpServers: { mcportal: variant === 'hosted'
    ? { type: 'streamable-http', url: 'https://mcportal.lol/mcp' }
    : { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/bin/mcportal.mjs', '--stdio'],
        env: { MCPORTAL_DATA_DIR: '${PLUGIN_DATA}/mcportal' } } } };
}
export async function buildPlugin(variant: PluginVariant, destination: string, root = ROOT): Promise<void> {
  // Exclusive directory creation prevents overwriting an installed plugin or another build.
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination);
  const files = ['skills', 'LICENSE', ...(variant === 'local' ? ['src', 'bin', 'brand', 'package.json'] : [])];
  for (const file of files) {
    await cp(path.join(root, file), path.join(destination, file), { recursive: true, filter: async (source) => {
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`Package cannot contain symlinks: ${source}`);
      return true;
    } });
  }
  for (const [name, content] of Object.entries({ 'plugin.json': await pluginMetadata(variant, root), 'mcp.json': pluginMcp(variant) })) {
    await writeFile(path.join(destination, name), `${JSON.stringify(content, null, 2)}\n`);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [variant, output] = process.argv.slice(2);
  if ((variant !== 'hosted' && variant !== 'local') || !output) throw new Error('Usage: node scripts/plugin-package.ts <hosted|local> <new output directory>');
  await buildPlugin(variant, path.resolve(output));
}
