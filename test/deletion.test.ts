/**
 * Deleting an account leaves nothing that names it. Every kind of data is created for
 * one account (and a bystander) in file-backed stores, the account is deleted, and then
 * every file in the data directory is searched for its id, login and computer name.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { deleteAccountData } from '../src/account.ts';
import { runAdmin } from '../src/admin-cli.ts';
import { Accounts, makeBootstrap } from '../src/accounts.ts';
import { AuthStore, fileAuthPersistence } from '../src/auth/store.ts';
import { buildClip, FileClipStore } from '../src/clips.ts';
import { buildEdition, FileEditionStore } from '../src/editions.ts';
import { FileHandoffStore } from '../src/handoffs.ts';
import { safeFileId } from '../src/lib/files.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore } from '../src/seen.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { FileProfileStore } from '../src/store.ts';

async function filesUnder(dir: string): Promise<Array<{ file: string; text: string }>> {
  const out: Array<{ file: string; text: string }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    out.push({ file: path.relative(dir, file), text: await readFile(file, 'utf8') });
  }
  return out;
}

test('deleting an account leaves nothing that names it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-delete-'));
  const accounts = new Accounts(fileAuthPersistence(dir, 'accounts.json'), makeBootstrap(['admin'], [], true));
  const auth = new AuthStore(dir);
  const publicProfiles = new PublicProfiles(fileAuthPersistence(dir, 'public-profiles.json'));
  const socialStore = new DocumentSocialStore(fileAuthPersistence(dir, 'social.json'));
  const social = new Social({ store: socialStore, profiles: publicProfiles });
  const deps = {
    accounts, oauth: auth, publicProfiles, social,
    store: new FileProfileStore(dir), reading: new FileReadingStore(dir), handoffs: new FileHandoffStore(dir),
    seen: new FileSeenStore(dir), editions: new FileEditionStore(dir), clips: new FileClipStore(dir),
  };

  // Two accounts: lawrence (to delete, who came in by invite) and friend (who stays). Sign-up is open.
  await accounts.invite('lawrence', 'admin-cli:ops');
  const admitted = await accounts.admit({ githubId: 4242, login: 'lawrence' });
  assert.ok(admitted.ok);
  const me = admitted.account.id;
  await accounts.setStatus('lawrence', 'suspended', 'admin-cli:ops', 'checking a report about @lawrence');
  await accounts.setStatus('lawrence', 'active', 'admin-cli:ops');
  await accounts.invite('pal', me);   // someone lawrence invited
  const friendAdmitted = await accounts.admit({ githubId: 77, login: 'friend' });
  assert.ok(friendAdmitted.ok);
  const friend = friendAdmitted.account.id;

  // Everything lawrence can have.
  await deps.store.put(me, validateProfile({ ...defaultProfile(), name: "Lawrence's room", saved: [{ url: 'https://example.com/a', title: 'Saved' }] }));
  await writeFile(path.join(dir, `${safeFileId(me)}.corrupt-1700000000000.json`), '{"name": "Lawrence\'s broken room"');
  await deps.clips.add(me, buildClip({ kind: 'quote', text: 'a quote lawrence kept' }));
  await deps.reading.record(me, { url: 'https://example.com/read', status: 'opened', title: 'Read' });
  await deps.handoffs.create(me, { url: 'https://example.com/handoff', title: 'Handoff', place: { kind: 'article' }, passage: 'a passage lawrence chose' });
  await deps.seen.mark(me, [{ portalId: 'hn', itemIds: ['1', '2'] }]);
  await deps.editions.put(me, buildEdition({ title: 'Picks', picks: [{ ref: 'hn:1', why: 'good' }] }));
  await publicProfiles.set(me, { handle: 'old_handle' });
  await publicProfiles.set(me, { handle: 'larry_reads', displayName: 'Lawrence' });   // old_handle is now held for him
  await publicProfiles.set(friend, { handle: 'a_friend' });
  const shared = await social.share(me, { kind: 'link', title: 'A link', url: 'https://example.com/s' });
  await social.follow(friend, 'larry_reads');
  await social.follow(me, 'a_friend');
  const filed = await social.report(me, { handle: 'a_friend' }, 'spam from them');
  await social.resolveReport(filed.id, 'admin-cli:ops', 'dismissed');
  await social.report(friend, { shareId: shared.id }, 'rude');
  await social.report(friend, { handle: 'larry_reads' }, 'rude again');
  const laptop = await auth.registerClient({ client_name: 'MCPortal on Lawrences-MacBook', redirect_uris: ['http://127.0.0.1/cb'] });
  await auth.issueTokens({ userId: me, githubId: 4242, login: 'lawrence' }, laptop.client_id, 'https://mcportal.test/mcp', 'mcportal');
  const friendsApp = await auth.registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
  await auth.issueTokens({ userId: friend, githubId: 77, login: 'friend' }, friendsApp.client_id, 'https://mcportal.test/mcp', 'mcportal');

  const before = await filesUnder(dir);
  assert.ok(before.some((f) => f.text.includes(me)), 'the search can find him before');

  await deleteAccountData(me, deps);

  // Nothing names him: not his id (his GitHub id), login, name, computer, or anything he wrote.
  const traces = ['4242', 'lawrence', 'Lawrence', 'Lawrences-MacBook', 'spam from them'];
  const after = await filesUnder(dir);
  const found = after.flatMap((f) => traces.filter((t) => f.text.includes(t)).map((t) => `${f.file}: ${t}`));
  assert.deepEqual(found, [], 'no file mentions the deleted account');
  assert.ok(!after.some((f) => f.file.includes(safeFileId(me))), 'no file is named for him (the room, its unreadable copy, clips)');

  // What outlasts him, by design: his handles stay held (so nobody can pose as him) and
  // reports about him stay for admins, all without saying whose they were.
  const profiles = JSON.parse(await readFile(path.join(dir, 'public-profiles.json'), 'utf8'));
  assert.deepEqual(Object.keys(profiles.held).sort(), ['larry_reads', 'old_handle']);
  assert.ok(Object.values(profiles.held).every((h) => (h as { accountId: string }).accountId === 'deleted'));
  assert.equal((await publicProfiles.byHandle('larry_reads')), undefined);
  const reports = await social.reports();
  assert.equal(reports.length, 3, 'reports stay for admins');
  assert.ok(reports.every((r) => r.status === 'resolved'), 'the ones about him are closed: nothing is left to act on');
  assert.ok((await accounts.auditLog(50)).some((e) => e.action === 'account.deleted'), 'the deletion is in the audit log');

  // The bystander keeps everything, including the app they signed in with.
  assert.equal((await publicProfiles.get(friend))?.handle, 'a_friend');
  assert.equal((await auth.grantsOf(friend)).length, 1);
  assert.ok(after.some((f) => f.text.includes(friend)));
});

test('admin delete: for someone who lost GitHub access, only with --confirm, and audited', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-admin-delete-'));
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;   // files in `dir`, like a server without Postgres
  try {
    const accounts = new Accounts(fileAuthPersistence(dir, 'accounts.json'), makeBootstrap([], [], true));
    const admitted = await accounts.admit({ githubId: 4242, login: 'lawrence' });
    assert.ok(admitted.ok);
    await new FileProfileStore(dir).put(admitted.account.id, validateProfile({ ...defaultProfile(), name: 'Mine' }));
    await new FileClipStore(dir).add(admitted.account.id, buildClip({ kind: 'quote', text: 'kept' }));

    const lines: string[] = [];
    const run = (...args: string[]) => runAdmin(args, dir, (l) => lines.push(l));
    assert.equal(await run('delete', '@lawrence'), 2, 'without --confirm it only says what it would do');
    assert.match(lines.join('\n'), /can't be undone/);
    assert.ok(await new FileProfileStore(dir).get(admitted.account.id).then((p) => p.name === 'Mine'), 'nothing deleted yet');
    assert.equal(await run('delete', 'nobody'), 1);
    assert.equal(await run('delete', '@lawrence', '--confirm'), 0);
    assert.match(lines.at(-1)!, /Deleted github-4242 \(@lawrence\): 1 clip/);

    const after = await filesUnder(dir);
    assert.deepEqual(after.filter((f) => f.text.includes('4242') || f.text.includes('lawrence')).map((f) => f.file), []);
    const fresh = new Accounts(fileAuthPersistence(dir, 'accounts.json'), makeBootstrap([], [], true));
    const entry = (await fresh.auditLog(5)).find((e) => e.action === 'account.deleted');
    assert.match(entry?.actor ?? '', /^admin-cli:/, 'the admin who did it is recorded');
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  }
});
