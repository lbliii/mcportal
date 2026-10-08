import { COLLECTION_CHANGE_SCHEMA, type Collection, type CollectionChange } from '../collections.ts';
import { changeCollection, collectionData } from '../collection-service.ts';
import { need, ok, ROOM_URI, untrusted, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

/** Model text stays bounded; the UI receives the complete collection contract. */
function collectionText(c: Collection) {
  const value = JSON.stringify({ ...c, entries: c.entries.map(e => ({ ...e, excerpt: e.excerpt?.slice(0,300) })) });
  return value.length <= 24000 ? value : value.slice(0,24000) + '\n… Collection text is capped at 24,000 characters. Use the evidence refs shown above to read individual sources.';
}

export const COLLECTION_TOOLS: ToolDef[] = [{
  name: 'open_collection', title: 'Open a desk or trail', access: 'fetch', cost: 2,
  description: 'Open a private Topic Desk, kept comparison or reading trail by id, with evidence and live sources. Omit id to list collections. Refresh rechecks selected live sources.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', maxLength: 100 }, refresh: { type: 'boolean' } } },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, _meta: { ui: { resourceUri: ROOM_URI } },
  handler: async (args, ctx) => {
    const collections = await need(ctx.collections, 'Collections are not available on this server.').list(ctx.userId);
    const sources = (await ctx.store.get(ctx.userId)).columns.flatMap(c => c.panels).map(p => ({ portalId: p.id, title: p.title || p.id, source: p.source }));
    const desk = typeof args.id === 'string' ? await collectionData(args.id, ctx, args.refresh === true) : undefined;
    return ok(untrusted('Your collections', desk ? collectionText(desk.collection) + '\n' + JSON.stringify({ unavailableRefs: desk.unavailableRefs, unavailablePortals: desk.unavailablePortals, orientationStale: desk.orientationStale, live: desk.live.map(p => ({portalId: p.portalId, title: p.title, error: p.error, items: p.items.slice(0,5).map(i => ({title: i.title, url: i.url}))})) }).slice(0,12000) : JSON.stringify(collections.map(c => ({ id: c.id, title: c.title, kind: c.kind, entries: c.entries.length })))), { collections, sources, ...(desk ? { desk } : {}) } satisfies ToolResults['open_collection']);
  },
}, {
  name: 'update_collection', title: 'Keep and arrange collection material', access: 'write', cost: 1,
  description: 'Create or edit private desks, comparisons (2–3 sources) and trails. Entries use clip:ID or url:URL refs. Remove deletes membership only. Reorder names every ref. Agent orientation needs citations to current entries; never invent source text.',
  inputSchema: COLLECTION_CHANGE_SCHEMA,
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, _meta: { ui: { resourceUri: ROOM_URI } },
  handler: async (args, ctx) => {
    const collection = await changeCollection(args as unknown as CollectionChange, ctx);
    const collections = await need(ctx.collections, 'Collections are not available on this server.').list(ctx.userId);
    return ok(collection ? untrusted('Your collection', collectionText(collection)) : 'Collection removed; its clips, saved items and subscriptions remain.', { collections, ...(collection ? { collection } : {}) } satisfies ToolResults['update_collection']);
  },
}];
