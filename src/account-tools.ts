/**
 * Tools for the user's identity and data: their public profile (handle, display
 * name, bio), exports and imports, and a link to the account page.
 *
 * Deleting the account is deliberately not a tool: it happens on the account page
 * after a fresh GitHub sign-in, so no text a model reads can trigger it.
 */
import { clean } from './lib/text.ts';
import { describeImport, EXPORT_FORMATS, importExport, parseExport, type ExportFormat } from './portability.ts';
import { HandleError, suggestHandle, type PublicProfile } from './public-profiles.ts';
import { ProfileError } from './profile.ts';
import { toolError, untrusted, type CallToolResult, type ToolDef } from './tools.ts';

function ok(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

const HOSTED_ONLY = 'Public profiles are part of the hosted MCPortal. This one runs on your machine, so it has no handle to claim.';

function describeProfile(p: PublicProfile): string {
  return [`@${p.handle}`, p.displayName ? `name: ${p.displayName}` : '', p.bio ? `bio: ${p.bio}` : ''].filter(Boolean).join('\n');
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
        return ok(`${moved}${untrusted(`@${profile.handle}`, describeProfile(found.profile))}`, { profile, ...(found.movedFrom ? { movedFrom: found.movedFrom } : {}) });
      }
      const mine = await ctx.publicProfiles.get(ctx.userId);
      if (mine) return ok(`Your public profile (visible to signed-in MCPortal users):\n${describeProfile(mine)}`, { profile: mine });
      const suggested = suggestHandle(ctx.actor?.login);
      return ok(`You have no public profile; everything in your portal is private. ${suggested ? `If you want one, @${suggested} is the suggested handle (from your GitHub login).` : 'Pick a handle to create one.'}`, { profile: null, suggested: suggested ?? null });
    },
  },
  {
    name: 'set_public_profile',
    title: 'Set your public profile',
    description: [
      "Create or change the user's public profile: a handle (2-30 letters, digits or underscores), a display name and a short bio.",
      'Only when the user asks for a profile or handle; it is how other MCPortal users will find them. Nothing in their portal becomes public by this.',
      'A changed handle keeps pointing to them for 30 days and nobody else can take it meanwhile.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        handle: { type: 'string', description: 'Required the first time' },
        displayName: { type: 'string', maxLength: 50 },
        bio: { type: 'string', maxLength: 160 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY);
      try {
        const { profile, created, released } = await ctx.publicProfiles.set(ctx.userId, {
          handle: typeof args.handle === 'string' ? args.handle : undefined,
          displayName: typeof args.displayName === 'string' ? args.displayName : undefined,
          bio: typeof args.bio === 'string' ? args.bio : undefined,
        });
        const head = created ? `Created your public profile as @${profile.handle}.` : released ? `Changed your handle from @${released} to @${profile.handle}. @${released} points to you for 30 days.` : 'Updated your public profile.';
        return ok(`${head}\n${describeProfile(profile)}`, { profile });
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
      'Add the contents of an MCPortal export file (format "mcportal-export") to the user\'s portal: panels they don\'t have, saved items and clips. Only adds; nothing is removed or moved. A brand-new portal takes the exported layout as is.',
      'Pass the file\'s text as data. For subscriptions from another feed reader, use import_opml instead.',
    ].join(' '),
    inputSchema: { type: 'object', required: ['data'], additionalProperties: false, properties: { data: { type: 'string', description: 'The export file\'s JSON text' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      try {
        const result = await importExport(parseExport(String(args.data ?? '')), ctx.userId, ctx);
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
