/**
 * Tools for the user's identity and data: their public profile (handle, display
 * name, bio), exports and imports, and a link to the account page.
 *
 * Deleting the account is deliberately not a tool: it happens on the account page
 * after a fresh GitHub sign-in, so no text a model reads can trigger it.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { SPACE_INPUT } from '../space-input.ts';
import type { PublicProfileInput } from '../public-profiles.ts';
import { clean } from '../lib/text.ts';
import { describeImport, EXPORT_MAX_BYTES, EXPORT_FORMATS, importExport, parseExport, type ExportFormat } from '../portability.ts';
import { SPACE_SETTINGS_SCHEMA, publicSpaceProfile, MAX_FEATURED, suggestHandle, type PublicProfile } from '../public-profiles.ts';
import type { ToolResults } from './results.ts';
import { describeIdentity, HOSTED_ONLY, identityOf, socialActive, socialEntry, ok, toolError, toolFailure, untrusted, type ToolDef } from './kit.ts';

function describeProfile(p: PublicProfile): string {
  return [
    `@${p.handle}`,
    p.displayName ? `name: ${p.displayName}` : '',
    p.bio ? `bio: ${p.bio}` : '',
    p.spaceTitle ? `space: ${p.spaceTitle}` : '',
    `format: ${p.format ?? 'paperback'}; ink: ${p.cover?.ink ?? 'atomic'}; motif: ${p.cover?.motif ?? 'arches'}` ,
    p.frequency?.length ? `transmitting on: ${p.frequency.join(', ')}` : '',
    p.travelers?.length ? `fellow travelers: ${p.travelers.join(', ')}` : '',
    p.private ? 'Space: members only' : 'Space: public on the web',
    p.sources?.length ? `featured sources: ${p.sources.map((s) => s.title).join(', ')}` : '',
    p.reblogs ? `new posts can be reblogged by: ${p.reblogs === 'nobody' ? 'nobody' : 'followers only'}` : '',
    p.listed ? 'listed: people with similar sources can find them (find_people)' : 'unlisted: found only by handle or Space link',
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.publicProfiles) return toolError(HOSTED_ONLY.profiles, 'unavailable');
      if (typeof args.handle === 'string' && args.handle.trim()) {
        const found = await ctx.publicProfiles.byHandle(args.handle);
        if (!found) return toolError(`No MCPortal profile for @${clean(args.handle, 40).replace(/^@/, '')}.`, 'not_found');
        const sections = await ctx.social?.spaceSections(ctx.userId, found.profile.accountId);
        const { accountId: _id, broughtAboard: _brought, ...profile } = publicSpaceProfile({ ...found.profile, sources: sections?.sources ?? [] });
        const moved = found.movedFrom ? `@${found.movedFrom} is now @${profile.handle}.\n` : '';
        const stats = ctx.social && found.profile.accountId !== ctx.userId ? await ctx.social.stats(ctx.userId, found.profile.accountId) : undefined;
        const counts = stats ? `\n${stats.followers} follower(s), ${stats.shares} share(s) you can see.${stats.following ? ' You follow them.' : ''}` : '';
        return ok(`${moved}${untrusted(`@${profile.handle}`, describeProfile({ ...profile, accountId: _id }))}${counts}`, { profile, ...(stats ? { stats } : {}), ...(found.movedFrom ? { movedFrom: found.movedFrom } : {}) });
      }
      const mine = await ctx.publicProfiles.get(ctx.userId);
      if (mine) return ok(`Your public profile (public on the web unless made members-only):\n${describeProfile(mine)}`, { profile: mine });
      const suggested = suggestHandle(ctx.actor?.login);
      return ok(`You have no public profile; everything in your room is private. ${suggested ? `If you want one, @${suggested} is the suggested handle (from your GitHub login).` : 'Pick a handle to create one.'}`, { profile: null, suggested: suggested ?? null });
    },
  },
  {
    name: 'set_public_profile',
    title: 'Set your public profile and space',
    access: 'write',
    available: socialEntry,
    description: "Create or change the user's public profile and Space, only when they ask: handle, name, bio, Space title, ink, motif, format, topics, own pinned post, listed fellow travelers, stamps, public visibility, featured portals ('Sources I read') and who may reblog their posts by default. Public by default: only their Space and everyone posts reach the web. Ask approval for exact bio and topic wording. Nothing else in their room becomes public. An old handle keeps pointing to them for 30 days.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...SPACE_SETTINGS_SCHEMA,
        handle: { type: 'string', description: '2-30 letters, digits or underscores; needed the first time' },
        displayName: { type: 'string', maxLength: 50 },
        bio: { type: 'string', maxLength: 160 },
        spaceTitle: { type: 'string', maxLength: 60 },
        ...SPACE_INPUT,
        featuredPortalIds: { type: 'array', maxItems: MAX_FEATURED, items: { type: 'string' }, description: 'Ids (from open_room) of feed, Hacker News or GitHub portals to recommend; [] clears' },
        reblogs: { type: 'string', enum: ['anyone', 'followers', 'nobody'] },
        listed: { type: 'boolean', description: 'findable via find_people' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
        const { profile, created, released } = await (ctx.social?.setSpace.bind(ctx.social) ?? ctx.publicProfiles.set.bind(ctx.publicProfiles))(ctx.userId, {
          handle: typeof args.handle === 'string' ? args.handle : undefined,
          displayName: typeof args.displayName === 'string' ? args.displayName : undefined,
          bio: typeof args.bio === 'string' ? args.bio : undefined,
          spaceTitle: typeof args.spaceTitle === 'string' ? args.spaceTitle : undefined,
          ...Object.fromEntries(Object.keys(SPACE_INPUT).filter((k) => args[k] !== undefined).map((k) => [k, args[k]])) as PublicProfileInput,
          sources,
          showSources: typeof args.showSources === 'boolean' ? args.showSources : undefined,
          showPeople: typeof args.showPeople === 'boolean' ? args.showPeople : undefined,
          sourceCuration: args.sourceCuration as PublicProfile['sourceCuration'],
          peopleCuration: args.peopleCuration as PublicProfile['peopleCuration'],
          reblogs: typeof args.reblogs === 'string' ? args.reblogs : undefined,
          listed: typeof args.listed === 'boolean' ? args.listed : undefined,
        });
        const skipped = sources ? sources.length - (profile.sources?.length ?? 0) : 0;
        const head = created ? `Created your public profile as @${profile.handle}. ${UNLOCKS}` : released ? `Changed your handle from @${released} to @${profile.handle}. @${released} points to you for 30 days.` : 'Updated your public profile.';
        return ok(`${head}\n${describeProfile(profile)}${skipped > 0 ? `\n${skipped} portal(s) weren't featured: only feeds, Hacker News and GitHub can be.` : ''}`, { profile } satisfies ToolResults['set_public_profile']);
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
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args, ctx) {
      let text: string;
      if (typeof args.data === 'string' && args.data.trim()) text = args.data;
      else if (typeof args.path === 'string' && args.path.trim()) {
        if (!ctx.localFiles) return toolError('path only works with a local MCPortal. Call import_portal with no arguments for an upload link.');
        const file = args.path.trim().replace(/^~(?=\/|$)/, homedir());
        if (!/\.json$/i.test(file)) return toolError('path must be a .json MCPortal export file.');
        const info = await stat(file).catch(() => undefined);
        if (!info?.isFile()) return toolError(`No file at ${clean(file, 200)}.`, 'not_found');
        if (info.size > EXPORT_MAX_BYTES) return toolError('That file is over 80 MB; it isn\'t an MCPortal export.');
        text = await readFile(file, 'utf8');
      } else if (ctx.uploadLink) {
        const link = ctx.uploadLink();
        return ok(`Upload link (works once, for 15 minutes): ${link}\nThe user picks their MCPortal export file there; the page says what was imported. Then call open_room to show it.`, { uploadUrl: link });
      } else return toolError('Pass path (the export file on this machine) or data (its text).');
      try {
        const data = parseExport(text);
        const result = ctx.importer ? await ctx.importer(data) : await importExport(data, ctx.userId, ctx);
        return ok(`${describeImport(result)}\nCall open_room to show it.`, { result, profile: await ctx.store.get(ctx.userId) });
      } catch (error) {
        return toolFailure(error, 'Not imported: ');
      }
    },
  },
  {
    name: 'account_settings',
    title: 'Account and sign-in',
    access: 'read',
    description: "Whether the user is signed in (as whom) or in ghost mode, and the account page, where they download everything or delete their account (only there, never a tool).",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(_args, ctx) {
      const identity = await identityOf(ctx);
      const shareAudience = (await ctx.store.get(ctx.userId)).shareAudience ?? 'everyone';
      if (!ctx.accountUrl) {
        const signIn = ctx.link ? ' To keep this portal in a hosted account (the same portal on every device, plus sharing), link_account signs in.' : '';
        return ok(`${describeIdentity(identity)} To remove everything, delete that folder.${signIn}`, { identity, url: null, shareAudience } satisfies ToolResults['account_settings']);
      }
      return ok(`${describeIdentity(identity)} The account page is ${ctx.accountUrl}: the user signs in with GitHub there to download everything or delete their account.`, { identity, url: ctx.accountUrl, shareAudience } satisfies ToolResults['account_settings']);
    },
  },
  {
    name: 'link_account',
    title: 'Sign in to a hosted MCPortal',
    access: 'write',
    available: (reach) => reach.link === 'unlinked',
    description: "Sign this local MCPortal in to the user's hosted account, so their portal is the same everywhere and they can share. Returns a sign-in link for them to open; only when they ask to sign in.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async handler(_args, ctx) {
      if (!ctx.link) return toolError('This MCPortal is hosted: the user is signed in already.', 'unavailable');
      try {
        const { url } = await ctx.link.start();
        return ok(`Sign-in link (works for 10 minutes): ${url}\nThe user signs in with GitHub there. This computer's portal is then added to their account, and the next open_room shows it.`, { url } satisfies ToolResults['link_account']);
      } catch (error) {
        return toolFailure(error, 'Not started: ');
      }
    },
  },
  {
    name: 'unlink_account',
    title: 'Sign out of the hosted MCPortal',
    access: 'write',
    available: (reach) => reach.link === 'linked',
    description: "Sign this computer out of the user's hosted MCPortal: their portal is copied back here first, so nothing disappears, and MCPortal returns to ghost mode. Only when they ask.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(_args, ctx) {
      if (!ctx.link?.linked) return toolError('This MCPortal isn\'t signed in.', 'failed_precondition');
      try {
        return ok(await ctx.link.unlink(), { identity: { mode: 'ghost' } } satisfies ToolResults['unlink_account']);
      } catch (error) {
        return toolFailure(error, 'Still signed in: ');
      }
    },
  },
];
