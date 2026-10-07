/**
 * The storage and social interfaces the tools use, implemented over the hosted state
 * API (src/link/client.ts): what a linked local MCPortal puts in its ToolContext
 * instead of files. Tools run here, unchanged; the state lives on the hosted server.
 *
 * Each store serves one account, the linked one; asking for anyone else is a bug and
 * throws. Methods the API doesn't offer (deleting everything, imports) are
 * `unavailable`: those happen on the hosted account page.
 */
import type { Clip, ClipPatch, ClipQuery, ClipSummary } from '../clips.ts';
import type { ClipStore } from '../clip-stores.ts';
import type { Edition, EditionStore } from '../editions.ts';
import type { Handoff, HandoffInput, HandoffStore } from '../handoffs.ts';
import { AppError, errorCode } from '../lib/errors.ts';
import { KeyedMutex } from '../lib/files.ts';
import { defaultProfile, validateProfile, type Profile } from '../profile.ts';
import type { ProfileDirectory } from '../public-profiles.ts';
import type { ReadingState, ReadingStore, ReadingUpdate } from '../reading.ts';
import type { SeenStore } from '../seen.ts';
import type { SocialService } from '../social.ts';
import type { ProfileChange, ProfileStore, Versioned } from '../store.ts';
import type { StateClient } from './client.ts';

/** How long a read of the room is reused before asking whether it changed (which is free when it hasn't). */
export const ROOM_FRESH_MS = 30_000;
/** Attempts at an update when another device keeps changing the room in between. */
const UPDATE_ATTEMPTS = 4;
const PROFILE_VERSION = defaultProfile().version;

const onAccountPage = (what: string) => new AppError('unavailable', `${what} happens on your hosted account page for a linked MCPortal.`);

/** The one account a linked store serves. */
class Linked {
  protected readonly client: StateClient;
  protected readonly accountId: string;

  constructor(client: StateClient, accountId: string) {
    this.client = client;
    this.accountId = accountId;
  }

  protected mine(userId: string): void {
    if (userId !== this.accountId) throw new Error('A linked MCPortal serves only its linked account.');
  }
}

const OFFLINE_NOTICE = "Offline: can't reach your hosted MCPortal, so this is your portal as last synced. Feeds still load; changes wait until you're back online.";

/** Not reaching the hosted server at all (as opposed to it refusing something). */
const unreachable = (error: unknown) => errorCode(error) === 'upstream_unreachable';

export class RemoteProfileStore extends Linked implements ProfileStore {
  private cached: (Versioned & { at: number; tooNew: boolean }) | undefined;
  private offline = false;
  private notice: string | undefined;
  private mutex = new KeyedMutex();
  private readonly now: () => number;

  constructor(client: StateClient, accountId: string, now: () => number = Date.now) {
    super(client, accountId);
    this.now = now;
  }

  /** The room, from the cache while it's fresh; `revalidate` asks the server either way. */
  private async room(revalidate = false): Promise<Versioned> {
    const c = this.cached;
    if (!revalidate && c && this.now() - c.at < ROOM_FRESH_MS) return { profile: structuredClone(c.profile), rev: c.rev };
    let r: { unchanged?: boolean; rev: number; profile?: unknown; notice?: string };
    try {
      r = await this.client.call('room.get', c ? { ifNoneMatch: c.rev } : {});
    } catch (error) {
      // Offline with a copy: read it (writes still fail clearly, since they need the server).
      if (!unreachable(error) || !c || revalidate) throw error;
      if (!this.offline) this.addNotice(OFFLINE_NOTICE);
      this.offline = true;
      return { profile: structuredClone(c.profile), rev: c.rev };
    }
    this.offline = false;
    if (r.notice) this.notice = r.notice;
    if (r.unchanged && c && c.rev === r.rev) {
      c.at = this.now();
    } else {
      const version = (r.profile as { version?: unknown } | undefined)?.version;
      this.cached = { profile: validateProfile(r.profile), rev: r.rev, at: this.now(), tooNew: typeof version === 'number' && version > PROFILE_VERSION };
    }
    return { profile: structuredClone(this.cached!.profile), rev: this.cached!.rev };
  }

  /** A room saved by a newer MCPortal can be read here but not written, or what this version doesn't know would be dropped. */
  private writable(): void {
    if (this.cached?.tooNew) throw new AppError('unavailable', 'Your room was saved by a newer MCPortal. Update MCPortal on this computer to change it here.');
  }

  private remember(profile: Profile, rev: number): void {
    this.cached = { profile: structuredClone(profile), rev, at: this.now(), tooNew: false };
  }

  async get(userId: string): Promise<Profile> {
    this.mine(userId);
    return (await this.room()).profile;
  }

  async versioned(userId: string): Promise<Versioned> {
    this.mine(userId);
    return this.room();
  }

  /**
   * Run `change` on the latest room and save it if nothing changed it in between;
   * otherwise read again and re-run it. `change` is pure and synchronous (the
   * ProfileStore contract), so running it again is safe.
   */
  update<T>(userId: string, change: (profile: Profile) => ProfileChange<T>): Promise<T> {
    this.mine(userId);
    return this.mutex.run(userId, async () => {
      for (let attempt = 0; ; attempt++) {
        const { profile: current, rev } = await this.room(attempt > 0);
        const { profile, result } = change(current);
        if (!profile) return result;
        this.writable();
        const valid = validateProfile(profile);
        try {
          this.remember(valid, (await this.client.call<{ rev: number }>('room.put', { profile: valid, ifMatch: rev })).rev);
          return result;
        } catch (error) {
          if (errorCode(error) !== 'conflict' || attempt + 1 >= UPDATE_ATTEMPTS) throw error;
        }
      }
    });
  }

  put(userId: string, profile: Profile): Promise<void> {
    this.mine(userId);
    return this.mutex.run(userId, async () => {
      if (!this.cached) await this.room();
      this.writable();
      const valid = validateProfile(profile);
      this.remember(valid, (await this.client.call<{ rev: number }>('room.put', { profile: valid })).rev);
    });
  }

  replaceIf(userId: string, profile: Profile, ifMatch: number): Promise<number> {
    this.mine(userId);
    return this.mutex.run(userId, async () => {
      if (!this.cached) await this.room();
      this.writable();
      const valid = validateProfile(profile);
      const { rev } = await this.client.call<{ rev: number }>('room.put', { profile: valid, ifMatch });
      this.remember(valid, rev);
      return rev;
    });
  }

  /** Whether the last read reached the server, and when the room was last synced (ms), for the toolbar. */
  health(): { offline: boolean; syncedAt?: number } {
    return { offline: this.offline, ...(this.cached ? { syncedAt: this.cached.at } : {}) };
  }

  /** A one-time notice for the next open_room (e.g. what signing in added). */
  addNotice(text: string): void {
    this.notice = this.notice ? `${this.notice}\n${text}` : text;
  }

  takeNotice(userId: string): string | undefined {
    this.mine(userId);
    const notice = this.notice;
    this.notice = undefined;
    return notice;
  }

  async delete(): Promise<void> {
    throw onAccountPage('Deleting your account');
  }
}

export class RemoteClipStore extends Linked implements ClipStore {
  /** The hosted server builds the clip again from its content and picks the id; the clip it stored comes back. */
  async add(userId: string, clip: Clip): Promise<Clip> {
    this.mine(userId);
    const { kind, title, note, tags, source, data } = clip;
    return this.client.call<Clip>('clips.add', { clip: dropUndefined({ kind, title, note, tags, source, data }) });
  }

  async get(userId: string, id: string): Promise<Clip | undefined> {
    this.mine(userId);
    return (await this.client.call<Clip | null>('clips.get', { id })) ?? undefined;
  }

  async list(userId: string, query: ClipQuery = {}): Promise<ClipSummary[]> {
    this.mine(userId);
    return this.client.call('clips.list', dropUndefined({ ...query, limit: query.limit === undefined ? undefined : Math.min(query.limit, 50) }));
  }

  async update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined> {
    this.mine(userId);
    return (await this.client.call<Clip | null>('clips.update', { id, patch: dropUndefined(patch) })) ?? undefined;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    this.mine(userId);
    return this.client.call('clips.delete', { id });
  }

  async usage(userId: string): Promise<{ count: number; bytes: number }> {
    this.mine(userId);
    return this.client.call('clips.usage');
  }

  async deleteAll(): Promise<number> {
    throw onAccountPage('Deleting every clip');
  }
}

export class RemoteReadingStore extends Linked implements ReadingStore {
  async get(userId: string, url: string): Promise<ReadingState | undefined> {
    this.mine(userId);
    return (await this.client.call<ReadingState | null>('reading.get', { url })) ?? undefined;
  }

  async record(userId: string, update: ReadingUpdate): Promise<ReadingState> {
    this.mine(userId);
    return this.client.call('reading.record', dropUndefined({ ...update }));
  }

  async list(userId: string, options: { unfinished?: boolean; limit?: number } = {}): Promise<ReadingState[]> {
    this.mine(userId);
    return this.client.call('reading.list', dropUndefined({ ...options, limit: options.limit === undefined ? undefined : Math.min(options.limit, 100) }));
  }

  async import(): Promise<number> {
    throw onAccountPage('Importing reading history');
  }

  async deleteAll(): Promise<void> {
    throw onAccountPage('Deleting reading history');
  }
}

/**
 * Seen sets are a convenience ("new" badges), so offline they're best effort: reads come
 * back empty (nothing marked new) and marks are dropped, rather than failing the room.
 */
export class RemoteSeenStore extends Linked implements SeenStore {
  async get(userId: string, portalIds: string[]): Promise<Map<string, Set<string>>> {
    this.mine(userId);
    try {
      const sets = await this.client.call<Record<string, string[]>>('seen.get', { portalIds });
      return new Map(Object.entries(sets).map(([portal, items]) => [portal, new Set(items)]));
    } catch (error) {
      if (unreachable(error)) return new Map();
      throw error;
    }
  }

  async mark(userId: string, marks: Array<{ portalId: string; itemIds: string[] }>): Promise<void> {
    this.mine(userId);
    if (marks.length) await this.client.call('seen.mark', { marks }).catch((error: unknown) => { if (!unreachable(error)) throw error; });
  }

  /** The hosted server prunes against the room it holds, which is the room these ids came from. */
  async keepOnly(userId: string): Promise<void> {
    this.mine(userId);
    await this.client.call('seen.prune').catch((error: unknown) => { if (!unreachable(error)) throw error; });
  }

  async deleteAll(): Promise<void> {
    throw onAccountPage('Deleting seen history');
  }
}

export class RemoteHandoffStore extends Linked implements HandoffStore {
  async create(userId: string, input: HandoffInput): Promise<Handoff> {
    this.mine(userId);
    return this.client.call('handoffs.create', dropUndefined({ ...input }));
  }

  async get(userId: string, code: string): Promise<Handoff | undefined> {
    this.mine(userId);
    return (await this.client.call<Handoff | null>('handoffs.get', { code })) ?? undefined;
  }

  async list(userId: string): Promise<Handoff[]> {
    this.mine(userId);
    return this.client.call('handoffs.list');
  }

  async markOpened(userId: string, code: string): Promise<void> {
    this.mine(userId);
    await this.client.call('handoffs.markOpened', { code });
  }

  async deleteAll(): Promise<void> {
    throw onAccountPage('Deleting handoffs');
  }
}

/**
 * The edition, like seen sets, is a convenience: offline the room just doesn't lead with
 * picks, and new picks are shown in their card but not kept.
 */
export class RemoteEditionStore extends Linked implements EditionStore {
  async get(userId: string): Promise<Edition | undefined> {
    this.mine(userId);
    try {
      return (await this.client.call<Edition | null>('editions.get')) ?? undefined;
    } catch (error) {
      if (unreachable(error)) return undefined;
      throw error;
    }
  }

  /** The hosted server dates it; only what the agent chose goes. */
  async put(userId: string, edition: Edition): Promise<void> {
    this.mine(userId);
    await this.client.call('editions.put', dropUndefined({ title: edition.title, intro: edition.intro, picks: edition.picks }))
      .catch((error: unknown) => { if (!unreachable(error)) throw error; });
  }

  async deleteAll(): Promise<void> {
    throw onAccountPage('Deleting your edition');
  }
}

/** Public profiles: your own, and anyone's by handle. */
export function remoteProfiles(client: StateClient, accountId: string): ProfileDirectory {
  const mine = (id: string) => { if (id !== accountId) throw new Error('A linked MCPortal reads only its own public profile by account.'); };
  return {
    async get(id) { mine(id); return (await client.call<Awaited<ReturnType<ProfileDirectory['get']>> | null>('profiles.mine')) ?? undefined; },
    async byHandle(handle) { return (await client.call<Awaited<ReturnType<ProfileDirectory['byHandle']>> | null>('profiles.byHandle', { handle })) ?? undefined; },
    async set(id, input) { mine(id); return client.call('profiles.set', dropUndefined({ ...input })); },
    async remove(id) { mine(id); return (await client.call<Awaited<ReturnType<ProfileDirectory['remove']>> | null>('profiles.remove')) ?? undefined; },
  };
}

/** Sharing and follows, as the linked account. A share names its clip or saved item; the server looks it up. */
export function remoteSocial(client: StateClient, accountId: string): SocialService {
  const as = (viewer: string) => { if (viewer !== accountId) throw new Error('A linked MCPortal acts only as its linked account.'); };
  return {
    async resolve(viewer, handle) { as(viewer); return client.call('social.resolve', { handle }); },
    async share(author, input) {
      as(author);
      const target = input.kind === 'clip' ? { clipId: input.clip?.id } : { savedUrl: input.url };
      return client.call('social.share', dropUndefined({ ...target, note: typeof input.note === 'string' ? input.note : undefined, audience: typeof input.audience === 'string' ? input.audience : undefined, reblogs: typeof input.reblogs === 'string' ? input.reblogs : undefined }));
    },
    async reblog(author, input) {
      as(author);
      return client.call('social.reblog', dropUndefined({ id: input.id, note: typeof input.note === 'string' ? input.note : undefined, audience: typeof input.audience === 'string' ? input.audience : undefined }));
    },
    async shareSettings(author, id, change) {
      as(author);
      return client.call('social.shareSettings', dropUndefined({ id, reblogs: typeof change.reblogs === 'string' ? change.reblogs : undefined, detach: typeof change.detach === 'string' ? change.detach : undefined }));
    },
    async reblogsOf(viewer, id, query = {}) { as(viewer); return client.call('social.reblogsOf', { id, query: dropUndefined({ ...query }) }); },
    async unshare(author, id) { as(author); return client.call('social.unshare', { id }); },
    async get(viewer, id) { as(viewer); return (await client.call<Awaited<ReturnType<SocialService['get']>> | null>('social.get', { id })) ?? undefined; },
    async feed(viewer, query = {}) { as(viewer); return client.call('social.feed', { query: dropUndefined({ ...query }) }); },
    async sharesOf(viewer, owner, query = {}) { as(viewer); return client.call('social.sharesOf', { accountId: owner, query: dropUndefined({ ...query }) }); },
    async follow(viewer, handle) { as(viewer); return client.call('social.follow', { handle }); },
    async unfollow(viewer, handle) { as(viewer); return client.call('social.unfollow', { handle }); },
    async takeIntros(viewer) { as(viewer); return client.call('social.takeIntros', {}); },
    async findPeople(viewer, wanted, options = {}) { as(viewer); return client.call('social.findPeople', { wanted, options: dropUndefined({ ...options }) }); },
    async mute(viewer, handle, on) { as(viewer); return client.call('social.mute', { handle, on }); },
    async block(viewer, handle, on) { as(viewer); return client.call('social.block', { handle, on }); },
    async uses(id) { as(id); return client.call('social.uses'); },
    async connections(viewer) { as(viewer); return client.call('social.connections'); },
    async stats(viewer, owner) { as(viewer); return client.call('social.stats', { accountId: owner }); },
    async report(reporter, target, reason) { as(reporter); return client.call('social.report', { target: dropUndefined({ ...target }), reason: typeof reason === 'string' ? reason : '' }); },
  };
}

/** JSON drops undefined anyway, but the API's schemas refuse unknown or mistyped keys, so leave them out. */
function dropUndefined<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/** Everything a linked MCPortal's ToolContext reads from the hosted account, for one account. */
export function linkedStores(client: StateClient, accountId: string, options: { now?: () => number } = {}) {
  return {
    store: new RemoteProfileStore(client, accountId, options.now),
    clips: new RemoteClipStore(client, accountId),
    reading: new RemoteReadingStore(client, accountId),
    seen: new RemoteSeenStore(client, accountId),
    handoffs: new RemoteHandoffStore(client, accountId),
    editions: new RemoteEditionStore(client, accountId),
    publicProfiles: remoteProfiles(client, accountId),
    social: remoteSocial(client, accountId),
  };
}
