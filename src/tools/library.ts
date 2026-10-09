import { LIBRARY_COVERAGE, LIBRARY_SCHEMA, searchLibrary, type LibraryQuery } from '../library.ts';
import { ok, ROOM_URI, untrusted, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

export const LIBRARY_TOOLS: ToolDef[] = [{
  name: 'search_library', title: 'Find kept material', access: 'read', cost: 1,
  description: 'Find saved links, clips and reading history together; opens Recall Shelf. Searches retained text and metadata without fetching pages. Filter by kind, site, tag or reading status; offset pages results.',
  inputSchema: LIBRARY_SCHEMA,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { resourceUri: ROOM_URI } },
  handler: async (args, ctx) => {
    const library = ctx.library ? await ctx.library.search(ctx.userId, args as LibraryQuery) : await searchLibrary(ctx.userId, args as LibraryQuery, ctx);
    const text = library.hits.map(h => `${h.ref} | ${h.clipKind ?? (h.saved ? 'saved link' : 'reading')} | ${h.title} | ${h.source} | ${h.excerpt}${h.url ? ` | ${h.url}` : ''}`).join('\n');
    return ok(`${library.total} match(es). ${library.coverage ?? LIBRARY_COVERAGE}${library.effectiveQuery ? ` No literal matches; searched keywords: ${library.effectiveQuery}.` : ''}${library.nextOffset !== null ? ` Next offset: ${library.nextOffset}.` : ''}\n${untrusted('Your retained material', text)}`, { library } satisfies ToolResults['search_library']);
  },
}];
