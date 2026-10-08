/**
 * The clip tools: clip, search_clips, get_clip, update_clip, delete_clip.
 * Clips come only from explicit requests, and everything read back from them is
 * fenced as untrusted: a quote from an article can carry instructions.
 */
import { buildClip, fromContent, CLIP_KINDS, CLIP_LIMITS, clampLimit, clipText, queryWords, summaryOf, type Clip, type ClipKind, type ClipStore, type ClipSummary } from '../clips.ts';
import type { Profile } from '../profile.ts';
import { LOCATOR_SCHEMA } from '../evidence.ts';
import { clean } from '../lib/text.ts';
import { clipsPortal, clipsQuery } from '../sources.ts';
import { ensurePortal } from '../layout.ts';
import { ok, toolError, toolFailure, untrusted, ROOM_URI, type ToolContext, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';


const noStore = () => toolError('Clips are not available on this server.', 'unavailable');

function summaryLine(c: ClipSummary): string {
  const tags = c.tags.length ? ` ${c.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `- [${c.id}] ${c.kind} · ${c.title}${tags} · ${c.createdAt.slice(0, 10)}: ${c.preview}${c.note ? ` (note: ${clean(c.note, 120)})` : ''}`;
}

function sourceLabel(clip: ClipSummary): string {
  return clip.source.url ?? (clip.source.kind === 'conversation' ? 'a conversation' : clip.source.title ?? 'a clip');
}

/** The clips portals in the layout, rebuilt so the app can redraw them. */
async function clipPortals(ctx: ToolContext, clips: ClipStore, profile: Profile) {
  const specs = profile.columns.flatMap((c) => c.panels).filter((p) => p.source === 'clips');
  return Promise.all(specs.map(async (spec) => clipsPortal(spec, await clips.list(ctx.userId, clipsQuery(spec)))));
}

const kindProperty = { type: 'string', enum: CLIP_KINDS };

export const CLIP_TOOLS: ToolDef[] = [
  {
    name: 'clip',
    title: 'Clip to MCPortal',
    access: 'write',
    description: [
      "Keep something from this chat (or an article) in the user's clips, only when they ask to clip or keep it; a link to read later is save_item.",
      'Copy the content verbatim. Give a short title, the user\'s own words as note, and tags if they named any.',
      'The first clip adds a Clips portal to the room; say so.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['kind'],
      additionalProperties: false,
      properties: {
        kind: kindProperty,
        title: { type: 'string', maxLength: CLIP_LIMITS.title },
        note: { type: 'string', description: "Why it's worth keeping, in the user's words" },
        tags: { type: 'array', maxItems: CLIP_LIMITS.tags, items: { type: 'string' } },
        source: {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { type: 'string', enum: ['conversation', 'article', 'web'] }, url: { type: 'string' }, title: { type: 'string' }, locator: LOCATOR_SCHEMA },
          description: 'Where it came from, e.g. { kind: "article", url, title }',
        },
        content: { type: 'string', description: 'Every kind but exchange: the quote; a note in markdown; a markdown table; the link url; an image as SVG markup or a PNG, JPEG or WebP data: URI' },
        attribution: { type: 'string', description: 'quote: who said it' },
        turns: {
          type: 'array',
          maxItems: CLIP_LIMITS.turns,
          items: { type: 'object', required: ['speaker', 'text'], additionalProperties: false, properties: { speaker: { type: 'string' }, text: { type: 'string' } } },
          description: 'exchange: speaker is "user", "assistant" or a name',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      let clip: Clip;
      try {
        clip = await ctx.clips.add(ctx.userId, buildClip(fromContent(args)));
      } catch (error) {
        return toolFailure(error, 'Not clipped: ');
      }
      const { profile, added } = await ctx.store.update(ctx.userId, (before) => {
        const placed = ensurePortal(before, 'clips', 'Clips');
        return placed.added ? { profile: placed.profile, result: placed } : { result: placed };
      });
      const { count } = await ctx.clips.usage(ctx.userId);
      const summary = summaryOf(clip);
      const text = [
        `Clipped "${clip.title}" (id ${clip.id}, ${clip.kind}). ${count} clip(s).`,
        added ? 'Added a "Clips" portal to the room.' : '',
        untrusted(sourceLabel(clip), summaryLine(summary)),
      ].filter(Boolean).join('\n');
      return ok(text, { clip: summary, profile, layoutChanged: added, portals: await clipPortals(ctx, ctx.clips, profile) } satisfies ToolResults['clip']);
    },
  },
  {
    name: 'search_clips',
    title: 'Search clips',
    access: 'read',
    description: "Find the user's clips by words, kind or tag, for things from earlier chats ('that table we made about…'). Returns summaries; get_clip shows one in full.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Words that must all appear (title, note, tags, content)' },
        kind: kindProperty,
        tag: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        before: { type: 'string', description: 'createdAt of the last clip from the previous page' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      const kind = CLIP_KINDS.includes(args.kind as ClipKind) ? (args.kind as ClipKind) : undefined;
      const limit = clampLimit(args.limit, 20, 50);
      const clips = await ctx.clips.list(ctx.userId, {
        kind,
        tag: typeof args.tag === 'string' ? args.tag : undefined,
        query: typeof args.query === 'string' ? args.query : undefined,
        before: typeof args.before === 'string' ? args.before : undefined,
        limit,
      });
      const what = [queryWords(args.query as string | undefined).join(' '), kind, args.tag ? `#${clean(args.tag, 30)}` : ''].filter(Boolean).join(', ');
      if (!clips.length) return ok(`No clips${what ? ` match ${what}` : ' yet'}.`, { clips });
      const more = clips.length === limit ? `\nThere may be more: pass before=${clips[clips.length - 1]!.createdAt}.` : '';
      return ok(`${clips.length} clip(s)${what ? ` matching ${what}` : ''}:\n${untrusted('your clips', clips.map(summaryLine).join('\n'))}${more}`, { clips });
    },
  },
  {
    name: 'get_clip',
    title: 'Show a clip',
    access: 'read',
    description: "Show one of the user's clips in full, as a card in the conversation (\"show me that table\"). Get the id from search_clips or the Clips portal.",
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      const clip = await ctx.clips.get(ctx.userId, String(args.id ?? ''));
      if (!clip) return toolError(`No clip with id "${clean(args.id, 40)}". Use search_clips to find it.`, 'not_found');
      const head = [`${clip.kind} · ${clip.title}`, clip.tags.length ? `tags: ${clip.tags.join(', ')}` : '', clip.note ? `note: ${clip.note}` : '', `clipped ${clip.createdAt}`].filter(Boolean).join('\n');
      return ok(`Showing clip ${clip.id} in a card.\n${untrusted(sourceLabel(clip), `${head}\n\n${clipText(clip.data)}`)}`, { clip } satisfies ToolResults['get_clip']);
    },
  },
  {
    name: 'update_clip',
    title: 'Edit a clip',
    access: 'write',
    description: "Change a clip's title, note or tags. Its content can't change; clip it again instead. tags replaces the whole list.",
    inputSchema: {
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        title: { type: 'string', maxLength: CLIP_LIMITS.title },
        note: { type: 'string', description: 'Empty string removes the note' },
        tags: { type: 'array', maxItems: CLIP_LIMITS.tags, items: { type: 'string' } },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      let clip: Clip | undefined;
      try {
        clip = await ctx.clips.update(ctx.userId, String(args.id ?? ''), {
          title: typeof args.title === 'string' ? args.title : undefined,
          note: typeof args.note === 'string' ? args.note : undefined,
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        });
      } catch (error) {
        return toolFailure(error, 'Not changed: ');
      }
      if (!clip) return toolError(`No clip with id "${clean(args.id, 40)}".`, 'not_found');
      const profile = await ctx.store.get(ctx.userId);
      return ok(`Updated clip ${clip.id}.\n${untrusted(sourceLabel(clip), summaryLine(summaryOf(clip)))}`, { clip: summaryOf(clip), portals: await clipPortals(ctx, ctx.clips, profile) });
    },
  },
  {
    name: 'delete_clip',
    title: 'Delete a clip',
    access: 'write',
    description: "Delete one of the user's clips. Only when the user asks to delete or remove it.",
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      const id = String(args.id ?? '');
      const deleted = await ctx.clips.delete(ctx.userId, id);
      const profile = await ctx.store.get(ctx.userId);
      const { count } = await ctx.clips.usage(ctx.userId);
      return ok(deleted ? `Deleted. ${count} clip(s) left.` : `No clip with id "${clean(id, 40)}"; nothing changed.`, { deleted, id, portals: await clipPortals(ctx, ctx.clips, profile) });
    },
  },
];
