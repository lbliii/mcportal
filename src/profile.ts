/**
 * The preference profile: the user's room, stated in plain language and
 * stored as structured data. Principle: the agent never moves anything the
 * user placed unless asked, so updates are validated whole-profile writes.
 */
import { HN_FEEDS, type HnConfig } from './adapters/hn.ts';
import { docsInputUrl, TOC_KINDS, type DocsConfig, type TocKind } from './adapters/docs.ts';
import { REPO_PATTERN, type GithubConfig } from './adapters/github.ts';
import type { RssConfig } from './adapters/rss.ts';
import { AppError, type AppErrorOptions, type ErrorCode } from './lib/errors.ts';
import { clean } from './lib/text.ts';
import { CLIP_KINDS, type ClipKind, type Item, type SourceKind } from './types.ts';

export interface PortalSpec {
  id: string;
  source: SourceKind;
  title?: string;
  config: Record<string, unknown>;
}

export interface ColumnSpec {
  /** Relative width (flex-grow), 1 to 4. */
  width: number;
  panels: PortalSpec[];
}

/** columns: side-by-side portals. shelves: one horizontally scrolling row per portal. */
export const LAYOUTS = ['columns', 'shelves'] as const;
export type Layout = (typeof LAYOUTS)[number];
/** Where a story opens: card = reader inside the room, chat = its own reader card in the conversation. */
export const OPEN_IN = ['card', 'chat'] as const;
export type OpenIn = (typeof OPEN_IN)[number];

/** A bookmark. Title and note may come from third-party pages: untrusted, plain text. */
export interface SavedItem {
  url: string;
  title: string;
  source?: string;
  note?: string;
  savedAt: string;
}

/** The items of one pinned portal, as the agent last passed them. Untrusted, plain text. */
export interface PinnedData {
  items: Item[];
  pinnedAt: string;
}

export interface PinnedConfig {
  /** Where the items came from, e.g. "Jira". */
  from: string;
  /** How the agent fetches them again, in plain words: which tool, which arguments. */
  recipe: string;
  limit: number;
}

/** A clips portal: optionally only one kind or one tag. */
export interface ClipsConfig {
  kind?: ClipKind;
  tag?: string;
  limit: number;
}

export interface Profile {
  version: 1;
  name: string;
  layout: Layout;
  openIn: OpenIn;
  columns: ColumnSpec[];
  /** Newest first. Only save_item / remove_saved change it; update_profile carries it over. */
  saved: SavedItem[];
  /** Items of pinned portals, by portal id. Only pin_portal changes them; update_profile carries them over. */
  pins: Record<string, PinnedData>;
  /** False only for a brand-new user who hasn't set up their room yet (shows the welcome). */
  onboarded: boolean;
  updatedAt: string;
}

/** Columns scroll sideways, so there can be more than fit on screen. */
export const LIMITS = { columns: 8, portalsPerColumn: 4, items: 30, saved: 200 } as const;
export const SOURCES: SourceKind[] = ['hn', 'rss', 'github', 'docs', 'saved', 'pinned', 'clips', 'following'];

/** A profile, layout or source config that fails validation. Defaults to invalid_argument; pass a code when it's something else. */
export class ProfileError extends AppError {
  override name = 'ProfileError';

  constructor(message: string, code: ErrorCode = 'invalid_argument', options?: AppErrorOptions) {
    super(code, message, options);
  }
}

export function defaultProfile(now = new Date()): Profile {
  return {
    version: 1,
    name: 'morning',
    layout: 'columns',
    openIn: 'card',
    saved: [],
    pins: {},
    onboarded: false,
    updatedAt: now.toISOString(),
    columns: [
      { width: 1, panels: [{ id: 'hn-top', source: 'hn', title: 'Hacker News', config: { feed: 'top', limit: 12 } }] },
      {
        width: 1,
        panels: [
          {
            id: 'gh-mcp',
            source: 'github',
            title: 'Active MCP repos',
            config: { mode: 'search', query: 'topic:mcp stars:>500', sort: 'updated', limit: 10 },
          },
        ],
      },
      {
        width: 1,
        panels: [
          {
            id: 'simonw',
            source: 'rss',
            title: "Simon Willison's Weblog",
            config: { url: 'https://simonwillison.net/atom/everything/', limit: 10 },
          },
        ],
      },
    ],
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeSourceConfig(source: SourceKind, raw: unknown, where: string): HnConfig | RssConfig | GithubConfig | DocsConfig | PinnedConfig | ClipsConfig | { limit: number } {
  const config = isRecord(raw) ? raw : {};
  if (source === 'saved' || source === 'following') return { limit: clampInt(config.limit, 1, LIMITS.items, LIMITS.items) };
  if (source === 'clips') {
    if (config.kind !== undefined && !(CLIP_KINDS as readonly unknown[]).includes(config.kind)) throw new ProfileError(`${where}: clips kind must be one of ${CLIP_KINDS.join(', ')}`);
    const tag = typeof config.tag === 'string' ? config.tag.toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) : '';
    return { ...(config.kind ? { kind: config.kind as ClipKind } : {}), ...(tag ? { tag } : {}), limit: clampInt(config.limit, 1, LIMITS.items, LIMITS.items) };
  }
  if (source === 'pinned') {
    const from = clean(config.from, 40);
    const recipe = clean(config.recipe, 500);
    if (!from || !recipe) throw new ProfileError(`${where}: pinned needs "from" (where the items came from) and "recipe" (how to fetch them again)`);
    return { from, recipe, limit: clampInt(config.limit, 1, LIMITS.items, LIMITS.items) };
  }
  if (source === 'docs') {
    let url: string | null = null;
    try { url = typeof config.url === 'string' ? httpUrl(docsInputUrl(config.url)) : null; } catch { /* not an address */ }
    if (!url) throw new ProfileError(`${where}: docs needs a "url": a docs address or a GitHub owner/repo`);
    const docs: DocsConfig = { url, limit: clampInt(config.limit, 1, LIMITS.items, LIMITS.items) };
    if (config.toc !== undefined) {
      const toc = isRecord(config.toc) ? config.toc : {};
      const tocUrl = httpUrl(toc.url);
      if (!(TOC_KINDS as readonly unknown[]).includes(toc.kind) || !tocUrl) throw new ProfileError(`${where}: docs toc needs a kind (${TOC_KINDS.join(', ')}) and an http(s) url`);
      docs.toc = { kind: toc.kind as TocKind, url: tocUrl };
    }
    const section = clean(config.section, 120);
    if (section) docs.section = section;
    return docs;
  }
  const limit = clampInt(config.limit, 1, LIMITS.items, 10);
  if (source === 'hn') {
    const feed = (config.feed ?? 'top') as string;
    if (!(HN_FEEDS as readonly string[]).includes(feed)) {
      throw new ProfileError(`${where}: hn feed must be one of ${HN_FEEDS.join(', ')}`);
    }
    return { feed: feed as HnConfig['feed'], limit };
  }
  if (source === 'rss') {
    const url = typeof config.url === 'string' ? config.url.trim() : '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    } catch {
      throw new ProfileError(`${where}: rss needs a valid http(s) "url"`);
    }
    return { url, limit };
  }
  const mode = config.mode === 'releases' ? 'releases' : 'search';
  if (mode === 'releases') {
    const repo = typeof config.repo === 'string' ? config.repo.trim() : '';
    if (!REPO_PATTERN.test(repo)) throw new ProfileError(`${where}: github releases needs "repo" like "owner/name"`);
    return { mode, repo, limit };
  }
  const query = typeof config.query === 'string' && config.query.trim() ? config.query.trim().slice(0, 256) : 'topic:mcp';
  const sort = config.sort === 'updated' ? 'updated' : 'stars';
  return { mode, query, sort, limit };
}

/** Validate and normalize a whole profile. Throws ProfileError with a readable message. */
export function validateProfile(input: unknown, now = new Date()): Profile {
  if (!isRecord(input)) throw new ProfileError('Profile must be an object');
  const columnsRaw = input.columns;
  if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) throw new ProfileError('Profile needs at least one column');
  if (columnsRaw.length > LIMITS.columns) throw new ProfileError(`At most ${LIMITS.columns} columns`);

  const seen = new Set<string>();
  const columns: ColumnSpec[] = columnsRaw.map((colRaw, ci) => {
    if (!isRecord(colRaw)) throw new ProfileError(`columns[${ci}] must be an object`);
    const portalsRaw = colRaw.panels;
    if (!Array.isArray(portalsRaw) || portalsRaw.length === 0) throw new ProfileError(`columns[${ci}] needs at least one portal`);
    if (portalsRaw.length > LIMITS.portalsPerColumn) {
      throw new ProfileError(`columns[${ci}] has more than ${LIMITS.portalsPerColumn} portals`);
    }
    const portals = portalsRaw.map((pRaw, pi): PortalSpec => {
      const where = `columns[${ci}].panels[${pi}]`;
      if (!isRecord(pRaw)) throw new ProfileError(`${where} must be an object`);
      const source = pRaw.source as SourceKind;
      if (!SOURCES.includes(source)) throw new ProfileError(`${where}: source must be one of ${SOURCES.join(', ')}`);
      const title = clean(pRaw.title, 80) || undefined;
      let id = slug(typeof pRaw.id === 'string' && pRaw.id ? pRaw.id : title ?? `${source}-${ci}-${pi}`) || `${source}-${ci}-${pi}`;
      while (seen.has(id)) id = `${id}-2`;
      seen.add(id);
      const config = normalizeSourceConfig(source, pRaw.config, where) as unknown as Record<string, unknown>;
      return title ? { id, source, title, config } : { id, source, config };
    });
    return { width: clampInt(colRaw.width, 1, 4, 1), panels: portals };
  });

  const name = clean(input.name, 60) || 'room';
  const layout = (LAYOUTS as readonly unknown[]).includes(input.layout) ? (input.layout as Layout) : 'columns';
  const openIn = (OPEN_IN as readonly unknown[]).includes(input.openIn) ? (input.openIn as OpenIn) : 'card';
  // Profiles saved before onboarding existed belong to people who are already set up.
  const onboarded = input.onboarded !== false;
  const pinnedIds = columns.flatMap((c) => c.panels).filter((p) => p.source === 'pinned').map((p) => p.id);
  const pins = normalizePins(input.pins, pinnedIds, now);
  return { version: 1, name, layout, openIn, columns, saved: normalizeSaved(input.saved, now), pins, onboarded, updatedAt: now.toISOString() };
}

/** Keep pinned items only for pinned portals that exist; an unknown id gets none. */
export function normalizePins(raw: unknown, portalIds: string[], now = new Date()): Record<string, PinnedData> {
  const pins: Record<string, PinnedData> = {};
  const all = isRecord(raw) ? raw : {};
  for (const id of portalIds) {
    const entry = Object.hasOwn(all, id) && isRecord(all[id]) ? all[id] : {};
    const pinnedAt = typeof entry.pinnedAt === 'string' && !Number.isNaN(Date.parse(entry.pinnedAt)) ? new Date(entry.pinnedAt).toISOString() : now.toISOString();
    pins[id] = { items: normalizePinnedItems(entry.items), pinnedAt };
  }
  return pins;
}

/**
 * Items from another tool, as the agent passed them: plain text, http(s) links only,
 * capped. The shape is our own Item, so every portal renders the same way.
 */
export function normalizePinnedItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  const items: Item[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const title = clean(entry.title, 200);
    if (!title) continue;
    const url = httpUrl(entry.url) ?? undefined;
    const item: Item = { id: url ?? `pin-${items.length}`, title, meta: [] };
    if (url) item.url = url;
    const summary = clean(entry.summary, 280);
    if (summary) item.summary = summary;
    if (Array.isArray(entry.meta)) item.meta = entry.meta.map((m) => clean(m, 40)).filter(Boolean).slice(0, 4);
    if (typeof entry.publishedAt === 'string' && !Number.isNaN(Date.parse(entry.publishedAt))) item.publishedAt = new Date(entry.publishedAt).toISOString();
    items.push(item);
    if (items.length >= LIMITS.items) break;
  }
  return items;
}

export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Keep valid http(s) bookmarks, newest first, one per URL, capped. */
export function normalizeSaved(raw: unknown, now = new Date()): SavedItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const url = httpUrl(entry.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const savedAt = typeof entry.savedAt === 'string' && !Number.isNaN(Date.parse(entry.savedAt)) ? new Date(entry.savedAt).toISOString() : now.toISOString();
    const item: SavedItem = { url, title: clean(entry.title, 200) || new URL(url).hostname, savedAt };
    const source = clean(entry.source, 20);
    const note = clean(entry.note, 280);
    if (source) item.source = source;
    if (note) item.note = note;
    out.push(item);
    if (out.length >= LIMITS.saved) break;
  }
  return out;
}

/** The first portal showing saved items, if the user has one in their layout. */
export function findSavedPortal(profile: Profile): PortalSpec | undefined {
  for (const column of profile.columns) {
    const portal = column.panels.find((p) => p.source === 'saved');
    if (portal) return portal;
  }
  return undefined;
}

export function findPortal(profile: Profile, portalId: string): PortalSpec | undefined {
  for (const column of profile.columns) {
    const portal = column.panels.find((p) => p.id === portalId);
    if (portal) return portal;
  }
  return undefined;
}

export interface ProfileDiff {
  settings: string[];
  added: string[];
  removed: string[];
  moved: string[];
  retitled: string[];
  reconfigured: string[];
}

function locate(profile: Profile): Map<string, { column: number; index: number; portal: PortalSpec }> {
  const map = new Map<string, { column: number; index: number; portal: PortalSpec }>();
  profile.columns.forEach((c, column) => c.panels.forEach((portal, index) => map.set(portal.id, { column, index, portal })));
  return map;
}

/** What changed between two layouts, by portal id. */
export function diffProfiles(before: Profile, after: Profile): ProfileDiff {
  const a = locate(before);
  const b = locate(after);
  const diff: ProfileDiff = { settings: [], added: [], removed: [], moved: [], retitled: [], reconfigured: [] };
  if (before.layout !== after.layout) diff.settings.push(`layout ${before.layout} → ${after.layout}`);
  if (before.openIn !== after.openIn) diff.settings.push(`openIn ${before.openIn} → ${after.openIn}`);
  for (const [id, was] of a) {
    const now = b.get(id);
    if (!now) {
      diff.removed.push(id);
      continue;
    }
    if (was.column !== now.column || was.index !== now.index) diff.moved.push(`${id} (column ${was.column + 1} → ${now.column + 1})`);
    if ((was.portal.title ?? '') !== (now.portal.title ?? '')) diff.retitled.push(id);
    if (JSON.stringify(was.portal.config) !== JSON.stringify(now.portal.config) || was.portal.source !== now.portal.source) diff.reconfigured.push(id);
  }
  for (const id of b.keys()) if (!a.has(id)) diff.added.push(id);
  return diff;
}

export function describeDiff(diff: ProfileDiff): string {
  const parts = (Object.entries(diff) as Array<[string, string[]]>).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(', ')}`);
  return parts.length ? parts.join('; ') : 'no portal changes';
}

/** A short, human-readable description of the layout, for the model and for diffs. */
export function describeLayout(profile: Profile): string {
  const mode = `${profile.layout} layout, stories open in ${profile.openIn === 'chat' ? 'their own chat card' : 'the room'}, ${profile.saved.length} saved`;
  return `${mode}; ` + profile.columns
    .map((c, i) => `column ${i + 1} (width ${c.width}): ${c.panels.map((p) => `${p.title ?? p.id} [${p.source}]`).join(' / ')}`)
    .join('; ');
}
