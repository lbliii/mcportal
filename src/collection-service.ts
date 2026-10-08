import type { Collection, CollectionChange, CollectionEntry } from './collections.ts';
import { evidenceRef } from './collections.ts';
import { AppError } from './lib/errors.ts';
import { need, type ToolContext } from './tools/kit.ts';
import { portalFor } from './tools/room.ts';
import type { PortalResult } from './types.ts';

export interface CollectionData { collection: Collection; unavailableRefs: string[]; unavailablePortals: string[]; orientationStale: boolean; live: PortalResult[] }
export async function changeCollection(input: CollectionChange, ctx: ToolContext): Promise<Collection | undefined> {
  const store = need(ctx.collections, 'Collections are not available on this server.');
  const next = structuredClone(input);
  if (next.entries) {
    for (const e of next.entries) {
      e.ref = evidenceRef(e.ref);
      if (e.ref.startsWith('clip:')) {
        const clip = await ctx.clips?.get(ctx.userId, e.ref.slice(5));
        if (!clip) throw new AppError('not_found', 'A selected clip is unavailable in your account.');
        delete e.excerpt;
        if (clip.source.url) e.url = clip.source.url;
        else delete e.url;
        if (clip.source.locator) e.locator = clip.source.locator;
        else delete e.locator;
      }
    }
  }
  if (next.livePortals) {
    const known = new Set((await ctx.store.get(ctx.userId)).columns.flatMap(c => c.panels).map(p => p.id));
    if (next.livePortals.some(id => !known.has(id))) throw new AppError('not_found', 'Choose live sources from your current room.');
  }
  return store.change(ctx.userId, next);
}
export async function collectionData(id: string, ctx: ToolContext, refresh = false): Promise<CollectionData> {
  const collection = await need(ctx.collections, 'Collections are not available on this server.').get(ctx.userId, id);
  if (!collection) throw new AppError('not_found', 'This collection is unavailable.');
  const unavailableRefs: string[] = [];
  let changedEvidence = false;
  await Promise.all(collection.entries.filter(e => e.ref.startsWith('clip:')).map(async e => {
    const clip = await ctx.clips?.get(ctx.userId, e.ref.slice(5));
    if (!clip) unavailableRefs.push(e.ref);
    else if (collection.orientation?.refs.includes(e.ref) && clip.updatedAt > collection.orientation.createdAt) changedEvidence = true;
  }));
  const profile = await ctx.store.get(ctx.userId), specs = profile.columns.flatMap(c => c.panels);
  const unavailablePortals = collection.livePortals.filter(id => !specs.some(p => p.id === id));
  const live = await Promise.all(collection.livePortals.map(id => specs.find(p => p.id === id)).filter(p => p !== undefined).map(p => portalFor(p, profile, ctx, refresh)));
  const refs = new Set(collection.entries.map(e => e.ref));
  return { collection, unavailableRefs: unavailableRefs.sort(), unavailablePortals, live, orientationStale: changedEvidence || Boolean(collection.orientation?.refs.some(ref => !refs.has(ref) || unavailableRefs.includes(ref) || collection.entries.some(e => e.ref === ref && e.addedAt > collection.orientation!.createdAt))) };
}
export function entryUrl(e: CollectionEntry): string | undefined { return e.ref.startsWith('url:') ? e.ref.slice(4) : undefined; }
