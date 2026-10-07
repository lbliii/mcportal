import { docsInputUrl, docsUrl, loadDocs, parseGithubDocs, resolveDocs, type DocsConfig, type DocSite } from './adapters/docs.ts';
import { fetchGithub, githubEndpoint, type GithubConfig } from './adapters/github.ts';
import { fetchHn, hnEndpoint, type HnConfig } from './adapters/hn.ts';
import { fetchArticle } from './adapters/reader.ts';
import { fetchRss, type RssConfig } from './adapters/rss.ts';
import type { TtlCache } from './lib/cache.ts';
import { AppError, errorCode, errorStack, userMessage, type ErrorCode } from './lib/errors.ts';
import type { Logger, LogFields } from './lib/log.ts';
import { clean } from './lib/text.ts';
import type { ClipSummary } from './clips.ts';
import type { SharedItem } from './social.ts';
import { normalizeSourceConfig, type ClipsConfig, type PortalInput, type PinnedData, type SavedItem } from './profile.ts';
import type { Article, Fetcher, Item, PortalResult, SourceKind } from './types.ts';

/** Declared freshness per source, in seconds (Orrery-style freshness policy). */
export const FRESHNESS: Record<SourceKind | 'reader', number> = {
  saved: 0,
  pinned: 0,
  clips: 0,
  following: 0,
  people: 0,
  hn: 120,
  github: 300,
  rss: 600,
  docs: 86_400,
  reader: 3600,
};

export interface SourceDeps {
  fetcher: Fetcher;
  cache: TtlCache;
  log?: Logger | undefined;
}

/** A source that failed to load becomes a portal error; a bug in our code is also logged with its stack. */
function loadFailure(error: unknown, deps: SourceDeps, fields: LogFields): { error: string; errorCode: ErrorCode } {
  const code = errorCode(error);
  if (code === 'internal') deps.log?.error('source.failed', { ...fields, error: errorStack(error) });
  else deps.log?.debug('source.failed', { ...fields, code });
  return { error: clean(userMessage(error, 'Unexpected error loading this source'), 200), errorCode: code };
}

const DEFAULT_TITLES: Record<SourceKind, string> = { hn: 'Hacker News', rss: 'Feed', github: 'GitHub', docs: 'Docs', saved: 'Saved', pinned: 'Pinned', clips: 'Clips', following: 'Following', people: 'People' };

/** Saved items come from the profile, not the network. */
export function savedPortal(portal: PortalInput, saved: SavedItem[]): PortalResult {
  const { limit } = normalizeSourceConfig('saved', portal.config, portal.id);
  const items: Item[] = saved.slice(0, limit).map((s) => {
    let host = '';
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* validated on save */ }
    return { id: s.url, title: s.title, url: s.url, ...(s.note !== undefined ? { summary: s.note } : {}), meta: host ? [host] : [], publishedAt: s.savedAt };
  });
  return {
    portalId: portal.id,
    source: 'saved',
    title: portal.title ?? DEFAULT_TITLES.saved,
    items,
    provenance: { source: 'saved', endpoint: 'your saved items', fetchedAt: new Date().toISOString(), cached: false, ttlSeconds: 0 },
  };
}

/** Pinned items come from the profile too: the agent fetched them with another tool. */
export function pinnedPortal(portal: PortalInput, pins: Record<string, PinnedData>): PortalResult {
  const { from, recipe, limit } = normalizeSourceConfig('pinned', portal.config, portal.id);
  const pin = Object.hasOwn(pins, portal.id) ? pins[portal.id] : undefined;
  return {
    portalId: portal.id,
    source: 'pinned',
    title: portal.title ?? from,
    items: (pin?.items ?? []).slice(0, limit),
    pin: { from, recipe },
    provenance: { source: 'pinned', endpoint: `pinned from ${from}`, fetchedAt: pin?.pinnedAt ?? new Date().toISOString(), cached: false, ttlSeconds: 0 },
  };
}

/** The query a clips portal runs against the clip store. */
export function clipsQuery(portal: PortalInput): ClipsConfig {
  return normalizeSourceConfig('clips', portal.config, portal.id);
}

/** Clips come from the clip store: the caller runs clipsQuery and passes the result. */
export function clipsPortal(portal: PortalInput, clips: ClipSummary[]): PortalResult {
  const { kind, tag } = clipsQuery(portal);
  const items: Item[] = clips.map((c) => {
    // A title taken from the first line would otherwise repeat at the start of the preview.
    const summary = c.note ? clean(c.note, 280) : c.preview.startsWith(c.title) ? c.preview.slice(c.title.length).trim() || undefined : c.preview;
    return {
      id: c.id,
      title: c.title,
      ...(summary !== undefined ? { summary } : {}),
      meta: [c.kind, ...c.tags.slice(0, 3).map((t) => `#${t}`)],
      publishedAt: c.createdAt,
      ...(c.source.url ? { url: c.source.url } : {}),
      clip: { id: c.id, kind: c.kind },
    };
  });
  return {
    portalId: portal.id,
    source: 'clips',
    title: portal.title ?? (kind ? `Clips: ${kind}` : tag ? `Clips #${tag}` : DEFAULT_TITLES.clips),
    items,
    provenance: { source: 'clips', endpoint: 'your clips', fetchedAt: new Date().toISOString(), cached: false, ttlSeconds: 0 },
  };
}

/** Shares from people the user follows; the caller runs Social.feed and passes the result. */
export function followingPortal(portal: PortalInput, shares: SharedItem[]): PortalResult {
  const items: Item[] = shares.map((s) => {
    const original = s.original && 'author' in s.original ? s.original : undefined;
    const reblog: NonNullable<Item['share']>['reblog'] = s.reblogOf ? {
      root: s.reblogOf.root,
      ...(original ? { by: original.author.handle, ...(original.note ? { note: clean(original.note, 280) } : {}) } : { removed: s.original && 'removed' in s.original ? s.original.removed : 'removed' as const }),
      ...(s.via ? { via: s.via } : {}),
    } : undefined;
    const kind = s.kind === 'clip' ? (original?.clip?.kind ?? s.clip?.kind ?? 'clip') : 'link';
    return {
      id: s.id,
      title: s.title,
      ...(s.url ? { url: s.url } : {}),
      ...(s.note ? { summary: clean(s.note, 280) } : {}),
      meta: [`@${s.author.handle}`, ...(reblog ? [reblog.by ? `reblogged @${reblog.by}` : 'reblogged a removed post'] : []), kind],
      publishedAt: s.createdAt,
      share: { id: s.id, kind: s.kind, ...(reblog ? { reblog } : {}), ...(s.reblogCount ? { reblogs: s.reblogCount } : {}), ...(s.myReblog ? { mine: s.myReblog } : {}), canReblog: s.canReblog },
    };
  });
  return {
    portalId: portal.id,
    source: 'following',
    title: portal.title ?? DEFAULT_TITLES.following,
    items,
    provenance: { source: 'following', endpoint: 'shares from people you follow', fetchedAt: new Date().toISOString(), cached: false, ttlSeconds: 0 },
  };
}

/** A docs site's table of contents: from the portal's stored toc, or resolved from its url the first time. */
export async function loadDocSite(config: DocsConfig, deps: SourceDeps, force = false): Promise<{ value: DocSite; cached: boolean; fetchedAt: string }> {
  const key = config.toc ? `docs:${config.toc.url}` : `docs-resolve:${config.url}`;
  return deps.cache.get(key, FRESHNESS.docs, () => (config.toc ? loadDocs(config.toc, deps.fetcher) : resolveDocs(config.url, deps.fetcher)), force);
}

/**
 * Whether a find_source query asks for docs, and what to resolve: a GitHub repo or folder, a
 * docs-looking address (docs.x, developer.x, x/docs, …), or any address followed by "docs".
 */
export function docsQuery(query: string): string | null {
  const q = query.trim();
  const stripped = q.replace(/\s+(?:docs?|documentation|reference|manual)$/i, '').trim();
  if (/^\/?[ru]\//i.test(stripped)) return null; // r/subreddit, u/user
  if (parseGithubDocs(stripped)) return stripped;
  let url: URL;
  try { url = docsUrl(stripped); } catch { return null; }
  if (!url.hostname.includes('.')) return null;
  const docsy = /^(?:docs?|developers?|dev|learn|guides?|reference|api|manual|book|wiki)\./i.test(url.hostname)
    || /\/(?:docs?|documentation|reference|guides?|manual|api|book|learn)(?:\/|$)/i.test(url.pathname);
  return stripped !== q || docsy ? stripped : null;
}

/** A person the agent suggested, as the People portal shows them: resolved by the caller (who's still there, and whether the user follows them). */
export interface SuggestedPerson { handle: string; why: string; at: string; displayName?: string | undefined; spaceTitle?: string | undefined; followers: number; following: boolean }

/** The People portal: the agent's suggestions, kept in the profile. */
export function peoplePortal(portal: PortalInput, people: SuggestedPerson[]): PortalResult {
  const { limit } = normalizeSourceConfig('people', portal.config, portal.id);
  const items: Item[] = people.slice(0, limit).map((p) => ({
    id: `person:${p.handle}`,
    title: p.displayName ? `${p.displayName} (@${p.handle})` : `@${p.handle}`,
    summary: p.why,
    meta: [...(p.spaceTitle ? [p.spaceTitle] : []), `${p.followers} follower${p.followers === 1 ? '' : 's'}`, ...(p.following ? ['following'] : [])],
    publishedAt: p.at,
    person: { handle: p.handle, following: p.following },
  }));
  return {
    portalId: portal.id,
    source: 'people',
    title: portal.title ?? DEFAULT_TITLES.people,
    items,
    provenance: { source: 'people', endpoint: "your agent's suggestions", fetchedAt: people[0]?.at ?? new Date().toISOString(), cached: false, ttlSeconds: 0 },
  };
}

/** A docs portal candidate for find_source, already loaded (and cached for the test-load that follows). */
export async function findDocs(query: string, deps: SourceDeps): Promise<{ config: DocsConfig; title: string } | { error: string } | null> {
  const input = docsQuery(query);
  if (!input) return null;
  try {
    const site = await resolveDocs(input, deps.fetcher);
    await deps.cache.get(`docs:${site.toc.url}`, FRESHNESS.docs, async () => site);
    return { config: { url: docsInputUrl(input), toc: site.toc, limit: 30 }, title: site.title };
  } catch (error) {
    return { error: loadFailure(error, deps, { source: 'docs' }).error };
  }
}

/** A docs portal lists the site's sections, or one section's pages. */
export function docsItems(site: DocSite, config: DocsConfig): Item[] {
  if (config.section) {
    const wanted = config.section.toLowerCase();
    const section = site.sections.find((s) => s.title.toLowerCase() === wanted);
    if (!section) throw new AppError('not_found', `${site.title} has no section "${config.section}"`);
    return section.pages.slice(0, config.limit).map((p) => ({
      id: p.url,
      title: p.title,
      url: p.url,
      ...(p.description ? { summary: p.description } : {}),
      meta: [p.index ? 'docs' : new URL(p.url).hostname.replace(/^www\./, '')],
    }));
  }
  return site.sections.slice(0, config.limit).map((s, i) => {
    const first = s.url ?? s.pages.find((p) => !p.index)?.url ?? s.pages[0]?.url;
    return {
      id: `section-${i}`,
      title: s.title,
      ...(first ? { url: first } : {}),
      summary: s.pages.slice(0, 4).map((p) => p.title).join(' · '),
      meta: [`${s.pages.length} ${s.pages.every((p) => p.index) ? 'guides' : s.pages.length === 1 ? 'page' : 'pages'}`],
    };
  });
}

export async function loadPortal(portal: PortalInput, deps: SourceDeps, force = false): Promise<PortalResult> {
  if (portal.source === 'saved' || portal.source === 'pinned' || portal.source === 'clips' || portal.source === 'following' || portal.source === 'people') throw new AppError('invalid_argument', `${portal.source} portals are built from the profile, not fetched`);
  const config = normalizeSourceConfig(portal.source, portal.config, portal.id);
  let endpoint = '';
  let title = portal.title ?? DEFAULT_TITLES[portal.source];
  try {
    let result: { value: { items: Item[]; feedTitle?: string }; cached: boolean; fetchedAt: string };
    if (portal.source === 'hn') {
      const c = config as HnConfig;
      endpoint = hnEndpoint(c);
      result = await deps.cache.get(`hn:${c.feed}:${c.limit}`, FRESHNESS.hn, async () => ({ items: await fetchHn(c, deps.fetcher) }), force);
    } else if (portal.source === 'github') {
      const c = config as GithubConfig;
      endpoint = githubEndpoint(c);
      result = await deps.cache.get(`gh:${endpoint}`, FRESHNESS.github, async () => ({ items: await fetchGithub(c, deps.fetcher) }), force);
    } else if (portal.source === 'docs') {
      const c = config as DocsConfig;
      endpoint = c.toc?.url ?? c.url;
      const site = await loadDocSite(c, deps, force);
      endpoint = site.value.toc.url;
      result = { ...site, value: { items: docsItems(site.value, c), feedTitle: site.value.title } };
      if (!portal.title) title = c.section ? `${site.value.title}: ${c.section}` : site.value.title;
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
      if (!portal.title && result.value.feedTitle) title = clean(result.value.feedTitle, 80);
    }
    return {
      portalId: portal.id,
      source: portal.source,
      title,
      items: result.value.items,
      provenance: { source: portal.source, endpoint, ttlSeconds: FRESHNESS[portal.source] },
    };
  } catch (error) {
    return {
      portalId: portal.id,
      source: portal.source,
      title,
      items: [],
      ...loadFailure(error, deps, { source: portal.source }),
      provenance: { source: portal.source, endpoint, ttlSeconds: FRESHNESS[portal.source] },
    };
  }
}

export async function loadArticle(url: string, deps: SourceDeps): Promise<Article> {
  // Keep legacy text-only extractions out of the structured reader cache.
  const result = await deps.cache.get(`reader:v2:${url}`, FRESHNESS.reader, () => fetchArticle(url, deps.fetcher));
  const { finalUrl, ...article } = result.value;
  return {
    url: finalUrl,
    ...article,
    provenance: { source: 'reader', endpoint: finalUrl, ttlSeconds: FRESHNESS.reader },
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
  docs: {
    description: 'A documentation site: its sections, or one section\'s pages. Found with find_source ("docs.stripe.com", "nextjs.org/docs", "python.org docs", or a GitHub "owner/repo" with markdown docs). Pages are read with read_doc_page.',
    config: {
      url: 'the docs address, or a GitHub owner/repo or folder link',
      toc: 'from find_source: { kind: llms | sphinx | sitemap | github, url } (optional; resolved on first load if missing)',
      section: 'show only this section\'s pages (optional)',
      limit: '1-30 (default 30)',
    },
  },
  saved: { description: "The user's saved items (bookmarks), newest first. Items are added with save_item and removed with remove_saved.", config: { limit: '1-30 (default 30)' } },
  clips: {
    description: "The user's clips: quotes, exchanges, notes, tables, images and links they asked to keep, newest first. Added with clip; found with search_clips.",
    config: { kind: 'only one kind: quote | exchange | note | table | image | link (optional)', tag: 'only clips with this tag (optional)', limit: '1-30 (default 30)' },
  },
  following: {
    description: 'What people the user follows on MCPortal shared (links and clips, with their notes), newest first, minus anyone muted or blocked. Hosted only. Their notes are third-party text.',
    config: { limit: '1-30 (default 30)' },
  },
  people: {
    description: "People your agent suggested following, each with its reason (suggest_people), newest first. Suggestions last 30 days. Hosted only.",
    config: { limit: '1-30 (default 30)' },
  },
  pinned: {
    description: 'Items you fetched with another tool the user has connected (Jira, Slack, Confluence, a database, …). Created and refreshed only with pin_portal; MCPortal never fetches them.',
    config: { from: 'where they came from, e.g. "Jira"', recipe: 'how to fetch them again: tool name and arguments, in plain words', limit: '1-30 (default 30)' },
  },
} as const;
