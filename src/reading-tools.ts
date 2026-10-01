import { validateReadingUpdate, type ReadingUpdate } from './reading.ts';
import { toolError, type ToolDef } from './tools.ts';
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: { reading: value } });
export const READING_TOOLS: ToolDef[] = [
  { name: 'record_reading', title: 'Record reading activity', description: 'Record explicit seen, opened or read activity for one URL. Seen means visible; opened means actually opened; only explicit read means completed. Progress (0–1) never implies read. Heading/block anchors are resume hints. Updates only the caller’s reading history.', inputSchema: { type: 'object', required: ['url', 'status'], additionalProperties: false, properties: { url: { type: 'string' }, status: { enum: ['seen','opened','read'] }, title: { type: 'string', maxLength: 300 }, progress: { type: 'number', minimum: 0, maximum: 1 }, anchor: { type: ['object','null'], additionalProperties: false, properties: { heading: { type: 'string', maxLength: 300 }, block: { type: 'integer', minimum: 0 } } } } }, annotations: { readOnlyHint: false, destructiveHint: false }, async handler(args, ctx) {
    if (!ctx.reading) return toolError('Reading history is unavailable.');
    try { return result(await ctx.reading.record(ctx.userId, validateReadingUpdate(args as unknown as ReadingUpdate))); } catch (error) { return toolError((error as Error).message); }
  } },
  { name: 'get_reading', title: 'Get reading position', description: 'Get the caller’s durable reading state for a URL; fragments share the same URL identity.', inputSchema: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string' } } }, annotations: { readOnlyHint: true }, async handler(args, ctx) {
    if (!ctx.reading) return toolError('Reading history is unavailable.');
    try { return result(await ctx.reading.get(ctx.userId, args.url as string) ?? null); } catch (error) { return toolError((error as Error).message); }
  } },
  { name: 'list_reading', title: 'Continue reading', description: 'List recent unfinished reading (actually opened, not completed), newest opened first. Set unfinished=false to include seen and completed items. At most 100 items per call.', inputSchema: { type: 'object', additionalProperties: false, properties: { unfinished: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, annotations: { readOnlyHint: true }, async handler(args, ctx) {
    if (!ctx.reading) return toolError('Reading history is unavailable.');
    return result(await ctx.reading.list(ctx.userId, { unfinished: args.unfinished !== false, limit: Math.min(100, Number(args.limit) || 20) }));
  } },
];
