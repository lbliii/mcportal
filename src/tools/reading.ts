/**
 * Reading history tools: record_reading, get_reading, list_reading (docs/reading-state.md).
 * They touch only the caller's own history, and only on explicit signals: seen, opened, read.
 * The room's reader records and resumes reading (record_reading, get_reading are app-only);
 * the model asks what the user was reading (list_reading).
 */
import { validateReadingUpdate, type ReadingUpdate } from '../reading.ts';
import { ok, toolError, toolFailure, ROOM_URI, type CallToolResult, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

const NO_HISTORY = 'Reading history is unavailable.';

function result<K extends 'record_reading' | 'get_reading' | 'list_reading'>(value: ToolResults[K]['reading']): CallToolResult {
  return ok(JSON.stringify(value), { reading: value });
}

export const READING_TOOLS: ToolDef[] = [
  {
    name: 'record_reading',
    title: 'Record reading activity',
    access: 'write',
    description: [
      "The room's reader records what the user does with one URL: seen (visible), opened (actually opened), read (only when they mark it read).",
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
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI, visibility: ['app'] } },
    async handler(args, ctx) {
      const reading = ctx.reading;
      if (!reading) return toolError(NO_HISTORY, 'unavailable');
      try {
        return result<'record_reading'>(await reading.record(ctx.userId, validateReadingUpdate(args as unknown as ReadingUpdate)));
      } catch (error) {
        return toolFailure(error);
      }
    },
  },
  {
    name: 'get_reading',
    title: 'Get reading position',
    access: 'read',
    description: 'Where the user left off in a URL, so the reader can resume there; fragments share the same URL identity.',
    inputSchema: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI, visibility: ['app'] } },
    async handler(args, ctx) {
      const reading = ctx.reading;
      if (!reading) return toolError(NO_HISTORY, 'unavailable');
      try {
        return result<'get_reading'>((await reading.get(ctx.userId, String(args.url ?? ''))) ?? null);
      } catch (error) {
        return toolFailure(error);
      }
    },
  },
  {
    name: 'list_reading',
    title: 'Continue reading',
    access: 'read',
    description: "What the user was reading: pages they opened and haven't finished, most recent first ('what was I in the middle of?').",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { unfinished: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const reading = ctx.reading;
      if (!reading) return toolError(NO_HISTORY, 'unavailable');
      return result<'list_reading'>(await reading.list(ctx.userId, { unfinished: args.unfinished !== false, limit: Math.min(100, Number(args.limit) || 20) }));
    },
  },
];
