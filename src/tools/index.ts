/**
 * Every MCP tool, in the order tools/list shows them. Each module owns one area;
 * src/tools/kit.ts is what they share.
 */
import type { Action } from '../access.ts';
import { ACCOUNT_TOOLS } from './account.ts';
import { CLIP_TOOLS } from './clips.ts';
import { DOCS_TOOLS } from './docs.ts';
import { HANDOFF_TOOLS } from './handoffs.ts';
import type { ToolDef } from './kit.ts';
import { READER_TOOLS } from './reader.ts';
import { READING_TOOLS } from './reading.ts';
import { ROOM_TOOLS } from './room.ts';
import { SAVED_TOOLS } from './saved.ts';
import { SOCIAL_TOOLS } from './social.ts';
import { SOURCE_TOOLS } from './sources.ts';

export const TOOLS: readonly ToolDef[] = [
  ...ROOM_TOOLS,
  ...SOURCE_TOOLS,
  ...READER_TOOLS,
  ...SAVED_TOOLS,
  ...DOCS_TOOLS,
  ...HANDOFF_TOOLS,
  ...CLIP_TOOLS,
  ...ACCOUNT_TOOLS,
  ...SOCIAL_TOOLS,
  ...READING_TOOLS,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function findTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

/** What a tool does, for the access gate. Unknown tools are treated as writes. */
export function toolAction(name: string): Action {
  return BY_NAME.get(name)?.access ?? 'write';
}

/** Budget units for one call: the tool's declared cost, else 1. */
export function toolCost(name: string, args: Record<string, unknown>): number {
  const cost = BY_NAME.get(name)?.cost;
  return typeof cost === 'function' ? cost(args) : (cost ?? 1);
}
