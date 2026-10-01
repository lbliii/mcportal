/**
 * The room tools: open_room, build_room, get_profile, update_profile, refresh_portal.
 * They show the room and change its layout; adding single portals lives in sources.ts.
 */
import { clean } from '../lib/text.ts';
import { spreadColumns, withLayout } from '../layout.ts';
import { MAX_PACKS, packSummaries, STARTER_PACKS } from '../packs.ts';
import { describeDiff, describeLayout, diffProfiles, findPortal, normalizePins, normalizeSourceConfig, SOURCES, validateProfile, type PortalInput, type Profile } from '../profile.ts';
import { clipsPortal, clipsQuery, followingPortal, loadPortal, pinnedPortal, savedPortal } from '../sources.ts';
import type { PortalResult } from '../types.ts';
import { ok, toolError, toolFailure, untrusted, ROOM_URI, type ToolContext, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

/** Any portal's current items: profile-backed ones from the profile and stores, the rest fetched (cached unless `force`). */
export async function portalFor(spec: PortalInput, profile: Profile, ctx: ToolContext, force = false): Promise<PortalResult> {
  if (spec.source === 'saved') return savedPortal(spec, profile.saved);
  if (spec.source === 'pinned') return pinnedPortal(spec, profile.pins);
  if (spec.source === 'clips') return clipsPortal(spec, ctx.clips ? await ctx.clips.list(ctx.userId, clipsQuery(spec)) : []);
  if (spec.source === 'following') {
    const { limit } = normalizeSourceConfig('following', spec.config, spec.id);
    return followingPortal(spec, ctx.social ? await ctx.social.feed(ctx.userId, { limit }) : []);
  }
  return loadPortal(spec, ctx, force);
}

/** One item as a line of text for the model. */
export function itemLine(item: PortalResult['items'][number]): string {
  return `- ${item.title}${item.meta.length ? ` (${item.meta.join(', ')})` : ''}${item.url ? ` <${item.url}>` : ''}`;
}

function summarizePortals(profile: Profile, portals: PortalResult[], notice?: string): string {
  const lines = [`MCPortal room "${profile.name}": ${describeLayout(profile)}.`];
  if (notice) lines.push(`Notice for the user: ${notice}`);
  for (const portal of portals) {
    if (portal.error) {
      lines.push(`\n[${portal.portalId}] could not load: ${clean(portal.error, 200)}`);
      continue;
    }
    if (portal.pin) {
      lines.push(`\n[${portal.portalId}] ${portal.items.length} items pinned from ${portal.pin.from}, updated ${portal.provenance.fetchedAt}. To refresh: ${portal.pin.recipe}; then pin_portal with portalId ${portal.portalId}.`);
    } else lines.push(`\n[${portal.portalId}] ${portal.items.length} items`);
    lines.push(untrusted(portal.provenance.endpoint, [`portal title: ${portal.title}`, ...portal.items.slice(0, 5).map(itemLine)].join('\n')));
  }
  return lines.join('\n');
}

const portalSchema = {
  type: 'object',
  required: ['source', 'config'],
  properties: {
    id: { type: 'string', description: 'Stable id. Keep existing ids when editing.' },
    source: { type: 'string', enum: SOURCES },
    title: { type: 'string' },
    config: { type: 'object', description: 'Source-specific settings; see list_sources.' },
  },
};

export const ROOM_TOOLS: ToolDef[] = [
  {
    name: 'open_room',
    title: 'Open your MCPortal room',
    access: 'fetch',
    cost: 3,
    description:
      "Open the user's MCPortal room: their portals onto their sources (Hacker News, GitHub, RSS, and data pinned from their other tools), arranged by their saved layout. Use this when the user asks to open their room, portal, MCPortal, dashboard, or morning view, or asks what's new across their sources.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { setup: { type: 'boolean', description: 'Show the welcome and starter packs, e.g. when the user asks to start over or rebuild their room.' } },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      const profile = await ctx.store.get(ctx.userId);
      const notice = ctx.store.takeNotice?.(ctx.userId);
      if (!profile.onboarded || args.setup === true) {
        const packs = packSummaries();
        const text = [
          profile.onboarded
            ? 'Showing the room setup. Building from packs replaces the current layout (saved items stay); confirm with the user before calling build_room.'
            : 'This is a new MCPortal user: the welcome screen is showing. Ask what they are into, or let them pick in the UI.',
          `Starter packs (pick up to ${MAX_PACKS} with build_room): ${packs.map((p) => `${p.id} (${p.label}: ${p.sources.join(', ')})`).join('; ')}.`,
          'For interests no pack covers, build from the closest packs (or none), then use find_source and add_portal for specific sites, channels or feeds.',
        ].join('\n');
        return ok(text, { profile, portals: [], onboarding: { packs, maxPacks: MAX_PACKS, rebuilding: profile.onboarded }, generatedAt: new Date().toISOString() } satisfies ToolResults['open_room']);
      }
      const portals = await Promise.all(profile.columns.flatMap((c) => c.panels).map((p) => portalFor(p, profile, ctx)));
      return ok(summarizePortals(profile, portals, notice), { profile, portals, notice, generatedAt: new Date().toISOString() } satisfies ToolResults['open_room']);
    },
  },
  {
    name: 'build_room',
    title: 'Build the room from starter packs',
    access: 'write',
    description: [
      `Set up the user's room from up to ${MAX_PACKS} starter packs (ids from open_room's setup, e.g. developer, docs, ai, news, gaming, art, science, music, film).`,
      'Replaces the current layout; saved items stay. Use it for first-time setup, or when the user asks to start over (confirm first if they have a room they built).',
      'An empty packs list keeps the sample layout and just finishes setup. Afterwards call open_room to show it, and offer to add anything specific with find_source.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['packs'],
      additionalProperties: false,
      properties: {
        packs: { type: 'array', maxItems: MAX_PACKS, items: { type: 'string', enum: STARTER_PACKS.map((p) => p.id) } },
        layout: { type: 'string', enum: ['columns', 'shelves'], description: 'Default shelves (picture rows).' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const ids = [...new Set((Array.isArray(args.packs) ? args.packs : []).map(String))];
      const unknown = ids.filter((id) => !STARTER_PACKS.some((p) => p.id === id));
      if (unknown.length) return toolError(`Unknown pack(s): ${unknown.join(', ')}. Packs: ${STARTER_PACKS.map((p) => p.id).join(', ')}`);
      if (ids.length > MAX_PACKS) return toolError(`Pick at most ${MAX_PACKS} packs`);
      if (!ids.length) {
        const kept = await ctx.store.update(ctx.userId, (before) => {
          const profile = { ...before, onboarded: true, updatedAt: new Date().toISOString() };
          return { profile, result: profile };
        });
        return ok(`Setup finished; kept the current layout: ${describeLayout(kept)}`, { profile: kept } satisfies ToolResults['build_room']);
      }
      // Sources in pack order, spread over at most 8 columns, packs kept together.
      const sources = ids.flatMap((id) => STARTER_PACKS.find((p) => p.id === id)!.portals);
      const layout = args.layout === 'columns' ? 'columns' : 'shelves';
      const profile = await ctx.store.update(ctx.userId, (before) => {
        const built = withLayout(before, { layout, columns: spreadColumns(sources), onboarded: true });
        return { profile: built, result: built };
      });
      const labels = ids.map((id) => STARTER_PACKS.find((p) => p.id === id)!.label);
      return ok(`Built the room from ${labels.join(', ')}: ${sources.length} sources, ${layout} layout. Saved items kept (${profile.saved.length}).`, { profile } satisfies ToolResults['build_room']);
    },
  },
  {
    name: 'get_profile',
    title: 'Get room preferences',
    access: 'read',
    description: "Return the user's saved MCPortal profile: the layout, and each portal with its source settings (each column stores its portals as panels). Always call this before update_profile.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async handler(_args, ctx) {
      const profile = await ctx.store.get(ctx.userId);
      const notice = ctx.store.takeNotice?.(ctx.userId);
      // Pinned items stay out of the text: update_profile carries them over, and they can be long.
      const pins = Object.fromEntries(Object.entries(profile.pins).map(([id, p]) => [id, `${p.items.length} items, pinned ${p.pinnedAt}`]));
      return ok(`${notice ? `Notice for the user: ${notice}\n\n` : ''}${describeLayout(profile)}\n\n${JSON.stringify({ ...profile, pins }, null, 2)}`, { profile });
    },
  },
  {
    name: 'update_profile',
    title: 'Update room preferences',
    access: 'write',
    description: [
      "Save the user's MCPortal layout. Send the COMPLETE profile (from get_profile) with only the changes the user asked for.",
      'Columns are left to right; the portals in a column (its "panels" list) stack top to bottom; width is relative (1-4).',
      'layout "columns" shows columns side by side; "shelves" shows each portal as a horizontally scrolling row, in column order. openIn "card" opens stories in a reader inside the room; "chat" opens each as its own reader card in the conversation.',
      "Never move, retitle, or remove portals the user did not mention: their stated layout is a fixed rule. Removing a portal is refused unless its id is listed in removePortalIds, which you may only do when the user explicitly asked to remove it.",
      'Saved items (bookmarks) are not part of this tool: they are kept as they are; use save_item and remove_saved for them. A portal with source "saved" shows them.',
      'Likewise the items of "pinned" portals are kept; use pin_portal to add or refresh those.',
      'After saving, tell the user what changed (the result lists it) and call open_room to show it.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['profile'],
      additionalProperties: false,
      properties: {
        profile: {
          type: 'object',
          required: ['columns'],
          properties: {
            name: { type: 'string' },
            layout: { type: 'string', enum: ['columns', 'shelves'] },
            openIn: { type: 'string', enum: ['card', 'chat'] },
            columns: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: {
                type: 'object',
                required: ['panels'],
                properties: { width: { type: 'integer', minimum: 1, maximum: 4 }, panels: { type: 'array', minItems: 1, maxItems: 4, items: portalSchema } },
              },
            },
          },
        },
        removePortalIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of portals the user explicitly asked to remove. Required for any removal.',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      let next: Profile;
      try {
        next = validateProfile(args.profile);
      } catch (error) {
        return toolFailure(error, 'Profile not saved: ');
      }
      const asked = next;
      const allowed = new Set(Array.isArray(args.removePortalIds) ? args.removePortalIds.map(String) : []);
      ctx.store.takeNotice?.(ctx.userId);
      const saved = await ctx.store.update<{ unapproved: string[] } | { profile: Profile; diff: ReturnType<typeof diffProfiles> }>(ctx.userId, (before) => {
        // Bookmarks and pinned items are never edited through the layout.
        const pinnedIds = asked.columns.flatMap((c) => c.panels).filter((p) => p.source === 'pinned').map((p) => p.id);
        const profile = { ...asked, saved: before.saved, pins: normalizePins(before.pins, pinnedIds) };
        const diff = diffProfiles(before, profile);
        const unapproved = diff.removed.filter((id) => !allowed.has(id));
        return unapproved.length ? { result: { unapproved } } : { profile, result: { profile, diff } };
      });
      if ('unapproved' in saved) {
        return toolError(
          `Profile not saved: it would remove ${saved.unapproved.join(', ')}. Keep those portals, or, only if the user explicitly asked to remove them, list them in removePortalIds.`,
        );
      }
      return ok(`Saved. Changes: ${describeDiff(saved.diff)}.\nLayout now: ${describeLayout(saved.profile)}`, { profile: saved.profile, changes: saved.diff } satisfies ToolResults['update_profile']);
    },
  },
  {
    name: 'refresh_portal',
    title: 'Refresh one portal',
    access: 'fetch',
    cost: 2,
    description: 'Reload a single portal, bypassing the cache. Used by the room UI.',
    inputSchema: { type: 'object', required: ['portalId'], additionalProperties: false, properties: { portalId: { type: 'string' } } },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: ROOM_URI, visibility: ['app'] } },
    async handler(args, ctx) {
      const profile = await ctx.store.get(ctx.userId);
      const spec = findPortal(profile, String(args.portalId ?? ''));
      if (!spec) return toolError(`No portal with id "${clean(args.portalId, 60)}"`, 'not_found');
      const portal = await portalFor(spec, profile, ctx, true);
      return ok(`${portal.portalId}: ${portal.items.length} items`, { portal } satisfies ToolResults['refresh_portal']);
    },
  },
];
