/**
 * Sharing tools: share (and reblog), unshare, get_share, share_settings, list_shares,
 * relationship, list_connections, report. Everything other people wrote (notes, titles,
 * clips) reaches the model fenced as untrusted: another user's note is exactly
 * where someone would try to plant instructions.
 */
import { clean } from '../lib/text.ts';
import { httpUrl } from '../profile.ts';
import { clipText, type ClipData } from '../clips.ts';
import { AUDIENCES, REBLOG_RULES, type PersonMatch, type Reblogger, type SharedItem } from '../social.ts';
import { hostOf, namedSignal, sourceSignal, termsOf, type Wanted } from '../people.ts';
import { isAppError } from '../lib/errors.ts';
import { ensurePortal } from '../layout.ts';
import { PEOPLE, type Profile } from '../profile.ts';
import { peoplePortal, type SuggestedPerson } from '../sources.ts';
import { HOSTED_ONLY, labsOf, socialActive, socialEntry, ok, toolError, untrusted, ROOM_URI, type CallToolResult, type ToolContext, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

export function shareLine(s: SharedItem): string {
  const who = s.mine ? 'you' : `@${s.author.handle}`;
  const to = s.audience === 'mcportal' ? 'everyone on MCPortal' : 'followers';
  const original = s.original && 'author' in s.original ? s.original : undefined;
  const what = s.reblogOf
    ? `reblogged ${original ? `@${original.author.handle}'s post` : s.original && 'removed' in s.original && s.original.removed === 'detached' ? 'a post its author removed from this reblog' : 'a post that was removed'}${s.via ? ` (via @${s.via})` : ''}`
    : `shared ${s.kind === 'clip' ? `a ${s.clip?.kind ?? 'clip'}` : 'a link'}`;
  const reblogs = [s.reblogCount ? `${s.reblogCount} reblog${s.reblogCount === 1 ? '' : 's'}` : '', s.reblogs && !s.reblogOf ? `reblogs: ${s.reblogs} only` : '', s.myReblog && !s.mine ? 'you reblogged it' : ''].filter(Boolean);
  return `- [${s.id}] ${who} ${what}: ${s.title}${s.url ? ` <${s.url}>` : ''} · to ${to} · ${s.createdAt.slice(0, 10)}${reblogs.map((r) => ` · ${r}`).join('')}${s.hiddenAt ? ' · hidden by an admin' : ''}`
    + `${original?.note ? `\n  @${original.author.handle}'s note: ${clean(original.note, 300)}` : ''}${s.note ? `\n  note: ${clean(s.note, 300)}` : ''}`;
}

/** "Reblogged by @a, @b and 3 more." */
function rebloggedBy(list: Reblogger[]): string {
  if (!list.length) return '';
  const names = list.slice(0, 5).map((r) => `@${r.handle}${r.detached ? ' (removed by you)' : ''}`);
  return `Reblogged by ${names.join(', ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}.`;
}

/** A refused request as a sentence (the rules' messages have no final stop). */
function fail(error: unknown): CallToolResult {
  if (!isAppError(error)) throw error;
  return toolError(`${error.message.replace(/\.$/, '')}.`, error.code, error.details);
}

const handleProp = { type: 'string', description: 'e.g. "@someone"' };

/**
 * What find_people looks for, from its arguments, else the user's room; and how the reasons
 * name the sources ("of your sources", "of the sources you named", "of @ana's sources").
 */
async function wantedFrom(args: Record<string, unknown>, ctx: ToolContext): Promise<{ wanted: Wanted; basis: string; except?: string }> {
  const wanted: Wanted = { sources: [], hosts: [], terms: typeof args.about === 'string' ? termsOf(args.about) : [] };
  const named = Array.isArray(args.sources) ? args.sources.map(String).slice(0, 10) : [];
  for (const raw of named) {
    const { source, host } = namedSignal(raw);
    if (source) wanted.sources.push(source);
    if (host) wanted.hosts.push(host);
  }
  if (named.length) return { wanted, basis: 'of the sources you named' };
  const like = typeof args.like === 'string' && args.like.trim() ? args.like : undefined;
  if (like && ctx.social) {
    const them = await ctx.social.resolve(ctx.userId, like);
    for (const f of them.sources ?? []) { const s = sourceSignal(f.source, f.config, f.title); if (s) wanted.sources.push(s); }
    for (const post of await ctx.social.sharesOf(ctx.userId, them.accountId, { limit: 20 })) { const h = post.url ? hostOf(post.url) : undefined; if (h && !wanted.hosts.includes(h)) wanted.hosts.push(h); }
    return { wanted, basis: `of @${them.handle}'s sources`, except: them.handle };
  }
  if (!wanted.terms.length) {
    for (const p of (await ctx.store.get(ctx.userId)).columns.flatMap((c) => c.panels)) {
      const s = sourceSignal(p.source, p.config, p.title ?? p.id);
      if (!s) continue;
      wanted.sources.push(s);
      if (s.site && !wanted.hosts.includes(s.site)) wanted.hosts.push(s.site);
    }
  }
  return { wanted, basis: 'of your sources' };
}

/** A match's reasons as short clauses. Source titles are the other person's words: they stay inside the fence. */
function reasonsOf(p: PersonMatch, basis: string): string[] {
  const list = (xs: string[]) => (xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more`);
  return [
    p.sources.length ? `features ${p.sources.length === 1 ? 'one' : p.sources.length} ${basis}: ${list(p.sources)}` : '',
    p.sites.length ? `features other feeds from ${list(p.sites)}` : '',
    p.hosts.length ? `shared ${list(p.hosts.map((h) => `${h.count} post${h.count === 1 ? '' : 's'} from ${h.host}`))}` : '',
    p.terms.space.length ? `their Space mentions ${list(p.terms.space)}` : '',
    p.terms.posts.length ? `their posts mention ${list(p.terms.posts)}` : '',
  ].filter(Boolean);
}

/**
 * Listed people who feature some of these sources: a passing hint for add_portal and
 * build_room ("@ana features 3 of these"). Handles only, never their titles; '' if none.
 */
export async function featuredBy(ctx: ToolContext, sources: Array<{ source: string; config: unknown; title?: string | undefined }>, what: string): Promise<string> {
  if (!ctx.social) return '';
  const signals = sources.map((s) => sourceSignal(s.source, s.config, s.title ?? s.source)).filter((s) => s !== undefined);
  if (!signals.length) return '';
  try {
    const people = (await ctx.social.findPeople(ctx.userId, { sources: signals, hosts: [], terms: [] }, { limit: 3 })).filter((p) => p.sources.length);
    if (!people.length) return '';
    const named = people.map((p) => (signals.length > 1 ? `@${p.handle} (${p.sources.length})` : `@${p.handle}`)).join(', ');
    return `On MCPortal, ${named} also feature${people.length === 1 ? 's' : ''} ${what}. If the user might like to follow people with their taste, offer to introduce them (find_people says why).`;
  } catch {
    return '';   // a hint, never a failure
  }
}

/** Who find_people last returned to each user, for an hour: suggest_people keeps only those. */
const FOUND_MS = 3600_000;
const found = new Map<string, { handles: Set<string>; at: number }>();
function rememberFound(userId: string, handles: string[]): void {
  const now = Date.now();
  for (const [k, v] of found) if (now - v.at > FOUND_MS) found.delete(k);
  if (found.size >= 5000) found.delete(found.keys().next().value!);
  const prior = found.get(userId);
  // Several searches in one conversation all count: the agent may pick across them.
  found.set(userId, { handles: new Set([...(prior && now - prior.at <= FOUND_MS ? prior.handles : []), ...handles]), at: now });
}
function foundFor(userId: string): Set<string> | undefined {
  const entry = found.get(userId);
  return entry && Date.now() - entry.at <= FOUND_MS ? entry.handles : undefined;
}

/**
 * The People portal's suggestions as they stand: someone who unlisted, blocked the user, was
 * suspended or deleted their profile drops out; following them is shown, not hidden.
 */
export async function suggestedPeople(profile: Profile, ctx: ToolContext): Promise<SuggestedPerson[]> {
  if (!ctx.social) return [];
  const social = ctx.social;
  const out = await Promise.all((profile.people?.picks ?? []).map(async (pick): Promise<SuggestedPerson | undefined> => {
    try {
      const them = await social.resolve(ctx.userId, pick.handle);
      if (!them.listed || them.handle !== pick.handle) return undefined;
      const stats = await social.stats(ctx.userId, them.accountId);
      return { ...pick, displayName: them.displayName, spaceTitle: them.spaceTitle, followers: stats.followers, following: stats.following };
    } catch {
      return undefined;
    }
  }));
  return out.filter((p) => p !== undefined);
}

/** A Space's address: /@handle on the server that holds the account (docs/plans/finding-people.md). */
export function spaceLink(ctx: ToolContext, handle: string): string | undefined {
  try { return ctx.accountUrl ? new URL(`/@${handle}`, ctx.accountUrl).href : undefined; } catch { return undefined; }
}

const GRID_POSTS = 60;
const GRID_IMAGES = 12;
const GRID_IMAGE_B64 = 270_000;   // ~200 KB of image

/** A post as the space grid shows it: long content cut, big images left for get_share. */
export function forGrid(posts: SharedItem[]): SharedItem[] {
  let images = 0;
  return posts.map((p) => {
    if (!p.clip) return p;
    const d = p.clip.data;
    let data: ClipData = d;
    if (d.kind === 'table') data = { ...d, rows: d.rows.slice(0, 8) };
    else if (d.kind === 'note') data = { ...d, blocks: d.blocks.slice(0, 6) };
    else if (d.kind === 'exchange') data = { ...d, turns: d.turns.slice(0, 4) };
    else if (d.kind === 'image') data = d.data.length <= GRID_IMAGE_B64 && images++ < GRID_IMAGES ? d : { ...d, data: '' };
    return { ...p, clip: { ...p.clip, data } };
  });
}

export const SOCIAL_TOOLS: ToolDef[] = [
  {
    name: 'open_space',
    title: 'Open a space',
    access: 'read',
    available: socialEntry,
    description: "Open someone's Space by handle, or the user's own without one, as a card: their profile, what they shared, and the sources they recommend.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { handle: handleProp } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      if (!ctx.social || !ctx.publicProfiles) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      try {
        const handle = typeof args.handle === 'string' && args.handle.trim() ? args.handle : undefined;
        const profile = handle ? await ctx.social.resolve(ctx.userId, handle) : await ctx.publicProfiles.get(ctx.userId);
        if (!profile) return toolError('You have no space yet: it starts with a public profile. Create one with set_public_profile (a handle, and optionally a space title and featured sources), then share things into it.', 'failed_precondition');
        const mine = profile.accountId === ctx.userId;
        const posts = await ctx.social.sharesOf(ctx.userId, profile.accountId, { limit: GRID_POSTS });
        const stats = await ctx.social.stats(ctx.userId, profile.accountId);
        const { accountId: _id, ...pub } = profile;
        const link = spaceLink(ctx, profile.handle);
        const space = { ...pub, mine, followers: stats.followers, following: stats.following, posts: forGrid(posts), sources: profile.sources ?? [], ...(link ? { link } : {}) };
        const title = profile.spaceTitle ?? `@${profile.handle}`;
        // What they feature that's in the user's room too: the user's own data, said only to them.
        const room = new Set(mine ? [] : (await ctx.store.get(ctx.userId)).columns.flatMap((c) => c.panels).map((p) => sourceSignal(p.source, p.config, p.title ?? p.id)?.key).filter((k) => k !== undefined));
        const shared = space.sources.filter((s) => room.has(sourceSignal(s.source, s.config, s.title)?.key ?? '')).map((s) => s.title);
        const text = [
          `Showing ${mine ? 'your space' : `@${profile.handle}'s space`} "${title}" in a card: ${posts.length} post(s)${mine ? '' : ' you can see'}, ${stats.followers} follower(s), ${space.sources.length} featured source(s).${!mine && !stats.following ? ' The user doesn\'t follow them yet.' : ''}`
            + (link ? ` Link to share it (it also brings friends in): ${link}` : ''),
          untrusted(mine ? 'your space' : `@${profile.handle}'s space`, [
            profile.bio ? `bio: ${profile.bio}` : '',
            shared.length ? `in the user's room too: ${shared.join(', ')}` : '',
            ...space.sources.map((s) => `source: ${s.title} (${s.source})`),
            ...posts.slice(0, 10).map(shareLine),
          ].filter(Boolean).join('\n')),
        ].join('\n');
        return ok(text, { space } satisfies ToolResults['open_space']);
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: 'share',
    title: 'Share with followers',
    access: 'write',
    available: socialActive,
    description: "Share one of the user's saved links (savedUrl) or clips (clipId), or reblog a post (reblogOf), with a note, to their followers or everyone on MCPortal. Only when they ask; ask first if they haven't read it; if you write the note, share only after they approve its exact words.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        savedUrl: { type: 'string', description: 'URL of a saved item' },
        clipId: { type: 'string' },
        note: { type: 'string', maxLength: 500 },
        audience: { type: 'string', enum: AUDIENCES },
        reblogOf: { type: 'string', description: 'post id' },
        reblogs: { type: 'string', enum: REBLOG_RULES },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      try {
        if (typeof args.reblogOf === 'string' && args.reblogOf) {
          const reblog = await ctx.social.reblog(ctx.userId, { id: args.reblogOf, note: args.note, audience: args.audience });
          const original = reblog.original && 'author' in reblog.original ? `@${reblog.original.author.handle}'s post` : 'the post';
          return ok(`Reblogged ${original} (id ${reblog.id}; undo with unshare).\n${untrusted('your reblog', shareLine(reblog))}`, { share: reblog } satisfies ToolResults['share']);
        }
        let input: Parameters<NonNullable<ToolContext['social']>['share']>[1];
        if (typeof args.clipId === 'string' && args.clipId) {
          const clip = await ctx.clips?.get(ctx.userId, args.clipId);
          if (!clip) return toolError(`No clip with id "${clean(args.clipId, 40)}". Use search_clips to find it.`, 'not_found');
          input = { kind: 'clip', title: clip.title, url: clip.source.url, clip, note: args.note, audience: args.audience, reblogs: args.reblogs };
        } else {
          const url = httpUrl(args.savedUrl);
          const saved = url ? (await ctx.store.get(ctx.userId)).saved.find((s) => s.url === url) : undefined;
          if (!saved) return toolError('Share a saved item (savedUrl, save it first with save_item) or a clip (clipId).');
          input = { kind: 'link', title: saved.title, url: saved.url, note: args.note, audience: args.audience, reblogs: args.reblogs };
        }
        const shared = await ctx.social.share(ctx.userId, input);
        return ok(`Shared (id ${shared.id}).\n${untrusted('your share', shareLine(shared))}`, { share: shared } satisfies ToolResults['share']);
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: 'unshare',
    title: 'Remove a share',
    access: 'write',
    available: socialActive,
    description: "Remove one of the user's shares or reblogs (undoing a reblog). Only when they ask.",
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      const removed = await ctx.social.unshare(ctx.userId, String(args.id ?? ''));
      return ok(removed ? 'Removed the share.' : 'No share of yours with that id; nothing changed.', { removed });
    },
  },
  {
    name: 'get_share',
    title: 'Show a share',
    access: 'read',
    available: socialActive,
    description: 'Show one share or reblog in full (notes, the link or clip, who reblogged it), as a card in the conversation. Ids come from the Following portal or list_shares.',
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      const share = await ctx.social.get(ctx.userId, String(args.id ?? ''));
      if (!share) return toolError('That share isn\'t available.', 'not_found');
      const original = share.original && 'author' in share.original ? share.original : undefined;
      const clip = original?.clip ?? share.clip;
      const body = clip ? `\n\n${clipText(clip.data)}` : '';
      // Who reblogged it: the original's reblogs, as this viewer may see them.
      const rebloggers = share.reblogCount || share.mine ? await ctx.social.reblogsOf(ctx.userId, share.id, { limit: 50 }).catch(() => []) : [];
      const by = rebloggedBy(rebloggers);
      return ok(`Showing share ${share.id} in a card.${by ? ` ${by}` : ''}\n${untrusted(share.mine ? 'your share' : `a share by @${share.author.handle}`, `${shareLine(share)}${body}`)}`,
        { share, ...(rebloggers.length ? { rebloggers } : {}), ...(labsOf(ctx).length ? { labs: [...labsOf(ctx)] } : {}) } satisfies ToolResults['get_share']);
    },
  },
  {
    name: 'share_settings',
    title: 'Change who can reblog a post',
    access: 'write',
    available: socialActive,
    description: "Change who may reblog one of the user's posts, or remove it from someone's reblog of it (detach: the reblog's id; permanent). Only when they ask.",
    inputSchema: {
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: { id: { type: 'string' }, reblogs: { type: 'string', enum: REBLOG_RULES }, detach: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      if (args.reblogs === undefined && args.detach === undefined) return toolError('Say who may reblog it (reblogs) or which reblog to remove it from (detach).');
      try {
        const share = await ctx.social.shareSettings(ctx.userId, String(args.id ?? ''), { reblogs: args.reblogs, detach: args.detach });
        const who = args.reblogs === 'nobody' ? 'Nobody' : args.reblogs === 'followers' ? 'Only your followers' : 'Anyone signed in';
        const done = [args.reblogs !== undefined ? `${who} can reblog it from now on; reblogs made before stay.` : '',
          args.detach !== undefined ? 'Removed your post from that reblog, for good: it now says its author removed it.' : ''].filter(Boolean).join(' ');
        return ok(`${done}\n${untrusted('your share', shareLine(share))}`, { share } satisfies ToolResults['share_settings']);
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: 'list_shares',
    title: 'List shares',
    access: 'read',
    available: socialActive,
    description: "The user's own shares (without handle), or what someone shared that the user may see.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { handle: handleProp, limit: { type: 'integer', minimum: 1, maximum: 50 }, before: { type: 'string', description: 'createdAt of the last share from the previous page' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.social || !ctx.publicProfiles) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      try {
        const query = { limit: Number(args.limit) || 20, before: typeof args.before === 'string' ? args.before : undefined };
        const owner = typeof args.handle === 'string' && args.handle.trim() ? (await ctx.social.resolve(ctx.userId, args.handle)).accountId : ctx.userId;
        const shares = await ctx.social.sharesOf(ctx.userId, owner, query);
        const who = owner === ctx.userId ? 'your' : `@${clean(args.handle, 40).replace(/^@/, '')}'s`;
        if (!shares.length) return ok(`No shares to show from ${who === 'your' ? 'you' : who.slice(0, -2)}.`, { shares });
        return ok(`${shares.length} of ${who} shares:\n${untrusted(`${who} shares`, shares.map(shareLine).join('\n'))}`, { shares });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: 'relationship',
    title: 'Follow, mute or block someone',
    access: 'write',
    available: socialEntry,
    description: "Follow, unfollow, mute or unmute a person by handle, or block or unblock them, only when the user asks. Following puts their shares in a Following portal; blocking removes follows both ways and hides each from the other.",
    inputSchema: {
      type: 'object',
      required: ['handle', 'action'],
      additionalProperties: false,
      properties: { handle: handleProp, action: { type: 'string', enum: ['follow', 'unfollow', 'mute', 'unmute', 'block', 'unblock'] } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      const handle = String(args.handle ?? '');
      try {
        switch (args.action) {
          case 'follow': {
            const target = await ctx.social.follow(ctx.userId, handle);
            const { profile, added } = await ctx.store.update(ctx.userId, (before) => {
              const placed = ensurePortal(before, 'following', 'Following');
              return placed.added ? { profile: placed.profile, result: placed } : { result: placed };
            });
            return ok(`Following @${target.handle}.${added ? ' Added a "Following" portal to the room.' : ''}`, { handle: target.handle, layoutChanged: added, profile } satisfies ToolResults['relationship']);
          }
          case 'unfollow':
            return ok((await ctx.social.unfollow(ctx.userId, handle)) ? `Unfollowed @${clean(handle, 40).replace(/^@/, '')}.` : 'You weren\'t following them.', {});
          case 'mute': case 'unmute': {
            const target = await ctx.social.mute(ctx.userId, handle, args.action === 'mute');
            return ok(args.action === 'mute' ? `Muted @${target.handle}: their shares won't show in your Following portal.` : `Unmuted @${target.handle}.`, { handle: target.handle });
          }
          case 'block': case 'unblock': {
            const target = await ctx.social.block(ctx.userId, handle, args.action === 'block');
            return ok(args.action === 'block' ? `Blocked @${target.handle}. You no longer follow each other, and neither of you sees the other's shares.` : `Unblocked @${target.handle}. Follows aren't restored.`, { handle: target.handle });
          }
          default:
            return toolError('action must be follow, unfollow, mute, unmute, block or unblock.');
        }
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: 'find_people',
    title: 'Find people to follow',
    access: 'read',
    cost: 2,
    available: socialEntry,
    description: "Find people on MCPortal who share the user's interests, by topics (about), sites (sources) or someone like them (like); with none, by their room. Pass topics, not the conversation. Introduce one or two with the reasons.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        about: { type: 'string', maxLength: 200 },
        sources: { type: 'array', maxItems: 10, items: { type: 'string' }, description: 'sites, feeds or owner/repo' },
        like: handleProp,
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      try {
        const { wanted, basis, except } = await wantedFrom(args, ctx);
        const people = await ctx.social.findPeople(ctx.userId, wanted, except ? { except } : {});
        // Someone the user said "Not for me" to comes last, and says so.
        const passed = new Set((await ctx.store.get(ctx.userId)).people?.passed.map((p) => p.handle) ?? []);
        const found = people.map((p) => ({ ...p, reasons: reasonsOf(p, basis), ...(passed.has(p.handle) ? { passed: true as const } : {}) }))
          .sort((a, b) => Number(Boolean(a.passed)) - Number(Boolean(b.passed)));
        for (const p of found) if (p.passed) p.reasons.push('the user passed on them before (Not for me)');
        rememberFound(ctx.userId, found.map((p) => p.handle));
        if (!found.length) {
          return ok(`Nobody listed on MCPortal matches yet. Only people who chose to be findable show up, and there aren't many so far. ${basis === 'of your sources' ? 'Try topics (about) or sites (sources).' : ''}`.trim(), { people: [] } satisfies ToolResults['find_people']);
        }
        const body = found.map((p) => [
          `@${p.handle}${p.displayName ? ` (${p.displayName})` : ''}${p.spaceTitle ? `, "${p.spaceTitle}"` : ''} · ${p.followers} follower(s)`,
          `  why: ${p.reasons.join('; ')}`,
          p.bio ? `  bio: ${p.bio}` : '',
          p.featured.length ? `  features: ${p.featured.join(', ')}` : '',
          ...p.posts.map((post) => `  - ${post.title}${post.url ? ` <${post.url}>` : ''}${post.note ? ` — ${clean(post.note, 200)}` : ''}`),
        ].filter(Boolean).join('\n')).join('\n');
        return ok(`${found.length} listed ${found.length === 1 ? 'person matches' : 'people match'}, best first. Introduce one or two in your own words from what's below, then offer to follow (relationship) or open their Space (open_space); to keep picks in the room, suggest_people. Say only what they made public.\n${untrusted('people on MCPortal', body)}`,
          { people: found } satisfies ToolResults['find_people']);
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: 'suggest_people',
    title: 'Suggest people to follow',
    access: 'write',
    available: socialEntry,
    description: "Keep picks from find_people in the user's People portal, best first, each with a one-line reason: what they share, never guesses about who they are; by handle.",
    inputSchema: {
      type: 'object',
      required: ['picks'],
      additionalProperties: false,
      properties: {
        picks: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', required: ['handle', 'why'], additionalProperties: false, properties: { handle: handleProp, why: { type: 'string', maxLength: PEOPLE.why } } } },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      const recent = foundFor(ctx.userId);
      if (!recent) return toolError('Call find_people first: suggest only people it just returned.', 'failed_precondition');
      const picks = (Array.isArray(args.picks) ? args.picks : []).map((p: { handle?: unknown; why?: unknown }) => ({ handle: String(p.handle ?? '').trim().replace(/^@/, '').toLowerCase(), why: clean(p.why, PEOPLE.why) }));
      const unknown = picks.filter((p) => !recent.has(p.handle)).map((p) => `@${clean(p.handle, 40)}`);
      if (unknown.length) return toolError(`Not kept: ${unknown.join(', ')} ${unknown.length === 1 ? "wasn't" : "weren't"} in find_people's last results. Suggest only people it returned.`, 'invalid_argument');
      if (picks.some((p) => !p.why)) return toolError('Each pick needs a reason (why).');
      const at = new Date().toISOString();
      const chosen = new Set(picks.map((p) => p.handle));
      const { profile, added } = await ctx.store.update(ctx.userId, (before) => {
        const old = before.people ?? { picks: [], passed: [] };
        const people = {
          picks: [...picks.map((p) => ({ ...p, at })), ...old.picks.filter((p) => !chosen.has(p.handle))].slice(0, PEOPLE.picks),
          passed: old.passed.filter((p) => !chosen.has(p.handle)),
        };
        const placed = ensurePortal({ ...before, people }, 'people', 'People');
        return { profile: placed.profile, result: placed };
      });
      const spec = profile.columns.flatMap((c) => c.panels).find((p) => p.source === 'people');
      const portal = peoplePortal(spec ?? { id: 'people', source: 'people', config: {} }, await suggestedPeople(profile, ctx));
      return ok(`Kept ${picks.length} suggestion(s) in the People portal${added ? ' (just added to the room)' : ''}, shown in a card. Each has Follow, their Space and Not for me.`,
        { suggested: { portal }, profile, layoutChanged: added } satisfies ToolResults['suggest_people']);
    },
  },
  {
    name: 'pass_person',
    title: 'Not for me',
    access: 'write',
    available: socialEntry,
    description: "The room's Not for me on a suggested person: they leave the People portal, and find_people says the user passed on them for 90 days.",
    inputSchema: { type: 'object', required: ['handle'], additionalProperties: false, properties: { handle: handleProp } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI, visibility: ['app'] } },
    async handler(args, ctx) {
      const handle = String(args.handle ?? '').trim().replace(/^@/, '').toLowerCase();
      if (!/^[a-z0-9_]{2,30}$/.test(handle)) return toolError('That isn\'t a handle.');
      const profile = await ctx.store.update(ctx.userId, (before) => {
        const old = before.people ?? { picks: [], passed: [] };
        const people = { picks: old.picks.filter((p) => p.handle !== handle), passed: [{ handle, at: new Date().toISOString() }, ...old.passed.filter((p) => p.handle !== handle)] };
        const next = { ...before, people };
        return { profile: next, result: next };
      });
      return ok(`Passed on @${handle}.`, { profile } satisfies ToolResults['pass_person']);
    },
  },
  {
    name: 'list_connections',
    title: 'Who you follow, mute and block',
    access: 'read',
    available: socialActive,
    description: 'The handles the user follows, mutes and blocks, and how many people follow them.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(_args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      const c = await ctx.social.connections(ctx.userId);
      const list = (xs: string[]) => (xs.length ? xs.map((h) => `@${h}`).join(', ') : 'nobody');
      return ok(`Following: ${list(c.following)}.\nMuted: ${list(c.muted)}.\nBlocked: ${list(c.blocked)}.\nFollowers: ${c.followers}.`, c);
    },
  },
  {
    name: 'report',
    title: 'Report a share or person',
    access: 'write',
    available: socialEntry,
    description: "Report a share (shareId) or a person (handle) to the admins with a short reason, only when the user asks. Suggest blocking too.",
    inputSchema: {
      type: 'object',
      required: ['reason'],
      additionalProperties: false,
      properties: { shareId: { type: 'string' }, handle: handleProp, reason: { type: 'string', maxLength: 500 } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      try {
        const report = await ctx.social.report(ctx.userId, {
          shareId: typeof args.shareId === 'string' && args.shareId ? args.shareId : undefined,
          handle: typeof args.handle === 'string' && args.handle ? args.handle : undefined,
        }, args.reason);
        return ok(`Reported. An admin will look at it (report ${report.id}).`, { reportId: report.id });
      } catch (error) {
        return fail(error);
      }
    },
  },
];
