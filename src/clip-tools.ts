/**
 * The clip tools: clip, search_clips, get_clip, update_clip, delete_clip.
 * Clips come only from explicit requests, and everything read back from them is
 * fenced as untrusted: a quote from an article can carry instructions.
 */
import { buildClip, CLIP_KINDS, CLIP_LIMITS, ClipError, clampLimit, queryWords, summaryOf, type Clip, type ClipData, type ClipKind, type ClipSummary } from './clips.ts';
import { clean } from './lib/text.ts';
import { clipsPanel, clipsQuery } from './sources.ts';
import { ensurePanel, toolError, untrusted, WORKSPACE_URI, type CallToolResult, type ToolContext, type ToolDef } from './tools.ts';

const MODEL_TABLE_ROWS = 100;

function ok(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

const noStore = () => toolError('Clips are not available on this server.');

function summaryLine(c: ClipSummary): string {
  const tags = c.tags.length ? ` ${c.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `- [${c.id}] ${c.kind} · ${c.title}${tags} · ${c.createdAt.slice(0, 10)}: ${c.preview}${c.note ? ` (note: ${clean(c.note, 120)})` : ''}`;
}

/** The clip's content as text for the model. */
export function clipText(data: ClipData): string {
  switch (data.kind) {
    case 'quote': return `${data.text}${data.attribution ? `\n— ${data.attribution}` : ''}`;
    case 'exchange': return data.turns.map((t) => `${t.speaker}: ${t.text}`).join('\n\n');
    case 'note': return data.blocks.map((b) => (b.type === 'h' ? `## ${b.text}` : b.type === 'li' ? `- ${b.text}` : b.type === 'quote' ? `> ${b.text}` : b.type === 'pre' ? `\`\`\`\n${b.text}\n\`\`\`` : b.text)).join('\n\n');
    case 'table': {
      const row = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
      const lines = [row(data.columns), row(data.columns.map(() => '---')), ...data.rows.slice(0, MODEL_TABLE_ROWS).map(row)];
      if (data.rows.length > MODEL_TABLE_ROWS) lines.push(`(${data.rows.length - MODEL_TABLE_ROWS} more rows; the clip card shows them all)`);
      return lines.join('\n');
    }
    case 'image': return `[${data.mime} image, ${Math.ceil(Buffer.from(data.data, 'base64').length / 1000)} KB: shown in the clip card]`;
    case 'link': return data.url;
  }
}

function sourceLabel(clip: ClipSummary): string {
  return clip.source.url ?? (clip.source.kind === 'conversation' ? 'a conversation' : clip.source.title ?? 'a clip');
}

/** The clips panels in the layout, rebuilt so the app can redraw them. */
async function clipPanels(ctx: ToolContext, profile: Awaited<ReturnType<ToolContext['store']['get']>>) {
  const specs = profile.columns.flatMap((c) => c.panels).filter((p) => p.source === 'clips');
  return Promise.all(specs.map(async (spec) => clipsPanel(spec, await ctx.clips!.list(ctx.userId, clipsQuery(spec)))));
}

const kindProperty = { type: 'string', enum: CLIP_KINDS };

export const CLIP_TOOLS: ToolDef[] = [
  {
    name: 'clip',
    title: 'Clip to MCPortal',
    description: [
      "Save a snippet from this conversation (or an article) to the user's MCPortal clips. Only when the user asks to clip, save or keep something from the chat; for a link to read later, use save_item.",
      'Pick the kind and fill only its fields:',
      'quote: text (verbatim) and attribution;',
      `exchange: turns [{ speaker: "user" | "assistant" | a name, text }], verbatim, at most ${CLIP_LIMITS.turns};`,
      'note: markdown (headings, paragraphs, lists, code, quotes) for an explanation or summary;',
      `table: a markdown table in table, or columns and rows (at most ${CLIP_LIMITS.columns} × ${CLIP_LIMITS.rows});`,
      `image: svg (markup) or image (a data: URI of a PNG, JPEG or WebP, up to ${CLIP_LIMITS.image / 1000} KB), for a chart or diagram already made in the chat;`,
      'link: url.',
      'Give a short title, the user\'s own words as note if they said why, and tags if they named any. source says where it came from ({ kind: "article", url, title } for an article).',
      'The first clip adds a "Clips" portal to the room if there isn\'t one; say so.',
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
          properties: { kind: { type: 'string', enum: ['conversation', 'article', 'web'] }, url: { type: 'string' }, title: { type: 'string' } },
        },
        text: { type: 'string', description: 'quote' },
        attribution: { type: 'string', description: 'quote: who said it' },
        turns: {
          type: 'array',
          maxItems: CLIP_LIMITS.turns,
          items: { type: 'object', required: ['speaker', 'text'], additionalProperties: false, properties: { speaker: { type: 'string' }, text: { type: 'string' } } },
          description: 'exchange',
        },
        markdown: { type: 'string', description: 'note' },
        table: { type: 'string', description: 'table, as markdown' },
        columns: { type: 'array', items: { type: 'string' }, description: 'table' },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table' },
        svg: { type: 'string', description: 'image, as SVG markup' },
        image: { type: 'string', description: 'image, as a data: URI' },
        url: { type: 'string', description: 'link' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      let clip: Clip;
      try {
        clip = buildClip(args);
        await ctx.clips.add(ctx.userId, clip);
      } catch (error) {
        if (error instanceof ClipError) return toolError(`Not clipped: ${error.message}`);
        throw error;
      }
      const before = await ctx.store.get(ctx.userId);
      const { profile, added } = ensurePanel(before, 'clips', 'Clips');
      if (added) await ctx.store.put(ctx.userId, profile);
      const { count } = await ctx.clips.usage(ctx.userId);
      const summary = summaryOf(clip);
      const text = [
        `Clipped "${clip.title}" (id ${clip.id}, ${clip.kind}). ${count} clip(s).`,
        added ? 'Added a "Clips" portal to the room.' : '',
        untrusted(sourceLabel(clip), summaryLine(summary)),
      ].filter(Boolean).join('\n');
      return ok(text, { clip: summary, profile, layoutChanged: added, panels: await clipPanels(ctx, profile) });
    },
  },
  {
    name: 'search_clips',
    title: 'Search clips',
    description: [
      "Find the user's clips by words, kind or tag, newest first. Returns summaries; use get_clip for the full content.",
      'Use it when the user refers to something from an earlier chat ("that table we made about…", "what did we decide about…").',
    ].join(' '),
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
    annotations: { readOnlyHint: true },
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
    description: "Show one of the user's clips in full, as a card in the conversation (\"show me that table\"). Get the id from search_clips or the Clips portal.",
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: WORKSPACE_URI } },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      const clip = await ctx.clips.get(ctx.userId, String(args.id ?? ''));
      if (!clip) return toolError(`No clip with id "${clean(args.id, 40)}". Use search_clips to find it.`);
      const head = [`${clip.kind} · ${clip.title}`, clip.tags.length ? `tags: ${clip.tags.join(', ')}` : '', clip.note ? `note: ${clip.note}` : '', `clipped ${clip.createdAt}`].filter(Boolean).join('\n');
      return ok(`Showing clip ${clip.id} in a card.\n${untrusted(sourceLabel(clip), `${head}\n\n${clipText(clip.data)}`)}`, { clip });
    },
  },
  {
    name: 'update_clip',
    title: 'Edit a clip',
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
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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
        if (error instanceof ClipError) return toolError(`Not changed: ${error.message}`);
        throw error;
      }
      if (!clip) return toolError(`No clip with id "${clean(args.id, 40)}".`);
      const profile = await ctx.store.get(ctx.userId);
      return ok(`Updated clip ${clip.id}.\n${untrusted(sourceLabel(clip), summaryLine(summaryOf(clip)))}`, { clip: summaryOf(clip), panels: await clipPanels(ctx, profile) });
    },
  },
  {
    name: 'delete_clip',
    title: 'Delete a clip',
    description: "Delete one of the user's clips. Only when the user asks to delete or remove it.",
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      if (!ctx.clips) return noStore();
      const id = String(args.id ?? '');
      const deleted = await ctx.clips.delete(ctx.userId, id);
      const profile = await ctx.store.get(ctx.userId);
      const { count } = await ctx.clips.usage(ctx.userId);
      return ok(deleted ? `Deleted. ${count} clip(s) left.` : `No clip with id "${clean(id, 40)}"; nothing changed.`, { deleted, id, panels: await clipPanels(ctx, profile) });
    },
  },
];

