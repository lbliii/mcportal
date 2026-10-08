import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { migrateData } from '../src/lib/migrate-data.ts';
import { checkCompatibility } from '../src/link/compatibility.ts';
import { startSignIn } from '../src/link/signin.ts';
import { LinkFile } from '../src/link/link-file.ts';
import { raw, startApp } from './helpers.ts';

test('migration retains nested state and account link, repeats safely, and refuses occupied destinations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcportal-migration-test-'));
  try {
    const source = path.join(root, 'old'), target = path.join(root, 'plugin/mcportal');
    await mkdir(path.join(source, 'clips'), { recursive: true });
    await writeFile(path.join(source, 'default.json'), '{"name":"my room"}');
    await writeFile(path.join(source, 'clips/one.json'), '{"text":"retained"}');
    await writeFile(path.join(source, 'link.json'), '{"token":"test-only"}', { mode: 0o600 });
    assert.equal(await migrateData(source, target), 'copied');
    assert.equal(await readFile(path.join(target, 'clips/one.json'), 'utf8'), '{"text":"retained"}');
    assert.equal(await readFile(path.join(target, 'link.json'), 'utf8'), await readFile(path.join(source, 'link.json'), 'utf8'));
    assert.equal((await stat(target)).mode & 0o777, 0o700);
    await writeFile(path.join(target, 'default.json'), '{"name":"changed after migration"}');
    assert.equal(await migrateData(source, target), 'already_migrated');
    assert.match(await readFile(path.join(target, 'default.json'), 'utf8'), /changed after migration/);
    assert.match(await readFile(path.join(source, 'default.json'), 'utf8'), /my room/);
    const occupied = path.join(root, 'occupied');
    await mkdir(occupied); await writeFile(path.join(occupied, 'default.json'), 'keep');
    await assert.rejects(migrateData(source, occupied), /already contains data/);
    assert.equal(await readFile(path.join(occupied, 'default.json'), 'utf8'), 'keep');
    await assert.rejects(migrateData(source, path.join(source, 'nested')), /separate|inside source/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('migration refuses symlinks and publishes no partial destination', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcportal-migration-test-'));
  try {
    const source = path.join(root, 'old'), target = path.join(root, 'new');
    await mkdir(source); await writeFile(path.join(source, 'default.json'), 'keep');
    await symlink('/etc/passwd', path.join(source, 'external'));
    await assert.rejects(migrateData(source, target), /symlinks/);
    await assert.rejects(access(target));
    await assert.rejects(access(target + '.migration-lock'));
    assert.equal(await readFile(path.join(source, 'default.json'), 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public compatibility metadata requires an allowed host and no account', async () => {
  const app = await startApp();
  try {
    const result = await raw(app.port, { path: '/.well-known/mcportal' });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).minClientVersion, '0.10.0');
    assert.equal((await raw(app.port, { path: '/.well-known/mcportal', headers: { host: 'evil.invalid' } })).status, 421);
  } finally { await app.close(); }
});

const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
test('compatibility distinguishes required, optional and unavailable updates', async () => {
  const fetcher = (async () => reply({ version: 1, minClientVersion: '0.10.0', recommendedVersion: '0.11.0' })) as typeof fetch;
  assert.equal((await checkCompatibility('https://example.com', '0.7.0', fetcher)).status, 'update_required');
  assert.equal((await checkCompatibility('https://example.com', '0.10.0', fetcher)).status, 'update_available');
  assert.equal((await checkCompatibility('https://example.com', '0.11.0', fetcher)).status, 'current');
  assert.equal((await checkCompatibility('https://example.com', '0.11.0', async () => new Response('', { status: 404 }))).status, 'unavailable');
  assert.equal((await checkCompatibility('https://example.com', '0.11.0', async () => { throw new Error('offline'); })).status, 'unavailable');
  assert.equal((await checkCompatibility('https://example.com', '0.11.0', async () => reply({ version: 1, minClientVersion: 1 }))).status, 'unavailable');
});

test('unsupported client is rejected before OAuth discovery, registration or local callback', async () => {
  const calls: string[] = [];
  await assert.rejects(startSignIn({ server: 'https://example.com', link: new LinkFile('/unused'), fetch: async (url) => {
    calls.push(String(url)); return reply({ version: 1, minClientVersion: '99.0.0', recommendedVersion: '99.0.0' });
  } }), /before sign-in/);
  assert.deepEqual(calls, ['https://example.com/.well-known/mcportal']);
});
