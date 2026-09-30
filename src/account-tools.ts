/**
 * Tools for the user's identity and data: their public profile (handle, display
 * name, bio), exports and imports, and a link to the account page.
 *
 * Deleting the account is deliberately not a tool: it happens on the account page
 * after a fresh GitHub sign-in, so no text a model reads can trigger it.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { clean } from './lib/text.ts';
import { describeImport, EXPORT_FORMATS, importExport, parseExport, type ExportFormat } from './portability.ts';
import { ACCENTS, HandleError, MAX_FEATURED, suggestHandle, type PublicProfile } from './public-profiles.ts';
import { ProfileError } from './profile.ts';
import { toolError, untrusted, type CallToolResult, type ToolDef } from './tools.ts';

function ok(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

const HOSTED_ONLY = 'Public profiles are part of the hosted MCPortal. This one runs on your machine, so it has no handle to claim.';

function describeProfile(p: PublicProfile): string {
  return [
    `@${p.handle}`,
    p.displayName ? `name: ${p.displayName}` : '',
    p.bio ? `bio: ${p.bio}` : '',
    p.spaceTitle ? `space: ${p.spaceTitle}` : '',
    p.sources?.length ? `featured sources: ${p.sources.map((s) => s.title).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

const FORMAT_DOCS: Record<ExportFormat, string> = {
  mcportal: 'everything (layout, sources, saved items, clips, public profile) as one JSON file another MCPortal can import',
  bookmarks: 'saved items as a bookmarks file for browsers and bookmark managers',
  clips: 'clips as Markdown files (with images) in a .tar.gz, for Obsidian, Notion or a folder',
  opml: 'sources as OPML for any feed reader',
};

export const ACCOUNT_TOOLS: ToolDef[] = [
  {
    name: 'get_public_profile',
    title: 'Get a public profile',
    description: [
      "Without handle: the user's own public profile, if they have one (they don't until they claim a handle), and a suggested handle.",
      'With handle: another MCPortal user\'s public profile (handle, name, bio).',
    ].join(' '),
    inputSchema: { type: 'object', additionalProperties: false, properties: { handle: { type: 'string', description: 'e.g. "@someone"' } } },
    annotations: { readOnlyHint: true },
    async handler(args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY);
      if (typeof args.handle === 'string' && args.handle.trim()) {
        const found = await ctx.publicProfiles.byHandle(args.handle);
        if (!found) return toolError(`No MCPortal profile for @${clean(args.handle, 40).replace(/^@/, '')}.`);
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
    description: [
      "Create or change the user's public profile and space: a handle (2-30 letters, digits or underscores), a display name, a short bio,",
      `the Space's title (e.g. "late-night reading"), an accent colour (${ACCENTS.join(', ')}), and featuredPanelIds: up to ${MAX_FEATURED} portals from their room (panel ids from get_profile) to recommend as "Sources I read" (feeds, Hacker News, GitHub; [] clears).`,
      'Only when the user asks. It is how other MCPortal users find them; nothing else in their room becomes public.',
      'A changed handle keeps pointing to them for 30 days and nobody else can take it meanwhile.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        handle: { type: 'string', description: 'Required the first time' },
        displayName: { type: 'string', maxLength: 50 },
        bio: { type: 'string', maxLength: 160 },
        spaceTitle: { type: 'string', maxLength: 60 },
        accent: { type: 'string', enum: [...ACCENTS, ''] },
        featuredPanelIds: { type: 'array', maxItems: MAX_FEATURED, items: { type: 'string' } },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY);
      try {
        let sources: Array<{ title?: string; source: string; config: unknown }> | undefined;
        if (Array.isArray(args.featuredPanelIds)) {
          const panels = (await ctx.store.get(ctx.userId)).columns.flatMap((c) => c.panels);
          const ids = args.featuredPanelIds.map(String);
          const unknown = ids.filter((id) => !panels.some((p) => p.id === id));
          if (unknown.length) return toolError(`Not saved: no portal with id ${unknown.map((u) => clean(u, 40)).join(', ')} (see get_profile).`);
          sources = ids.map((id) => panels.find((p) => p.id === id)!).map((p) => ({ title: p.title ?? p.id, source: p.source, config: p.config }));
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
        const head = created ? `Created your public profile as @${profile.handle}.` : released ? `Changed your handle from @${released} to @${profile.handle}. @${released} points to you for 30 days.` : 'Updated your public profile.';
        return ok(`${head}\n${describeProfile(profile)}${skipped > 0 ? `\n${skipped} portal(s) weren't featured: only feeds, Hacker News and GitHub can be.` : ''}`, { profile });
      } catch (error) {
        if (error instanceof HandleError) return toolError(`Not saved: ${error.message}.`);
        throw error;
      }
    },
  },
  {
    name: 'remove_public_profile',
    title: 'Remove your public profile',
    description: "Make the user private again: removes their handle, name and bio. Only when they ask. Their handle stays reserved for them for 30 days.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async handler(_args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY);
      const removed = await ctx.publicProfiles.remove(ctx.userId);
      return ok(removed ? `Removed your public profile. @${removed.handle} is held for you for 30 days.` : 'You had no public profile; nothing changed.', { removed: Boolean(removed) });
    },
  },
  {
    name: 'export_data',
    title: 'Export your data',
    description: [
      "Give the user a copy of their MCPortal data. Formats: ",
      EXPORT_FORMATS.map((f) => `${f}: ${FORMAT_DOCS[f]}`).join('; '),
      '. On the hosted MCPortal this returns a download link that works once, for 15 minutes; locally it writes a file and returns its path. Show the link or path to the user as is.',
    ].join(''),
    inputSchema: { type: 'object', required: ['format'], additionalProperties: false, properties: { format: { type: 'string', enum: EXPORT_FORMATS } } },
    annotations: { readOnlyHint: true },
    async handler(args, ctx) {
      const format = args.format as ExportFormat;
      if (!EXPORT_FORMATS.includes(format)) return toolError(`format must be one of ${EXPORT_FORMATS.join(', ')}`);
      if (!ctx.deliver) return toolError('Exports are not available on this server.');
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
    description: [
      'Add an MCPortal export file (format "mcportal-export") to the user\'s room: portals they don\'t have, saved items and clips. Only adds; nothing is removed or moved. A brand-new room takes the exported layout as is.',
      'Usually call it with no arguments: on the hosted MCPortal that returns a one-time upload link for the user to pick the file, so it never has to pass through the conversation. Show them the link as is.',
      'On a local MCPortal, pass path (a .json file on this machine). Pass data (the file\'s text) only for a small export that is already in the conversation.',
      'For subscriptions from another feed reader, use import_opml instead.',
    ].join(' '),
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
        if (!info?.isFile()) return toolError(`No file at ${clean(file, 200)}.`);
        if (info.size > 60 * 1024 * 1024) return toolError('That file is over 60 MB; it isn\'t an MCPortal export.');
        text = await readFile(file, 'utf8');
      } else if (ctx.uploadLink) {
        const link = ctx.uploadLink();
        return ok(`Upload link (works once, for 15 minutes): ${link}\nThe user picks their MCPortal export file there; the page says what was imported. Then call open_workspace to show it.`, { uploadUrl: link });
      } else return toolError('Pass path (the export file on this machine) or data (its text).');
      try {
        const result = await importExport(parseExport(text), ctx.userId, ctx);
        return ok(`${describeImport(result)}\nCall open_workspace to show it.`, { result, profile: await ctx.store.get(ctx.userId) });
      } catch (error) {
        if (error instanceof ProfileError) return toolError(`Not imported: ${error.message}`);
        throw error;
      }
    },
  },
  {
    name: 'account_settings',
    title: 'Account page',
    description: "Link to the user's MCPortal account page, where they sign in with GitHub to download everything or delete their account. Use it when they ask to delete their account: deletion only happens there, never through a tool.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true },
    async handler(_args, ctx) {
      if (!ctx.accountUrl) return ok('This MCPortal runs on your machine: there is no account. Your data is in the MCPortal data folder (~/.mcportal unless MCPORTAL_DATA_DIR is set); delete that folder to remove everything.', { url: null });
      return ok(`The account page is ${ctx.accountUrl}. The user signs in with GitHub there to download everything or delete their account.`, { url: ctx.accountUrl });
    },
  },
];
