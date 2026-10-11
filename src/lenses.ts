/**
 * Lenses (lab `plates`, docs/plans/plates.md): the caller's own data, shaped to be drawn.
 * get_lens attaches no room UI, so a host that draws its own answers (charts, timelines)
 * draws from this. Each lens also carries a ready plate spec, so in a host that shows
 * the room the agent can pass it straight to show_plate. Text-only hosts read the summary.
 */
import { CLIP_LIMITS } from './clips.ts';
import { READING_LIMIT } from './reading.ts';
import type { PlateInput } from './plates.ts';
import type { ToolContext } from './tools/kit.ts';

export const LENSES = ['reading_activity'] as const;
export type LensName = (typeof LENSES)[number];

export interface ReadingActivityLens {
  name: 'reading_activity';
  title: string;
  /** Monday-start UTC weeks, oldest first. */
  weeks: Array<{ week: string; opened: number; read: number; clipped: number }>;
  totals: { opened: number; read: number; clipped: number };
  /** Sites the user opened most in the window. */
  topSites: Array<{ site: string; opened: number }>;
  /** A plate spec for show_plate, from the same numbers. */
  plate: PlateInput;
}
export type Lens = ReadingActivityLens;

const DAY = 86_400_000;
/** The Monday (UTC) of the week a time falls in, as YYYY-MM-DD. */
export function weekOf(time: number): string {
  const d = new Date(time);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
  return new Date(monday).toISOString().slice(0, 10);
}

/** Weekly reading: pages opened, marked read, and clips kept, over the last `weeks` weeks. */
export async function readingActivity(ctx: Pick<ToolContext, 'reading' | 'clips' | 'userId'>, weeks: number, now = Date.now()): Promise<ReadingActivityLens> {
  const first = weekOf(now - (weeks - 1) * 7 * DAY), start = Date.parse(`${first}T00:00:00Z`);
  const buckets = new Map<string, { opened: number; read: number; clipped: number }>();
  for (let t = start; t <= now; t += 7 * DAY) buckets.set(weekOf(t), { opened: 0, read: 0, clipped: 0 });
  const add = (iso: string | undefined, key: 'opened' | 'read' | 'clipped') => {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t) || t < start || t > now) return false;
    const bucket = buckets.get(weekOf(t));
    if (bucket) bucket[key]++;
    return Boolean(bucket);
  };
  const sites = new Map<string, number>();
  for (const r of (await ctx.reading?.list(ctx.userId, { limit: READING_LIMIT })) ?? []) {
    if (add(r.lastOpenedAt, 'opened')) {
      const site = new URL(r.url).hostname.replace(/^www\./, '');
      sites.set(site, (sites.get(site) ?? 0) + 1);
    }
    add(r.readAt, 'read');
  }
  for (const c of (await ctx.clips?.list(ctx.userId, { limit: CLIP_LIMITS.perUser })) ?? []) add(c.createdAt, 'clipped');
  const rows = [...buckets].map(([week, v]) => ({ week, ...v }));
  const totals = rows.reduce((t, r) => ({ opened: t.opened + r.opened, read: t.read + r.read, clipped: t.clipped + r.clipped }), { opened: 0, read: 0, clipped: 0 });
  const topSites = [...sites].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([site, opened]) => ({ site, opened }));
  const title = `Your reading, last ${weeks} weeks`;
  const series = (['opened', 'read', 'clipped'] as const).map((key) => ({ name: key === 'opened' ? 'Opened' : key === 'read' ? 'Marked read' : 'Clipped', points: rows.map((r) => ({ x: r.week, y: r[key] })) }));
  return {
    name: 'reading_activity', title, weeks: rows, totals, topSites,
    plate: { title, caption: `${totals.opened} pages opened, ${totals.read} marked read and ${totals.clipped} clips kept.${topSites[0] ? ` Most opened: ${topSites[0].site}.` : ''}`, spec: { kind: 'series', mark: 'bar', series } },
  };
}

/** The lens as text, for hosts that show no UI. */
export function lensText(lens: Lens): string {
  const busiest = [...lens.weeks].sort((a, b) => b.opened - a.opened)[0];
  return [
    `${lens.title}: ${lens.totals.opened} pages opened, ${lens.totals.read} marked read, ${lens.totals.clipped} clips kept.`,
    busiest && busiest.opened ? `Busiest week: ${busiest.week} (${busiest.opened} opened).` : 'No pages opened in this window.',
    lens.topSites.length ? `Most opened sites: ${lens.topSites.map((s) => `${s.site} (${s.opened})`).join(', ')}.` : '',
    'Weeks (Monday start, opened/read/clipped): ' + lens.weeks.map((w) => `${w.week} ${w.opened}/${w.read}/${w.clipped}`).join('; '),
  ].filter(Boolean).join('\n');
}

/** The output schema hosts read to draw a reading_activity lens. */
export const LENS_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['lens'],
  properties: {
    lens: {
      type: 'object',
      required: ['name', 'title', 'weeks', 'totals', 'topSites', 'plate'],
      properties: {
        name: { enum: LENSES },
        title: { type: 'string' },
        weeks: { type: 'array', description: 'Monday-start UTC weeks, oldest first', items: { type: 'object', required: ['week', 'opened', 'read', 'clipped'], properties: { week: { type: 'string', format: 'date' }, opened: { type: 'integer' }, read: { type: 'integer' }, clipped: { type: 'integer' } } } },
        totals: { type: 'object', properties: { opened: { type: 'integer' }, read: { type: 'integer' }, clipped: { type: 'integer' } } },
        topSites: { type: 'array', items: { type: 'object', properties: { site: { type: 'string' }, opened: { type: 'integer' } } } },
        plate: { type: 'object', description: 'A ready spec for show_plate' },
      },
    },
  },
} as const;
