/** Run before releasing or deploying a raised minimum; GitHub release evidence is read-only. */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MIN_CLIENT_VERSION } from '../src/api/calls.ts';
import { compareVersions } from './release.ts';
import { validateSupportPolicy, type ReplacementRelease, type SupportPolicy } from './release-support.ts';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function checkSupport(baseline?: string): Promise<void> {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const tag = baseline ?? git('describe', '--tags', '--abbrev=0');
  const previous = /export const MIN_CLIENT_VERSION = '([^']+)'/.exec(git('show', `${tag}:src/api/calls.ts`))?.[1];
  if (!previous) throw new Error(`Cannot determine minimum supported client at ${tag}`);
  const policy = JSON.parse(await readFile(new URL('../release-support.json', import.meta.url), 'utf8')) as SupportPolicy;
  let replacement: ReplacementRelease | undefined;
  if (compareVersions(MIN_CLIENT_VERSION, previous) > 0) {
    replacement = JSON.parse(execFileSync('gh', ['release', 'view', `v${MIN_CLIENT_VERSION}`, '--repo', 'lbliii/mcportal', '--json', 'isDraft,publishedAt,assets'], { cwd: ROOT, encoding: 'utf8' }));
  }
  validateSupportPolicy(policy, MIN_CLIENT_VERSION, previous, replacement);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await checkSupport(process.argv[2]);
  console.log('Minimum-client support policy verified');
}
