/**
 * Cutting a release, in two steps so it goes through review like any other change:
 *
 *   node scripts/release.ts prepare <x.y.z | patch | minor | major> [--dry-run]
 *       From an up-to-date main: sets the version everywhere it's stated, moves the
 *       changelog's "Unreleased" under it, runs npm run check, and opens a release PR.
 *   node scripts/release.ts publish [--dry-run]
 *       After that PR is merged: tags main's head as v<version> and creates the GitHub
 *       release, with that version's changelog section as its notes.
 *
 * Deploying is separate (see CONTRIBUTING.md). Plugin users only receive a release
 * when the version changes, which is what this is for. MIN_CLIENT_VERSION
 * (src/api/calls.ts) is never raised here: that's a decision of its own.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionFiles } from './distribution.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const at = (file: string) => path.join(ROOT, file);

/** Every hand-written place that states the version (server.json and manifest.json are generated from package.json). */
const VERSIONED = ['package.json', 'package-lock.json', '.claude-plugin/plugin.json', 'src/mcp.ts'] as const;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v: string): [number, number, number] | undefined {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)!, y = parseVersion(b)!;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** The version a spec asks for: an explicit x.y.z, or a bump of the current one. */
export function nextVersion(current: string, spec: string): string {
  if (parseVersion(spec)) return spec;
  const v = parseVersion(current);
  if (!v) throw new Error(`The current version "${current}" isn't x.y.z.`);
  const [major, minor, patch] = v;
  if (spec === 'major') return `${major + 1}.0.0`;
  if (spec === 'minor') return `${major}.${minor + 1}.0`;
  if (spec === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`"${spec}" isn't a version (x.y.z) or patch, minor or major.`);
}

const UNRELEASED = /^## Unreleased[ \t]*\n/m;
const heading = (version: string) => new RegExp(`^## v${version.replace(/\./g, '\\.')}(?:\\s|$)`, 'm');

/** The changelog with "Unreleased" moved under the version (a fresh, empty "Unreleased" stays on top). */
export function releaseChangelog(text: string, version: string, date: string): string {
  const match = UNRELEASED.exec(text);
  if (!match) throw new Error('CHANGELOG.md has no "## Unreleased" section.');
  if (heading(version).test(text)) throw new Error(`CHANGELOG.md already has a v${version} section.`);
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  if (!(next === -1 ? rest : rest.slice(0, next)).trim()) throw new Error('"Unreleased" is empty: nothing to release.');
  return `${text.slice(0, match.index)}## Unreleased\n\n## v${version} — ${date}\n${rest}`;
}

/** One version's section of the changelog, without its heading (the release notes). */
export function changelogSection(text: string, version: string): string {
  const match = heading(version).exec(text);
  if (!match) throw new Error(`CHANGELOG.md has no v${version} section.`);
  const body = text.slice(text.indexOf('\n', match.index) + 1);
  const next = body.search(/^## /m);
  return (next === -1 ? body : body.slice(0, next)).trim();
}

type Versioned = (typeof VERSIONED)[number];

// Where each file states the version. The lockfile states it twice: at the top and for the root package.
const SERVER_INFO_VERSION = /(export const SERVER_INFO = \{[^}]*version: ')([^']*)(')/;
const JSON_VERSION = /("version": ")([^"]*)(")/g;
const occurrences = (file: Versioned) => (file === 'package-lock.json' ? 2 : 1);

/** The versions a file states (edited as text, so the file's formatting is kept). */
export function statedVersions(file: Versioned, text: string): string[] {
  if (file === 'src/mcp.ts') return [SERVER_INFO_VERSION.exec(text)?.[2] ?? ''];
  return [...text.matchAll(JSON_VERSION)].slice(0, occurrences(file)).map((m) => m[2]!);
}

/** A file's contents with the version changed, and nothing else. */
export function withVersion(file: Versioned, text: string, version: string): string {
  if (file === 'src/mcp.ts') {
    if (!SERVER_INFO_VERSION.test(text)) throw new Error('SERVER_INFO in src/mcp.ts not found.');
    return text.replace(SERVER_INFO_VERSION, `$1${version}$3`);
  }
  let left = occurrences(file);
  return text.replace(JSON_VERSION, (whole, open: string, _v: string, close: string) => (left-- > 0 ? `${open}${version}${close}` : whole));
}

/** Every hand-written place that states a version, and what it says (for publish and the tests). */
export async function versionsInRepo(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const file of VERSIONED) out[file] = statedVersions(file, await readFile(at(file), 'utf8'));
  return out;
}

// ------------------------------------------------------------ the two steps

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gh = (...args: string[]) => execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const currentVersion = async () => (JSON.parse(await readFile(at('package.json'), 'utf8')) as { version: string }).version;
const tagExists = (tag: string) => git('tag', '--list', tag) !== '' || git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '';

/** Releases start from exactly what's on origin/main, with nothing uncommitted. A dry run only warns. */
function requireCleanMain(dryRun: boolean): void {
  git('fetch', '--quiet', '--tags', 'origin');
  const problems = [
    git('status', '--porcelain') ? 'There are uncommitted changes. Commit or set them aside first.' : '',
    git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main') ? 'HEAD isn\'t origin/main. Check out the latest main (git switch --detach origin/main) and run this again.' : '',
  ].filter(Boolean);
  if (!problems.length) return;
  if (!dryRun) throw new Error(problems.join(' '));
  for (const p of problems) console.warn(`Warning (a real run stops here): ${p}`);
}

async function prepare(spec: string | undefined, dryRun: boolean): Promise<void> {
  if (!spec) throw new Error('Say which version: prepare <x.y.z | patch | minor | major>.');
  requireCleanMain(dryRun);
  const current = await currentVersion();
  const version = nextVersion(current, spec);
  if (compareVersions(version, current) < 0) throw new Error(`v${version} is older than the current version, ${current}.`);
  if (tagExists(`v${version}`)) throw new Error(`v${version} is already tagged.`);
  const date = new Date().toISOString().slice(0, 10);

  const changes = new Map<string, string>();
  for (const file of VERSIONED) changes.set(file, withVersion(file, await readFile(at(file), 'utf8'), version));
  changes.set('CHANGELOG.md', releaseChangelog(await readFile(at('CHANGELOG.md'), 'utf8'), version, date));
  const notes = changelogSection(changes.get('CHANGELOG.md')!, version);

  console.log(`Release v${version} (${current} before), dated ${date}.`);
  console.log(`Changes: ${[...changes.keys(), 'server.json', 'manifest.json'].join(', ')}.`);
  if (dryRun) {
    console.log(`\nRelease notes (${notes.split('\n').length} lines):\n\n${notes.split('\n').slice(0, 12).join('\n')}\n…\n\nDry run: nothing written.`);
    return;
  }

  const branch = `release/v${version}`;
  git('switch', '--quiet', '-c', branch);
  for (const [file, text] of changes) await writeFile(at(file), text);
  // Generated from package.json, now that it has the new version.
  for (const [file, text] of Object.entries(await distributionFiles())) await writeFile(at(file), text);
  execFileSync('npm', ['run', 'check', '--silent'], { cwd: ROOT, stdio: 'inherit' });

  git('add', '--', ...changes.keys(), 'server.json', 'manifest.json');
  git('commit', '--quiet', '-m', `Release v${version}`);
  git('push', '--quiet', '-u', 'origin', branch);
  const bodyFile = path.join(await mkdtemp(path.join(tmpdir(), 'mcportal-release-')), 'body.md');
  await writeFile(bodyFile, `Release v${version}. After merging, run \`node scripts/release.ts publish\` from the merged main to tag it and create the GitHub release.\n\n${notes}\n`);
  console.log(gh('pr', 'create', '--base', 'main', '--head', branch, '--title', `Release v${version}`, '--body-file', bodyFile));
}

async function publish(dryRun: boolean): Promise<void> {
  requireCleanMain(dryRun);
  const version = await currentVersion();
  const tag = `v${version}`;
  if (tagExists(tag)) throw new Error(`${tag} is already tagged: prepare the next release first.`);
  for (const [file, versions] of Object.entries(await versionsInRepo())) {
    if (versions.some((v) => v !== version)) throw new Error(`${file} says ${versions.join(', ')}, not ${version}.`);
  }
  const notes = changelogSection(await readFile(at('CHANGELOG.md'), 'utf8'), version);
  const commit = git('rev-parse', '--short', 'HEAD');
  if (dryRun) {
    console.log(`Would tag ${commit} as ${tag} and create the GitHub release "MCPortal ${tag}". Dry run: nothing changed.`);
    return;
  }
  git('tag', '-a', tag, '-m', `MCPortal ${tag}`);
  git('push', '--quiet', 'origin', tag);
  const notesFile = path.join(await mkdtemp(path.join(tmpdir(), 'mcportal-release-')), 'notes.md');
  await writeFile(notesFile, `${notes}\n`);
  console.log(gh('release', 'create', tag, '--verify-tag', '--title', `MCPortal ${tag}`, '--notes-file', notesFile));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [step, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const spec = rest.find((a) => !a.startsWith('--'));
  try {
    if (step === 'prepare') await prepare(spec, dryRun);
    else if (step === 'publish') await publish(dryRun);
    else throw new Error('Usage: node scripts/release.ts prepare <x.y.z | patch | minor | major> [--dry-run] | publish [--dry-run]');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
