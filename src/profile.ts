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

/** A portal as stored: its config is the validated settings of its source. */
export interface PortalOf<S extends SourceKind> {
  id: string;
  source: S;
  title?: string;
  config: SourceConfigs[S];
}

/** Any stored portal. Narrow on `source` to get its config type. */
export type PortalSpec = { [S in SourceKind]: PortalOf<S> }[SourceKind];

/** A portal before validation (tool arguments, starter packs, discovery candidates). validateProfile turns it into a PortalSpec. */
export interface PortalInput {
  id: string;
  source: SourceKind;
  title?: string | undefined;
  config: unknown;
}

export interface ColumnSpec {
  /** Relative width (flex-grow), 1 to 4. */
  width: number;
  panels: PortalSpec[];
}

/** A column before validation. */
export interface ColumnInput {
  width?: number;
  panels: Array<PortalInput | PortalSpec>;
}

/**
 * columns: side-by-side portals. shelves: one horizontally scrolling row per portal.
 * frontpage: the agent's picks, then each portal's top items, top to bottom (a lab).
 * river: every portal merged into one stream, picks first, then new, then seen.
 */
export const LAYOUTS = ['columns', 'shelves', 'frontpage', 'river'] as const;
export type Layout = (typeof LAYOUTS)[number];
/** Layouts that are labs, each behind the lab of the same name. */
const LAB_LAYOUTS: readonly Layout[] = ['frontpage'];

/** The layouts offered to the model and in the room: a lab's layout only while its lab is on. */
export const offeredLayouts = (labs: readonly string[]): Layout[] => LAYOUTS.filter((l) => !LAB_LAYOUTS.includes(l) || labs.includes(l));
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

/** Saved and following portals have only a length. */
export interface LimitConfig {
  limit: number;
}

/** A clips portal: optionally only one kind or one tag. */
export interface ClipsConfig {
  kind?: ClipKind;
  tag?: string;
  limit: number;
}

/** Each source's validated settings. */
export interface SourceConfigs {
  hn: HnConfig;
  rss: RssConfig;
  github: GithubConfig;
  docs: DocsConfig;
  saved: LimitConfig;
  pinned: PinnedConfig;
  clips: ClipsConfig;
  following: LimitConfig;
  people: LimitConfig;
  lobby: LimitConfig;
}

export type SourceConfig = SourceConfigs[SourceKind];

export interface Profile {
  version: 1;
  name: string;
  layout: Layout;
  openIn: OpenIn;
  columns: ColumnSpec[];
  /** Newest first. Only save_item / remove_saved change it; arrange_room carries it over. */
  saved: SavedItem[];
  /** Items of pinned portals, by portal id. Only pin_portal changes them; arrange_room drops a removed portal's. */
  pins: Record<string, PinnedData>;
  /** False only for a brand-new user who hasn't set up their room yet (shows the welcome). */
  onboarded: boolean;
  /** The People portal's suggestions and who the user passed on (docs/plans/finding-people.md). Only suggest_people and pass_person change it. */
  people?: PeopleData;
  updatedAt: string;
}

/** Someone the agent suggested, in its words: the reason is the agent's, from what they made public. */
export interface PersonPick { handle: string; why: string; at: string }
export interface PeopleData {
  /** Newest first; a suggestion lasts 30 days. */
  picks: PersonPick[];
  /** "Not for me", remembered 90 days so find_people can say so. */
  passed: Array<{ handle: string; at: string }>;
}
export const PEOPLE = { picks: 12, passed: 200, why: 200, pickDays: 30, passDays: 90 } as const;

/** Columns scroll sideways, so there can be more than fit on screen. */
export const LIMITS = { columns: 8, portalsPerColumn: 4, items: 30, saved: 200 } as const;
export const SOURCES: SourceKind[] = ['hn', 'rss', 'github', 'docs', 'saved', 'pinned', 'clips', 'following', 'people', 'lobby'];

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

type Normalizer<S extends SourceKind> = (config: Record<string, unknown>, where: string) => SourceConfigs[S];

const itemsLimit = (config: Record<string, unknown>) => ({ limit: clampInt(config.limit, 1, LIMITS.items, LIMITS.items) });
/** Fetched sources default to 10 items. */
const fetchLimit = (config: Record<string, unknown>) => clampInt(config.limit, 1, LIMITS.items, 10);

const NORMALIZERS: { [S in SourceKind]: Normalizer<S> } = {
  saved: itemsLimit,
  following: itemsLimit,
  people: itemsLimit,
  lobby: itemsLimit,
  clips(config, where) {
    if (config.kind !== undefined && !(CLIP_KINDS as readonly unknown[]).includes(config.kind)) throw new ProfileError(`${where}: clips kind must be one of ${CLIP_KINDS.join(', ')}`);
    const tag = typeof config.tag === 'string' ? config.tag.toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) : '';
    return { ...(config.kind ? { kind: config.kind as ClipKind } : {}), ...(tag ? { tag } : {}), ...itemsLimit(config) };
  },
  pinned(config, where) {
    const from = clean(config.from, 40);
    const recipe = clean(config.recipe, 500);
    if (!from || !recipe) throw new ProfileError(`${where}: pinned needs "from" (where the items came from) and "recipe" (how to fetch them again)`);
    return { from, recipe, ...itemsLimit(config) };
  },
  docs(config, where) {
    let url: string | null = null;
    try { url = typeof config.url === 'string' ? httpUrl(docsInputUrl(config.url)) : null; } catch { /* not an address */ }
    if (!url) throw new ProfileError(`${where}: docs needs a "url": a docs address or a GitHub owner/repo`);
    const docs: DocsConfig = { url, ...itemsLimit(config) };
    if (config.toc !== undefined) {
      const toc = isRecord(config.toc) ? config.toc : {};
      const tocUrl = httpUrl(toc.url);
      if (!(TOC_KINDS as readonly unknown[]).includes(toc.kind) || !tocUrl) throw new ProfileError(`${where}: docs toc needs a kind (${TOC_KINDS.join(', ')}) and an http(s) url`);
      docs.toc = { kind: toc.kind as TocKind, url: tocUrl };
    }
    const section = clean(config.section, 120);
    if (section) docs.section = section;
    return docs;
  },
  hn(config, where) {
    const feed = (config.feed ?? 'top') as string;
    if (!(HN_FEEDS as readonly string[]).includes(feed)) throw new ProfileError(`${where}: hn feed must be one of ${HN_FEEDS.join(', ')}`);
    return { feed: feed as HnConfig['feed'], limit: fetchLimit(config) };
  },
  rss(config, where) {
    const url = typeof config.url === 'string' ? config.url.trim() : '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    } catch {
      throw new ProfileError(`${where}: rss needs a valid http(s) "url"`);
    }
    return { url, limit: fetchLimit(config) };
  },
  github(config, where) {
    const limit = fetchLimit(config);
    if (config.mode === 'releases') {
      const repo = typeof config.repo === 'string' ? config.repo.trim() : '';
      if (!REPO_PATTERN.test(repo)) throw new ProfileError(`${where}: github releases needs "repo" like "owner/name"`);
      return { mode: 'releases', repo, limit };
    }
    const query = typeof config.query === 'string' && config.query.trim() ? config.query.trim().slice(0, 256) : 'topic:mcp';
    const sort = config.sort === 'updated' ? 'updated' : 'stars';
    return { mode: 'search', query, sort, limit };
  },
};

/** A source's settings, validated and with defaults filled in. Throws ProfileError naming `where`. */
export function normalizeSourceConfig<S extends SourceKind>(source: S, raw: unknown, where: string): SourceConfigs[S] {
  const normalize: Normalizer<S> = NORMALIZERS[source];
  return normalize(isRecord(raw) ? raw : {}, where);
}

/** A source paired with its validated settings: narrowing on `source` types `config`. */
export type SourceSettings<K extends SourceKind = SourceKind> = { [S in K]: { source: S; config: SourceConfigs[S] } }[K];

/** A source and its settings, validated. The one place a source and its config are paired up. */
export function sourceSettings<S extends SourceKind>(source: S, raw: unknown, where: string): SourceSettings<S> {
  const settings = { source, config: normalizeSourceConfig(source, raw, where) };
  // { source: S; config: SourceConfigs[S] } is a member of the union for every S; TypeScript can't see that through a generic.
  return settings as unknown as SourceSettings<S>;
}

/** A stored portal from validated parts. */
function portalOf(id: string, title: string | undefined, settings: SourceSettings): PortalSpec {
  return title ? { id, title, ...settings } : { id, ...settings };
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
      return portalOf(id, title, sourceSettings(source, pRaw.config, where));
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
  const people = normalizePeople(input.people, now);
  return { version: 1, name, layout, openIn, columns, saved: normalizeSaved(input.saved, now), pins, onboarded, ...(people ? { people } : {}), updatedAt: now.toISOString() };
}

/** Suggestions and passes: valid handles only, the reason cleaned, expired ones dropped, one per handle, capped. */
export function normalizePeople(raw: unknown, now = new Date()): PeopleData | undefined {
  if (!isRecord(raw)) return undefined;
  const day = 86_400_000;
  const when = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);
  const handleOf = (v: unknown) => (typeof v === 'string' && /^[a-z0-9_]{2,30}$/.test(v) ? v : undefined);
  const picks: PersonPick[] = [];
  for (const e of Array.isArray(raw.picks) ? raw.picks : []) {
    if (!isRecord(e)) continue;
    const handle = handleOf(e.handle), at = when(e.at), why = clean(e.why, PEOPLE.why);
    if (!handle || !at || !why || now.getTime() - at.getTime() > PEOPLE.pickDays * day || picks.some((p) => p.handle === handle)) continue;
    picks.push({ handle, why, at: at.toISOString() });
    if (picks.length >= PEOPLE.picks) break;
  }
  const passed: PeopleData['passed'] = [];
  for (const e of Array.isArray(raw.passed) ? raw.passed : []) {
    if (!isRecord(e)) continue;
    const handle = handleOf(e.handle), at = when(e.at);
    if (!handle || !at || now.getTime() - at.getTime() > PEOPLE.passDays * day || passed.some((p) => p.handle === handle)) continue;
    passed.push({ handle, at: at.toISOString() });
    if (passed.length >= PEOPLE.passed) break;
  }
  return picks.length || passed.length ? { picks, passed } : undefined;
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
  if (before.name !== after.name) diff.settings.push(`name "${before.name}" → "${after.name}"`);
  after.columns.forEach((c, i) => {
    const was = before.columns[i];
    if (was && was.width !== c.width) diff.settings.push(`column ${i + 1} width ${was.width} → ${c.width}`);
  });
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
