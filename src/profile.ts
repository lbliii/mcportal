/**
 * The preference profile: the user's workspace, stated in plain language and
 * stored as structured data. Principle: the agent never moves anything the
 * user placed unless asked, so updates are validated whole-profile writes.
 */
import { HN_FEEDS, type HnConfig } from './adapters/hn.ts';
import { REPO_PATTERN, type GithubConfig } from './adapters/github.ts';
import type { RssConfig } from './adapters/rss.ts';
import type { SourceKind } from './types.ts';

export interface PanelSpec {
  id: string;
  source: SourceKind;
  title?: string;
  config: Record<string, unknown>;
}

export interface ColumnSpec {
  /** Relative width (flex-grow), 1 to 4. */
  width: number;
  panels: PanelSpec[];
}

export interface Profile {
  version: 1;
  name: string;
  columns: ColumnSpec[];
  updatedAt: string;
}

export const LIMITS = { columns: 4, panelsPerColumn: 4, items: 30 } as const;
export const SOURCES: SourceKind[] = ['hn', 'rss', 'github'];

export class ProfileError extends Error {
  override name = 'ProfileError';
}

export function defaultProfile(now = new Date()): Profile {
  return {
    version: 1,
    name: 'morning',
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

export function normalizeSourceConfig(source: SourceKind, raw: unknown, where: string): HnConfig | RssConfig | GithubConfig {
  const config = isRecord(raw) ? raw : {};
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
    const panelsRaw = colRaw.panels;
    if (!Array.isArray(panelsRaw) || panelsRaw.length === 0) throw new ProfileError(`columns[${ci}] needs at least one panel`);
    if (panelsRaw.length > LIMITS.panelsPerColumn) {
      throw new ProfileError(`columns[${ci}] has more than ${LIMITS.panelsPerColumn} panels`);
    }
    const panels = panelsRaw.map((pRaw, pi): PanelSpec => {
      const where = `columns[${ci}].panels[${pi}]`;
      if (!isRecord(pRaw)) throw new ProfileError(`${where} must be an object`);
      const source = pRaw.source as SourceKind;
      if (!SOURCES.includes(source)) throw new ProfileError(`${where}: source must be one of ${SOURCES.join(', ')}`);
      const title = typeof pRaw.title === 'string' && pRaw.title.trim() ? pRaw.title.trim().slice(0, 80) : undefined;
      let id = slug(typeof pRaw.id === 'string' && pRaw.id ? pRaw.id : title ?? `${source}-${ci}-${pi}`) || `${source}-${ci}-${pi}`;
      while (seen.has(id)) id = `${id}-2`;
      seen.add(id);
      const config = normalizeSourceConfig(source, pRaw.config, where) as unknown as Record<string, unknown>;
      return title ? { id, source, title, config } : { id, source, config };
    });
    return { width: clampInt(colRaw.width, 1, 4, 1), panels };
  });

  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 60) : 'workspace';
  return { version: 1, name, columns, updatedAt: now.toISOString() };
}

export function findPanel(profile: Profile, panelId: string): PanelSpec | undefined {
  for (const column of profile.columns) {
    const panel = column.panels.find((p) => p.id === panelId);
    if (panel) return panel;
  }
  return undefined;
}

/** A short, human-readable description of the layout, for the model and for diffs. */
export function describeLayout(profile: Profile): string {
  return profile.columns
    .map((c, i) => `column ${i + 1} (width ${c.width}): ${c.panels.map((p) => `${p.title ?? p.id} [${p.source}]`).join(' / ')}`)
    .join('; ');
}
