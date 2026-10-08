/**
 * The files that describe MCPortal to the places people find and install it,
 * generated from package.json and the server itself so they can't drift:
 *
 *   server.json     the MCP Registry entry (the hosted server, by URL)
 *   manifest.json   the MCPB bundle manifest (a local install in Claude desktop)
 *
 *   node scripts/distribution.ts           write them
 *   node scripts/distribution.ts --check   fail if they're out of date (test/distribution.test.ts)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pluginMetadata, pluginMcp } from './plugin-package.ts';
import { surface } from './footprint.ts';

const ROOT = new URL('../', import.meta.url);
const HOSTED = 'https://mcportal.lol';
const REPOSITORY = 'https://github.com/lbliii/mcportal';
const NAME = 'io.github.lbliii/mcportal';

interface Package { version: string; description: string; engines: { node: string } }

export async function distributionFiles(): Promise<Record<string, string>> {
  const pkg = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8')) as Package;
  const plugin = JSON.parse(await readFile(new URL('.claude-plugin/plugin.json', ROOT), 'utf8')) as { description: string; author: { name: string }; keywords: string[] };
  const local = await surface('local');
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

  const server = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: NAME,
    description: 'Your reading room in your agent: portals onto feeds, docs, Hacker News and GitHub, with reader view, clips and saved links.',
    version: pkg.version,
    repository: { url: REPOSITORY, source: 'github' },
    websiteUrl: HOSTED,
    // Sign-in is OAuth (discovered from the server), so no headers to configure.
    remotes: [{ type: 'streamable-http', url: `${HOSTED}/mcp` }],
  };

  const manifest = {
    manifest_version: '0.3',
    name: 'mcportal',
    display_name: 'MCPortal',
    version: pkg.version,
    description: plugin.description,
    long_description: 'MCPortal is your reading room inside your agent. Open it to see portals onto the sources you follow (any site with a feed, Hacker News, GitHub, documentation sites), arranged the way you ask. Read articles and docs without the clutter, save links, clip things from the conversation, and import or export your subscriptions. This bundle runs MCPortal on your computer: your room lives in ~/.mcportal and nothing is sent anywhere but the sites you follow.',
    author: { name: plugin.author.name, url: REPOSITORY },
    homepage: HOSTED,
    repository: { type: 'git', url: `${REPOSITORY}.git` },
    icon: 'src/site/icon-512.png',
    server: {
      type: 'node',
      entry_point: 'bin/mcportal.mjs',
      mcp_config: { command: 'node', args: ['${__dirname}/bin/mcportal.mjs', '--stdio'], env: {} },
    },
    // What a local MCPortal offers (no sharing or public profiles: those are hosted only).
    tools: local.tools.map((t) => ({ name: t.name, description: t.description.split(/(?<=\.)\s/)[0] })),
    tools_generated: false,
    keywords: plugin.keywords,
    license: 'AGPL-3.0-only',
    privacy_policies: [`${HOSTED}/privacy`],
    // MCPortal runs its .ts files directly, which needs Node 22.18 or later.
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: pkg.engines.node } },
  };

  return { 'server.json': json(server), 'manifest.json': json(manifest),
    'plugin.json': json(await pluginMetadata('local')), 'mcp.json': json(pluginMcp('local')) };
}

/** Files whose committed contents differ from what would be generated. */
export async function staleDistributionFiles(): Promise<string[]> {
  const stale: string[] = [];
  for (const [name, contents] of Object.entries(await distributionFiles())) {
    const current = await readFile(new URL(name, ROOT), 'utf8').catch(() => '');
    if (current !== contents) stale.push(name);
  }
  return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = await staleDistributionFiles();
    console.error(stale.length ? `Out of date: ${stale.join(', ')}. Run node scripts/distribution.ts` : 'Distribution files are current');
    process.exitCode = stale.length ? 1 : 0;
  } else {
    for (const [name, contents] of Object.entries(await distributionFiles())) await writeFile(new URL(name, ROOT), contents);
    console.error('Wrote server.json and manifest.json');
  }
}
