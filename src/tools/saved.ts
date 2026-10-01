/**
 * What the user keeps: save_item and remove_saved (bookmarks), and pin_portal (items
 * the agent brought from another tool). Both live in the profile and are never fetched.
 */
import { clean } from '../lib/text.ts';
import { addPortalTo, columnOf, ensurePortal, slugId, withLayout } from '../layout.ts';
import { describeLayout, findPortal, findSavedPortal, httpUrl, LIMITS, normalizePinnedItems, validateProfile, type PinnedConfig, type Profile, type SavedItem } from '../profile.ts';
import { pinnedPortal, savedPortal } from '../sources.ts';
import type { ProfileChange } from '../store.ts';
import { ok, toolError, toolFailure, untrusted, type CallToolResult, type ToolDef } from './kit.ts';

/** What the saving tools return: the model gets a fenced summary, the app gets state to redraw. */
function savedResult(text: string, profile: Profile, layoutChanged: boolean): CallToolResult {
  const spec = findSavedPortal(profile);
  return ok(text, { saved: profile.saved, profile, layoutChanged, portal: spec ? savedPortal(spec, profile.saved) : null });
}

export const SAVED_TOOLS: ToolDef[] = [
  {
    name: 'save_item',
    title: 'Save to MCPortal',
    access: 'write',
    description: [
      "Save a link to the user's MCPortal (a bookmark), or update the title or note of one already saved.",
      'Use when the user asks to save, bookmark, favorite, or keep something for later. Newest first; at most 200 (the oldest drop off).',
      'The first save adds a "Saved" portal to the room if there isn\'t one; say so.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'http(s) URL' },
        title: { type: 'string', description: 'Short title; defaults to the site name' },
        note: { type: 'string', description: "Optional note in the user's words" },
        source: { type: 'string', description: 'Where it came from, e.g. hn, rss, github' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const url = httpUrl(args.url);
      if (!url) return toolError('save_item needs an http(s) "url"');
      const { profile, added, existing } = await ctx.store.update(ctx.userId, (before) => {
        const existing = before.saved.find((s) => s.url === url);
        const entry: Record<string, unknown> = {
          ...existing,
          url,
          title: args.title ?? existing?.title,
          note: args.note ?? existing?.note,
          source: args.source ?? existing?.source,
          savedAt: existing?.savedAt ?? new Date().toISOString(),
        };
        const withItem = validateProfile({ ...before, saved: [entry, ...before.saved.filter((s) => s.url !== url)] });
        const { profile, added } = ensurePortal(withItem, 'saved', 'Saved');
        return { profile, result: { profile, added, existing } };
      });
      const item = profile.saved[0] as SavedItem;
      const text = [
        existing ? 'Updated a saved item.' : `Saved. ${profile.saved.length} saved item(s).`,
        added ? 'Added a "Saved" portal to the room.' : '',
        untrusted(item.url, `title: ${item.title}${item.note ? `\nnote: ${item.note}` : ''}`),
      ].filter(Boolean).join('\n');
      return savedResult(text, profile, added);
    },
  },
  {
    name: 'remove_saved',
    title: 'Remove a saved item',
    access: 'write',
    description: "Remove one link from the user's saved items. Only when the user asks to remove, unsave, or delete it.",
    inputSchema: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      const url = httpUrl(args.url);
      if (!url) return toolError('remove_saved needs an http(s) "url"');
      const { profile, removed } = await ctx.store.update(ctx.userId, (before) => {
        if (!before.saved.some((s) => s.url === url)) return { result: { profile: before, removed: false } };
        const profile = { ...before, saved: before.saved.filter((s) => s.url !== url), updatedAt: new Date().toISOString() };
        return { profile, result: { profile, removed: true } };
      });
      if (!removed) return savedResult('That link was not saved; nothing changed.', profile, false);
      return savedResult(`Removed. ${profile.saved.length} saved item(s) left.`, profile, false);
    },
  },
  {
    name: 'pin_portal',
    title: 'Pin results from another tool',
    access: 'write',
    description: [
      "Show results from another tool the user has connected (Jira, Slack, Confluence, Drive, GitLab, a database, …) as a portal in their room.",
      'You fetch the data with that tool, then pass the items here: MCPortal stores and shows them and never contacts the other service.',
      'Keep each item short: a title, its link if there is one, a one-line summary, and up to 4 meta tags (status, assignee, priority).',
      '"recipe" says how to fetch the items again in plain words (tool name and arguments), so the portal can be refreshed.',
      'To refresh a pinned portal (e.g. the user asks, or presses its refresh button), read its recipe from get_profile (config.recipe), run it,',
      'and call pin_portal with its portalId and the new items. A new portal only adds: nothing else moves, and it refuses duplicates.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['items'],
      additionalProperties: false,
      properties: {
        portalId: { type: 'string', description: 'Refresh this pinned portal instead of adding one.' },
        title: { type: 'string', description: 'Portal title, e.g. "My open bugs". Required for a new portal.' },
        from: { type: 'string', description: 'Where the items come from, e.g. "Jira". Required for a new portal.' },
        recipe: {
          type: 'string',
          description: 'How to fetch the items again, e.g. "jira_search with jql: assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC". Required for a new portal.',
        },
        items: {
          type: 'array',
          description: `Up to ${LIMITS.items}; more, or items without a title, are left out (the result says how many).`,
          items: {
            type: 'object',
            required: ['title'],
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              url: { type: 'string', description: 'http(s) link to the item' },
              summary: { type: 'string', description: 'One line' },
              meta: { type: 'array', items: { type: 'string' }, description: 'Up to 4 short tags: status, assignee, priority' },
              publishedAt: { type: 'string', description: 'ISO date the item was created or last updated' },
            },
          },
        },
        column: { type: 'integer', minimum: 1, maximum: 8, description: 'New portals only; pass it only if the user said where.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      if (!Array.isArray(args.items)) return toolError('pin_portal needs "items" (an empty list is fine)');
      const items = normalizePinnedItems(args.items);
      const pin = { items, pinnedAt: new Date().toISOString() };
      const title = clean(args.title, 80);
      const from = clean(args.from, 40);
      const recipe = clean(args.recipe, 500);
      const refreshing = args.portalId !== undefined;
      if (!refreshing && (!title || !from || !recipe)) return toolError('A new pinned portal needs "title", "from" and "recipe". To refresh one, pass its portalId.');
      let outcome: { profile: Profile; portalId: string } | { refused: CallToolResult };
      try {
        outcome = await ctx.store.update(ctx.userId, (before): ProfileChange<typeof outcome> => {
          if (refreshing) {
            const portalId = String(args.portalId);
            const spec = findPortal(before, portalId);
            if (!spec || spec.source !== 'pinned') return { result: { refused: toolError(`No pinned portal with id "${clean(args.portalId, 60)}". Leave out portalId to add a new one.`, 'not_found') } };
            const config = { ...spec.config, ...(from ? { from: args.from } : {}), ...(recipe ? { recipe: args.recipe } : {}) };
            const columns = before.columns.map((c) => ({ ...c, panels: c.panels.map((p) => (p.id === portalId ? { ...p, title: title || spec.title, config } : p)) }));
            const profile = withLayout(before, { columns, pins: { ...before.pins, [portalId]: pin } });
            return { profile, result: { profile, portalId } };
          }
          const added = addPortalTo(before, { id: slugId(title), source: 'pinned', title, config: { from, recipe } }, typeof args.column === 'number' ? args.column : undefined);
          if ('error' in added) return { result: { refused: toolError(`Not pinned: ${added.error}${added.code === 'conflict' ? ' To refresh it, pass that portalId.' : ''}`, added.code) } };
          const profile = { ...added.profile, pins: { ...added.profile.pins, [added.portalId]: pin } };
          return { profile, result: { profile, portalId: added.portalId } };
        });
      } catch (error) {
        return toolFailure(error, 'Not pinned: ');
      }
      if ('refused' in outcome) return outcome.refused;
      const { profile, portalId } = outcome;
      const portal = pinnedPortal(findPortal(profile, portalId)!, profile.pins);
      const { from: source } = findPortal(profile, portalId)!.config as unknown as PinnedConfig;
      const dropped = args.items.length - items.length;
      const text = refreshing
        ? `Refreshed "${portal.title}" (id ${portalId}): ${items.length} items from ${source}.`
        : `Pinned "${portal.title}" (id ${portalId}) in column ${columnOf(profile, portalId)}: ${items.length} items from ${source}.\nLayout now: ${describeLayout(profile)}`;
      return ok(`${text}${dropped > 0 ? `\n${dropped} item(s) were left out (no title, or over ${LIMITS.items}).` : ''}`, { profile, portal, portalId });
    },
  },
];
