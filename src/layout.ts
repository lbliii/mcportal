/**
 * Changing a room's layout without disturbing what the user arranged. Every function
 * here only adds or rebuilds what it's asked to: none moves or removes the user's
 * other portals, and saved items always pass through untouched.
 */
import type { ErrorCode } from './lib/errors.ts';
import { findPortal, LIMITS, validateProfile, type ColumnInput, type PortalInput, type PortalSpec, type Profile } from './profile.ts';

/** A portal id from a title: lowercase words joined by dashes. */
export function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'portal';
}

/**
 * The profile with `changes` applied and validated. Saved items are kept exactly as
 * they were: validation normalizes the layout, never the user's bookmarks.
 */
export function withLayout(profile: Profile, changes: Omit<Partial<Profile>, 'columns'> & { columns?: ColumnInput[] }): Profile {
  return { ...validateProfile({ ...profile, ...changes }), saved: profile.saved };
}

/** Portals in order, spread evenly over at most the column limit (a fresh room from packs or an import). */
export function spreadColumns(portals: PortalInput[]): ColumnInput[] {
  const perColumn = Math.ceil(portals.length / LIMITS.columns);
  const columns: ColumnInput[] = [];
  for (let i = 0; i < portals.length; i += perColumn) columns.push({ width: 1, panels: portals.slice(i, i + perColumn) });
  return columns;
}

/** The 1-based column a portal is in, or 0. */
export function columnOf(profile: Profile, portalId: string): number {
  return profile.columns.findIndex((c) => c.panels.some((p) => p.id === portalId)) + 1;
}

/**
 * Put a Saved (or Clips, or Following) portal in the layout the first time it's needed,
 * so what the user saved visibly lands somewhere.
 */
export function ensurePortal(profile: Profile, source: 'saved' | 'clips' | 'following', title: string): { profile: Profile; added: boolean } {
  if (profile.columns.some((c) => c.panels.some((p) => p.source === source))) return { profile, added: false };
  const portal: PortalSpec = { id: source, source, title, config: { limit: LIMITS.items } };
  while (findPortal(profile, portal.id)) portal.id += '-2';
  const columns = profile.columns.map((c) => ({ ...c, panels: [...c.panels] }));
  const last = columns[columns.length - 1];
  if (columns.length < LIMITS.columns) columns.push({ width: 1, panels: [portal] });
  else if (last && last.panels.length < LIMITS.portalsPerColumn) last.panels.push(portal);
  else return { profile, added: false };
  return { profile: { ...profile, columns }, added: true };
}

/**
 * Add one portal: into `column` (1-based; one past the last makes a new column),
 * else a new column, else the emptiest column. Refuses duplicates and full rooms.
 */
export function addPortalTo(profile: Profile, spec: PortalInput, column?: number): { profile: Profile; portalId: string } | { error: string; code: ErrorCode } {
  const key = (p: PortalSpec) => `${p.source}:${JSON.stringify({ ...p.config, limit: undefined })}`;
  const probe = validateProfile({ ...profile, columns: [{ panels: [spec] }] }).columns[0]!.panels[0]!;
  const dupe = profile.columns.flatMap((c) => c.panels).find((p) => key(p) === key(probe));
  if (dupe) return { error: `That source is already in the room as "${dupe.title ?? dupe.id}" (id ${dupe.id}).`, code: 'conflict' };

  const columns: ColumnInput[] = profile.columns.map((c) => ({ ...c, panels: [...c.panels] }));
  const n = columns.length;
  if (column !== undefined) {
    const target = columns[column - 1];
    if (target) {
      if (target.panels.length >= LIMITS.portalsPerColumn) return { error: `Column ${column} is full (${LIMITS.portalsPerColumn} portals).`, code: 'limit_exceeded' };
      target.panels.push(spec);
    } else if (column === n + 1 && n < LIMITS.columns) columns.push({ width: 1, panels: [spec] });
    else return { error: `column must be between 1 and ${Math.min(n + 1, LIMITS.columns)}`, code: 'invalid_argument' };
  } else if (n < LIMITS.columns) columns.push({ width: 1, panels: [spec] });
  else {
    const target = columns.reduce((best, c) => (c.panels.length < best.panels.length ? c : best));
    if (target.panels.length >= LIMITS.portalsPerColumn) return { error: `The room is full (${LIMITS.columns} columns of ${LIMITS.portalsPerColumn} portals). Remove a portal first.`, code: 'limit_exceeded' };
    target.panels.push(spec);
  }
  const before = new Set(profile.columns.flatMap((c) => c.panels).map((p) => p.id));
  const next = withLayout(profile, { columns });
  const portalId = next.columns.flatMap((c) => c.panels).find((p) => !before.has(p.id))!.id;
  return { profile: next, portalId };
}
