/**
 * Sharing and follows (identity plan, phase 4). Native to MCPortal: shares are
 * seen by signed-in users in their Following portal or on a profile, never
 * published to the open web.
 *
 *   share   a saved link or a clip with a note. The content is copied at share
 *           time, so the share doesn't change if the clip does. Audience:
 *           'followers' (default) or 'mcportal' (anyone signed in).
 *   follow  open for anyone with a public profile.
 *   mute    their shares disappear from your Following portal.
 *   block   they can't follow you or see your shares, and you don't see theirs;
 *           blocking removes follows both ways.
 *   report  a share or a profile, for admins to look at. Admins can hide a share.
 *   reblog  pass someone's post on to your followers, with an optional note
 *           (docs/plans/reblog.md). A reblog references the original, never copies
 *           its note or clip, so the original's author keeps control: deleting it,
 *           hiding it, or detaching it from one reblog leaves a tombstone there.
 *           Reblogging a reblog reblogs the original, crediting the one you saw (via).
 *           Counts pool on the original. Who may reblog is the original's rule.
 *
 * Visibility is decided here, in one place (canSee), and every cross-user read
 * goes through Social. Stores only store.
 *
 * The store interface and the in-process store live in social-store.ts and are
 * re-exported from here.
 */
import { randomBytes } from 'node:crypto';
import { ClipError, cleanText, type Clip } from './clips.ts';
import { AppError, type AppErrorOptions, type ErrorCode } from './lib/errors.ts';
import { clean } from './lib/text.ts';
import type { PublicProfile, PublicProfiles } from './public-profiles.ts';
import { limitOf, type SocialStore } from './social-store.ts';

export { DocumentSocialStore, type SocialStore } from './social-store.ts';

export const AUDIENCES = ['followers', 'mcportal'] as const;
export type Audience = (typeof AUDIENCES)[number];
/** Who may reblog a post: anyone signed in, people who follow its author, or nobody. */
export const REBLOG_RULES = ['anyone', 'followers', 'nobody'] as const;
export type ReblogRule = (typeof REBLOG_RULES)[number];

/** How long a resolved report is kept. */
export const REPORT_DAYS = 180;

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
  /** A reblog: the original post, and the reblog it was reblogged from (if any). Title, kind and url are the original's, as a snapshot. */
  reblogOf?: { root: string; via?: string };
  /** Who may reblog this post (originals only). Absent: anyone. */
  reblogs?: ReblogRule;
  /** On a reblog: when the original's author removed their post from it. */
  detachedAt?: string;
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
  limit?: number | undefined;
  before?: string | undefined;
}

/** A sharing or relationship request the rules refuse. Defaults to invalid_argument; pass a code when it's something else. */
export class SocialError extends AppError {
  override name = 'SocialError';

  constructor(message: string, code: ErrorCode = 'invalid_argument', options?: AppErrorOptions) {
    super(code, message, options);
  }
}

const newId = (prefix: string) => `${prefix}${randomBytes(6).toString('hex')}`;

// ---- the rules ----------------------------------------------------------------

/** An author as others see them: by handle, never by account id. */
export interface Author { handle: string; displayName?: string }

/**
 * The original of a reblog as the viewer may see it, drawn live: its author, note and clip.
 * Or why it's gone: deleted, hidden or private ('removed'), or detached by its author.
 */
export type Original =
  | { id: string; author: Author; title: string; url?: string; note?: string; clip?: Clip; kind: 'link' | 'clip'; createdAt: string }
  | { removed: 'removed' | 'detached' };

/** A share as another user sees it: the author by handle, never by account id. */
export interface SharedItem extends Omit<Share, 'accountId'> {
  author: Author;
  mine: boolean;
  /** A reblog's original (or its tombstone). */
  original?: Original;
  /** The handle of the reblog this one was reblogged from, while it can be seen. */
  via?: string;
  /** Reblogs of the original, pooled: the same count on the original and on every reblog. */
  reblogCount: number;
  /** The viewer's own reblog of the original, if any (to undo). */
  myReblog?: string;
  /** Whether the viewer may reblog it now. */
  canReblog: boolean;
}

/** Someone who reblogged a post, as the viewer may see them. */
export interface Reblogger { handle: string; reblogId: string; createdAt: string; note?: string; detached?: true }

export interface SocialDeps {
  store: SocialStore;
  profiles: PublicProfiles;
  /** Accounts that can't be seen (suspended). */
  hidden?: (accountId: string) => boolean;
  now?: () => number;
}

/**
 * What tools ask of the social layer, always acting as the signed-in account (the
 * first argument). The hosted server implements it with Social; a linked local
 * MCPortal implements it over the hosted API. Moderation (reports, hiding,
 * forgetting an account) is left out: it's for the admin page, never for tools.
 */
export type SocialService = Pick<Social,
  'resolve' | 'share' | 'unshare' | 'get' | 'feed' | 'sharesOf' | 'follow' | 'unfollow' | 'mute' | 'block' | 'uses' | 'connections' | 'stats' | 'report'
  | 'reblog' | 'shareSettings' | 'reblogsOf'>;

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
    if (!found) throw new SocialError(`No MCPortal profile for @${clean(handle, 40).replace(/^@/, '')}`, 'not_found');
    if (found.profile.accountId !== viewer && (await this.blockedEitherWay(viewer, found.profile.accountId))) {
      throw new SocialError(`No MCPortal profile for @${found.profile.handle}`, 'not_found');   // a block hides both ways, silently
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
    // A reblog of someone the viewer blocked (or who blocked them) isn't shown at all, not even as a tombstone.
    if (share.reblogOf) {
      const root = await this.store.getShare(share.reblogOf.root);
      if (root && root.accountId !== viewer && (await this.blockedEitherWay(viewer, root.accountId))) return false;
    }
    if (share.audience === 'mcportal') return true;
    return (await this.store.outgoing('follows', viewer)).includes(share.accountId);
  }

  private async authorOf(accountId: string): Promise<Author | undefined> {
    const profile = await this.profiles.get(accountId);
    return profile ? { handle: profile.handle, ...(profile.displayName ? { displayName: profile.displayName } : {}) } : undefined;
  }

  /**
   * Why `viewer` may not reblog `root` (an original), or null when they may. The author's
   * rule decides, and a followers-only post never travels further than its author chose.
   */
  private async refusal(viewer: string, root: Share): Promise<{ message: string; code: ErrorCode } | null> {
    if (!(await this.canSee(viewer, root))) return { message: 'No such post', code: 'not_found' };
    if (root.accountId === viewer) return { message: "That's your own post: it's already in your Space", code: 'invalid_argument' };
    const who = `@${(await this.authorOf(root.accountId))?.handle ?? 'its author'}`;
    if (root.audience === 'followers') return { message: `${who} shared this with their followers only, so it can't be reblogged`, code: 'forbidden' };
    const rule = root.reblogs ?? 'anyone';
    if (rule === 'nobody') return { message: `${who} keeps this one to themselves: reblogs are off`, code: 'forbidden' };
    if (rule === 'followers' && !(await this.store.outgoing('follows', viewer)).includes(root.accountId)) return { message: `Only people who follow ${who} can reblog this`, code: 'forbidden' };
    return null;
  }

  /** A reblog's original as the viewer may see it, or why it's gone. @param root the stored original, if it still exists */
  private async originalFor(viewer: string, reblog: Share, root: Share | undefined): Promise<Original> {
    if (reblog.detachedAt) return { removed: 'detached' };
    if (!root || !(await this.canSee(viewer, root))) return { removed: 'removed' };
    const author = await this.authorOf(root.accountId);
    if (!author) return { removed: 'removed' };
    return { id: root.id, author, title: root.title, kind: root.kind, createdAt: root.createdAt,
      ...(root.url ? { url: root.url } : {}), ...(root.note ? { note: root.note } : {}), ...(root.clip ? { clip: root.clip } : {}) };
  }

  private async present(viewer: string, shares: Share[]): Promise<SharedItem[]> {
    const rootIdOf = (s: Share) => s.reblogOf?.root ?? s.id;
    const rootIds = [...new Set(shares.map(rootIdOf))];
    const [counts, mine] = await Promise.all([this.store.countReblogs(rootIds), this.store.reblogsBy(viewer, rootIds)]);
    const roots = new Map<string, Share | undefined>();
    for (const id of rootIds) roots.set(id, shares.find((s) => s.id === id) ?? (await this.store.getShare(id)));
    const out: SharedItem[] = [];
    for (const s of shares) {
      const { accountId, ...rest } = s;
      const root = roots.get(rootIdOf(s));
      const item: SharedItem = {
        ...rest,
        author: (await this.authorOf(accountId)) ?? { handle: 'you' },
        mine: accountId === viewer,
        reblogCount: counts.get(rootIdOf(s)) ?? 0,
        canReblog: Boolean(root) && !s.detachedAt && !mine.has(rootIdOf(s)) && !(await this.refusal(viewer, root!)),
      };
      const myReblog = mine.get(rootIdOf(s));
      if (myReblog) item.myReblog = myReblog;
      if (s.reblogOf) {
        item.original = await this.originalFor(viewer, s, root);
        const via = s.reblogOf.via ? await this.store.getShare(s.reblogOf.via) : undefined;
        const viaAuthor = via && (await this.canSee(viewer, via)) ? await this.authorOf(via.accountId) : undefined;
        if (viaAuthor) item.via = viaAuthor.handle;
      }
      out.push(item);
    }
    return out;
  }

  /** A new post by `author`: the profile and limit checks every post passes, and its note cleaned. */
  private async post(author: string, input: { note?: unknown; audience?: unknown }, fields: Omit<Share, 'id' | 'accountId' | 'note' | 'audience' | 'createdAt'>): Promise<SharedItem> {
    if (!(await this.profiles.get(author))) throw new SocialError('Sharing needs a public profile, so people know who shared it. Create one with set_public_profile first', 'failed_precondition');
    if ((await this.store.countShares(author)) >= SOCIAL_LIMITS.sharesPerUser) throw new SocialError(`You have ${SOCIAL_LIMITS.sharesPerUser} posts, the most MCPortal keeps. Remove some with unshare`, 'limit_exceeded');
    const audience: Audience = input.audience === 'mcportal' ? 'mcportal' : 'followers';
    let note: string;
    try {
      note = cleanText(input.note, SOCIAL_LIMITS.note, 'note');
    } catch (error) {
      if (!(error instanceof ClipError)) throw error;
      throw new SocialError(error.message.replace(/\.$/, ''), error.code);
    }
    const share: Share = { id: newId('s'), accountId: author, ...fields, ...(note ? { note } : {}), audience, createdAt: this.at() };
    await this.store.addShare(share);
    return (await this.present(author, [share]))[0]!;
  }

  async share(author: string, input: { kind: 'link' | 'clip'; title: string; url?: string | undefined; clip?: Clip | undefined; note?: unknown; audience?: unknown; reblogs?: unknown }): Promise<SharedItem> {
    // Who may reblog it: what the post says, else the author's default (absent: anyone).
    const reblogs = (REBLOG_RULES as readonly unknown[]).includes(input.reblogs) ? input.reblogs as ReblogRule : (await this.profiles.get(author))?.reblogs;
    return this.post(author, input, {
      kind: input.kind,
      title: clean(input.title, 200) || 'Untitled',
      ...(input.url ? { url: input.url } : {}),
      ...(input.clip ? { clip: input.clip } : {}),
      ...(reblogs && reblogs !== 'anyone' ? { reblogs } : {}),
    });
  }

  /**
   * Reblog a post the author can see. A reblog of a reblog reblogs its original, crediting
   * the one it came through. One reblog per person per original; the original's rule decides.
   */
  async reblog(author: string, input: { id: string; note?: unknown; audience?: unknown }): Promise<SharedItem> {
    const seen = await this.store.getShare(String(input.id));
    if (!seen || !(await this.canSee(author, seen))) throw new SocialError('No such post', 'not_found');
    if (seen.detachedAt) throw new SocialError('Its author removed the original from that reblog', 'failed_precondition');
    const root = seen.reblogOf ? await this.store.getShare(seen.reblogOf.root) : seen;
    if (!root) throw new SocialError('The original post was removed', 'not_found');
    const refused = await this.refusal(author, root);
    if (refused) throw new SocialError(refused.message, refused.code);
    const existing = (await this.store.reblogsBy(author, [root.id])).get(root.id);
    if (existing) throw new SocialError(`You already reblogged it (${existing}); undo with unshare`, 'conflict');
    const via = seen.reblogOf && seen.accountId !== author ? seen.id : undefined;
    return this.post(author, input, {
      kind: root.kind,
      title: root.title,
      ...(root.url ? { url: root.url } : {}),
      reblogOf: { root: root.id, ...(via ? { via } : {}) },
    });
  }

  /**
   * The author acting on their own post: who may reblog it from now on (existing reblogs
   * stay), or removing it from one reblog of it (`detach`: that reblog's id), for good.
   */
  async shareSettings(author: string, id: string, change: { reblogs?: unknown; detach?: unknown }): Promise<SharedItem> {
    const share = await this.store.getShare(String(id));
    if (!share || share.accountId !== author) throw new SocialError('No post of yours with that id', 'not_found');
    if (change.reblogs !== undefined) {
      if (!(REBLOG_RULES as readonly unknown[]).includes(change.reblogs)) throw new SocialError(`reblogs must be one of ${REBLOG_RULES.join(', ')}`);
      if (share.reblogOf) throw new SocialError("A reblog follows its original's rule");
      await this.store.updateShare(share.id, { reblogs: change.reblogs === 'anyone' ? null : change.reblogs as ReblogRule });
    }
    if (change.detach !== undefined) {
      const reblog = await this.store.getShare(String(change.detach));
      if (!reblog || reblog.reblogOf?.root !== share.id) throw new SocialError('That reblog is not of this post', 'not_found');
      if (!reblog.detachedAt) await this.store.updateShare(reblog.id, { detachedAt: this.at() });
    }
    return (await this.present(author, [(await this.store.getShare(share.id))!]))[0]!;
  }

  /**
   * Who reblogged a post (or a reblog's original), newest first, as the viewer may see them.
   * The original's author sees everyone who reblogged it (the credit is theirs), detached ones
   * marked, but a reblog's note only when they may see that reblog; blocks hide both ways.
   */
  async reblogsOf(viewer: string, id: string, query: PageQuery = {}): Promise<Reblogger[]> {
    const seen = await this.store.getShare(String(id));
    const root = seen?.reblogOf ? await this.store.getShare(seen.reblogOf.root) : seen;
    if (!root || !(await this.canSee(viewer, root))) throw new SocialError('No such post', 'not_found');
    const isAuthor = root.accountId === viewer;
    const out: Reblogger[] = [];
    for (const r of await this.store.reblogsOf(root.id, { ...query, limit: limitOf(query) })) {
      const visible = await this.canSee(viewer, r);
      if (isAuthor ? this.hidden(r.accountId) || (await this.blockedEitherWay(viewer, r.accountId)) : r.detachedAt || !visible) continue;
      const who = await this.authorOf(r.accountId);
      if (!who) continue;
      out.push({ handle: who.handle, reblogId: r.id, createdAt: r.createdAt, ...(r.note && visible ? { note: r.note } : {}), ...(r.detachedAt ? { detached: true as const } : {}) });
    }
    return out;
  }

  async unshare(author: string, id: string): Promise<boolean> {
    return this.store.deleteShare(author, id);
  }

  /** One share, if the viewer may see it. */
  async get(viewer: string, id: string): Promise<SharedItem | undefined> {
    const share = await this.store.getShare(id);
    return share && (await this.canSee(viewer, share)) ? (await this.present(viewer, [share]))[0] : undefined;
  }

  /** The Following portal: shares from people the viewer follows, minus muted and blocked. */
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
      for (const s of page) {
        if (visible.length >= limit || !(await this.canSee(viewer, s))) continue;
        // Muting someone hides their posts, reblogged or not.
        if (s.reblogOf && muted.size && muted.has((await this.store.getShare(s.reblogOf.root))?.accountId ?? '')) continue;
        visible.push(s);
      }
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
    if ((await this.store.outgoing('follows', viewer)).length >= SOCIAL_LIMITS.follows) throw new SocialError(`You follow ${SOCIAL_LIMITS.follows} people, the most MCPortal allows`, 'limit_exceeded');
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
    if (!found) throw new SocialError(`No MCPortal profile for @${clean(handle, 40).replace(/^@/, '')}`, 'not_found');
    const target = found.profile;
    if (target.accountId === viewer) throw new SocialError("You can't block yourself");
    if (on) {
      await this.store.relate('blocks', viewer, target.accountId);
      await this.store.unrelate('follows', viewer, target.accountId);
      await this.store.unrelate('follows', target.accountId, viewer);
    } else await this.store.unrelate('blocks', viewer, target.accountId);
    return target;
  }

  /** Whether an account takes part: follows, mutes or blocks anyone (cheap: no profiles are read). */
  async uses(accountId: string): Promise<boolean> {
    for (const relation of ['follows', 'mutes', 'blocks'] as const) if ((await this.store.outgoing(relation, accountId)).length) return true;
    return false;
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

  async report(reporter: string, target: { shareId?: string | undefined; handle?: string | undefined }, reason: unknown): Promise<Report> {
    const why = clean(reason, SOCIAL_LIMITS.reason);
    if (!why) throw new SocialError('Say briefly what is wrong');
    const open = (await this.store.reports('open', 10_000)).filter((r) => r.reporterId === reporter).length;
    if (open >= SOCIAL_LIMITS.openReportsPerUser) throw new SocialError('You have many open reports; an admin will get to them', 'limit_exceeded');
    let targetKind: Report['targetKind'];
    let targetId: string;
    if (target.shareId) {
      const share = await this.store.getShare(target.shareId);
      if (!share || !(await this.canSee(reporter, share))) throw new SocialError('No such share', 'not_found');
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
    return this.store.forget(accountId, this.at());
  }

  /** Retention: resolved reports are kept REPORT_DAYS after they were resolved. */
  purgeReports(): Promise<number> {
    return this.store.purgeReports(new Date(Date.parse(this.at()) - REPORT_DAYS * 86_400_000).toISOString());
  }
}
