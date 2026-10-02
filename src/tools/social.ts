/**
 * Sharing tools: share, unshare, get_share, list_shares, relationship,
 * list_connections, report. Everything other people wrote (notes, titles,
 * clips) reaches the model fenced as untrusted: another user's note is exactly
 * where someone would try to plant instructions.
 */
import { clean } from '../lib/text.ts';
import { httpUrl } from '../profile.ts';
import { clipText, type ClipData } from '../clips.ts';
import { AUDIENCES, type SharedItem } from '../social.ts';
import { isAppError } from '../lib/errors.ts';
import { ensurePortal } from '../layout.ts';
import { HOSTED_ONLY, socialActive, socialEntry, ok, toolError, untrusted, ROOM_URI, type CallToolResult, type ToolContext, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

export function shareLine(s: SharedItem): string {
  const who = s.mine ? 'you' : `@${s.author.handle}`;
  const to = s.audience === 'mcportal' ? 'everyone on MCPortal' : 'followers';
  return `- [${s.id}] ${who} shared ${s.kind === 'clip' ? `a ${s.clip?.kind ?? 'clip'}` : 'a link'}: ${s.title}${s.url ? ` <${s.url}>` : ''} · to ${to} · ${s.createdAt.slice(0, 10)}${s.hiddenAt ? ' · hidden by an admin' : ''}${s.note ? `\n  note: ${clean(s.note, 300)}` : ''}`;
}

/** A refused request as a sentence (the rules' messages have no final stop). */
function fail(error: unknown): CallToolResult {
  if (!isAppError(error)) throw error;
  return toolError(`${error.message.replace(/\.$/, '')}.`, error.code, error.details);
}

const handleProp = { type: 'string', description: 'e.g. "@someone"' };

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
        const space = { ...pub, mine, followers: stats.followers, following: stats.following, posts: forGrid(posts), sources: profile.sources ?? [] };
        const title = profile.spaceTitle ?? `@${profile.handle}`;
        const text = [
          `Showing ${mine ? 'your space' : `@${profile.handle}'s space`} "${title}" in a card: ${posts.length} post(s)${mine ? '' : ' you can see'}, ${stats.followers} follower(s), ${space.sources.length} featured source(s).${!mine && !stats.following ? ' The user doesn\'t follow them yet.' : ''}`,
          untrusted(mine ? 'your space' : `@${profile.handle}'s space`, [
            profile.bio ? `bio: ${profile.bio}` : '',
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
    description: "Share one of the user's saved links (savedUrl) or clips (clipId) with a note, to their followers or everyone on MCPortal. Only when they ask; if you write the note, share only after they approve its exact words.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        savedUrl: { type: 'string', description: 'URL of a saved item' },
        clipId: { type: 'string' },
        note: { type: 'string', maxLength: 500 },
        audience: { type: 'string', enum: AUDIENCES },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      try {
        let input: Parameters<NonNullable<ToolContext['social']>['share']>[1];
        if (typeof args.clipId === 'string' && args.clipId) {
          const clip = await ctx.clips?.get(ctx.userId, args.clipId);
          if (!clip) return toolError(`No clip with id "${clean(args.clipId, 40)}". Use search_clips to find it.`, 'not_found');
          input = { kind: 'clip', title: clip.title, url: clip.source.url, clip, note: args.note, audience: args.audience };
        } else {
          const url = httpUrl(args.savedUrl);
          const saved = url ? (await ctx.store.get(ctx.userId)).saved.find((s) => s.url === url) : undefined;
          if (!saved) return toolError('Share a saved item (savedUrl, save it first with save_item) or a clip (clipId).');
          input = { kind: 'link', title: saved.title, url: saved.url, note: args.note, audience: args.audience };
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
    description: "Remove one of the user's shares. Only when they ask.",
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
    description: 'Show one share in full (the note and the shared link or clip), as a card in the conversation. Ids come from the Following portal or list_shares.',
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY.sharing, 'unavailable');
      const share = await ctx.social.get(ctx.userId, String(args.id ?? ''));
      if (!share) return toolError('That share isn\'t available.', 'not_found');
      const body = share.clip ? `\n\n${clipText(share.clip.data)}` : '';
      return ok(`Showing share ${share.id} in a card.\n${untrusted(share.mine ? 'your share' : `a share by @${share.author.handle}`, `${shareLine(share)}${body}`)}`, { share } satisfies ToolResults['get_share']);
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
