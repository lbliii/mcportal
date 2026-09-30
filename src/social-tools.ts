/**
 * Sharing tools: share, unshare, get_share, list_shares, relationship,
 * list_connections, report. Everything other people wrote (notes, titles,
 * clips) reaches the model fenced as untrusted: another user's note is exactly
 * where someone would try to plant instructions.
 */
import { clipText } from './clip-tools.ts';
import { clean } from './lib/text.ts';
import { httpUrl } from './profile.ts';
import { AUDIENCES, SocialError, type SharedItem } from './social.ts';
import { ensurePanel, toolError, untrusted, WORKSPACE_URI, type CallToolResult, type ToolContext, type ToolDef } from './tools.ts';

function ok(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

const HOSTED_ONLY = 'Sharing is part of the hosted MCPortal. This one runs on your machine, so there is nobody to share with.';

export function shareLine(s: SharedItem): string {
  const who = s.mine ? 'you' : `@${s.author.handle}`;
  const to = s.audience === 'mcportal' ? 'everyone on MCPortal' : 'followers';
  return `- [${s.id}] ${who} shared ${s.kind === 'clip' ? `a ${s.clip?.kind ?? 'clip'}` : 'a link'}: ${s.title}${s.url ? ` <${s.url}>` : ''} · to ${to} · ${s.createdAt.slice(0, 10)}${s.hiddenAt ? ' · hidden by an admin' : ''}${s.note ? `\n  note: ${clean(s.note, 300)}` : ''}`;
}

function fail(error: unknown): CallToolResult {
  if (error instanceof SocialError) return toolError(`${error.message}.`);
  throw error;
}

const handleProp = { type: 'string', description: 'e.g. "@someone"' };

export const SOCIAL_TOOLS: ToolDef[] = [
  {
    name: 'share',
    title: 'Share with followers',
    description: [
      'Share one of the user\'s saved links (savedUrl) or clips (clipId) with a note, to their followers (default) or everyone on MCPortal (audience "mcportal").',
      'Only when the user asks to share. If you write the note, show it to them and share only after they approve those exact words.',
      'Needs a public profile (set_public_profile). The content is copied as it is now.',
    ].join(' '),
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
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY);
      try {
        let input: Parameters<NonNullable<ToolContext['social']>['share']>[1];
        if (typeof args.clipId === 'string' && args.clipId) {
          const clip = await ctx.clips?.get(ctx.userId, args.clipId);
          if (!clip) return toolError(`No clip with id "${clean(args.clipId, 40)}". Use search_clips to find it.`);
          input = { kind: 'clip', title: clip.title, url: clip.source.url, clip, note: args.note, audience: args.audience };
        } else {
          const url = httpUrl(args.savedUrl);
          const saved = url ? (await ctx.store.get(ctx.userId)).saved.find((s) => s.url === url) : undefined;
          if (!saved) return toolError('Share a saved item (savedUrl, save it first with save_item) or a clip (clipId).');
          input = { kind: 'link', title: saved.title, url: saved.url, note: args.note, audience: args.audience };
        }
        const shared = await ctx.social.share(ctx.userId, input);
        return ok(`Shared (id ${shared.id}).\n${untrusted('your share', shareLine(shared))}`, { share: shared });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: 'unshare',
    title: 'Remove a share',
    description: "Remove one of the user's shares. Only when they ask.",
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY);
      const removed = await ctx.social.unshare(ctx.userId, String(args.id ?? ''));
      return ok(removed ? 'Removed the share.' : 'No share of yours with that id; nothing changed.', { removed });
    },
  },
  {
    name: 'get_share',
    title: 'Show a share',
    description: 'Show one share in full (the note and the shared link or clip), as a card in the conversation. Ids come from the Following panel or list_shares.',
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: WORKSPACE_URI } },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY);
      const share = await ctx.social.get(ctx.userId, String(args.id ?? ''));
      if (!share) return toolError('That share isn\'t available.');
      const body = share.clip ? `\n\n${clipText(share.clip.data)}` : '';
      return ok(`Showing share ${share.id} in a card.\n${untrusted(share.mine ? 'your share' : `a share by @${share.author.handle}`, `${shareLine(share)}${body}`)}`, { share });
    },
  },
  {
    name: 'list_shares',
    title: 'List shares',
    description: 'Without handle: the user\'s own shares. With handle: what that person shared that the user may see. Newest first.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { handle: handleProp, limit: { type: 'integer', minimum: 1, maximum: 50 }, before: { type: 'string', description: 'createdAt of the last share from the previous page' } },
    },
    annotations: { readOnlyHint: true },
    async handler(args, ctx) {
      if (!ctx.social || !ctx.publicProfiles) return toolError(HOSTED_ONLY);
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
    description: [
      'follow / unfollow a person by handle (their shares then appear in the user\'s Following panel; the first follow adds that panel);',
      'mute / unmute (hide their shares from the user\'s Following panel);',
      'block / unblock (they can\'t follow the user or see their shares, and the user doesn\'t see theirs; blocking removes follows both ways).',
      'Only when the user asks.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['handle', 'action'],
      additionalProperties: false,
      properties: { handle: handleProp, action: { type: 'string', enum: ['follow', 'unfollow', 'mute', 'unmute', 'block', 'unblock'] } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY);
      const handle = String(args.handle ?? '');
      try {
        switch (args.action) {
          case 'follow': {
            const target = await ctx.social.follow(ctx.userId, handle);
            const { profile, added } = ensurePanel(await ctx.store.get(ctx.userId), 'following', 'Following');
            if (added) await ctx.store.put(ctx.userId, profile);
            return ok(`Following @${target.handle}.${added ? ' Added a "Following" panel to the layout.' : ''}`, { handle: target.handle, layoutChanged: added, profile });
          }
          case 'unfollow':
            return ok((await ctx.social.unfollow(ctx.userId, handle)) ? `Unfollowed @${clean(handle, 40).replace(/^@/, '')}.` : 'You weren\'t following them.', {});
          case 'mute': case 'unmute': {
            const target = await ctx.social.mute(ctx.userId, handle, args.action === 'mute');
            return ok(args.action === 'mute' ? `Muted @${target.handle}: their shares won't show in your Following panel.` : `Unmuted @${target.handle}.`, { handle: target.handle });
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
    description: 'The handles the user follows, mutes and blocks, and how many people follow them.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true },
    async handler(_args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY);
      const c = await ctx.social.connections(ctx.userId);
      const list = (xs: string[]) => (xs.length ? xs.map((h) => `@${h}`).join(', ') : 'nobody');
      return ok(`Following: ${list(c.following)}.\nMuted: ${list(c.muted)}.\nBlocked: ${list(c.blocked)}.\nFollowers: ${c.followers}.`, c);
    },
  },
  {
    name: 'report',
    title: 'Report a share or person',
    description: 'Report a share (shareId) or a person (handle) to the MCPortal admins, with a short reason. Only when the user asks. Suggest blocking too if they don\'t want to see them.',
    inputSchema: {
      type: 'object',
      required: ['reason'],
      additionalProperties: false,
      properties: { shareId: { type: 'string' }, handle: handleProp, reason: { type: 'string', maxLength: 500 } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      if (!ctx.social) return toolError(HOSTED_ONLY);
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
