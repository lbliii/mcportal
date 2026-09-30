/**
 * Accounts, invites and the audit log (identity plan, phase 1).
 *
 * An account is MCPortal's record of a person: an id, a status and a role. A
 * sign-in identity (for now only GitHub: `github:<numeric id>`) maps to an
 * account. Account ids keep today's form (`github-<id>`), so existing profiles
 * need no migration.
 *
 * Who gets in:
 *   - an existing active account;
 *   - a GitHub login someone invited (the account is created on first sign-in);
 *   - bootstrap config: MCPORTAL_ADMINS, and MCPORTAL_ALLOWED_GITHUB_USERS (the
 *     old allowlist, still honored);
 *   - anyone, when sign-up is open (MCPORTAL_OPEN_SIGNUP=1, or when neither
 *     admins nor an allowlist is configured, which matches the old behavior).
 * Suspended accounts are refused everywhere, within one refresh interval.
 *
 * Like the OAuth store, the state is one document (file or Postgres row) held in
 * memory; it's reloaded periodically so changes made by the admin CLI (another
 * process) take effect. One server instance.
 */
import type { AuthPersistence } from './auth/store.ts';
import { clean } from './lib/text.ts';

export type AccountStatus = 'active' | 'suspended';
export type Role = 'user' | 'admin';

export interface Account {
  id: string;
  status: AccountStatus;
  role: Role;
  login?: string;
  githubId?: number;
  /** How they got in. Invited accounts stay until suspended; the others only while config still lets them in. */
  via: 'invite' | 'bootstrap' | 'open';
  createdAt: number;
  updatedAt: number;
}

export interface Invite {
  login: string;
  invitedBy: string;
  createdAt: number;
}

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
  target: string;
  detail?: string;
}

interface Doc {
  accounts: Record<string, Account>;
  identities: Record<string, string>;   // "github:<id>" -> account id
  invites: Record<string, Invite>;      // lowercase login -> invite
  audit: AuditEntry[];
}

export interface Bootstrap {
  /** GitHub logins or numeric ids that are admins (and always allowed in). */
  admins: string[];
  /** The old allowlist: logins or numeric ids allowed in without an invite. */
  allow: string[];
  openSignup: boolean;
}

export interface GithubIdentity {
  githubId: number;
  login: string;
}

export type Admission = { ok: true; account: Account } | { ok: false; reason: 'not_invited' | 'suspended' };

const AUDIT_MAX = 2000;
const RELOAD_MS = 30_000;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;

/**
 * Sign-up is open when MCPORTAL_OPEN_SIGNUP=1, or when neither admins nor an
 * allowlist is configured (the behavior before accounts existed).
 */
export function makeBootstrap(admins: string[], allow: string[], openFlag = false): Bootstrap {
  const norm = (xs: string[]) => xs.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const a = norm(admins);
  const l = norm(allow);
  return { admins: a, allow: l, openSignup: openFlag || (a.length === 0 && l.length === 0) };
}

export function bootstrapFromEnv(env: NodeJS.ProcessEnv, allowOverride?: string[]): Bootstrap {
  const list = (v: string | undefined) => (v ?? '').split(',');
  return makeBootstrap(list(env.MCPORTAL_ADMINS), allowOverride ?? list(env.MCPORTAL_ALLOWED_GITHUB_USERS), env.MCPORTAL_OPEN_SIGNUP === '1');
}

/** In-memory persistence, for tests and for OAuth setups without an accounts store. */
export function memoryPersistence(): AuthPersistence {
  let value: string | undefined;
  return { read: async () => value, write: async (json) => { value = json; } };
}

export function accountIdFor(githubId: number): string {
  return `github-${githubId}`;
}

export class Accounts {
  private persistence: AuthPersistence;
  private bootstrap: Bootstrap;
  private now: () => number;
  private doc: Doc | null = null;
  private loadedAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(persistence: AuthPersistence, bootstrap: Bootstrap, now: () => number = Date.now) {
    this.persistence = persistence;
    this.bootstrap = bootstrap;
    this.now = now;
  }

  /** Load (or reload, if stale) from persistence. Call before the sync checks are trusted. */
  async load(force = false): Promise<void> {
    if (!force && this.doc && this.now() - this.loadedAt < RELOAD_MS) return;
    const raw = await this.persistence.read().catch(() => undefined);
    let parsed: Partial<Doc> = {};
    try {
      parsed = raw ? (JSON.parse(raw) as Partial<Doc>) : {};
    } catch {
      process.stderr.write('[mcportal] accounts document unreadable; starting from bootstrap config only\n');
    }
    this.doc = { accounts: parsed.accounts ?? {}, identities: parsed.identities ?? {}, invites: parsed.invites ?? {}, audit: parsed.audit ?? [] };
    this.loadedAt = this.now();
  }

  /** Serialized read-modify-write against the freshest document. */
  private write<T>(mutate: (doc: Doc) => T): Promise<T> {
    const run = this.chain.then(async () => {
      await this.load(true);
      const result = mutate(this.doc!);
      if (this.doc!.audit.length > AUDIT_MAX) this.doc!.audit.splice(0, this.doc!.audit.length - AUDIT_MAX);
      await this.persistence.write(JSON.stringify(this.doc));
      return result;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  private bootstrapMatch(list: string[], id: GithubIdentity): boolean {
    return list.includes(id.login.toLowerCase()) || list.includes(String(id.githubId));
  }

  private isBootstrapAdmin(id: GithubIdentity): boolean {
    return this.bootstrapMatch(this.bootstrap.admins, id);
  }

  /** Does the current config (open sign-up, admins, allowlist) let this identity in, invite aside? */
  private configAdmits(id: GithubIdentity): boolean {
    return this.bootstrap.openSignup || this.isBootstrapAdmin(id) || this.bootstrapMatch(this.bootstrap.allow, id);
  }

  /** Sync check used on every request and token refresh (from the cached document). */
  isActive(id: GithubIdentity): boolean {
    void this.load();   // refresh in the background when stale
    const account = this.doc?.accounts[this.doc.identities[`github:${id.githubId}`] ?? ''];
    if (account && account.status !== 'active') return false;
    if (account?.via === 'invite') return true;
    // Admitted by config (or no account yet, e.g. tokens issued before accounts existed): the config decides now.
    return this.configAdmits(id);
  }

  /** At sign-in: find or create the account, or refuse. */
  admit(id: GithubIdentity): Promise<Admission> {
    return this.write((doc): Admission => {
      const key = `github:${id.githubId}`;
      const login = clean(id.login, 39).toLowerCase();
      const existing = doc.accounts[doc.identities[key] ?? ''];
      const now = this.now();
      if (existing) {
        if (existing.status === 'suspended') return { ok: false, reason: 'suspended' };
        if (existing.via !== 'invite' && !this.configAdmits(id)) return { ok: false, reason: 'not_invited' };
        if (existing.login !== login) existing.login = login;   // GitHub renames are fine: the id is what counts
        if (this.isBootstrapAdmin(id) && existing.role !== 'admin') existing.role = 'admin';
        existing.updatedAt = now;
        return { ok: true, account: existing };
      }
      const invite = doc.invites[login];
      const byConfig = this.configAdmits(id);
      if (!byConfig && !invite) return { ok: false, reason: 'not_invited' };
      const account: Account = {
        id: accountIdFor(id.githubId),
        status: 'active',
        role: this.isBootstrapAdmin(id) ? 'admin' : 'user',
        login,
        githubId: id.githubId,
        via: invite ? 'invite' : byConfig && !this.bootstrap.openSignup ? 'bootstrap' : 'open',
        createdAt: now,
        updatedAt: now,
      };
      doc.accounts[account.id] = account;
      doc.identities[key] = account.id;
      delete doc.invites[login];
      doc.audit.push({ at: now, actor: account.id, action: 'account.created', target: account.id, detail: invite ? `invited by ${invite.invitedBy}` : this.bootstrap.openSignup ? 'open sign-up' : 'bootstrap' });
      return { ok: true, account };
    });
  }

  /** Role and status for the access gate. Unknown accounts are plain active users (bootstrap/legacy). */
  actor(accountId: string): { accountId: string; role: Role; status: AccountStatus } {
    void this.load();
    const account = this.doc?.accounts[accountId];
    if (account) return { accountId, role: account.role, status: account.status };
    const githubId = Number(accountId.replace(/^github-/, ''));
    const admin = Number.isFinite(githubId) && this.bootstrap.admins.includes(String(githubId));
    return { accountId, role: admin ? 'admin' : 'user', status: 'active' };
  }

  // ---------------------------------------------------------------- admin (CLI / admin page only; never MCP tools)

  private find(doc: Doc, who: string): Account | undefined {
    const q = who.trim().toLowerCase().replace(/^@/, '');
    return doc.accounts[q] ?? Object.values(doc.accounts).find((a) => a.login === q || String(a.githubId) === q);
  }

  invite(login: string, by: string): Promise<Invite> {
    const l = login.trim().toLowerCase().replace(/^@/, '');
    if (!LOGIN.test(l)) return Promise.reject(new Error(`"${login}" isn't a valid GitHub login`));
    return this.write((doc) => {
      const invite: Invite = { login: l, invitedBy: by, createdAt: this.now() };
      doc.invites[l] = invite;
      doc.audit.push({ at: invite.createdAt, actor: by, action: 'invite.created', target: l });
      return invite;
    });
  }

  uninvite(login: string, by: string): Promise<boolean> {
    const l = login.trim().toLowerCase().replace(/^@/, '');
    return this.write((doc) => {
      if (!doc.invites[l]) return false;
      delete doc.invites[l];
      doc.audit.push({ at: this.now(), actor: by, action: 'invite.revoked', target: l });
      return true;
    });
  }

  setStatus(who: string, status: AccountStatus, by: string, reason?: string): Promise<Account> {
    return this.write((doc) => {
      const account = this.find(doc, who);
      if (!account) throw new Error(`No account for "${who}"`);
      account.status = status;
      account.updatedAt = this.now();
      doc.audit.push({ at: account.updatedAt, actor: by, action: status === 'suspended' ? 'account.suspended' : 'account.reinstated', target: account.id, detail: clean(reason, 200) || undefined });
      return account;
    });
  }

  async list(): Promise<{ accounts: Account[]; invites: Invite[] }> {
    await this.load(true);
    return { accounts: Object.values(this.doc!.accounts).sort((a, b) => a.createdAt - b.createdAt), invites: Object.values(this.doc!.invites) };
  }

  async auditLog(limit = 50): Promise<AuditEntry[]> {
    await this.load(true);
    return this.doc!.audit.slice(-limit).reverse();
  }
}
