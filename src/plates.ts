/**
 * Plates (lab `plates`, docs/plans/plates.md): illustrations the agent places in the room.
 * The agent supplies a spec in a small fixed grammar; MCPortal validates it, resolves its
 * evidence refs and hands the room data to draw. MCPortal never draws anything the spec
 * didn't name, and no agent markup reaches the room. Every kind has a text form, so a
 * host that shows no UI still gets the whole plate. Plates are temporary: nothing is stored.
 */
import { evidenceRef } from './collections.ts';
import { AppError } from './lib/errors.ts';
import { clean } from './lib/text.ts';
import type { ToolContext } from './tools/kit.ts';

export const PLATE_KINDS = ['series', 'timeline', 'steps', 'matrix'] as const;
export type PlateKind = (typeof PLATE_KINDS)[number];
export const PLATE_MARKS = ['good', 'mixed', 'poor', 'none'] as const;
export type PlateMark = (typeof PLATE_MARKS)[number];

export const PLATE_LIMITS = { title: 120, caption: 600, label: 80, detail: 200, refs: 8, series: 4, points: 200, events: 12, entries: 40, steps: 24, columns: 6, rows: 12, cell: 60, unit: 8 } as const;

export type PlateSpec =
  | { kind: 'series'; mark: 'line' | 'bar'; unit?: string; series: Array<{ name: string; points: Array<{ x: string; y: number }> }>; events?: Array<{ at: string; label: string }> }
  | { kind: 'timeline'; entries: Array<{ at: string; label: string; detail?: string; ref?: string }> }
  | { kind: 'steps'; steps: Array<{ label: string; detail?: string; emphasis?: boolean }> }
  | { kind: 'matrix'; columns: Array<{ label: string; ref?: string }>; rows: Array<{ label: string; cells: Array<{ mark: PlateMark; text: string }> }> };

/** A ref as the room shows it: the source's own title and link when MCPortal has them. */
export interface PlateRef { ref: string; title: string; url?: string; missing?: boolean }

export interface Plate { title: string; caption?: string; spec: PlateSpec; refs: PlateRef[]; createdAt: string }

export interface PlateInput { title: string; caption?: string; spec: Record<string, unknown>; refs?: string[] }

/**
 * The input schema, kept small because every listed tool costs the model tokens. Each
 * array's item shape is in its description; specFrom() checks shapes, counts and lengths
 * kind by kind (the validator in src/lib/schema.ts has no oneOf).
 */
export const PLATE_SCHEMA = {
  type: 'object',
  required: ['title', 'spec'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: PLATE_LIMITS.title },
    caption: { type: 'string', maxLength: PLATE_LIMITS.caption, description: 'What the reader should notice.' },
    refs: { type: 'array', maxItems: PLATE_LIMITS.refs, items: { type: 'string' }, description: 'Evidence: clip:ID or url:URL.' },
    spec: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { enum: PLATE_KINDS },
        series: { type: 'array', items: { type: 'object' }, description: 'series: [{name, points:[{x,y}]}]; x is YYYY-MM-DD or a label. Also mark (line|bar), unit, events:[{at,label}]' },
        entries: { type: 'array', items: { type: 'object' }, description: 'timeline: [{at:YYYY-MM-DD, label, detail?, ref?}]' },
        steps: { type: 'array', items: { type: 'object' }, description: 'steps: [{label, detail?, emphasis?}]' },
        columns: { type: 'array', items: { type: 'object' }, description: 'matrix: [{label, ref?}]' },
        rows: { type: 'array', items: { type: 'object' }, description: 'matrix: [{label, cells:[{mark:good|mixed|poor|none, text}]}], one cell per column' },
      },
    },
  },
} as const;

const invalid = (message: string) => new AppError('invalid_argument', message);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(v: unknown, what: string): string {
  if (typeof v !== 'string' || !ISO_DATE.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00Z`))) throw invalid(`${what} must be an ISO date (YYYY-MM-DD).`);
  return v;
}
/** Text within its limit: over the limit is refused, not cut. */
function text(v: unknown, max: number, what: string, required = true): string | undefined {
  if (v === undefined && !required) return undefined;
  if (v !== undefined && typeof v !== 'string') throw invalid(`${what} must be text.`);
  if (typeof v === 'string' && [...v].length > max) throw invalid(`${what} must be at most ${max} characters.`);
  const s = clean(v ?? '', max);
  if (required && !s) throw invalid(`${what} needs text.`);
  return s || undefined;
}
/** A list of objects with between min and max entries. Absent counts as empty. */
function list(v: unknown, max: number, what: string, min = 0): Array<Record<string, unknown>> {
  if (v !== undefined && !Array.isArray(v)) throw invalid(`${what} must be a list.`);
  const items = (v ?? []) as unknown[];
  if (items.length > max) throw invalid(`${what} can have at most ${max} entries.`);
  if (items.length < min) throw invalid(`${what} needs at least ${min} entries.`);
  if (items.some((i) => typeof i !== 'object' || i === null || Array.isArray(i))) throw invalid(`Each of ${what} must be an object.`);
  return items as Array<Record<string, unknown>>;
}
/** Fields that belong to other kinds are refused, so a spec can't carry something the room ignores. */
function only(spec: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(spec).filter((k) => k !== 'kind' && !allowed.includes(k));
  if (extra.length) throw invalid(`A ${String(spec.kind)} plate doesn't use ${extra.join(', ')}.`);
}

/** The spec, checked kind by kind. Refs inside it must also be listed in the plate's refs. */
export function specFrom(raw: Record<string, unknown>, refs: string[]): PlateSpec {
  const cite = (v: unknown) => {
    if (v === undefined) return undefined;
    const ref = evidenceRef(v);
    if (!refs.includes(ref)) throw invalid(`The ref ${clean(String(v), 120)} must also be listed in refs.`);
    return ref;
  };
  switch (raw.kind) {
    case 'series': {
      only(raw, ['mark', 'unit', 'series', 'events']);
      if (raw.mark !== undefined && raw.mark !== 'line' && raw.mark !== 'bar') throw invalid('mark is line or bar.');
      const series = list(raw.series, PLATE_LIMITS.series, 'series', 1).map((s) => ({ name: text(s.name, PLATE_LIMITS.label, 'A series name')!, points: list(s.points, PLATE_LIMITS.points, 'points', 1).map((p) => ({ x: text(p.x, 40, 'A point x')!, y: typeof p.y === 'number' ? p.y : NaN })) }));
      const xs = series.flatMap((s) => s.points.map((p) => p.x));
      if (series.some((s) => s.points.some((p) => !Number.isFinite(p.y)))) throw invalid('Every point needs a finite number y.');
      const dated = xs.every((x) => ISO_DATE.test(x));
      if (!dated && xs.some((x) => ISO_DATE.test(x))) throw invalid('Use either ISO dates or category labels for x, not both.');
      if (dated) for (const x of xs) isoDate(x, 'A point x');
      const events = list(raw.events, PLATE_LIMITS.events, 'events').map((e) => ({ at: dated ? isoDate(e.at, 'An event date') : text(e.at, 40, 'An event x')!, label: text(e.label, PLATE_LIMITS.label, 'An event label')! }));
      const unit = text(raw.unit, PLATE_LIMITS.unit, 'The unit', false);
      return { kind: 'series', mark: raw.mark === 'bar' ? 'bar' : 'line', ...(unit ? { unit } : {}), series: series.map((s) => ({ ...s, points: dated ? [...s.points].sort((a, b) => a.x.localeCompare(b.x)) : s.points })), ...(events.length ? { events } : {}) };
    }
    case 'timeline': {
      only(raw, ['entries']);
      const entries = list(raw.entries, PLATE_LIMITS.entries, 'entries', 2).map((e) => {
        const detail = text(e.detail, PLATE_LIMITS.detail, 'A detail', false), ref = cite(e.ref);
        return { at: isoDate(e.at, 'An entry date'), label: text(e.label, PLATE_LIMITS.label, 'An entry label')!, ...(detail ? { detail } : {}), ...(ref ? { ref } : {}) };
      }).sort((a, b) => a.at.localeCompare(b.at));
      return { kind: 'timeline', entries };
    }
    case 'steps': {
      only(raw, ['steps']);
      const steps = list(raw.steps, PLATE_LIMITS.steps, 'steps', 2).map((s) => {
        const detail = text(s.detail, PLATE_LIMITS.detail, 'A detail', false);
        return { label: text(s.label, PLATE_LIMITS.label, 'A step label')!, ...(detail ? { detail } : {}), ...(s.emphasis === true ? { emphasis: true } : {}) };
      });
      return { kind: 'steps', steps };
    }
    case 'matrix': {
      only(raw, ['columns', 'rows']);
      const columns = list(raw.columns, PLATE_LIMITS.columns, 'columns', 1).map((c) => { const ref = cite(c.ref); return { label: text(c.label, PLATE_LIMITS.label, 'A column label')!, ...(ref ? { ref } : {}) }; });
      const rows = list(raw.rows, PLATE_LIMITS.rows, 'rows', 1).map((r) => ({ label: text(r.label, PLATE_LIMITS.label, 'A row label')!, cells: list(r.cells, PLATE_LIMITS.columns, 'cells').map((c) => {
        if (!(PLATE_MARKS as readonly unknown[]).includes(c.mark)) throw invalid(`A cell's mark is one of ${PLATE_MARKS.join(', ')}.`);
        return { mark: c.mark as PlateMark, text: text(c.text, PLATE_LIMITS.cell, 'A cell', false) ?? '' };
      }) }));
      if (rows.some((r) => r.cells.length !== columns.length)) throw invalid(`Every row needs exactly ${columns.length} cells, one per column.`);
      return { kind: 'matrix', columns, rows };
    }
    default:
      throw invalid(`A plate's kind is one of ${PLATE_KINDS.join(', ')}.`);
  }
}

/** Validate a plate and resolve its refs against the caller's clips. A missing clip stays visibly missing. */
export async function plateFrom(input: PlateInput, ctx: Pick<ToolContext, 'clips' | 'reading' | 'userId'>, now = new Date()): Promise<Plate> {
  const refs = [...new Set((input.refs ?? []).map(evidenceRef))];
  if (refs.length > PLATE_LIMITS.refs) throw invalid(`A plate cites at most ${PLATE_LIMITS.refs} refs.`);
  const spec = specFrom(input.spec, refs);
  const resolved: PlateRef[] = [];
  for (const ref of refs) {
    if (ref.startsWith('clip:')) {
      const clip = await ctx.clips?.get(ctx.userId, ref.slice(5));
      resolved.push(clip ? { ref, title: clip.title, ...(clip.source.url ? { url: clip.source.url } : {}) } : { ref, title: 'Unavailable clip', missing: true });
    } else {
      // A page the user has read keeps the title MCPortal recorded; otherwise its address.
      const url = ref.slice(4), page = new URL(url), read = await ctx.reading?.get(ctx.userId, url);
      resolved.push({ ref, title: read?.title || clean(`${page.hostname.replace(/^www\./, '')}${page.pathname === '/' ? '' : page.pathname}`, PLATE_LIMITS.label), url });
    }
  }
  const caption = text(input.caption, PLATE_LIMITS.caption, 'The caption', false);
  return { title: text(input.title, PLATE_LIMITS.title, 'The title')!, ...(caption ? { caption } : {}), spec, refs: resolved, createdAt: now.toISOString() };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (x: string) => (ISO_DATE.test(x) ? `${MONTHS[Number(x.slice(5, 7)) - 1]} ${Number(x.slice(8, 10))}, ${x.slice(0, 4)}` : x);
const num = (n: number, unit = '') => (unit === '%' ? `${n}%` : `${unit}${n}`);

/** The plate as text: what a host without UI shows, and what the model reads back. */
export function plateText(plate: Plate): string {
  const refNo = new Map(plate.refs.map((r, i) => [r.ref, i + 1]));
  const cite = (ref?: string) => (ref ? ` [${refNo.get(ref)}]` : '');
  const lines = [plate.title, ...(plate.caption ? [plate.caption] : []), ''];
  const s = plate.spec;
  if (s.kind === 'series') {
    for (const series of s.series) {
      const ys = series.points.map((p) => p.y);
      lines.push(`${series.name}: ${series.points.length} points, first ${num(ys[0]!, s.unit)}, last ${num(ys.at(-1)!, s.unit)}, low ${num(Math.min(...ys), s.unit)}, high ${num(Math.max(...ys), s.unit)}`);
      for (const p of series.points) lines.push(`  ${short(p.x)}: ${num(p.y, s.unit)}`);
    }
    if (s.events?.length) lines.push(`Events: ${s.events.map((e) => `${e.label} (${short(e.at)})`).join('; ')}`);
  } else if (s.kind === 'timeline') {
    for (const e of s.entries) lines.push(`${short(e.at)}: ${e.label}${e.detail ? `. ${e.detail}` : ''}${cite(e.ref)}`);
  } else if (s.kind === 'steps') {
    s.steps.forEach((st, i) => lines.push(`${i + 1}. ${st.label}${st.emphasis ? ' (key step)' : ''}${st.detail ? `: ${st.detail}` : ''}`));
  } else {
    lines.push(`| | ${s.columns.map((c) => `${c.label}${cite(c.ref)}`).join(' | ')} |`, `|---|${s.columns.map(() => '---').join('|')}|`);
    for (const r of s.rows) lines.push(`| ${r.label} | ${r.cells.map((c) => `${c.text}${c.mark !== 'none' ? ` (${c.mark})` : ''}`).join(' | ')} |`);
  }
  // A url ref's title can come from the page itself, which is third-party text; the model gets the address.
  if (plate.refs.length) lines.push('', 'Evidence:', ...plate.refs.map((r, i) => `[${i + 1}] ${r.ref.startsWith('clip:') ? `${r.title}${r.url ? ` ${r.url}` : ''}` : r.url}${r.missing ? ' (unavailable)' : ''}`));
  return lines.join('\n');
}
