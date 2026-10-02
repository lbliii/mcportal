/**
 * The highlights tools: list_new_items (candidates and taste signals for the agent to
 * rank) and show_highlights (the agent's picks as a card, kept as the room's edition).
 * See src/highlights.ts and src/editions.ts.
 */
import { buildEdition, EDITION_HOURS } from '../editions.ts';
import { candidateLine, candidates, findByRef, parseRef, PICKS, tasteSignals, type HighlightPick } from '../highlights.ts';
import { clean } from '../lib/text.ts';
import { findPortal } from '../profile.ts';
import { tracksSeen } from '../seen.ts';
import { ok, toolError, untrusted, ROOM_URI, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';
import { portalFor } from './room.ts';

export const HIGHLIGHT_TOOLS: ToolDef[] = [
  {
    name: 'list_new_items',
    title: "List what's new in the room",
    access: 'fetch',
    cost: 3,
    description: "What the user hasn't seen yet across their room (or the portals named), each with a ref, plus what MCPortal knows of their taste. For 'what's worth reading / catch me up / highlights': pick with what you know of them, then show_highlights.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { portals: { type: 'array', items: { type: 'string' }, description: 'Portal ids, to look at only these' } },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, ctx) {
      const profile = await ctx.store.get(ctx.userId);
      const wanted = Array.isArray(args.portals) && args.portals.length ? new Set(args.portals.map(String)) : null;
      const specs = profile.columns.flatMap((c) => c.panels).filter((p) => tracksSeen(p.source) && p.source !== 'pinned' && (!wanted || wanted.has(p.id)));
      if (wanted && !specs.length) return toolError(`None of those are portals with new items to show (${[...wanted].map((w) => clean(w, 40)).join(', ')}). open_room lists the ids.`, 'not_found');
      const portals = await Promise.all(specs.map((s) => portalFor(s, profile, ctx)));
      const seen = ctx.seen ? await ctx.seen.get(ctx.userId, specs.map((s) => s.id)) : null;
      const items = candidates(portals, seen);
      const [reading, clips] = await Promise.all([
        ctx.reading ? ctx.reading.list(ctx.userId, { unfinished: false, limit: 100 }) : [],
        ctx.clips ? ctx.clips.list(ctx.userId, { limit: 200 }) : [],
      ]);
      const signals = tasteSignals(profile, reading, clips);
      const text = [
        items.length
          ? `${items.length} item(s) the user hasn't seen, by portal in turn (each source's own order). Pick with what you know of the user, then call show_highlights with the refs and a short reason each.`
          : "Nothing new: the user has seen everything in their room.",
        items.length ? untrusted('new items in the room', items.map((c) => candidateLine(c)).join('\n')) : '',
        signals.length ? untrusted('what MCPortal knows of their taste', signals.join('\n')) : '',
      ].filter(Boolean).join('\n\n');
      return ok(text, { items, signals } satisfies ToolResults['list_new_items']);
    },
  },
  {
    name: 'show_highlights',
    title: 'Show highlights',
    access: 'write',
    description: "Show your picks from list_new_items, best first, as a highlights card: each item's ref and a one-line reason it's worth the user's time. The room then leads with them for a day.",
    inputSchema: {
      type: 'object',
      required: ['picks'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', maxLength: PICKS.title },
        intro: { type: 'string', maxLength: PICKS.intro },
        picks: {
          type: 'array',
          minItems: 1,
          maxItems: PICKS.max,
          items: { type: 'object', required: ['ref', 'why'], additionalProperties: false, properties: { ref: { type: 'string' }, why: { type: 'string', maxLength: PICKS.why } } },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      const profile = await ctx.store.get(ctx.userId);
      const picks = args.picks as Array<{ ref: string; why: string }>;
      // Load each named portal once (cached), and find each pick among its real items.
      const portals = new Map<string, Awaited<ReturnType<typeof portalFor>> | null>();
      const shown: HighlightPick[] = [];
      const unknown: string[] = [];
      for (const pick of picks) {
        const ref = parseRef(pick.ref);
        const spec = ref ? findPortal(profile, ref.portalId) : undefined;
        if (!ref || !spec) { unknown.push(clean(pick.ref, 40)); continue; }
        if (!portals.has(spec.id)) portals.set(spec.id, await portalFor(spec, profile, ctx).catch(() => null));
        const portal = portals.get(spec.id);
        const item = portal ? findByRef(portal.items, ref.hash) : undefined;
        if (!portal || !item) { unknown.push(clean(pick.ref, 40)); continue; }
        if (shown.some((s) => s.ref === `${spec.id}/${ref.hash}`)) continue;
        shown.push({ ref: `${spec.id}/${ref.hash}`, portalId: spec.id, portalTitle: portal.title, source: portal.source, item, why: clean(pick.why, PICKS.why) });
      }
      if (!shown.length) return toolError(`None of those refs name an item in the room (${unknown.join(', ')}). Use refs from list_new_items.`, 'invalid_argument');
      const title = clean(args.title, PICKS.title) || 'Highlights';
      const intro = clean(args.intro, PICKS.intro);
      // The room's edition: only the refs and your words are kept; open_room finds the items again.
      await ctx.editions?.put(ctx.userId, buildEdition({ title, intro, picks: shown.map(({ ref, why }) => ({ ref, why })) }));
      return ok(`Showing ${shown.length} highlight(s) in a card.${ctx.editions ? ` The room leads with them for ${EDITION_HOURS} hours.` : ''}${unknown.length ? ` Skipped refs that name nothing in the room: ${unknown.join(', ')}.` : ''}`,
        { highlights: { title, ...(intro ? { intro } : {}), picks: shown } } satisfies ToolResults['show_highlights']);
    },
  },
];
