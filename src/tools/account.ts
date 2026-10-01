/**
 * Tools for the user's identity and data: their public profile (handle, display
 * name, bio), exports and imports, and a link to the account page.
 *
 * Deleting the account is deliberately not a tool: it happens on the account page
 * after a fresh GitHub sign-in, so no text a model reads can trigger it.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { clean } from '../lib/text.ts';
import { describeImport, EXPORT_FORMATS, importExport, parseExport, type ExportFormat } from '../portability.ts';
import { ACCENTS, MAX_FEATURED, suggestHandle, type PublicProfile } from '../public-profiles.ts';
import { HOSTED_ONLY, socialActive, socialEntry, ok, toolError, toolFailure, untrusted, type ToolDef } from './kit.ts';

function describeProfile(p: PublicProfile): string {
  return [
    `@${p.handle}`,
    p.displayName ? `name: ${p.displayName}` : '',
    p.bio ? `bio: ${p.bio}` : '',
    p.spaceTitle ? `space: ${p.spaceTitle}` : '',
    p.sources?.length ? `featured sources: ${p.sources.map((s) => s.title).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/** Hosts load the tool list when a conversation starts, so tools an action unlocks arrive in the next one. */
const UNLOCKS = 'Sharing (share, list_shares and the rest) is available from the next conversation.';

export const ACCOUNT_TOOLS: ToolDef[] = [
  {
    name: 'get_public_profile',
    title: 'Get a public profile',
    access: 'read',
    available: socialActive,
    description: "The user's own public profile and a suggested handle (without handle), or another user's (with handle).",
    inputSchema: { type: 'object', additionalProperties: false, properties: { handle: { type: 'string', description: 'e.g. "@someone"' } } },
    annotations: { readOnlyHint: true },
    async handler(args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY.profiles, 'unavailable');
      if (typeof args.handle === 'string' && args.handle.trim()) {
        const found = await ctx.publicProfiles.byHandle(args.handle);
        if (!found) return toolError(`No MCPortal profile for @${clean(args.handle, 40).replace(/^@/, '')}.`, 'not_found');
        const { accountId: _id, ...profile } = found.profile;
        const moved = found.movedFrom ? `@${found.movedFrom} is now @${profile.handle}.\n` : '';
        const stats = ctx.social && found.profile.accountId !== ctx.userId ? await ctx.social.stats(ctx.userId, found.profile.accountId) : undefined;
        const counts = stats ? `\n${stats.followers} follower(s), ${stats.shares} share(s) you can see.${stats.following ? ' You follow them.' : ''}` : '';
        return ok(`${moved}${untrusted(`@${profile.handle}`, describeProfile(found.profile))}${counts}`, { profile, ...(stats ? { stats } : {}), ...(found.movedFrom ? { movedFrom: found.movedFrom } : {}) });
      }
      const mine = await ctx.publicProfiles.get(ctx.userId);
      if (mine) return ok(`Your public profile (visible to signed-in MCPortal users):\n${describeProfile(mine)}`, { profile: mine });
      const suggested = suggestHandle(ctx.actor?.login);
      return ok(`You have no public profile; everything in your room is private. ${suggested ? `If you want one, @${suggested} is the suggested handle (from your GitHub login).` : 'Pick a handle to create one.'}`, { profile: null, suggested: suggested ?? null });
    },
  },
  {
    name: 'set_public_profile',
    title: 'Set your public profile and space',
    access: 'write',
    available: socialEntry,
    description: "Create or change the user's public profile and Space, only when they ask: handle, name, bio, Space title, accent colour and featured portals ('Sources I read'). It's how other MCPortal users find them; nothing else in their room becomes public. An old handle keeps pointing to them for 30 days.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        handle: { type: 'string', description: '2-30 letters, digits or underscores; needed the first time' },
        displayName: { type: 'string', maxLength: 50 },
        bio: { type: 'string', maxLength: 160 },
        spaceTitle: { type: 'string', maxLength: 60 },
        accent: { type: 'string', enum: [...ACCENTS, ''] },
        featuredPortalIds: { type: 'array', maxItems: MAX_FEATURED, items: { type: 'string' }, description: 'Ids (from open_room) of feed, Hacker News or GitHub portals to recommend; [] clears' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY.profiles, 'unavailable');
      try {
        let sources: Array<{ title?: string; source: string; config: unknown }> | undefined;
        if (Array.isArray(args.featuredPortalIds)) {
          const portals = (await ctx.store.get(ctx.userId)).columns.flatMap((c) => c.panels);
          const ids = args.featuredPortalIds.map(String);
          const unknown = ids.filter((id) => !portals.some((p) => p.id === id));
          if (unknown.length) return toolError(`Not saved: no portal with id ${unknown.map((u) => clean(u, 40)).join(', ')} (see open_room).`, 'not_found');
          sources = ids.map((id) => portals.find((p) => p.id === id)!).map((p) => ({ title: p.title ?? p.id, source: p.source, config: p.config }));
        }
        const { profile, created, released } = await ctx.publicProfiles.set(ctx.userId, {
          handle: typeof args.handle === 'string' ? args.handle : undefined,
          displayName: typeof args.displayName === 'string' ? args.displayName : undefined,
          bio: typeof args.bio === 'string' ? args.bio : undefined,
          spaceTitle: typeof args.spaceTitle === 'string' ? args.spaceTitle : undefined,
          accent: typeof args.accent === 'string' ? args.accent : undefined,
          sources,
        });
        const skipped = sources ? sources.length - (profile.sources?.length ?? 0) : 0;
        const head = created ? `Created your public profile as @${profile.handle}. ${UNLOCKS}` : released ? `Changed your handle from @${released} to @${profile.handle}. @${released} points to you for 30 days.` : 'Updated your public profile.';
        return ok(`${head}\n${describeProfile(profile)}${skipped > 0 ? `\n${skipped} portal(s) weren't featured: only feeds, Hacker News and GitHub can be.` : ''}`, { profile });
      } catch (error) {
        return toolFailure(error, 'Not saved: ', '.');
      }
    },
  },
  {
    name: 'remove_public_profile',
    title: 'Remove your public profile',
    access: 'write',
    available: socialActive,
    description: "Make the user private again: removes their handle, name and bio. Only when they ask. Their handle stays reserved for them for 30 days.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async handler(_args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY.profiles, 'unavailable');
      const removed = await ctx.publicProfiles.remove(ctx.userId);
      return ok(removed ? `Removed your public profile. @${removed.handle} is held for you for 30 days.` : 'You had no public profile; nothing changed.', { removed: Boolean(removed) });
    },
  },
  {
    name: 'export_data',
    title: 'Export your data',
    access: 'read',
    cost: 5,
    description: "Give the user a copy of their data: everything (mcportal), saved items as bookmarks, clips as Markdown, or sources as OPML. Hosted: a one-time download link (15 minutes); local: a file path. Show it to them as is.",
    inputSchema: { type: 'object', required: ['format'], additionalProperties: false, properties: { format: { type: 'string', enum: EXPORT_FORMATS } } },
    annotations: { readOnlyHint: true },
    async handler(args, ctx) {
      const format = args.format as ExportFormat;
      if (!EXPORT_FORMATS.includes(format)) return toolError(`format must be one of ${EXPORT_FORMATS.join(', ')}`);
      if (!ctx.deliver) return toolError('Exports are not available on this server.', 'unavailable');
      const got = await ctx.deliver(format);
      const text = got.kind === 'link'
        ? `Your export (${got.summary}) is ready. Download link (works once, for 15 minutes): ${got.where}`
        : `Your export (${got.summary}) is saved at: ${got.where}`;
      return ok(text, { format, ...got });
    },
  },
  {
    name: 'import_portal',
    title: 'Import an MCPortal export',
    access: 'write',
    cost: 20,
    description: "Add an MCPortal export to the user's room: portals they don't have, saved items and clips; nothing is removed or moved. Hosted: call with no arguments for a one-time upload link and show it as is. Local: pass path. Pass data only for a small export already in the chat. Feed-reader subscriptions go through import_opml.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        data: { type: 'string', description: 'The export file\'s JSON text (small exports only)' },
        path: { type: 'string', description: 'Local MCPortal only: path to the .json export file' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      let text: string;
      if (typeof args.data === 'string' && args.data.trim()) text = args.data;
      else if (typeof args.path === 'string' && args.path.trim()) {
        if (!ctx.localFiles) return toolError('path only works with a local MCPortal. Call import_portal with no arguments for an upload link.');
        const file = args.path.trim().replace(/^~(?=\/|$)/, homedir());
        if (!/\.json$/i.test(file)) return toolError('path must be a .json MCPortal export file.');
        const info = await stat(file).catch(() => undefined);
        if (!info?.isFile()) return toolError(`No file at ${clean(file, 200)}.`, 'not_found');
        if (info.size > 60 * 1024 * 1024) return toolError('That file is over 60 MB; it isn\'t an MCPortal export.');
        text = await readFile(file, 'utf8');
      } else if (ctx.uploadLink) {
        const link = ctx.uploadLink();
        return ok(`Upload link (works once, for 15 minutes): ${link}\nThe user picks their MCPortal export file there; the page says what was imported. Then call open_room to show it.`, { uploadUrl: link });
      } else return toolError('Pass path (the export file on this machine) or data (its text).');
      try {
        const result = await importExport(parseExport(text), ctx.userId, ctx);
        return ok(`${describeImport(result)}\nCall open_room to show it.`, { result, profile: await ctx.store.get(ctx.userId) });
      } catch (error) {
        return toolFailure(error, 'Not imported: ');
      }
    },
  },
  {
    name: 'account_settings',
    title: 'Account page',
    access: 'read',
    description: "Link to the user's account page, where they sign in with GitHub to download everything or delete their account. Deleting an account only happens there, never through a tool.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true },
    async handler(_args, ctx) {
      if (!ctx.accountUrl) return ok('This MCPortal runs on your machine: there is no account. Your data is in the MCPortal data folder (~/.mcportal unless MCPORTAL_DATA_DIR is set); delete that folder to remove everything.', { url: null });
      return ok(`The account page is ${ctx.accountUrl}. The user signs in with GitHub there to download everything or delete their account.`, { url: ctx.accountUrl });
    },
  },
];
