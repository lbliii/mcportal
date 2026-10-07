/**
 * Public profiles and handles (identity plan, phase 3). Opt-in: an account has no
 * public profile until its owner claims a handle. Spaces are public by default;
 * owners can keep them within signed-in MCPortal with public: false.
 *
 * Handles: 2-30 of a-z 0-9 _, unique and case-insensitive, reserved words blocked.
 * A handle that is given up (changed, or the profile removed) is held for 30 days:
 * lookups of the old handle find the owner's current profile, and nobody else can
 * claim it, so a handle can't be taken over right after it changes hands.
 *
 * Like accounts, the state is one document (file or Postgres row) held in memory;
 * it moves to tables when sharing needs joins. One server instance.
 */
import { randomInt } from 'node:crypto';
import { INKS, MOTIFS, FORMATS, STAMPS, type Cover, type SpaceFormat, type StampName } from './space-design.ts';
import type { AuthPersistence } from './auth/store.ts';
import { DOCUMENT_MAX_AGE_MS, SharedDocument } from './lib/document.ts';
import { AppError, type AppErrorOptions, type ErrorCode } from './lib/errors.ts';
import { clean } from './lib/text.ts';
import { normalizeSourceConfig, ProfileError, type SourceConfigs } from './profile.ts';

export const HANDLE_HOLD_MS = 30 * 24 * 3600 * 1000;
const HANDLE = /^[a-z0-9_]{2,30}$/;
export const RESERVED_HANDLES = new Set([
  'about', 'account', 'accounts', 'admin', 'administrator', 'all', 'anthropic', 'api', 'claude', 'everyone', 'feed', 'follow', 'followers',
  'following', 'help', 'join', 'login', 'logout', 'me', 'mcp', 'mcportal', 'mod', 'moderator', 'null', 'oauth', 'official', 'privacy',
  'root', 'security', 'settings', 'share', 'shares', 'staff', 'support', 'system', 'undefined', 'you',
]);


/** A source someone features in their space, so visitors can add it to their own portal. */
export interface FeaturedSource {
  title: string;
  source: 'rss' | 'hn' | 'github';
  config: SourceConfigs['rss' | 'hn' | 'github'];
}

export const MAX_FEATURED = 12;

export interface PublicProfile {
  accountId: string;
  handle: string;
  displayName?: string;
  bio?: string;
  /** The space's name, e.g. "liminal webspace". */
  spaceTitle?: string;
  cover?: Cover;
  format?: SpaceFormat;
  frequency?: string[];
  pinnedShareId?: string;
  travelers?: string[];
  hiddenStamps?: StampName[];
  private?: true;
  /** Lasting aggregate; no identities survive the one-time join note. */
  broughtAboard?: number;
  /** Sources from their portal they recommend. Copies: visitors never read anyone's portal. */
  sources?: FeaturedSource[];
  /** Who may reblog their new posts, unless a post says otherwise. Absent: anyone. */
  reblogs?: 'followers' | 'nobody';
  /** Findable by people with similar sources (find_people). Opt-in: absent means unlisted. */
  listed?: true;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfileInput {
  handle?: string | undefined;
  displayName?: string | undefined;
  bio?: string | undefined;
  spaceTitle?: string | undefined;
  ink?: string | undefined;
  motif?: string | undefined;
  reroll?: boolean | undefined;
  format?: string | undefined;
  frequency?: string[] | undefined;
  pinnedShareId?: string | undefined;
  travelers?: string[] | undefined;
  hiddenStamps?: string[] | undefined;
  public?: boolean | undefined;
  /** Replaces the featured list; [] clears it. */
  sources?: Array<{ title?: string; source: string; config: unknown }> | undefined;
  /** Who may reblog new posts by default: anyone, followers or nobody. */
  reblogs?: string | undefined;
  /** Findable by people with similar sources, or not. */
  listed?: boolean | undefined;
}

/** Only sources MCPortal fetches itself can be featured; configs are re-validated. */
export function normalizeFeatured(raw: PublicProfileInput['sources']): FeaturedSource[] {
  const out: FeaturedSource[] = [];
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    if (entry.source !== 'rss' && entry.source !== 'hn' && entry.source !== 'github') continue;
    let config: FeaturedSource['config'];
    try {
      config = normalizeSourceConfig(entry.source, entry.config, 'featured source');
    } catch (error) {
      if (error instanceof ProfileError) continue;
      throw error;
    }
    const key = `${entry.source}:${JSON.stringify({ ...config, limit: undefined })}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: clean(entry.title, 80) || entry.source, source: entry.source, config });
    if (out.length >= MAX_FEATURED) break;
  }
  return out;
}

interface Doc {
  profiles: Record<string, PublicProfile>;                    // account id -> profile
  held: Record<string, { accountId: string; until: number }>;  // released handle -> previous owner
}

/** A handle that is invalid, reserved or taken. Defaults to invalid_argument; pass a code when it's something else. */
export class HandleError extends AppError {
  override name = 'HandleError';

  constructor(message: string, code: ErrorCode = 'invalid_argument', options?: AppErrorOptions) {
    super(code, message, options);
  }
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

/**
 * What tools ask of public profiles: read anyone's, change only the caller's own (the
 * tools pass the signed-in account). PublicProfiles implements it on the hosted
 * server; a linked local MCPortal implements it over the hosted API.
 */
/** Who holds a deleted account's handles while they're held. */
const DELETED_HOLDER = 'deleted';

export type ProfileDirectory = Pick<PublicProfiles, 'get' | 'byHandle' | 'set' | 'remove' | 'restoreAppearance'>;

export class PublicProfiles {
  private doc: SharedDocument<Doc>;
  private hidden: (accountId: string) => boolean;
  now: () => number;

  /** `hidden` says whose profiles others can't see (suspended accounts). */
  constructor(persistence: AuthPersistence, options: { hidden?: (accountId: string) => boolean; now?: () => number } = {}) {
    this.hidden = options.hidden ?? (() => false);
    this.now = options.now ?? Date.now;
    this.doc = new SharedDocument<Doc>(persistence, 'public profiles', (d) => ({ profiles: d.profiles ?? {}, held: d.held ?? {} }), {
      maxAgeMs: DOCUMENT_MAX_AGE_MS,
      now: () => this.now(),
      // Released handles are held for a while; drop the holds that have run out.
      beforeWrite: (doc) => {
        const now = this.now();
        for (const [h, hold] of Object.entries(doc.held)) if (hold.until <= now) delete doc.held[h];
      },
    });
  }

  private load(): Promise<Doc> {
    return this.doc.get();
  }

  private write<T>(change: (doc: Doc) => T): Promise<T> {
    return this.doc.update(change);
  }

  private owner(doc: Doc, handle: string): string | undefined {
    return Object.values(doc.profiles).find((p) => p.handle === handle)?.accountId;
  }

  /** Your own profile (visible to you even while suspended). */
  async get(accountId: string): Promise<PublicProfile | undefined> {
    const doc = await this.load();
    const profile = doc.profiles[accountId];
    if (profile && !profile.cover) return (await this.set(accountId, {})).profile;
    return profile ? structuredClone(profile) : undefined;
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
    return { profile: (await this.get(profile.accountId))!, ...(movedFrom ? { movedFrom } : {}) };
  }

  /** Everyone who chose to be findable (docs/plans/finding-people.md), minus suspended accounts. */
  async listed(): Promise<PublicProfile[]> {
    const doc = await this.load();
    return Promise.all(Object.values(doc.profiles).filter((p) => p.listed && !this.hidden(p.accountId)).map(async (p) => (await this.get(p.accountId))!));
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
          if (owner && owner !== accountId) throw new HandleError(`@${checked.handle} is taken`, 'conflict');
          const hold = doc.held[checked.handle];
          if (hold && hold.until > this.now() && hold.accountId !== accountId) throw new HandleError(`@${checked.handle} was in use recently; try another`, 'conflict');
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
      const spaceTitle = input.spaceTitle !== undefined ? clean(input.spaceTitle, 60) : current?.spaceTitle;
      if (input.ink !== undefined && !INKS.includes(input.ink as Cover['ink'])) throw new HandleError(`ink must be one of ${INKS.join(', ')}`);
      if (input.motif !== undefined && !MOTIFS.includes(input.motif as Cover['motif'])) throw new HandleError(`motif must be one of ${MOTIFS.join(', ')}`);
      if (input.format !== undefined && !FORMATS.includes(input.format as SpaceFormat)) throw new HandleError(`format must be one of ${FORMATS.join(', ')}`);
      profile.cover = { ink: input.ink as Cover['ink'] ?? current?.cover?.ink ?? INKS[randomInt(INKS.length)]!, motif: input.motif as Cover['motif'] ?? current?.cover?.motif ?? MOTIFS[randomInt(MOTIFS.length)]!, seed: input.reroll || !current?.cover ? randomInt(0x100000000) : current.cover.seed };
      profile.format = input.format as SpaceFormat ?? current?.format ?? 'paperback';
      const frequency = input.frequency ?? current?.frequency;
      if (frequency && (frequency.length > 4 || frequency.some((t) => typeof t !== 'string' || !clean(t, 24) || t.length > 24))) throw new HandleError('frequency is up to four topics, each 1–24 characters');
      if (frequency?.length) profile.frequency = [...new Set(frequency.map((t) => clean(t, 24)))];
      const travelers = input.travelers ?? current?.travelers;
      if (travelers && (travelers.length > 6 || travelers.some((h) => 'error' in normalizeHandle(h)))) throw new HandleError('travelers is up to six valid handles');
      if (travelers?.length) profile.travelers = [...new Set(travelers.map((h) => (normalizeHandle(h) as { handle: string }).handle))];
      const hiddenStamps = input.hiddenStamps ?? current?.hiddenStamps;
      if (hiddenStamps?.some((n) => !STAMPS.includes(n as StampName))) throw new HandleError(`hiddenStamps must name ${STAMPS.join(', ')}`);
      if (hiddenStamps?.length) profile.hiddenStamps = [...new Set(hiddenStamps)] as StampName[];
      const pinned = input.pinnedShareId !== undefined ? input.pinnedShareId : current?.pinnedShareId;
      if (pinned) profile.pinnedShareId = clean(pinned, 80);
      if (input.public !== undefined ? !input.public : current?.private) profile.private = true;
      if (current?.broughtAboard) profile.broughtAboard = current.broughtAboard;
      const sources = input.sources !== undefined ? normalizeFeatured(input.sources) : current?.sources;
      if (input.reblogs !== undefined && !['anyone', 'followers', 'nobody'].includes(input.reblogs)) throw new HandleError('reblogs must be one of anyone, followers, nobody');
      const reblogs = input.reblogs !== undefined ? (input.reblogs === 'anyone' ? undefined : input.reblogs as 'followers' | 'nobody') : current?.reblogs;
      if (displayName) profile.displayName = displayName;
      if (bio) profile.bio = bio;
      if (spaceTitle) profile.spaceTitle = spaceTitle;
      if (sources?.length) profile.sources = sources;
      if (reblogs) profile.reblogs = reblogs;
      if (input.listed !== undefined ? input.listed === true : current?.listed) profile.listed = true;
      doc.profiles[accountId] = profile;
      return { profile: structuredClone(profile), created: !current, ...(released ? { released } : {}) };
    });
  }

  async recordJoin(accountId: string): Promise<void> {
    await this.write((doc) => {
      const p = doc.profiles[accountId];
      if (p) { p.broughtAboard = (p.broughtAboard ?? 0) + 1; p.updatedAt = new Date(this.now()).toISOString(); }
    });
  }

  /** Imports restore validated plates on an existing Space, without claiming a handle,
   * publishing text, changing privacy or importing claims about earned stamps. */
  restoreAppearance(accountId: string, raw: unknown): Promise<boolean> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return Promise.resolve(false);
    const value = raw as Record<string, unknown>;
    const cover = value.cover as Partial<Cover> | undefined;
    if (!cover || !INKS.includes(cover.ink!) || !MOTIFS.includes(cover.motif!) || !Number.isInteger(cover.seed) || cover.seed! < 0 || cover.seed! > 0xffffffff) throw new HandleError('The imported Space cover is invalid');
    if (value.format !== undefined && !FORMATS.includes(value.format as SpaceFormat)) throw new HandleError('The imported Space format is invalid');
    return this.write((doc) => {
      const current = doc.profiles[accountId];
      if (!current) return false;
      current.cover = { ink: cover.ink!, motif: cover.motif!, seed: cover.seed! };
      if (value.format !== undefined) current.format = value.format as SpaceFormat;
      current.updatedAt = new Date(this.now()).toISOString();
      return true;
    });
  }

  /**
   * Account deletion: the profile goes, and its handles (current and recently given up)
   * stay held for their 30 days, so nobody can pose as them, but no longer say whose.
   */
  forget(accountId: string): Promise<void> {
    return this.write((doc) => {
      const profile = doc.profiles[accountId];
      delete doc.profiles[accountId];
      if (profile) doc.held[profile.handle] = { accountId: DELETED_HOLDER, until: this.now() + HANDLE_HOLD_MS };
      for (const hold of Object.values(doc.held)) if (hold.accountId === accountId) hold.accountId = DELETED_HOLDER;
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
