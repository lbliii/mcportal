import { fetchGithub, githubEndpoint, type GithubConfig } from './adapters/github.ts';
import { fetchHn, hnEndpoint, type HnConfig } from './adapters/hn.ts';
import { fetchArticle } from './adapters/reader.ts';
import { fetchRss, type RssConfig } from './adapters/rss.ts';
import type { TtlCache } from './lib/cache.ts';
import { clean } from './lib/text.ts';
import { normalizeSourceConfig, type PanelSpec, type SavedItem } from './profile.ts';
import type { Article, Fetcher, Item, PanelResult, SourceKind } from './types.ts';

/** Declared freshness per source, in seconds (Orrery-style freshness policy). */
export const FRESHNESS: Record<SourceKind | 'reader', number> = {
  saved: 0,
  hn: 120,
  github: 300,
  rss: 600,
  reader: 3600,
};

export interface SourceDeps {
  fetcher: Fetcher;
  cache: TtlCache;
}

const DEFAULT_TITLES: Record<SourceKind, string> = { hn: 'Hacker News', rss: 'Feed', github: 'GitHub', saved: 'Saved' };

/** Saved items come from the profile, not the network. */
export function savedPanel(panel: PanelSpec, saved: SavedItem[]): PanelResult {
  const { limit } = normalizeSourceConfig('saved', panel.config, panel.id) as { limit: number };
  const items: Item[] = saved.slice(0, limit).map((s) => {
    let host = '';
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* validated on save */ }
    return { id: s.url, title: s.title, url: s.url, summary: s.note, meta: host ? [host] : [], publishedAt: s.savedAt };
  });
  return {
    panelId: panel.id,
    source: 'saved',
    title: panel.title ?? DEFAULT_TITLES.saved,
    items,
    provenance: { source: 'saved', endpoint: 'your saved items', fetchedAt: new Date().toISOString(), cached: false, ttlSeconds: 0 },
  };
}

export async function loadPanel(panel: PanelSpec, deps: SourceDeps, force = false): Promise<PanelResult> {
  if (panel.source === 'saved') throw new Error('saved panels are built from the profile; use savedPanel');
  const config = normalizeSourceConfig(panel.source, panel.config, panel.id);
  let endpoint = '';
  let title = panel.title ?? DEFAULT_TITLES[panel.source];
  try {
    let result: { value: { items: Item[]; feedTitle?: string }; cached: boolean; fetchedAt: string };
    if (panel.source === 'hn') {
      const c = config as HnConfig;
      endpoint = hnEndpoint(c);
      result = await deps.cache.get(`hn:${c.feed}:${c.limit}`, FRESHNESS.hn, async () => ({ items: await fetchHn(c, deps.fetcher) }), force);
    } else if (panel.source === 'github') {
      const c = config as GithubConfig;
      endpoint = githubEndpoint(c);
      result = await deps.cache.get(`gh:${endpoint}`, FRESHNESS.github, async () => ({ items: await fetchGithub(c, deps.fetcher) }), force);
    } else {
      const c = config as RssConfig;
      endpoint = c.url;
      result = await deps.cache.get(
        `rss:${c.url}:${c.limit}`,
        FRESHNESS.rss,
        async () => {
          const feed = await fetchRss(c, deps.fetcher);
          return { items: feed.items, feedTitle: feed.title };
        },
        force,
      );
      if (!panel.title && result.value.feedTitle) title = clean(result.value.feedTitle, 80);
    }
    return {
      panelId: panel.id,
      source: panel.source,
      title,
      items: result.value.items,
      provenance: { source: panel.source, endpoint, fetchedAt: result.fetchedAt, cached: result.cached, ttlSeconds: FRESHNESS[panel.source] },
    };
  } catch (error) {
    return {
      panelId: panel.id,
      source: panel.source,
      title,
      items: [],
      error: clean((error as Error).message, 200) || 'Unknown error',
      provenance: { source: panel.source, endpoint, fetchedAt: new Date().toISOString(), cached: false, ttlSeconds: FRESHNESS[panel.source] },
    };
  }
}

export async function loadArticle(url: string, deps: SourceDeps): Promise<Article> {
  const result = await deps.cache.get(`reader:${url}`, FRESHNESS.reader, () => fetchArticle(url, deps.fetcher));
  const { finalUrl, ...article } = result.value;
  return {
    url: finalUrl,
    ...article,
    provenance: { source: 'reader', endpoint: finalUrl, fetchedAt: result.fetchedAt, cached: result.cached, ttlSeconds: FRESHNESS.reader },
  };
}

export const SOURCE_DOCS = {
  hn: { description: 'Hacker News stories.', config: { feed: 'top | new | best | ask | show (default top)', limit: '1-30' } },
  github: {
    description: 'GitHub repositories (search) or a repo\'s releases.',
    config: {
      mode: 'search | releases (default search)',
      query: 'GitHub search query for mode=search, e.g. "topic:mcp stars:>500" or "org:anthropics"',
      sort: 'stars | updated (mode=search)',
      repo: '"owner/name" (mode=releases)',
      limit: '1-30',
    },
  },
  rss: { description: 'Any RSS or Atom feed: blogs, release feeds, podcasts, YouTube channels.', config: { url: 'feed URL (http/https)', limit: '1-30' } },
  saved: { description: "The user's saved items (bookmarks), newest first. Items are added with save_item and removed with remove_saved.", config: { limit: '1-30 (default 30)' } },
} as const;
