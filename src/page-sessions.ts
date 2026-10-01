/**
 * Browser sessions for the account and admin pages, after a fresh GitHub sign-in.
 *
 * In memory (sign in again after a deploy), keyed by the sha256 of the cookie value,
 * so a leaked memory dump holds no usable cookie. The cookie is HttpOnly and
 * SameSite=Lax, and __Host- prefixed over https. Each session carries a CSRF token
 * that changes need along with a same-origin request.
 */
import type { IncomingMessage } from 'node:http';
import { safeEqual, secretToken, sha256Hex } from './lib/ids.ts';
import { cookies } from './lib/web.ts';

export interface PageSession {
  accountId: string;
  login: string;
  csrf: string;
  expiresAt: number;
}

export class PageSessions {
  private sessions = new Map<string, PageSession>();
  private name: string;
  private publicUrl: string;
  private ttlMs: number;
  private max: number;
  private now: () => number;

  /** `name` tells the pages' cookies apart, e.g. "account" gives mcportal_account. */
  constructor(name: string, options: { publicUrl: string; ttlMs: number; max: number; now?: () => number }) {
    this.name = name;
    this.publicUrl = options.publicUrl;
    this.ttlMs = options.ttlMs;
    this.max = options.max;
    this.now = options.now ?? Date.now;
  }

  private get secure(): boolean {
    return this.publicUrl.startsWith('https://');
  }

  get cookieName(): string {
    return this.secure ? `__Host-mcportal_${this.name}` : `mcportal_${this.name}`;
  }

  /** A Set-Cookie value; an empty value with max age 0 signs the browser out. */
  cookie(value: string, maxAgeSeconds: number): string {
    return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${this.secure ? '; Secure' : ''}`;
  }

  /** Start a session; returns the Set-Cookie value that carries it. */
  start(accountId: string, login: string): string {
    const now = this.now();
    for (const [k, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(k);
    while (this.sessions.size >= this.max) this.sessions.delete(this.sessions.keys().next().value!);
    const raw = secretToken(32);
    this.sessions.set(sha256Hex(raw), { accountId, login, csrf: secretToken(24), expiresAt: now + this.ttlMs });
    return this.cookie(raw, this.ttlMs / 1000);
  }

  /** The request's live session, if any. */
  current(req: IncomingMessage): { key: string; session: PageSession } | undefined {
    const raw = cookies(req)[this.cookieName];
    if (!raw) return undefined;
    const key = sha256Hex(raw);
    const session = this.sessions.get(key);
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return undefined;
    }
    return { key, session };
  }

  /** Whether `given` is this session's CSRF token. */
  csrfMatches(session: PageSession, given: string | null | undefined): boolean {
    return Boolean(given) && safeEqual(given!, session.csrf);
  }

  end(key: string): void {
    this.sessions.delete(key);
  }

  /** Sign an account out everywhere (account deletion, suspension). */
  endAll(accountId: string): void {
    for (const [k, s] of this.sessions) if (s.accountId === accountId) this.sessions.delete(k);
  }
}
