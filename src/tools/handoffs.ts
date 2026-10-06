/**
 * The handoff tools: create_handoff (the room app) and open_handoff (the model, in the
 * new chat). See src/handoffs.ts and docs/explanation/reading.md, phase 2.
 */
import { HANDOFF_DAYS, normalizeCode, type Handoff } from '../handoffs.ts';
import { DOCS_TOOLS } from './docs.ts';
import { ok, toolError, toolFailure, untrusted, ROOM_URI, type CallToolResult, type ToolContext, type ToolDef } from './kit.ts';
import { READER_TOOLS } from './reader.ts';
import type { ToolResults } from './results.ts';

const NO_STORE = 'Handoffs are not available on this server.';
const tool = (tools: ToolDef[], name: string) => tools.find((t) => t.name === name)!;
const readArticle = tool(READER_TOOLS, 'read_article');
const openDocs = tool(DOCS_TOOLS, 'open_docs');
const readDocPage = tool(DOCS_TOOLS, 'read_doc_page');

/** The prompt the user says in a new chat. Only the code: no titles, nothing the site wrote. */
export const handoffPrompt = (code: string) => `Open MCPortal handoff ${code}`;

/** The page as read_article or open_docs + read_doc_page would show it. */
async function readPage(h: Handoff, ctx: ToolContext): Promise<{ text: string; view: Record<string, unknown> } | CallToolResult> {
  if (h.place.kind === 'article') {
    const read = await readArticle.handler({ url: h.url }, ctx);
    if (read.isError) return read;
    return { text: read.content[0]?.text ?? '', view: read.structuredContent ?? {} };
  }
  // Prefer the portal it came from; if that's gone, the docs address.
  const tries = [h.place.portalId ? { portalId: h.place.portalId } : null, h.place.docs ? { docs: h.place.docs } : null].filter((t) => t !== null);
  let last: CallToolResult | undefined;
  for (const site of tries) {
    const opened = await openDocs.handler(site, ctx);
    if (opened.isError) { last = opened; continue; }
    const page = await readDocPage.handler({ url: h.url, ...site }, ctx);
    if (page.isError) return page;
    return { text: page.content[0]?.text ?? '', view: { ...opened.structuredContent, page: h.url } };
  }
  return last ?? toolError('That handoff names no docs site.', 'invalid_argument');
}

export const HANDOFF_TOOLS: ToolDef[] = [
  {
    name: 'open_handoff',
    title: 'Open a handoff',
    access: 'fetch',
    cost: 3,
    description: "Open a page the user sent here from MCPortal's reader (they say \"Open MCPortal handoff k7q2xm\"): shows it as a card where they were reading, with any passage they selected, and gives you its text. Without a code, opens the newest one they haven't opened.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { code: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },   // it notes the handoff was opened, nothing the user made
    _meta: { ui: { resourceUri: ROOM_URI } },
    async handler(args, ctx) {
      if (!ctx.handoffs) return toolError(NO_STORE, 'unavailable');
      const code = normalizeCode(args.code);
      const waiting = await ctx.handoffs.list(ctx.userId);
      const handoff = code ? waiting.find((h) => h.code === code) : waiting.find((h) => !h.openedAt) ?? waiting[0];
      if (!handoff) {
        return toolError(code
          ? `There's no handoff ${code} (they last ${HANDOFF_DAYS} days). In MCPortal's reader or docs, "Send to a new chat" makes one.`
          : `No handoffs are waiting. In MCPortal's reader or docs, "Send to a new chat" makes one.`, 'not_found');
      }
      let page: Awaited<ReturnType<typeof readPage>>;
      try {
        page = await readPage(handoff, ctx);
      } catch (error) {
        return toolFailure(error, `Could not open handoff ${handoff.code}: `);
      }
      if (!('view' in page)) return page;   // a refusal from the reader or the docs tools
      await ctx.handoffs.markOpened(ctx.userId, handoff.code);
      const others = waiting.filter((h) => h.code !== handoff.code).map((h) => h.code);
      const text = [
        `The user sent this page from MCPortal to talk about it in this chat (handoff ${handoff.code}).${handoff.anchor?.heading ? ' They were reading the part under the heading quoted below.' : ''}`,
        handoff.passage || handoff.anchor?.heading
          ? untrusted(handoff.url, [handoff.anchor?.heading ? `heading: ${handoff.anchor.heading}` : '', handoff.passage ? `the passage they selected:\n${handoff.passage}` : ''].filter(Boolean).join('\n'))
          : '',
        page.text,
        others.length ? `Other handoffs waiting: ${others.join(', ')}.` : '',
      ].filter(Boolean).join('\n\n');
      return ok(text, { ...page.view, handoff: { ...handoff, openedAt: new Date().toISOString() } } as ToolResults['open_handoff']);
    },
  },
  {
    name: 'create_handoff',
    title: 'Send to a new chat',
    access: 'write',
    description: "The room's reader stores a page (and the passage the user selected) under a short code, to open in a new chat with open_handoff.",
    inputSchema: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        title: { type: 'string', maxLength: 300 },
        place: {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { enum: ['article', 'docs'] }, portalId: { type: 'string' }, docs: { type: 'string' } },
        },
        anchor: { type: 'object', additionalProperties: false, properties: { block: { type: 'integer', minimum: 0 }, heading: { type: 'string', maxLength: 300 } } },
        passage: { type: 'string', maxLength: 4000 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI, visibility: ['app'] } },
    async handler(args, ctx) {
      if (!ctx.handoffs) return toolError(NO_STORE, 'unavailable');
      try {
        const handoff = await ctx.handoffs.create(ctx.userId, args as never);
        const prompt = handoffPrompt(handoff.code);
        return ok(`Handoff ${handoff.code}: in a new chat, say "${prompt}".`, { handoff, prompt } satisfies ToolResults['create_handoff']);
      } catch (error) {
        return toolFailure(error, 'Not sent: ');
      }
    },
  },
];
