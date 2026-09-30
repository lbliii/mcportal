/**
 * Public profiles and handles (identity plan, phase 3). Opt-in: an account has no
 * public profile until its owner claims a handle. Profiles are visible only to
 * signed-in MCPortal users (through tools), never published to the open web.
 *
 * Handles: 2-30 of a-z 0-9 _, unique and case-insensitive, reserved words blocked.
 * A handle that is given up (changed, or the profile removed) is held for 30 days:
 * lookups of the old handle find the owner's current profile, and nobody else can
 * claim it, so a handle can't be taken over right after it changes hands.
 *
 * Like accounts, the state is one document (file or Postgres row) held in memory;
 * it moves to tables when sharing needs joins. One server instance.
 */
import type { AuthPersistence } from './auth/store.ts';
import { clean } from './lib/text.ts';
import { KeyedMutex } from './store.ts';

export const HANDLE_HOLD_MS = 30 * 24 * 3600 * 1000;
const HANDLE = /^[a-z0-9_]{2,30}$/;
export const RESERVED_HANDLES = new Set([
  'about', 'account', 'accounts', 'admin', 'administrator', 'all', 'anthropic', 'api', 'claude', 'everyone', 'feed', 'follow', 'followers',
  'following', 'help', 'join', 'login', 'logout', 'me', 'mcp', 'mcportal', 'mod', 'moderator', 'null', 'oauth', 'official', 'privacy',
  'root', 'security', 'settings', 'share', 'shares', 'staff', 'support', 'system', 'undefined', 'you',
]);

export interface PublicProfile {
  accountId: string;
  handle: string;
  displayName?: string;
  bio?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfileInput {
  handle?: string;
  displayName?: string;
  bio?: string;
}

interface Doc {
  profiles: Record<string, PublicProfile>;                    // account id -> profile
  held: Record<string, { accountId: string; until: number }>;  // released handle -> previous owner
}

export class HandleError extends Error {
  override name = 'HandleError';
}

/** The handle as stored, or an error message saying what's wrong with it. */
export function normalizeHandle(raw: unknown): { handle: string } | { error: string } {
  const handle = String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return { error: 'A handle is 2 to 30 letters, digits or underscores' };
  if (RESERVED_HANDLES.has(handle)) return { error: `@${handle} is reserved` };
  return { handle };
}

/** A handle suggestion from a GitHub login (hyphens aren't allowed in handles). */
export function suggestHandle(login: string | undefined): string | undefined {
  const s = (login ?? '').toLowerCase().replace(/-/g, '_').slice(0, 30);
  return 'handle' in normalizeHandle(s) ? s : undefined;
}

export class PublicProfiles {
  private persistence: AuthPersistence;
  private doc: Doc | null = null;
  private mutex = new KeyedMutex();
  private hidden: (accountId: string) => boolean;
  now: () => number;

  /** `hidden` says whose profiles others can't see (suspended accounts). */
  constructor(persistence: AuthPersistence, options: { hidden?: (accountId: string) => boolean; now?: () => number } = {}) {
    this.persistence = persistence;
    this.hidden = options.hidden ?? (() => false);
    this.now = options.now ?? Date.now;
  }

  private async load(): Promise<Doc> {
    if (this.doc) return this.doc;
    try {
      const raw = await this.persistence.read();
      const parsed = (raw ? JSON.parse(raw) : {}) as Partial<Doc>;
      this.doc = { profiles: parsed.profiles ?? {}, held: parsed.held ?? {} };
    } catch (error) {
      process.stderr.write(`[mcportal] public profiles unreadable, starting empty: ${(error as Error).message}\n`);
      this.doc = { profiles: {}, held: {} };
    }
    return this.doc;
  }

  private write<T>(change: (doc: Doc) => T): Promise<T> {
    return this.mutex.run('public-profiles', async () => {
      const doc = await this.load();
      const result = change(doc);
      const now = this.now();
      for (const [h, hold] of Object.entries(doc.held)) if (hold.until <= now) delete doc.held[h];
      await this.persistence.write(JSON.stringify(doc));
      return result;
    });
  }

  private owner(doc: Doc, handle: string): string | undefined {
    return Object.values(doc.profiles).find((p) => p.handle === handle)?.accountId;
  }

  /** Your own profile (visible to you even while suspended). */
  async get(accountId: string): Promise<PublicProfile | undefined> {
    const doc = await this.load();
    return doc.profiles[accountId] ? { ...doc.profiles[accountId] } : undefined;
  }

  /**
   * Someone's profile by handle, as another user sees it. An old handle within its
   * hold finds the owner's current profile (movedFrom says so).
   */
  async byHandle(raw: string): Promise<{ profile: PublicProfile; movedFrom?: string } | undefined> {
    const doc = await this.load();
    const handle = String(raw).trim().replace(/^@/, '').toLowerCase();
    let accountId = this.owner(doc, handle);
    let movedFrom: string | undefined;
    if (!accountId) {
      const hold = doc.held[handle];
      if (hold && hold.until > this.now()) {
        accountId = hold.accountId;
        movedFrom = handle;
      }
    }
    const profile = accountId ? doc.profiles[accountId] : undefined;
    if (!profile || this.hidden(profile.accountId)) return undefined;
    return { profile: { ...profile }, ...(movedFrom ? { movedFrom } : {}) };
  }

  /** Create or change your profile. A new profile needs a handle. Throws HandleError. */
  set(accountId: string, input: PublicProfileInput): Promise<{ profile: PublicProfile; created: boolean; released?: string }> {
    return this.write((doc) => {
      const current = doc.profiles[accountId];
      const at = new Date(this.now()).toISOString();
      let handle = current?.handle;
      let released: string | undefined;
      if (input.handle !== undefined) {
        const checked = normalizeHandle(input.handle);
        if ('error' in checked) throw new HandleError(checked.error);
        if (checked.handle !== current?.handle) {
          const owner = this.owner(doc, checked.handle);
          if (owner && owner !== accountId) throw new HandleError(`@${checked.handle} is taken`);
          const hold = doc.held[checked.handle];
          if (hold && hold.until > this.now() && hold.accountId !== accountId) throw new HandleError(`@${checked.handle} was in use recently; try another`);
          delete doc.held[checked.handle];
          if (current) {
            released = current.handle;
            doc.held[current.handle] = { accountId, until: this.now() + HANDLE_HOLD_MS };
          }
          handle = checked.handle;
        }
      }
      if (!handle) throw new HandleError('Pick a handle first');
      const profile: PublicProfile = { accountId, handle, createdAt: current?.createdAt ?? at, updatedAt: at };
      const displayName = input.displayName !== undefined ? clean(input.displayName, 50) : current?.displayName;
      const bio = input.bio !== undefined ? clean(input.bio, 160) : current?.bio;
      if (displayName) profile.displayName = displayName;
      if (bio) profile.bio = bio;
      doc.profiles[accountId] = profile;
      return { profile: { ...profile }, created: !current, ...(released ? { released } : {}) };
    });
  }

  /** Go private: the profile goes, and its handle is held for 30 days. */
  remove(accountId: string): Promise<PublicProfile | undefined> {
    return this.write((doc) => {
      const profile = doc.profiles[accountId];
      if (!profile) return undefined;
      delete doc.profiles[accountId];
      doc.held[profile.handle] = { accountId, until: this.now() + HANDLE_HOLD_MS };
      return profile;
    });
  }
}
