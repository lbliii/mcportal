/**
 * OAuth state that must survive restarts: registered clients and issued tokens.
 * Tokens are stored only as SHA-256 hashes. Each sign-in is a "grant"; a grant
 * holds at most one live access token and one live refresh token, so refresh
 * loops can't grow the file. Reusing a spent refresh token revokes the whole
 * grant (theft detection). The document is kept in memory and persisted
 * whole on every write, to a file (default) or a Postgres row (see db.ts); both
 * assume a single server instance.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SharedDocument, type DocumentPersistence } from '../lib/document.ts';
import { secretToken, sha256Hex } from '../lib/ids.ts';
import { atomicWrite } from '../lib/files.ts';

export const ACCESS_TTL_SECONDS = 3600;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600;
export const CLIENT_LIMITS = { clients: 500, redirectUris: 5, uriLength: 2048 };
/**
 * A registered client nobody holds tokens for is forgotten once it's gone unused this
 * long, so a computer's name doesn't stay forever. Long, because apps such as Claude
 * keep their registration and sign in with it again when someone comes back, and an
 * unknown one fails until they reconnect. (A deleted account's clients go at once.)
 */
export const CLIENT_IDLE_SECONDS = 180 * 24 * 3600;

export interface ClientRecord {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created_at: number;
  last_used_at: number;
}

export interface Identity {
  userId: string;
  githubId: number;
  login: string;
}

export interface TokenRecord extends Identity {
  kind: 'access' | 'refresh' | 'spent-refresh';
  grantId: string;
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

/** One signed-in app or device, as the account page lists it. */
export interface GrantSummary {
  grantId: string;
  clientName: string;
  /** When its client last used MCPortal (ms), 0 if unknown. */
  lastUsedAt: number;
  /** When it stops working unless used again (the refresh token's expiry, ms). */
  expiresAt: number;
}

export interface IssuedTokens {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface Data {
  clients: Record<string, ClientRecord>;
  tokens: Record<string, TokenRecord>;
}

/** Where a JSON document lives (OAuth state, and the accounts, profiles and social documents). */
export type AuthPersistence = DocumentPersistence;

export function fileAuthPersistence(dataDir: string, name = 'auth.json'): AuthPersistence {
  const file = path.join(dataDir, name);
  return {
    async read() {
      try {
        return await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    write: (json) => atomicWrite(file, json),
  };
}

export const hashToken = sha256Hex;

export function randomToken(prefix: string): string {
  return `${prefix}_${secretToken(32)}`;
}

/**
 * How stale the cached OAuth document may get. Short, because a token revoked on
 * another instance (sign-out, account deletion) stays valid here until the reload.
 */
const AUTH_MAX_AGE_MS = 5_000;

export class AuthStore {
  private data: SharedDocument<Data>;
  now: () => number;

  /** `where` is a data directory (file persistence) or an AuthPersistence (e.g. Postgres). */
  constructor(where: string | AuthPersistence, now: () => number = Date.now) {
    this.now = now;
    this.data = new SharedDocument<Data>(typeof where === 'string' ? fileAuthPersistence(where) : where, 'OAuth', (d) => ({ clients: d.clients ?? {}, tokens: d.tokens ?? {} }), {
      maxAgeMs: AUTH_MAX_AGE_MS,
      now: () => this.now(),
      beforeWrite: (data) => {
        const now = this.now();
        for (const [hash, record] of Object.entries(data.tokens)) if (record.expiresAt <= now) delete data.tokens[hash];
        const inUse = new Set(Object.values(data.tokens).map((t) => t.clientId));
        const idleBefore = Math.floor(now / 1000) - CLIENT_IDLE_SECONDS;
        for (const c of Object.values(data.clients)) if (!inUse.has(c.client_id) && c.last_used_at < idleBefore) delete data.clients[c.client_id];
        const clients = Object.values(data.clients);
        if (clients.length > CLIENT_LIMITS.clients) {
          clients.sort((a, b) => a.last_used_at - b.last_used_at);
          for (const c of clients.slice(0, clients.length - CLIENT_LIMITS.clients)) delete data.clients[c.client_id];
        }
      },
    });
  }

  /** The OAuth document, from the cache unless it's older than `maxAgeMs`. */
  private load(maxAgeMs?: number): Promise<Data> {
    return this.data.get(maxAgeMs);
  }

  /** Mutate + persist atomically. Expired records are pruned on every write. */
  private write<T>(mutate: (data: Data) => T): Promise<T> {
    return this.data.update(mutate);
  }

  /**
   * A record from the cache, or, if it isn't there, from a reload: another instance may
   * have issued it a moment ago. Overlapping reloads share one read, so a burst of
   * unknown tokens costs one read, not one each.
   */
  private async lookup<V>(pick: (data: Data) => V | undefined): Promise<V | undefined> {
    return pick(await this.load()) ?? pick(await this.load(0));
  }

  async registerClient(input: { client_name?: string | undefined; redirect_uris: string[] }): Promise<ClientRecord> {
    const now = Math.floor(this.now() / 1000);
    const record: ClientRecord = { client_id: randomToken('mcpc'), ...(input.client_name !== undefined ? { client_name: input.client_name } : {}), redirect_uris: input.redirect_uris, created_at: now, last_used_at: now };
    return this.write((d) => {
      d.clients[record.client_id] = record;
      return record;
    });
  }

  async getClient(clientId: string): Promise<ClientRecord | undefined> {
    return this.lookup((d) => d.clients[clientId]);
  }

  async touchClient(clientId: string): Promise<void> {
    await this.write((d) => {
      const c = d.clients[clientId];
      if (c) c.last_used_at = Math.floor(this.now() / 1000);
    });
  }

  private mint(d: Data, identity: Identity, clientId: string, resource: string, scope: string, grantId: string): IssuedTokens {
    const access = randomToken('mcpat');
    const refresh = randomToken('mcprt');
    const now = this.now();
    const base = { ...identity, grantId, clientId, resource, scope };
    d.tokens[hashToken(access)] = { ...base, kind: 'access', expiresAt: now + ACCESS_TTL_SECONDS * 1000 };
    d.tokens[hashToken(refresh)] = { ...base, kind: 'refresh', expiresAt: now + REFRESH_TTL_SECONDS * 1000 };
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope };
  }

  async issueTokens(identity: Identity, clientId: string, resource: string, scope: string): Promise<IssuedTokens> {
    const grantId = secretToken(12);
    return this.write((d) => this.mint(d, identity, clientId, resource, scope, grantId));
  }

  /** Valid, unexpired access token issued for this resource. */
  async verifyAccess(token: string, resource: string): Promise<TokenRecord | undefined> {
    const record = await this.lookup((d) => d.tokens[hashToken(token)]);
    if (!record || record.kind !== 'access' || record.expiresAt <= this.now() || record.resource !== resource) return undefined;
    return record;
  }

  /** Retention: expired tokens and unused clients go on every write; this is a write with no change. */
  prune(): Promise<void> {
    return this.write(() => undefined);
  }

  /**
   * Revoke every token of a user (account deletion), and forget the clients only they
   * used: a registration can carry a computer's name. Returns how many tokens went.
   */
  revokeUser(userId: string): Promise<number> {
    return this.write((d) => {
      let n = 0;
      const theirs = new Set<string>();
      for (const [hash, r] of Object.entries(d.tokens)) if (r.userId === userId) { theirs.add(r.clientId); delete d.tokens[hash]; n++; }
      const stillUsed = new Set(Object.values(d.tokens).map((t) => t.clientId));
      for (const id of theirs) if (!stillUsed.has(id)) delete d.clients[id];
      return n;
    });
  }

  /**
   * The user's signed-in apps and devices: one entry per grant that can still be
   * refreshed, newest use first, with the client's name.
   */
  async grantsOf(userId: string): Promise<GrantSummary[]> {
    const d = await this.load(0);
    const grants = new Map<string, GrantSummary>();
    for (const r of Object.values(d.tokens)) {
      if (r.userId !== userId || r.kind !== 'refresh' || r.expiresAt <= this.now()) continue;
      const client = d.clients[r.clientId];
      grants.set(r.grantId, { grantId: r.grantId, clientName: client?.client_name ?? 'An MCP client', lastUsedAt: (client?.last_used_at ?? 0) * 1000, expiresAt: r.expiresAt });
    }
    return [...grants.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  /** Sign one app or device out (the account page's Revoke). False if the grant isn't the user's. */
  revokeGrantOf(userId: string, grantId: string): Promise<boolean> {
    return this.write((d) => {
      if (!Object.values(d.tokens).some((r) => r.grantId === grantId && r.userId === userId)) return false;
      this.revokeGrant(d, grantId);
      return true;
    });
  }

  /**
   * Token revocation (RFC 7009): the grant behind an access or refresh token, if it was
   * issued to `clientId`. Unknown tokens are not an error, so the answer says nothing.
   */
  revokeToken(token: string, clientId: string): Promise<void> {
    return this.write((d) => {
      const r = d.tokens[hashToken(token)];
      if (r && r.clientId === clientId) this.revokeGrant(d, r.grantId);
    });
  }

  private revokeGrant(d: Data, grantId: string): void {
    for (const [hash, r] of Object.entries(d.tokens)) if (r.grantId === grantId) delete d.tokens[hash];
  }

  /**
   * Single-use refresh. The old refresh token becomes a "spent" tombstone and the
   * grant's old access token is revoked. Presenting a spent token revokes the grant.
   * `stillAllowed` lets the caller re-check the user (e.g. an allowlist) at refresh time.
   */
  async rotateRefresh(token: string, clientId: string, stillAllowed: (r: TokenRecord) => boolean): Promise<IssuedTokens | undefined> {
    const hash = hashToken(token);
    return this.write((d) => {
      const r = d.tokens[hash];
      if (!r || r.clientId !== clientId || r.expiresAt <= this.now()) return undefined;
      if (r.kind === 'spent-refresh') {
        this.revokeGrant(d, r.grantId);
        return undefined;
      }
      if (r.kind !== 'refresh') return undefined;
      if (!stillAllowed(r)) {
        this.revokeGrant(d, r.grantId);
        return undefined;
      }
      for (const [h, t] of Object.entries(d.tokens)) if (t.grantId === r.grantId && t.kind !== 'spent-refresh') delete d.tokens[h];
      d.tokens[hash] = { ...r, kind: 'spent-refresh' };
      return this.mint(d, r, r.clientId, r.resource, r.scope, r.grantId);
    });
  }
}
