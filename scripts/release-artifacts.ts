/** Build and hash exactly the packages the release publishes. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPlugin } from './plugin-package.ts';
export async function releaseArtifacts(destination: string, version: string): Promise<string[]> {
  await mkdir(destination, { recursive: true });
  const archives: string[] = [];
  const hashes: string[] = [];
  for (const variant of ['hosted', 'local'] as const) {
    const directory = `mcportal-${variant}-v${version}`;
    await buildPlugin(variant, path.join(destination, directory));
    const metadata = JSON.parse(await readFile(path.join(destination, directory, 'plugin.json'), 'utf8'));
    if (metadata.version !== version) throw new Error('Release package version mismatch');
    const archive = path.join(destination, `${directory}.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', path.join(destination, directory), '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    hashes.push(`${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${path.basename(archive)}`);
    archives.push(archive);
  }
  const checksums = path.join(destination, 'SHA256SUMS');
  await writeFile(checksums, hashes.join('\n') + '\n');
  return [...archives, checksums];
}
