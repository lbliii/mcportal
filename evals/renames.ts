/**
 * How the tool interface changed, so frozen eval cases (evals/tool-selection.ts) keep
 * their meaning across versions. A case expecting a tool the current server doesn't
 * offer is judged against what replaced it. Declare every rename or replacement here,
 * with the version it shipped in; never edit the cases instead.
 */
export interface Rename {
  /** The version that made the change. */
  version: string;
  /** The tool a case may expect. */
  from: string;
  /** What now does its job (any of these is right). */
  to: string[];
  /** Expected-argument names that changed with it: old name → new name (or null: no longer checked). */
  args?: Record<string, string | null>;
}

export const RENAMES: Rename[] = [
  // Edit by patch: the room and its ids come from open_room; each change is named.
  { version: '0.5.0', from: 'get_profile', to: ['open_room', 'arrange_room', 'remove_portal'] },
  { version: '0.5.0', from: 'update_profile', to: ['arrange_room', 'remove_portal'], args: { removePortalIds: 'portals' } },
];
