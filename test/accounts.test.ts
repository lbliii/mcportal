import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorize, localActor, toolAction } from '../src/access.ts';
import { Accounts, makeBootstrap, memoryPersistence } from '../src/accounts.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { handleMessage } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';

const lawrence = { githubId: 42, login: 'Lawrence' };
const mallory = { githubId: 666, login: 'mallory' };

test('accounts: allowlisted accounts depend on config; invited accounts persist until suspended', async () => {
  const p = memoryPersistence();
  const first = new Accounts(p, makeBootstrap([], ['lawrence']));
  await first.invite('mallory', 'admin');
  assert.equal((await first.admit(lawrence)).ok, true);
  assert.equal((await first.admit(mallory)).ok, true);
  assert.equal((await first.admit({ githubId: 7, login: 'eve' })).ok, false);

  // Restart with Lawrence removed from the allowlist: he's out, Mallory (invited) stays.
  const second = new Accounts(p, makeBootstrap(['someone-else'], []));
  await second.load();
  assert.equal(second.isActive(lawrence), false);
  assert.equal(second.isActive(mallory), true);
  assert.deepEqual(await second.admit(lawrence), { ok: false, reason: 'not_invited' });

  // A GitHub rename keeps the account (the numeric id is what counts).
  const renamed = await second.admit({ githubId: 666, login: 'mallory-new' });
  assert.equal(renamed.ok && renamed.account.login, 'mallory-new');
  assert.equal(renamed.ok && renamed.account.id, 'github-666');
});

test('invites: a stable link per invite, kept after use, gone when revoked', async () => {
  const accounts = new Accounts(memoryPersistence(), makeBootstrap(['admin'], []));
  const first = await accounts.invite('@Mallory', 'admin:x');
  const again = await accounts.invite('mallory', 'admin:x');
  assert.equal(again.code, first.code, 'inviting again keeps the same link');
  assert.equal((await accounts.findInvite(first.code!))?.login, 'mallory');
  await accounts.admit(mallory);
  assert.ok((await accounts.findInvite(first.code!))?.acceptedAt, 'kept after use');
  assert.equal((await accounts.list()).invites.length, 0, 'but no longer pending');
  assert.equal(await accounts.uninvite('mallory', 'x'), false, 'used invites cannot be revoked');
  await assert.rejects(accounts.invite('mallory', 'x'), /already has an account/);
  const eve = await accounts.invite('eve', 'x');
  assert.equal(await accounts.uninvite('eve', 'x'), true);
  assert.equal(await accounts.findInvite(eve.code!), undefined);
  assert.equal(await accounts.findInvite('../../etc/passwd'), undefined);
});

test('accounts: open sign-up only when nothing is configured or explicitly on; admins from bootstrap', async () => {
  assert.equal(makeBootstrap([], []).openSignup, true, 'matches the old behavior');
  assert.equal(makeBootstrap(['x'], []).openSignup, false);
  assert.equal(makeBootstrap(['x'], [], true).openSignup, true);
  const accounts = new Accounts(memoryPersistence(), makeBootstrap(['42'], []));
  const admitted = await accounts.admit(lawrence);
  assert.equal(admitted.ok && admitted.account.role, 'admin');
  assert.equal(accounts.actor('github-42').role, 'admin');
  assert.equal(accounts.actor('github-999').role, 'user', 'unknown accounts are plain users');
  await assert.rejects(accounts.invite('bad login!', 'x'), /valid GitHub login/);
  await assert.rejects(accounts.setStatus('nobody', 'suspended', 'x'), /No account/);
});

test('access: suspended accounts do nothing; admin actions need the role; owners only', () => {
  const me = { accountId: 'a', role: 'user' as const, status: 'active' as const };
  const admin = { ...me, accountId: 'root', role: 'admin' as const };
  assert.equal(authorize(me, 'write', { ownerId: 'a' }).ok, true);
  assert.equal(authorize(me, 'read', { ownerId: 'b' }).ok, false);
  assert.equal(authorize(admin, 'write', { ownerId: 'b' }).ok, false, 'admins touch others only via admin actions');
  assert.equal(authorize(admin, 'admin', { ownerId: 'b' }).ok, true);
  assert.equal(authorize(me, 'admin').ok, false);
  assert.equal(authorize({ ...me, status: 'suspended' }, 'read', { ownerId: 'a' }).ok, false);
  assert.equal(toolAction('get_profile'), 'read');
  assert.equal(toolAction('save_item'), 'write');
  assert.equal(toolAction('some_future_tool'), 'write', 'unknown tools are treated as writes');
  assert.equal(localActor('default').status, 'active');
});

test('access: the gate runs before every tool call', async () => {
  const ctx = { store: new MemoryProfileStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'a', actor: { accountId: 'a', role: 'user' as const, status: 'suspended' as const } };
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_profile', arguments: {} } }, ctx);
  const result = (res as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /suspended/);
  // An actor for someone else's portal is refused too (tools never act across accounts).
  const other = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_profile', arguments: {} } }, { ...ctx, actor: { accountId: 'b', role: 'user', status: 'active' } });
  assert.match((other as { result: { content: Array<{ text: string }> } }).result.content[0]!.text, /someone else/);
});
