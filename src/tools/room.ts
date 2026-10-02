/**
 * The room tools: open_room, build_room, arrange_room, remove_portal, refresh_portal, mark_seen.
 * They show the room and change its layout (src/layout.ts arrange: only what a call
 * names can change); adding single portals lives in sources.ts.
 */
import { clean } from '../lib/text.ts';
import { arrange, spreadColumns, withLayout, type Arrangement } from '../layout.ts';
import { leadOf, resolveEdition, type RoomEdition } from '../highlights.ts';
import { MAX_PACKS, packSummaries, STARTER_PACKS } from '../packs.ts';
import { SEEN_BATCH, tracksSeen, withNews } from '../seen.ts';
import { describeDiff, describeLayout, diffProfiles, findPortal, normalizeSourceConfig, LAYOUTS, type Layout, type PortalInput, type Profile, type ProfileDiff } from '../profile.ts';
import { clipsPortal, clipsQuery, followingPortal, loadPortal, pinnedPortal, savedPortal } from '../sources.ts';
import type { PortalResult } from '../types.ts';
import { ok, toolError, toolFailure, untrusted, ROOM_URI, type CallToolResult, type ToolContext, type ToolDef } from './kit.ts';
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

/** Items per portal in open_room's text: enough to say what's new; the room card shows the rest. */
const ROOM_ITEMS = 3;

/** "3h ago" for the agent. */
const hoursAgo = (iso: string, now = Date.now()) => { const h = Math.round((now - Date.parse(iso)) / 3_600_000); return h < 1 ? 'under an hour ago' : `${h}h ago`; };

function summarizePortals(profile: Profile, portals: PortalResult[], notice?: string, edition?: RoomEdition): string {
  const lines = [`MCPortal room "${profile.name}": ${describeLayout(profile)}.`];
  if (notice) lines.push(`Notice for the user: ${notice}`);
  // The edition's title, intro and reasons are the agent's own words; only refs name items.
  if (edition) lines.push(`Your highlights from ${hoursAgo(edition.createdAt)}, ${edition.picks.length} still in the room, lead the room: ${edition.picks.map((p) => p.ref).join(', ')}. Refresh with list_new_items and show_highlights.`);
  for (const portal of portals) {
    if (portal.error) {
      lines.push(`\n[${portal.portalId}] could not load: ${clean(portal.error, 200)}`);
      continue;
    }
    const fresh = portal.newCount ? `, ${portal.newCount} new` : '';
    if (portal.pin) {
      lines.push(`\n[${portal.portalId}] ${portal.items.length} items${fresh} pinned from ${portal.pin.from}, updated ${portal.provenance.fetchedAt}. To refresh: ${portal.pin.recipe}; then pin_portal with portalId ${portal.portalId}.`);
    } else lines.push(`\n[${portal.portalId}] ${portal.items.length} items${fresh}`);
    // New items first: they're what "what's new?" is asking about.
    const first = [...portal.items.filter((i) => i.new), ...portal.items.filter((i) => !i.new)].slice(0, ROOM_ITEMS);
    lines.push(untrusted(portal.provenance.endpoint, [`portal title: ${portal.title}`, ...first.map((i) => `${itemLine(i)}${i.new ? ' (new)' : ''}`)].join('\n')));
  }
  return lines.join('\n');
}

/** Apply an arrangement atomically and say what changed (arrange_room, remove_portal). */
async function rearrange(change: Arrangement, ctx: ToolContext): Promise<CallToolResult> {
  let saved: { profile: Profile; changes: ProfileDiff };
  try {
    saved = await ctx.store.update(ctx.userId, (before) => {
      const profile = arrange(before, change);
      return { profile, result: { profile, changes: diffProfiles(before, profile) } };
    });
  } catch (error) {
    return toolFailure(error, 'Nothing changed: ');
  }
  return ok(`Saved. Changes: ${describeDiff(saved.changes)}.\nLayout now: ${describeLayout(saved.profile)}`, { profile: saved.profile, changes: saved.changes } satisfies ToolResults['arrange_room']);
}

export const ROOM_TOOLS: ToolDef[] = [
  {
    name: 'open_room',
    title: 'Open your MCPortal room',
    access: 'fetch',
    cost: 3,
    description: "Open the user's MCPortal room: portals onto the sources they follow, in their layout, with what's new in each and each portal's id. For 'open my room / portal / MCPortal' or what's new across their sources.",
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
      const specs = profile.columns.flatMap((c) => c.panels);
      await ctx.seen?.keepOnly(ctx.userId, specs.map((p) => p.id));
      const portals = await withNews(await Promise.all(specs.map((p) => portalFor(p, profile, ctx))), ctx.userId, ctx.seen);
      const edition = resolveEdition(await ctx.editions?.get(ctx.userId), portals);
      const lead = leadOf(edition, portals);
      return ok(summarizePortals(profile, portals, notice, edition),
        { profile, portals, notice, ...(edition ? { edition } : {}), ...(lead ? { lead } : {}), generatedAt: new Date().toISOString() } satisfies ToolResults['open_room']);
    },
  },
  {
    name: 'build_room',
    title: 'Build the room from starter packs',
    access: 'write',
    description: `Set up the user's room from up to ${MAX_PACKS} starter packs (ids from open_room's setup). Replaces the layout, keeping saved items: confirm first if they built the room themselves. An empty list keeps the sample room and finishes setup. Then call open_room.`,
    inputSchema: {
      type: 'object',
      required: ['packs'],
      additionalProperties: false,
      properties: {
        packs: { type: 'array', maxItems: MAX_PACKS, items: { type: 'string', enum: STARTER_PACKS.map((p) => p.id) } },
        layout: { type: 'string', enum: [...LAYOUTS], description: 'Default shelves (picture rows).' },
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
      const layout: Layout = LAYOUTS.find((l) => l === args.layout) ?? 'shelves';
      const profile = await ctx.store.update(ctx.userId, (before) => {
        const built = withLayout(before, { layout, columns: spreadColumns(sources), onboarded: true });
        return { profile: built, result: built };
      });
      const labels = ids.map((id) => STARTER_PACKS.find((p) => p.id === id)!.label);
      return ok(`Built the room from ${labels.join(', ')}: ${sources.length} sources, ${layout} layout. Saved items kept (${profile.saved.length}).`, { profile } satisfies ToolResults['build_room']);
    },
  },
  {
    name: 'arrange_room',
    title: 'Arrange the room',
    access: 'write',
    description: "Change the room's layout: move portals (to a column, 1 = left; one past the last makes a new column), set column widths, retitle portals or change their settings, rename the room, or switch layout or how stories open. Name portals by id or title (open_room lists them); only what you name changes. Removing is remove_portal.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        move: { type: 'array', items: { type: 'object', required: ['portal', 'column'], additionalProperties: false, properties: { portal: { type: 'string' }, column: { type: 'integer', minimum: 1 }, position: { type: 'integer', minimum: 1, description: 'top = 1; default last' } } } },
        width: { type: 'array', items: { type: 'object', required: ['column', 'width'], additionalProperties: false, properties: { column: { type: 'integer', minimum: 1 }, width: { type: 'integer', minimum: 1, maximum: 4 } } } },
        retitle: { type: 'array', items: { type: 'object', required: ['portal', 'title'], additionalProperties: false, properties: { portal: { type: 'string' }, title: { type: 'string' } } } },
        configure: { type: 'array', items: { type: 'object', required: ['portal', 'config'], additionalProperties: false, properties: { portal: { type: 'string' }, config: { type: 'object', description: 'Settings to change (list_sources)' } } } },
        name: { type: 'string' },
        layout: { type: 'string', enum: [...LAYOUTS], description: 'columns side by side, or one sideways row per portal' },
        openIn: { type: 'string', enum: ['card', 'chat'], description: 'stories open in the room, or as their own card in the chat' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: (args, ctx) => rearrange(args as Arrangement, ctx),
  },
  {
    name: 'remove_portal',
    title: 'Remove portals from the room',
    access: 'write',
    description: "Remove portals from the user's room, only ones they asked to remove (by id or title; open_room lists them). Nothing else moves. Their saved items and clips stay.",
    inputSchema: {
      type: 'object',
      required: ['portals'],
      additionalProperties: false,
      properties: { portals: { type: 'array', minItems: 1, items: { type: 'string' } } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: (args, ctx) => rearrange({ remove: (args.portals as unknown[]).map(String) }, ctx),
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
      const [portal] = await withNews([await portalFor(spec, profile, ctx, true)], ctx.userId, ctx.seen);
      return ok(`${portal!.portalId}: ${portal!.items.length} items`, { portal: portal! } satisfies ToolResults['refresh_portal']);
    },
  },
  {
    name: 'mark_seen',
    title: 'Mark items seen',
    access: 'write',
    description: "The room records the items the user has had on screen or opened, so the next open_room says what's new to them.",
    inputSchema: {
      type: 'object',
      required: ['portals'],
      additionalProperties: false,
      properties: {
        portals: {
          type: 'array',
          maxItems: SEEN_BATCH.portals,
          items: {
            type: 'object',
            required: ['portalId', 'itemIds'],
            additionalProperties: false,
            properties: { portalId: { type: 'string' }, itemIds: { type: 'array', maxItems: SEEN_BATCH.items, items: { type: 'string', maxLength: 300 } } },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri: ROOM_URI, visibility: ['app'] } },
    async handler(args, ctx) {
      if (!ctx.seen) return toolError('Seen tracking is not available on this server.', 'unavailable');
      const profile = await ctx.store.get(ctx.userId);
      const tracked = new Set(profile.columns.flatMap((c) => c.panels).filter((p) => tracksSeen(p.source)).map((p) => p.id));
      // Only portals in the room that track it; anything else is ignored, not refused.
      const marks = (args.portals as Array<{ portalId: string; itemIds: string[] }>).filter((m) => tracked.has(m.portalId) && m.itemIds.length);
      await ctx.seen.mark(ctx.userId, marks);
      const marked = marks.reduce((n, m) => n + m.itemIds.length, 0);
      return ok(`Marked ${marked} item(s) seen.`, { marked } satisfies ToolResults['mark_seen']);
    },
  },
];
