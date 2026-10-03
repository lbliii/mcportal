/**
 * A linked MCPortal's credentials: `<data dir>/link.json` (mode 0600), and the token
 * source the state API client uses.
 *
 * Refresh tokens rotate and are single-use: presenting a spent one revokes the whole
 * grant. Two processes can share one data directory (the dev launcher, two Claude
 * windows), so refreshing happens under a lock file, and a process that waited re-reads
 * the file first: if someone else already refreshed, it uses their token instead.
 *
 * Tokens never go to the model, the room or the logs.
 */
import { hostedOrigin } from './hosted-url.ts';
import { open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../lib/errors.ts';
import { atomicWrite } from '../lib/files.ts';
import type { LinkAuth } from './client.ts';

export interface LinkRecord {
  version: 1;
  /** The hosted MCPortal's origin. */
  server: string;
  accountId: string;
  login?: string | undefined;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token expires (ms). */
  expiresAt: number;
  linkedAt: string;
}

/** Refresh this long before the access token expires, so a call never races its expiry. */
const EARLY_MS = 60_000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;

function isRecord(value: unknown): value is LinkRecord {
  const r = value as Partial<LinkRecord> | null;
  return typeof r === 'object' && r !== null && r.version === 1
    && typeof r.server === 'string' && /^https?:\/\//.test(r.server)
    && typeof r.accountId === 'string' && typeof r.clientId === 'string'
    && typeof r.accessToken === 'string' && typeof r.refreshToken === 'string' && typeof r.expiresAt === 'number';
}

export class LinkFile {
  readonly file: string;
  private readonly lockFile: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'link.json');
    this.lockFile = path.join(dataDir, 'link.lock');
  }

  /** The link, or undefined when this MCPortal isn't linked (or the file is unusable). */
  async read(): Promise<LinkRecord | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return undefined;
      return { ...parsed, server: hostedOrigin(parsed.server) };
    } catch {
      return undefined;
    }
  }

  write(record: LinkRecord): Promise<void> {
    hostedOrigin(record.server);
    return atomicWrite(this.file, `${JSON.stringify(record, null, 2)}\n`);
  }

  async remove(): Promise<void> {
    await rm(this.file, { force: true });
  }

  /** Run `fn` holding the link lock (across processes). A lock older than 30 s is a crashed holder's, and is taken over. */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(this.lockFile, 'wx', 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const age = await stat(this.lockFile).then((s) => Date.now() - s.mtimeMs, () => 0);
        if (age > LOCK_STALE_MS) { await rm(this.lockFile, { force: true }); continue; }
        if (Date.now() - started > LOCK_WAIT_MS) throw new AppError('unavailable', 'Another MCPortal on this computer is busy with the sign-in; try again in a moment.');
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try {
      return await fn();
    } finally {
      await rm(this.lockFile, { force: true });
    }
  }
}

/** Tokens from link.json, refreshed when they're about to expire or the server refuses one. */
export class FileLinkAuth implements LinkAuth {
  private readonly link: LinkFile;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(link: LinkFile, options: { fetch?: typeof fetch; now?: () => number } = {}) {
    this.link = link;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async token(): Promise<string> {
    const record = await this.link.read();
    if (!record) throw new AppError('unauthenticated', 'This MCPortal is not signed in.');
    if (record.expiresAt - this.now() > EARLY_MS) return record.accessToken;
    return (await this.refresh(record.accessToken)) ?? record.accessToken;
  }

  /** A new access token, unless the grant is gone (revoked, signed out elsewhere, account suspended). */
  refresh(rejected: string): Promise<string | undefined> {
    return this.link.withLock(async () => {
      const record = await this.link.read();
      if (!record) return undefined;
      // Someone else refreshed while we waited for the lock.
      if (record.accessToken !== rejected && record.expiresAt - this.now() > EARLY_MS) return record.accessToken;
      let res: Response;
      try {
        res = await this.fetch(new URL('/oauth/token', record.server), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: record.refreshToken, client_id: record.clientId }).toString(),
          redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new AppError('upstream_unreachable', "Can't reach your hosted MCPortal right now, so nothing was changed. Check the connection and try again.", { cause: error });
      }
      if (!res.ok) return undefined;
      const tokens = await res.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
      if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') return undefined;
      const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600;
      await this.link.write({ ...record, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: this.now() + expiresIn * 1000 });
      return tokens.access_token;
    });
  }
}
