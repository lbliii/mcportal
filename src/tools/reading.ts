/**
 * Reading history tools: record_reading, get_reading, list_reading (docs/reading-state.md).
 * They touch only the caller's own history, and only on explicit signals: seen, opened, read.
 */
import { validateReadingUpdate, type ReadingUpdate } from '../reading.ts';
import { ok, toolError, toolFailure, type CallToolResult, type ToolDef } from './kit.ts';

const NO_HISTORY = 'Reading history is unavailable.';

function result(value: unknown): CallToolResult {
  return ok(JSON.stringify(value), { reading: value });
}

export const READING_TOOLS: ToolDef[] = [
  {
    name: 'record_reading',
    title: 'Record reading activity',
    access: 'write',
    description: [
      'Record explicit seen, opened or read activity for one URL. Seen means visible; opened means actually opened; only explicit read means completed.',
      'Progress (0–1) never implies read. Heading/block anchors are resume hints. Updates only the caller’s reading history.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['url', 'status'],
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        status: { enum: ['seen', 'opened', 'read'] },
        title: { type: 'string', maxLength: 300 },
        progress: { type: 'number', minimum: 0, maximum: 1 },
        anchor: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: { heading: { type: 'string', maxLength: 300 }, block: { type: 'integer', minimum: 0 } },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const reading = ctx.reading;
      if (!reading) return toolError(NO_HISTORY, 'unavailable');
      try {
        return result(await reading.record(ctx.userId, validateReadingUpdate(args as unknown as ReadingUpdate)));
      } catch (error) {
        return toolFailure(error);
      }
    },
  },
  {
    name: 'get_reading',
    title: 'Get reading position',
    access: 'read',
    description: 'Get the caller’s durable reading state for a URL; fragments share the same URL identity.',
    inputSchema: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string' } } },
    annotations: { readOnlyHint: true },
    async handler(args, ctx) {
      const reading = ctx.reading;
      if (!reading) return toolError(NO_HISTORY, 'unavailable');
      try {
        return result((await reading.get(ctx.userId, String(args.url ?? ''))) ?? null);
      } catch (error) {
        return toolFailure(error);
      }
    },
  },
  {
    name: 'list_reading',
    title: 'Continue reading',
    access: 'read',
    description: 'List recent unfinished reading (actually opened, not completed), newest opened first. Set unfinished=false to include seen and completed items. At most 100 items per call.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { unfinished: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    annotations: { readOnlyHint: true },
    async handler(args, ctx) {
      const reading = ctx.reading;
      if (!reading) return toolError(NO_HISTORY, 'unavailable');
      return result(await reading.list(ctx.userId, { unfinished: args.unfinished !== false, limit: Math.min(100, Number(args.limit) || 20) }));
    },
  },
];
