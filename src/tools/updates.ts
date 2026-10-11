import { hostedUpdateStatus, updateMessage } from '../updates.ts';
import { ok, toolError, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

export const UPDATE_TOOLS: ToolDef[] = [
  {
    name: 'check_updates', title: 'Check MCPortal updates', access: 'fetch',
    description: 'Check the installed MCPortal version and available updates, with an upgrade guide. Checks public version metadata only; never installs software. Use when the user asks to update or reports old UI. refresh=false respects automatic-check preferences.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { refresh: { type: 'boolean', description: 'Explicit check now (default true); false respects automatic checks and the daily cache.' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const update = ctx.updates ? await ctx.updates.check(Boolean(ctx.link?.linked), args.refresh !== false)
        : hostedUpdateStatus(ctx.updateOrigin ?? (ctx.accountUrl ? new URL(ctx.accountUrl).origin : undefined));
      return ok(updateMessage(update), { update } satisfies ToolResults['check_updates']);
    },
  },
  {
    name: 'set_update_preferences', title: 'Update notice preferences', access: 'write',
    description: 'Set automatic public update checks on this local installation, or dismiss the current optional update notice. Never installs software or changes the room.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { automatic: { type: 'boolean' }, dismissedVersion: { type: 'string', pattern: '^\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}$' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
    async handler(args, ctx) {
      if (!ctx.updates) return toolError('Hosted updates are managed by the service. No local update preferences are needed.', 'unavailable');
      const update = await ctx.updates.configure(Boolean(ctx.link?.linked), {
        ...(typeof args.automatic === 'boolean' ? { automatic: args.automatic } : {}),
        ...(typeof args.dismissedVersion === 'string' ? { dismissedVersion: args.dismissedVersion } : {}),
      });
      return ok('Update preferences saved.', { update } satisfies ToolResults['set_update_preferences']);
    },
  },
];
