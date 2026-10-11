/**
 * Plate tools (lab `plates`, docs/plans/plates.md): show_plate draws an agent-specified
 * illustration in the room; get_lens returns the caller's data shaped to be drawn, with
 * no room UI, so hosts that draw their own answers can.
 */
import { LENS_OUTPUT_SCHEMA, LENSES, lensText, readingActivity } from '../lenses.ts';
import { AppError } from '../lib/errors.ts';
import { PLATE_SCHEMA, plateFrom, plateText, type PlateInput } from '../plates.ts';
import { labOn, ok, toolFailure, ROOM_URI, type ToolContext, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

const inLab = (reach: { labs: readonly string[] }) => reach.labs.includes('plates');
function requireLab(ctx: ToolContext) {
  if (!labOn(ctx, 'plates')) throw new AppError('unavailable', 'Plates are a lab that is off on this server (MCPORTAL_LABS=plates turns it on).');
}

export const PLATE_TOOLS: ToolDef[] = [
  {
    name: 'show_plate',
    title: 'Show a plate',
    access: 'read',
    description: [
      'Draw an illustration you design in the MCPortal room: series (line/bar over dates or categories), timeline (dated entries), steps (a flow or argument) or matrix (rows × columns with good/mixed/poor marks).',
      'Use it when a picture explains reading, clips or MCPortal data better than prose. Labels are your words; cite the user\'s material as refs (clip:ID or url:URL).',
      'It is shown as agent illustration and is temporary. The text result is the plate in words, for hosts without the room.',
    ].join(' '),
    inputSchema: PLATE_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: ROOM_URI } },
    available: inLab,
    async handler(args, ctx) {
      try {
        requireLab(ctx);
        const plate = await plateFrom(args as unknown as PlateInput, ctx);
        return ok(plateText(plate), { plate } satisfies ToolResults['show_plate']);
      } catch (error) {
        return toolFailure(error, 'Plate not shown: ');
      }
    },
  },
  {
    name: 'get_lens',
    title: 'Get a lens on your data',
    access: 'read',
    description: [
      "The user's MCPortal data shaped to be drawn. reading_activity: pages opened, marked read and clips kept per week, plus most opened sites.",
      'Draw it with your own charts if you can. Otherwise pass lens.plate to show_plate, or summarize the text.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['lens'],
      additionalProperties: false,
      properties: {
        lens: { enum: LENSES },
        weeks: { type: 'integer', minimum: 4, maximum: 26, description: 'Default 12.' },
      },
    },
    outputSchema: LENS_OUTPUT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    available: inLab,
    async handler(args, ctx) {
      try {
        requireLab(ctx);
        const lens = await readingActivity(ctx, typeof args.weeks === 'number' ? args.weeks : 12);
        return ok(lensText(lens), { lens } satisfies ToolResults['get_lens']);
      } catch (error) {
        return toolFailure(error, 'No lens: ');
      }
    },
  },
];
