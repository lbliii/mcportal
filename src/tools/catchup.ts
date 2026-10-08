import { CATCHUP_SCHEMA, catchup, type CatchupInput } from '../catchup.ts';
import { ok, ROOM_URI, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';
export const CATCHUP_TOOLS: ToolDef[] = [{ name: 'catch_up', title: 'A finite reading session', description: 'Start or resume a bounded session of currently retrieved unseen stories. Finish acknowledges only its captured set; it never marks articles read.', access: 'write', cost: 2,
  inputSchema: CATCHUP_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, _meta: { ui: { resourceUri: ROOM_URI, visibility: ['app'] } },
  handler: async (args, ctx) => {
    const session = ctx.catchup ? await ctx.catchup(args as unknown as CatchupInput) : await catchup(args as unknown as CatchupInput, ctx);
    return ok(session ? `${session.cursor}/${session.stories.length} stories${session.finishedAt ? '; session finished' : ''}.` : 'No active session.', { session } satisfies ToolResults['catch_up']);
  },
}];
