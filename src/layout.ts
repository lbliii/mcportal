/**
 * Changing a room's layout without disturbing what the user arranged. Every function
 * here only adds or rebuilds what it's asked to: none moves or removes the user's
 * other portals, and saved items always pass through untouched.
 */
import { AppError, type ErrorCode } from './lib/errors.ts';
import { clean } from './lib/text.ts';
import { findPortal, LIMITS, sourceSettings, validateProfile, type ColumnInput, type PortalInput, type PortalSpec, type Profile } from './profile.ts';

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
export function ensurePortal(profile: Profile, source: 'saved' | 'clips' | 'following' | 'people', title: string): { profile: Profile; added: boolean } {
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

/** What arrange_room can change. Each part is optional; only what it names changes. */
export interface Arrangement {
  /** Portals to take out of the room (ids, or titles that match one portal). */
  remove?: string[];
  /** Portals to move: to a column (1-based, as the room was; one past the last makes a new column) and a position in it (1-based; default last). */
  move?: Array<{ portal: string; column: number; position?: number }>;
  /** Column widths (1-4, relative), by column as the room was. */
  width?: Array<{ column: number; width: number }>;
  retitle?: Array<{ portal: string; title: string }>;
  /** Settings to change on a portal's source (merged into its current settings, then validated). */
  configure?: Array<{ portal: string; config: Record<string, unknown> }>;
  name?: string;
  layout?: Profile['layout'];
  openIn?: Profile['openIn'];
}

/** A refusal: nothing was changed. */
const refuse = (code: ErrorCode, message: string) => new AppError(code, message);

/** The portal a reference names: its id, or a title that matches exactly one portal (any case). */
export function resolvePortal(profile: Profile, ref: string): PortalSpec {
  const portals = profile.columns.flatMap((c) => c.panels);
  const byId = portals.find((p) => p.id === ref);
  if (byId) return byId;
  const byTitle = portals.filter((p) => (p.title ?? '').toLowerCase() === ref.trim().toLowerCase());
  if (byTitle.length === 1) return byTitle[0]!;
  if (byTitle.length > 1) throw refuse('invalid_argument', `"${clean(ref, 80)}" names ${byTitle.length} portals (${byTitle.map((p) => p.id).join(', ')}); use an id`);
  throw refuse('not_found', `No portal "${clean(ref, 80)}" in the room (open_room lists them)`);
}

/**
 * The room with an arrangement applied, all or nothing. Steps run in a fixed order:
 * remove, move, width, retitle, configure, then name / layout / openIn. Column numbers
 * mean the room as it was when the call began (columns emptied along the way are only
 * dropped at the end), and only portals the arrangement names can move, change or go.
 * Throws an AppError and changes nothing when any step can't be done.
 */
export function arrange(profile: Profile, change: Arrangement): Profile {
  const columns: Array<{ width: number; panels: PortalSpec[] }> = profile.columns.map((c) => ({ width: c.width, panels: [...c.panels] }));
  const original = columns.length;
  const at = (id: string) => columns.findIndex((c) => c.panels.some((p) => p.id === id));
  const take = (id: string) => {
    const column = columns[at(id)]!;
    column.panels.splice(column.panels.findIndex((p) => p.id === id), 1);
  };
  const columnFor = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 1 || n > original + 1) throw refuse('invalid_argument', `${what}: column ${n} isn't in the room (1 to ${original}, or ${original + 1} for a new one)`);
    if (n === original + 1 && columns.length === original) {
      if (original >= LIMITS.columns) throw refuse('limit_exceeded', `The room already has ${LIMITS.columns} columns, the most it can`);
      columns.push({ width: 1, panels: [] });
    }
    return columns[n - 1]!;
  };

  for (const ref of change.remove ?? []) take(resolvePortal(profile, ref).id);
  if (!columns.some((c) => c.panels.length)) throw refuse('invalid_argument', 'That would leave the room empty; it needs at least one portal');

  for (const step of change.move ?? []) {
    const portal = resolvePortal(profile, step.portal);
    if (at(portal.id) === -1) throw refuse('invalid_argument', `${portal.id} is being removed, so it can't also move`);
    take(portal.id);
    const target = columnFor(step.column, `Moving ${portal.id}`);
    if (target.panels.length >= LIMITS.portalsPerColumn) throw refuse('limit_exceeded', `Column ${step.column} is full (${LIMITS.portalsPerColumn} portals)`);
    const index = step.position === undefined ? target.panels.length : Math.min(Math.max(step.position, 1), target.panels.length + 1) - 1;
    target.panels.splice(index, 0, portal);
  }

  for (const step of change.width ?? []) {
    if (!Number.isInteger(step.width) || step.width < 1 || step.width > 4) throw refuse('invalid_argument', 'A column width is 1 to 4');
    columnFor(step.column, 'Width').width = step.width;
  }

  const edit = (ref: string, apply: (p: PortalSpec) => PortalSpec, what: string) => {
    const portal = resolvePortal(profile, ref);
    const column = columns[at(portal.id)];
    if (!column) throw refuse('invalid_argument', `${portal.id} is being removed, so it can't also be ${what}`);
    column.panels[column.panels.findIndex((p) => p.id === portal.id)] = apply(column.panels.find((p) => p.id === portal.id)!);
  };
  for (const step of change.retitle ?? []) {
    const title = clean(step.title, 80);
    if (!title) throw refuse('invalid_argument', 'A new title needs some text');
    edit(step.portal, (p) => ({ ...p, title }), 'retitled');
  }
  for (const step of change.configure ?? []) {
    edit(step.portal, (p) => {
      if (p.source === 'pinned') throw refuse('invalid_argument', `${p.id} is pinned: change it with pin_portal`);
      // Merged into what it has now, then validated like any stored portal.
      return { id: p.id, ...(p.title !== undefined ? { title: p.title } : {}), ...sourceSettings(p.source, { ...p.config, ...step.config }, p.id) };
    }, 'reconfigured');
  }

  const kept = columns.filter((c) => c.panels.length);
  return withLayout(profile, {
    columns: kept,
    ...(change.name !== undefined ? { name: change.name } : {}),
    ...(change.layout !== undefined ? { layout: change.layout } : {}),
    ...(change.openIn !== undefined ? { openIn: change.openIn } : {}),
    // Pinned items stay with the pinned portals that stay.
    pins: Object.fromEntries(Object.entries(profile.pins).filter(([id]) => kept.some((c) => c.panels.some((p) => p.id === id)))),
  });
}
