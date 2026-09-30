/**
 * Sharing and follows (identity plan, phase 4). Native to MCPortal: shares are
 * seen by signed-in users in their Following panel or on a profile, never
 * published to the open web.
 *
 *   share   a saved link or a clip with a note. The content is copied at share
 *           time, so the share doesn't change if the clip does. Audience:
 *           'followers' (default) or 'mcportal' (anyone signed in).
 *   follow  open for anyone with a public profile.
 *   mute    their shares disappear from your Following panel.
 *   block   they can't follow you or see your shares, and you don't see theirs;
 *           blocking removes follows both ways.
 *   report  a share or a profile, for admins to look at. Admins can hide a share.
 *
 * Visibility is decided here, in one place (canSee), and every cross-user read
 * goes through Social. Stores only store.
 */
import { randomBytes } from 'node:crypto';
import type { AuthPersistence } from './auth/store.ts';
import { cleanText, type Clip } from './clips.ts';
import { clean } from './lib/text.ts';
import type { PublicProfile, PublicProfiles } from './public-profiles.ts';
import { KeyedMutex } from './store.ts';

export const AUDIENCES = ['followers', 'mcportal'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const SOCIAL_LIMITS = { note: 500, sharesPerUser: 1000, follows: 2000, reason: 500, openReportsPerUser: 50 } as const;

export interface Share {
  id: string;
  accountId: string;
  kind: 'link' | 'clip';
  title: string;
  url?: string;
  note?: string;
  audience: Audience;
  /** For clip shares: the clip as it was when shared. */
  clip?: Clip;
  createdAt: string;
  /** Set when an admin hides it; then only its author sees it. */
  hiddenAt?: string;
}

export interface Report {
  id: string;
  reporterId: string;
  targetKind: 'share' | 'profile';
  targetId: string;
  reason: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
}

export type Relation = 'follows' | 'mutes' | 'blocks';

export interface PageQuery {
  limit?: number;
  before?: string;
}

export class SocialError extends Error {
  override name = 'SocialError';
}

/** Storage only; no rules. */
export interface SocialStore {
  addShare(share: Share): Promise<void>;
  getShare(id: string): Promise<Share | undefined>;
  deleteShare(accountId: string, id: string): Promise<boolean>;
  setHidden(id: string, hiddenAt: string | null): Promise<boolean>;
  /** Newest first. */
  sharesBy(accountIds: string[], query: PageQuery & { includeHidden?: boolean }): Promise<Share[]>;
  countShares(accountId: string): Promise<number>;
  /** a follows/mutes/blocks b. */
  relate(relation: Relation, a: string, b: string): Promise<boolean>;
  unrelate(relation: Relation, a: string, b: string): Promise<boolean>;
  /** Everyone a follows/mutes/blocks. */
  outgoing(relation: Relation, a: string): Promise<string[]>;
  /** Everyone who follows/mutes/blocks b. */
  incoming(relation: Relation, b: string): Promise<string[]>;
  addReport(report: Report): Promise<void>;
  reports(status?: Report['status'], limit?: number): Promise<Report[]>;
  resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined>;
  /** Account deletion: their shares and relations go; reports they filed stay, anonymized. */
  forget(accountId: string): Promise<void>;
}

const newId = (prefix: string) => `${prefix}${randomBytes(6).toString('hex')}`;
const limitOf = (q: PageQuery, fallback = 30, max = 100) => Math.min(max, Math.max(1, Math.round(Number(q.limit) || fallback)));

// ---- in-process store ---------------------------------------------------------

interface Doc {
  shares: Share[];
  relations: Record<Relation, Array<[string, string, string]>>;   // [a, b, at]
  reports: Report[];
}

/** One document (memory, or a file / Postgres row via persistence). For tests and local servers. */
export class DocumentSocialStore implements SocialStore {
  private persistence?: AuthPersistence;
  private doc: Doc | null = null;
  private mutex = new KeyedMutex();

  constructor(persistence?: AuthPersistence) {
    this.persistence = persistence;
  }

  private async load(): Promise<Doc> {
    if (this.doc) return this.doc;
    let parsed: Partial<Doc> = {};
    try {
      const raw = await this.persistence?.read();
      parsed = raw ? (JSON.parse(raw) as Partial<Doc>) : {};
    } catch (error) {
      process.stderr.write(`[mcportal] social document unreadable, starting empty: ${(error as Error).message}\n`);
    }
    this.doc = { shares: parsed.shares ?? [], relations: { follows: [], mutes: [], blocks: [], ...parsed.relations }, reports: parsed.reports ?? [] };
    return this.doc;
  }

  private write<T>(change: (doc: Doc) => T): Promise<T> {
    return this.mutex.run('social', async () => {
      const doc = await this.load();
      const result = change(doc);
      await this.persistence?.write(JSON.stringify(doc));
      return result;
    });
  }

  async addShare(share: Share): Promise<void> {
    await this.write((d) => { d.shares.unshift(structuredClone(share)); });
  }

  async getShare(id: string): Promise<Share | undefined> {
    return structuredClone((await this.load()).shares.find((s) => s.id === id));
  }

  deleteShare(accountId: string, id: string): Promise<boolean> {
    return this.write((d) => {
      const before = d.shares.length;
      d.shares = d.shares.filter((s) => !(s.id === id && s.accountId === accountId));
      return d.shares.length < before;
    });
  }

  setHidden(id: string, hiddenAt: string | null): Promise<boolean> {
    return this.write((d) => {
      const share = d.shares.find((s) => s.id === id);
      if (!share) return false;
      if (hiddenAt) share.hiddenAt = hiddenAt;
      else delete share.hiddenAt;
      return true;
    });
  }

  async sharesBy(accountIds: string[], query: PageQuery & { includeHidden?: boolean }): Promise<Share[]> {
    const ids = new Set(accountIds);
    return structuredClone((await this.load()).shares
      .filter((s) => ids.has(s.accountId) && (query.includeHidden || !s.hiddenAt) && (!query.before || s.createdAt < query.before))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, limitOf(query)));
  }

  async countShares(accountId: string): Promise<number> {
    return (await this.load()).shares.filter((s) => s.accountId === accountId).length;
  }

  relate(relation: Relation, a: string, b: string): Promise<boolean> {
    return this.write((d) => {
      if (d.relations[relation].some(([x, y]) => x === a && y === b)) return false;
      d.relations[relation].push([a, b, new Date().toISOString()]);
      return true;
    });
  }

  unrelate(relation: Relation, a: string, b: string): Promise<boolean> {
    return this.write((d) => {
      const before = d.relations[relation].length;
      d.relations[relation] = d.relations[relation].filter(([x, y]) => !(x === a && y === b));
      return d.relations[relation].length < before;
    });
  }

  async outgoing(relation: Relation, a: string): Promise<string[]> {
    return (await this.load()).relations[relation].filter(([x]) => x === a).map(([, y]) => y);
  }

  async incoming(relation: Relation, b: string): Promise<string[]> {
    return (await this.load()).relations[relation].filter(([, y]) => y === b).map(([x]) => x);
  }

  async addReport(report: Report): Promise<void> {
    await this.write((d) => { d.reports.unshift(structuredClone(report)); });
  }

  async reports(status?: Report['status'], limit = 100): Promise<Report[]> {
    return structuredClone((await this.load()).reports.filter((r) => !status || r.status === status).slice(0, limit));
  }

  resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined> {
    return this.write((d) => {
      const report = d.reports.find((r) => r.id === id);
      if (!report) return undefined;
      Object.assign(report, { status: 'resolved', resolvedAt: at, resolvedBy: by, resolution });
      return structuredClone(report);
    });
  }

  async forget(accountId: string): Promise<void> {
    await this.write((d) => {
      d.shares = d.shares.filter((s) => s.accountId !== accountId);
      for (const r of Object.keys(d.relations) as Relation[]) d.relations[r] = d.relations[r].filter(([a, b]) => a !== accountId && b !== accountId);
      for (const report of d.reports) if (report.reporterId === accountId) report.reporterId = 'deleted';
    });
  }
}

// ---- the rules ----------------------------------------------------------------

/** A share as another user sees it: the author by handle, never by account id. */
export interface SharedItem extends Omit<Share, 'accountId'> {
  author: { handle: string; displayName?: string };
  mine: boolean;
}

export interface SocialDeps {
  store: SocialStore;
  profiles: PublicProfiles;
  /** Accounts that can't be seen (suspended). */
  hidden?: (accountId: string) => boolean;
  now?: () => number;
}

export class Social {
  private store: SocialStore;
  private profiles: PublicProfiles;
  private hidden: (accountId: string) => boolean;
  private now: () => number;

  constructor(deps: SocialDeps) {
    this.store = deps.store;
    this.profiles = deps.profiles;
    this.hidden = deps.hidden ?? (() => false);
    this.now = deps.now ?? Date.now;
  }

  private at(): string {
    return new Date(this.now()).toISOString();
  }

  /** The account behind a handle that `viewer` may deal with (visible, not blocked either way). */
  async resolve(viewer: string, handle: string): Promise<PublicProfile> {
    const found = await this.profiles.byHandle(handle);
    if (!found) throw new SocialError(`No MCPortal profile for @${clean(handle, 40).replace(/^@/, '')}`);
    if (found.profile.accountId !== viewer && (await this.blockedEitherWay(viewer, found.profile.accountId))) {
      throw new SocialError(`No MCPortal profile for @${found.profile.handle}`);   // a block hides both ways, silently
    }
    return found.profile;
  }

  private async blockedEitherWay(a: string, b: string): Promise<boolean> {
    return (await this.store.outgoing('blocks', a)).includes(b) || (await this.store.outgoing('blocks', b)).includes(a);
  }

  /** The one visibility rule for shares. */
  async canSee(viewer: string, share: Share): Promise<boolean> {
    if (share.accountId === viewer) return true;
    if (share.hiddenAt || this.hidden(share.accountId)) return false;
    if (!(await this.profiles.get(share.accountId))) return false;   // gone private: shares go with the profile
    if (await this.blockedEitherWay(viewer, share.accountId)) return false;
    if (share.audience === 'mcportal') return true;
    return (await this.store.outgoing('follows', viewer)).includes(share.accountId);
  }

  private async present(viewer: string, shares: Share[]): Promise<SharedItem[]> {
    const out: SharedItem[] = [];
    for (const s of shares) {
      const author = await this.profiles.get(s.accountId);
      const { accountId, ...rest } = s;
      out.push({ ...rest, author: author ? { handle: author.handle, ...(author.displayName ? { displayName: author.displayName } : {}) } : { handle: 'you' }, mine: accountId === viewer });
    }
    return out;
  }

  async share(author: string, input: { kind: 'link' | 'clip'; title: string; url?: string; clip?: Clip; note?: unknown; audience?: unknown }): Promise<SharedItem> {
    if (!(await this.profiles.get(author))) throw new SocialError('Sharing needs a public profile, so people know who shared it. Create one with set_public_profile first');
    if ((await this.store.countShares(author)) >= SOCIAL_LIMITS.sharesPerUser) throw new SocialError(`You have ${SOCIAL_LIMITS.sharesPerUser} shares, the most MCPortal keeps. Remove some with unshare`);
    const audience: Audience = input.audience === 'mcportal' ? 'mcportal' : 'followers';
    let note: string;
    try {
      note = cleanText(input.note, SOCIAL_LIMITS.note, 'note');
    } catch (error) {
      throw new SocialError((error as Error).message.replace(/\.$/, ''));
    }
    const share: Share = {
      id: newId('s'),
      accountId: author,
      kind: input.kind,
      title: clean(input.title, 200) || 'Untitled',
      ...(input.url ? { url: input.url } : {}),
      ...(note ? { note } : {}),
      audience,
      ...(input.clip ? { clip: input.clip } : {}),
      createdAt: this.at(),
    };
    await this.store.addShare(share);
    return (await this.present(author, [share]))[0]!;
  }

  async unshare(author: string, id: string): Promise<boolean> {
    return this.store.deleteShare(author, id);
  }

  /** One share, if the viewer may see it. */
  async get(viewer: string, id: string): Promise<SharedItem | undefined> {
    const share = await this.store.getShare(id);
    return share && (await this.canSee(viewer, share)) ? (await this.present(viewer, [share]))[0] : undefined;
  }

  /** The Following panel: shares from people the viewer follows, minus muted and blocked. */
  async feed(viewer: string, query: PageQuery = {}): Promise<SharedItem[]> {
    const limit = limitOf(query);
    const muted = new Set(await this.store.outgoing('mutes', viewer));
    const authors: string[] = [];
    for (const id of await this.store.outgoing('follows', viewer)) if (!muted.has(id)) authors.push(id);
    if (!authors.length) return [];
    const visible: Share[] = [];
    let before = query.before;
    for (let round = 0; round < 5 && visible.length < limit; round++) {
      const page = await this.store.sharesBy(authors, { limit: limit * 2, before });
      for (const s of page) if (visible.length < limit && (await this.canSee(viewer, s))) visible.push(s);
      if (page.length < limit * 2) break;
      before = page[page.length - 1]!.createdAt;
    }
    return this.present(viewer, visible);
  }

  /** One person's shares that the viewer may see (all of them, for yourself). */
  async sharesOf(viewer: string, accountId: string, query: PageQuery = {}): Promise<SharedItem[]> {
    const page = await this.store.sharesBy([accountId], { ...query, limit: limitOf(query) * 2, includeHidden: accountId === viewer });
    const visible: Share[] = [];
    for (const s of page) if (visible.length < limitOf(query) && (await this.canSee(viewer, s))) visible.push(s);
    return this.present(viewer, visible);
  }

  async follow(viewer: string, handle: string): Promise<PublicProfile> {
    const target = await this.resolve(viewer, handle);
    if (target.accountId === viewer) throw new SocialError("You can't follow yourself");
    if ((await this.store.outgoing('follows', viewer)).length >= SOCIAL_LIMITS.follows) throw new SocialError(`You follow ${SOCIAL_LIMITS.follows} people, the most MCPortal allows`);
    await this.store.relate('follows', viewer, target.accountId);
    return target;
  }

  async unfollow(viewer: string, handle: string): Promise<boolean> {
    const found = await this.profiles.byHandle(handle);
    return found ? this.store.unrelate('follows', viewer, found.profile.accountId) : false;
  }

  async mute(viewer: string, handle: string, on: boolean): Promise<PublicProfile> {
    const target = await this.resolve(viewer, handle);
    if (target.accountId === viewer) throw new SocialError("You can't mute yourself");
    if (on) await this.store.relate('mutes', viewer, target.accountId);
    else await this.store.unrelate('mutes', viewer, target.accountId);
    return target;
  }

  /** Blocking also removes follows both ways. Unblocking doesn't restore them. */
  async block(viewer: string, handle: string, on: boolean): Promise<PublicProfile> {
    const found = await this.profiles.byHandle(handle);
    if (!found) throw new SocialError(`No MCPortal profile for @${clean(handle, 40).replace(/^@/, '')}`);
    const target = found.profile;
    if (target.accountId === viewer) throw new SocialError("You can't block yourself");
    if (on) {
      await this.store.relate('blocks', viewer, target.accountId);
      await this.store.unrelate('follows', viewer, target.accountId);
      await this.store.unrelate('follows', target.accountId, viewer);
    } else await this.store.unrelate('blocks', viewer, target.accountId);
    return target;
  }

  /** Handles in the viewer's lists, and how many follow them (never who). */
  async connections(viewer: string): Promise<{ following: string[]; muted: string[]; blocked: string[]; followers: number }> {
    const handles = async (ids: string[]) => (await Promise.all(ids.map((id) => this.profiles.get(id)))).filter((p): p is PublicProfile => Boolean(p) && !this.hidden(p!.accountId)).map((p) => p.handle).sort();
    return {
      following: await handles(await this.store.outgoing('follows', viewer)),
      muted: await handles(await this.store.outgoing('mutes', viewer)),
      blocked: await handles(await this.store.outgoing('blocks', viewer)),
      followers: (await this.store.incoming('follows', viewer)).length,
    };
  }

  /** Counts others may see on a profile. */
  async stats(viewer: string, accountId: string): Promise<{ followers: number; following: boolean; shares: number }> {
    const visible = await this.sharesOf(viewer, accountId, { limit: 100 });
    return { followers: (await this.store.incoming('follows', accountId)).length, following: (await this.store.outgoing('follows', viewer)).includes(accountId), shares: visible.length };
  }

  async report(reporter: string, target: { shareId?: string; handle?: string }, reason: unknown): Promise<Report> {
    const why = clean(reason, SOCIAL_LIMITS.reason);
    if (!why) throw new SocialError('Say briefly what is wrong');
    const open = (await this.store.reports('open', 10_000)).filter((r) => r.reporterId === reporter).length;
    if (open >= SOCIAL_LIMITS.openReportsPerUser) throw new SocialError('You have many open reports; an admin will get to them');
    let targetKind: Report['targetKind'];
    let targetId: string;
    if (target.shareId) {
      const share = await this.store.getShare(target.shareId);
      if (!share || !(await this.canSee(reporter, share))) throw new SocialError('No such share');
      if (share.accountId === reporter) throw new SocialError("That's your own share; remove it with unshare");
      targetKind = 'share';
      targetId = share.id;
    } else if (target.handle) {
      const profile = await this.resolve(reporter, target.handle);
      if (profile.accountId === reporter) throw new SocialError("You can't report yourself");
      targetKind = 'profile';
      targetId = profile.accountId;
    } else throw new SocialError('Report a share (shareId) or a person (handle)');
    const report: Report = { id: newId('r'), reporterId: reporter, targetKind, targetId, reason: why, status: 'open', createdAt: this.at() };
    await this.store.addReport(report);
    return report;
  }

  // ---- admin (admin page only; never tools) ----

  reports(status?: Report['status']): Promise<Report[]> {
    return this.store.reports(status);
  }

  getShareForAdmin(id: string): Promise<Share | undefined> {
    return this.store.getShare(id);
  }

  hideShare(id: string, hidden: boolean): Promise<boolean> {
    return this.store.setHidden(id, hidden ? this.at() : null);
  }

  resolveReport(id: string, by: string, resolution: string): Promise<Report | undefined> {
    return this.store.resolveReport(id, by, clean(resolution, 200) || 'resolved', this.at());
  }

  forget(accountId: string): Promise<void> {
    return this.store.forget(accountId);
  }
}
