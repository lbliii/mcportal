/**
 * Admin commands (identity plan): run on the server, never exposed as MCP tools,
 * so nothing a model reads can invite, suspend or impersonate anyone.
 *
 *   mcportal admin list
 *   mcportal admin invite <github-login>
 *   mcportal admin uninvite <github-login>
 *   mcportal admin suspend <login|account-id> [reason…]
 *   mcportal admin reinstate <login|account-id>
 *   mcportal admin audit [n]
 *   mcportal admin delete <login|account-id> --confirm
 *       Delete an account and everything it owns, as the account page does, for someone
 *       who can't sign in to do it (lost GitHub access). Check who's asking first.
 *
 * On Railway: railway ssh --service mcportal -- node bin/mcportal.mjs admin list
 * Uses the same storage as the server (Postgres when DATABASE_URL is set, else
 * files). The running server picks changes up within 30 seconds.
 */
import { deleteAccountData } from './account.ts';
import { Accounts, bootstrapFromEnv } from './accounts.ts';
import { AuthStore, fileAuthPersistence, type AuthPersistence } from './auth/store.ts';
import { silentLogger } from './lib/log.ts';
import { PublicProfiles } from './public-profiles.ts';
import { Social } from './social.ts';
import { openStorage } from './storage.ts';

const USAGE = `usage: mcportal admin <list | invite <login> | uninvite <login> | suspend <who> [reason] | reinstate <who> | audit [n] | delete <who> --confirm>`;

/** Delete an account with every store the server uses (the same ones, opened the same way). */
async function deleteAccount(who: string, confirmed: boolean, actor: string, dataDir: string, accounts: Accounts, out: (line: string) => void): Promise<number> {
  const q = who.trim().toLowerCase().replace(/^@/, '');
  const account = (await accounts.list()).accounts.find((a) => a.id === q || a.login === q || String(a.githubId) === q);
  if (!account) { out(`No account for ${who}.`); return 1; }
  const name = `${account.id}${account.login ? ` (@${account.login})` : ''}`;
  if (!confirmed) {
    out(`This deletes ${name} and everything it owns: room, saved items, clips, reading, public profile, shares, follows and sign-ins. It can't be undone.`);
    out(`Check who's asking first, then run: mcportal admin delete ${who} --confirm`);
    return 2;
  }
  const storage = await openStorage(dataDir, silentLogger);
  try {
    const publicProfiles = new PublicProfiles(storage.profilesPersistence);
    const done = await deleteAccountData(account.id, {
      accounts, store: storage.store, reading: storage.reading, handoffs: storage.handoffs, seen: storage.seen, editions: storage.editions, clips: storage.clips,
      publicProfiles, social: new Social({ store: storage.social, profiles: publicProfiles }),
      oauth: new AuthStore(storage.authPersistence ?? dataDir),
    }, actor);
    out(`Deleted ${name}: ${done.clips} clip(s), ${done.tokens} sign-in record(s), and the rest of its data. The server applies this within 30 seconds.`);
    return 0;
  } finally {
    await storage.close();
  }
}

async function persistence(dataDir: string): Promise<{ p: AuthPersistence; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (!url) return { p: fileAuthPersistence(dataDir, 'accounts.json'), close: async () => {} };
  const { connect, ensureSchema, pgAuthPersistence } = await import('./db.ts');
  const db = await connect(url);
  await ensureSchema(db);
  return { p: pgAuthPersistence(db, 'accounts'), close: async () => { await db.end?.(); } };
}

const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

export async function runAdmin(args: string[], dataDir: string, out: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Promise<number> {
  const [command, target, ...rest] = args;
  if (!command) { out(USAGE); return 2; }
  const actor = `admin-cli:${process.env.USER || process.env.RAILWAY_SERVICE_NAME || 'unknown'}`;
  const { p, close } = await persistence(dataDir);
  const accounts = new Accounts(p, bootstrapFromEnv(process.env));
  try {
    switch (command) {
      case 'list': {
        const { accounts: all, invites } = await accounts.list();
        out(`${all.length} account(s)`);
        for (const a of all) out(`  ${a.id.padEnd(22)} @${(a.login ?? '?').padEnd(20)} ${a.status.padEnd(10)} ${a.role.padEnd(6)} via ${a.via.padEnd(9)} since ${when(a.createdAt)}`);
        out(`${invites.length} pending invite(s)`);
        for (const i of invites) out(`  @${i.login.padEnd(20)} invited by ${i.invitedBy} on ${when(i.createdAt)}  code ${i.code ?? '(none)'}`);
        return 0;
      }
      case 'invite': {
        if (!target) { out(USAGE); return 2; }
        const invite = await accounts.invite(target, actor);
        const base = process.env.MCPORTAL_PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
        out(`Invited @${invite.login}. Their account is created the first time they sign in with GitHub.`);
        out(base ? `Send them: ${base.replace(/\/+$/, '')}/join/${invite.code}` : `Invite code: ${invite.code} (their link is <public URL>/join/<code>)`);
        return 0;
      }
      case 'uninvite':
        if (!target) { out(USAGE); return 2; }
        out((await accounts.uninvite(target, actor)) ? `Invite for @${target} revoked.` : `No pending invite for @${target}.`);
        return 0;
      case 'suspend':
      case 'reinstate': {
        if (!target) { out(USAGE); return 2; }
        const a = await accounts.setStatus(target, command === 'suspend' ? 'suspended' : 'active', actor, rest.join(' '));
        out(`${a.id} (@${a.login}) is now ${a.status}. The server applies this within 30 seconds.`);
        return 0;
      }
      case 'delete':
        if (!target) { out(USAGE); return 2; }
        return await deleteAccount(target, rest.includes('--confirm'), actor, dataDir, accounts, out);
      case 'audit': {
        const entries = await accounts.auditLog(Number(target) || 50);
        for (const e of entries) out(`  ${when(e.at)}  ${e.action.padEnd(19)} ${e.target.padEnd(22)} by ${e.actor}${e.detail ? `  (${e.detail})` : ''}`);
        if (!entries.length) out('No audit entries yet.');
        return 0;
      }
      default:
        out(USAGE);
        return 2;
    }
  } catch (error) {
    out(`error: ${(error as Error).message}`);
    return 1;
  } finally {
    await close();
  }
}
