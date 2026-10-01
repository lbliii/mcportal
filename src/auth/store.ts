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

  /** Revoke every token of a user (account deletion). Returns how many records went. */
  revokeUser(userId: string): Promise<number> {
    return this.write((d) => {
      let n = 0;
      for (const [hash, r] of Object.entries(d.tokens)) if (r.userId === userId) { delete d.tokens[hash]; n++; }
      return n;
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
