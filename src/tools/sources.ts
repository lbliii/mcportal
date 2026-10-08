/**
 * Source tools: read_source, find_source, add_portal, list_sources, and OPML import
 * (import_opml; export_data exports OPML). They find, preview and add what the room shows.
 */
import { mapLimit } from '../lib/async.ts';
import { errorStack, isAppError, userMessage } from '../lib/errors.ts';
import { clean } from '../lib/text.ts';
import { discover, type FetchedSource } from '../discover.ts';
import { addPortalTo, columnOf, slugId, withLayout, spreadColumns } from '../layout.ts';
import { OPML_LIMITS, parseOpml } from '../opml.ts';
import { describeLayout, findPortal, LIMITS, sourceSettings, SOURCES, type SourceSettings, type PortalInput, type Profile } from '../profile.ts';
import { findDocs, loadPortal, SOURCE_DOCS } from '../sources.ts';
import type { Item, PortalResult, SourceKind } from '../types.ts';
import { ok, toolError, toolFailure, untrusted, type ToolDef } from './kit.ts';
import { featuredBy } from './social.ts';
import type { ToolResults } from './results.ts';
import { itemLine, portalFor } from './room.ts';

/** Where a candidate's items come from, for the untrusted-content label. */
function sourceLabel(c: SourceSettings<FetchedSource>): string {
  if (c.source === 'rss' || c.source === 'docs') return c.config.url;
  if (c.source === 'github') return c.config.mode === 'releases' ? c.config.repo : `github search: ${c.config.query}`;
  return 'hn';
}

/** Sources MCPortal fetches (or, for saved, reads) itself. Pinned portals only come from pin_portal, People from suggest_people. */
const ADDABLE: SourceKind[] = SOURCES.filter((s) => s !== 'pinned' && s !== 'people' && s !== 'watches');

export const SOURCE_TOOLS: ToolDef[] = [
  {
    name: 'read_source',
    title: 'Read a source',
    access: 'fetch',
    cost: 2,
    description: "Fetch the latest items from one source (Hacker News, a feed, GitHub) without changing the room: for 'what's new on…' or previewing a feed before adding it.",
    inputSchema: {
      type: 'object',
      required: ['source'],
      additionalProperties: false,
      properties: { source: { type: 'string', enum: ADDABLE }, config: { type: 'object' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const source = args.source as SourceKind;
      let portal: PortalResult;
      try {
        const spec = { id: `preview-${source}`, source, config: args.config ?? {} };
        portal = await portalFor(spec, await ctx.store.get(ctx.userId), ctx);
      } catch (error) {
        return toolFailure(error, `Could not read ${source}: `);
      }
      if (portal.error) return toolError(`Could not read ${source}: ${clean(portal.error, 200)}`, portal.errorCode ?? 'upstream_error');
      return ok(untrusted(portal.provenance.endpoint, [`feed title: ${portal.title}`, ...portal.items.map(itemLine)].join('\n')), { portal });
    },
  },
  {
    name: 'find_source',
    title: 'Find a source to add',
    access: 'fetch',
    cost: 5,
    description: "Find what MCPortal can show for something the user wants to follow, test-load it and preview it; add a candidate with add_portal. Accepts a site or feed address, 'r/subreddit', 'owner/repo', 'hn', YouTube, Bluesky, Mastodon ('@name@server') or Substack addresses, a news topic as https://news.google.com/rss/search?q=TOPIC, or docs ('docs.stripe.com', 'react.dev docs', a GitHub repo with markdown docs). For a name, pass its domain.",
    inputSchema: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const query = clean(args.query, 500);
      if (!query) return toolError('find_source needs a "query"');
      const [found, docs] = await Promise.all([discover(query, ctx.fetcher), findDocs(query, ctx)]);
      if (docs && 'config' in docs) found.candidates.unshift({ source: 'docs', config: { ...docs.config }, title: docs.title, via: 'docs' });
      else if (docs && !found.candidates.length) found.hint ??= docs.error;
      const loaded = await Promise.all(found.candidates.slice(0, 5).map(async (c, i): Promise<typeof c & { error?: string; items: Item[] }> => {
        try {
          const portal = await loadPortal({ id: `candidate-${i}`, source: c.source, ...(c.source === 'rss' ? {} : { title: c.title }), config: c.config }, ctx);
          return { ...c, title: portal.error || c.source !== 'rss' ? c.title : portal.title, ...(portal.error !== undefined ? { error: portal.error } : {}), items: portal.items };
        } catch (error) {
          // A config the source refuses (ProfileError); anything else is a bug, and logged.
          if (!isAppError(error)) ctx.log?.warn('find_source.candidate_failed', { source: c.source, error: errorStack(error) });
          return { ...c, error: clean(userMessage(error), 160), items: [] };
        }
      }));
      const working = loaded.filter((c) => !c.error && c.items.length);
      // Each config as add_portal will store it, so the app reads typed, validated settings.
      const candidates = working.map(({ items, error: _error, source, config, ...c }) => ({ ...c, ...sourceSettings(source, config, 'candidate'), preview: items.slice(0, 3) }));
      if (!candidates.length) {
        const why = found.hint ?? (loaded.length ? `Found ${loaded.length} possible feed(s), but none loaded: ${clean(loaded[0]!.error ?? 'empty feed', 160)}` : 'Nothing found.');
        return ok(why, { candidates: [], hint: why } satisfies ToolResults['find_source']);
      }
      const text = candidates.map((c, i) =>
        untrusted(sourceLabel(c), [`${i + 1}. [${c.source}, via ${c.via}] ${c.title}`, `config: ${JSON.stringify(c.config)}`, ...c.preview.map(itemLine)].join('\n')));
      return ok([`${candidates.length} working source(s). Add one with add_portal using its source and config.`, ...text].join('\n'), { candidates, hint: found.hint } satisfies ToolResults['find_source']);
    },
  },
  {
    name: 'add_portal',
    title: 'Add a portal to the room',
    access: 'write',
    cost: 2,
    description: "Add one portal to the user's room from a find_source candidate (its source and config). Only adds: nothing else moves, and duplicates are refused. Pass column only if the user said where. Tell them where it went.",
    inputSchema: {
      type: 'object',
      required: ['source', 'config'],
      additionalProperties: false,
      properties: {
        source: { type: 'string', enum: ADDABLE },
        config: { type: 'object' },
        title: { type: 'string' },
        column: { type: 'integer', minimum: 1, maximum: 8 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const source = args.source as SourceKind;
      const title = clean(args.title, 80) || undefined;
      const config = args.config ?? {};
      const before = await ctx.store.get(ctx.userId);
      // Load it first: refuse sources that don't work, and name the portal after what it is.
      let trial: PortalResult;
      try {
        trial = await portalFor({ id: 'new', source, ...(title !== undefined ? { title } : {}), config }, before, ctx);
      } catch (error) {
        return toolFailure(error, 'Not added: ');
      }
      if (trial.error) return toolError(`Not added: it didn't load (${clean(trial.error, 160)}). Try find_source for a working address.`, trial.errorCode ?? 'upstream_error');
      const spec: PortalInput = { id: slugId(title ?? trial.title), source, ...(title !== undefined ? { title } : {}), config };
      let added: ReturnType<typeof addPortalTo>;
      try {
        added = await ctx.store.update<ReturnType<typeof addPortalTo>>(ctx.userId, (current) => {
          const result = addPortalTo(current, spec, typeof args.column === 'number' ? args.column : undefined);
          return 'error' in result ? { result } : { profile: result.profile, result };
        });
      } catch (error) {
        return toolFailure(error, 'Not added: ');
      }
      if ('error' in added) return toolError(`Not added: ${added.error}`, added.code);
      const placed = findPortal(added.profile, added.portalId)!;
      const portal = await portalFor(placed, added.profile, ctx);
      const hint = await featuredBy(ctx, [{ source, config, title: portal.title }], 'it');
      return ok(`Added "${portal.title}" (id ${added.portalId}) in column ${columnOf(added.profile, added.portalId)}.\nLayout now: ${describeLayout(added.profile)}${hint ? `\n${hint}` : ''}`,
        { profile: added.profile, portal, portalId: added.portalId } satisfies ToolResults['add_portal']);
    },
  },
  {
    name: 'list_sources',
    title: 'List available sources',
    access: 'read',
    description: 'Describe the source types MCPortal can show in a portal and the settings each accepts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler() {
      return ok(JSON.stringify(SOURCE_DOCS, null, 2), { sources: SOURCE_DOCS });
    },
  },
  {
    name: 'import_opml',
    title: 'Import subscriptions (OPML)',
    access: 'write',
    cost: 20,
    description: "Import the user's subscriptions from another feed reader: pass their OPML export's text. Working feeds are added as portals (a new room is built from their folders); nothing is moved or removed, and what didn't fit or load is reported. Then call open_room.",
    inputSchema: {
      type: 'object',
      required: ['opml'],
      additionalProperties: false,
      properties: { opml: { type: 'string', description: 'The OPML file contents (XML)' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const xml = String(args.opml ?? '');
      if (xml.length > OPML_LIMITS.bytes) return toolError(`That OPML file is over ${OPML_LIMITS.bytes / 1_000_000} MB`);
      const { title, feeds } = parseOpml(xml);
      if (!feeds.length) return toolError("No feeds found. Is that an OPML export? It should contain <outline xmlUrl=\"…\"> entries.");
      const before = await ctx.store.get(ctx.userId);
      const have = new Set(before.columns.flatMap((c) => c.panels).map((p) => (p.source === 'rss' ? p.config.url : '')));
      const fresh = feeds.filter((f) => !have.has(f.url));
      const room = LIMITS.columns * LIMITS.portalsPerColumn - (before.onboarded ? before.columns.reduce((n, c) => n + c.panels.length, 0) : 0);
      // Test-load (6 at a time) only as many as could fit, in the file's order.
      const candidates = fresh.slice(0, Math.max(0, room) + 8);
      const loaded = await mapLimit(candidates, 6, async (feed): Promise<{ feed: (typeof feeds)[number]; ok: boolean; error?: string; title?: string }> => {
        const portal = await loadPortal({ id: 'import', source: 'rss', config: { url: feed.url, limit: 10 } }, ctx);
        return portal.error || !portal.items.length ? { feed, ok: false, error: portal.error ?? 'empty feed' } : { feed, ok: true, title: portal.title };
      });
      const working = loaded.filter((l) => l.ok).slice(0, Math.max(0, room));
      const failed = loaded.filter((l) => !l.ok);
      const specs: PortalInput[] = working.map((l) => {
        const title = clean(l.feed.title || l.title, 80);
        return { id: slugId(l.feed.title || l.title || 'feed'), source: 'rss', ...(title ? { title } : {}), config: { url: l.feed.url, limit: 10 } };
      });
      if (!before.onboarded && !specs.length) return toolError(`None of the ${loaded.length} feeds tried loaded (${clean(failed[0]?.error, 120)}).`, 'upstream_error');
      // Group by folder, keeping the order folders first appear in their file.
      const folderOrder = [...new Set(working.map((l) => l.feed.category ?? ''))];
      const byCategory = [...working].sort((a, b) => folderOrder.indexOf(a.feed.category ?? '') - folderOrder.indexOf(b.feed.category ?? ''));
      const ordered = byCategory.map((l) => specs[working.indexOf(l)]!);
      const { profile, addedCount } = await ctx.store.update(ctx.userId, (current) => {
        let profile: Profile;
        if (!current.onboarded) {
          // New user: their reader's folders become the room, in order, over up to 8 columns.
          profile = withLayout(current, { layout: 'shelves', columns: spreadColumns(ordered), onboarded: true });
        } else {
          profile = current;
          for (const spec of specs) {
            const added = addPortalTo(profile, spec);
            if ('error' in added) break;
            profile = added.profile;
          }
        }
        const addedCount = profile.columns.flatMap((c) => c.panels).length - (current.onboarded ? current.columns.flatMap((c) => c.panels).length : 0);
        return { profile, result: { profile, addedCount } };
      });
      const notTried = fresh.length - candidates.length;
      const lines = [
        `Imported ${addedCount} of ${feeds.length} feed(s)${title ? ` from "${title}"` : ''}.`,
        feeds.length - fresh.length ? `${feeds.length - fresh.length} were already in the room.` : '',
        failed.length ? `${failed.length} didn't load: ${failed.slice(0, 5).map((f) => f.feed.title).join(', ')}${failed.length > 5 ? '…' : ''}.` : '',
        notTried > 0 || working.length < loaded.filter((l) => l.ok).length ? 'The room is full, so some feeds were left out; remove portals to make space.' : '',
      ].filter(Boolean);
      return ok(lines.join('\n'), { profile, imported: addedCount, failed: failed.map((f) => ({ url: f.feed.url, title: f.feed.title, error: f.error })), total: feeds.length } satisfies ToolResults['import_opml']);
    },
  },
];
