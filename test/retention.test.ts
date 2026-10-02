/** What's kept only for a while goes on schedule (src/housekeeping.ts), even on a quiet server. */
import assert from 'node:assert/strict';
import { mkdtemp, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Accounts, AUDIT_DAYS, makeBootstrap, PENDING_INVITE_DAYS } from '../src/accounts.ts';
import { AuthStore, CLIENT_IDLE_SECONDS } from '../src/auth/store.ts';
import { buildEdition, FileEditionStore, MemoryEditionStore } from '../src/editions.ts';
import { FileHandoffStore, HANDOFF_DAYS, MemoryHandoffStore } from '../src/handoffs.ts';
import { housekeep, retentionTasks } from '../src/housekeeping.ts';
import { memoryPersistence } from '../src/lib/document.ts';
import { sha256Hex } from '../src/lib/ids.ts';
import { silentLogger } from '../src/lib/log.ts';

const DAY = 86_400_000;
const page = { url: 'https://example.com/p', title: 'P', place: { kind: 'article' as const } };

test('retention: app registrations nobody uses are forgotten after 180 days', async () => {
  let now = Date.UTC(2026, 0, 1);
  const auth = new AuthStore(memoryPersistence(), () => now);
  const idle = await auth.registerClient({ client_name: 'MCPortal on an old laptop', redirect_uris: ['http://127.0.0.1/cb'] });
  const used = await auth.registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
  now += CLIENT_IDLE_SECONDS * 1000 - 10 * DAY;
  await auth.issueTokens({ userId: 'u', githubId: 1, login: 'u' }, used.client_id, 'https://x.test/mcp', 'mcportal');   // signed in recently
  now += 10 * DAY + 1000;
  await auth.prune();
  assert.equal(await auth.getClient(idle.client_id), undefined, 'unused for 180 days, no tokens: gone');
  assert.ok(await auth.getClient(used.client_id), 'a client someone is signed in with stays');
});

test('retention: the audit log keeps a year, and invites nobody used lapse after 90 days', async () => {
  let now = Date.UTC(2026, 0, 1);
  const accounts = new Accounts(memoryPersistence(), makeBootstrap(['admin'], []), () => now);
  await accounts.invite('early', 'admin');
  now += (PENDING_INVITE_DAYS - 1) * DAY;
  await accounts.invite('later', 'admin');
  now += 2 * DAY;
  await accounts.prune();
  assert.deepEqual((await accounts.list()).invites.map((i) => i.login), ['later'], 'the 91-day-old invite lapsed');
  now += AUDIT_DAYS * DAY - 50 * DAY;
  await accounts.prune();
  assert.deepEqual((await accounts.auditLog(10)).map((e) => e.target), ['later'], 'entries older than a year go');
});

test('retention: expired handoffs and highlights are purged, in memory, files and on schedule', async () => {
  let now = new Date(Date.UTC(2026, 0, 1));
  const clock = () => now;
  const handoffs = new MemoryHandoffStore(clock);
  const editions = new MemoryEditionStore(clock);
  await handoffs.create('u', page);
  await editions.put('u', buildEdition({ title: 'Picks', picks: [] }, now));
  now = new Date(now.getTime() + HANDOFF_DAYS * DAY + 1);
  const removed = await housekeep(retentionTasks({ handoffs, editions }), silentLogger);
  assert.deepEqual(removed, { handoffs: 1, editions: 1 });

  // Files: one whose last write is past the expiry window goes; a fresh one stays.
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-retention-'));
  const files = { handoffs: new FileHandoffStore(dir), editions: new FileEditionStore(dir) };
  await files.handoffs.create('old', page);
  await files.handoffs.create('new', page);
  await files.editions.put('old', buildEdition({ title: 'Picks', picks: [] }));
  // The 'old' user's files (named by a hash of the id) were last written past the window.
  const stale = new Date(Date.now() - HANDOFF_DAYS * DAY - 60_000);
  await utimes(path.join(dir, 'handoffs', `${sha256Hex('old')}.json`), stale, stale);
  await utimes(path.join(dir, 'editions', `${sha256Hex('old')}.json`), stale, stale);
  assert.deepEqual(await housekeep(retentionTasks(files), silentLogger), { handoffs: 1, editions: 1 });
  assert.equal((await files.handoffs.list('old')).length, 0);
  assert.equal((await files.handoffs.list('new')).length, 1, 'a live one stays');
});

test('retention: a failing task is logged and the others still run', async () => {
  const warnings: string[] = [];
  const log = { ...silentLogger, warn: (event: string) => { warnings.push(event); }, child: () => log };
  const removed = await housekeep([{ name: 'broken', run: async () => { throw new Error('db down'); } }, { name: 'fine', run: async () => 3 }], log);
  assert.deepEqual(removed, { fine: 3 });
  assert.deepEqual(warnings, ['housekeeping.failed']);
});
