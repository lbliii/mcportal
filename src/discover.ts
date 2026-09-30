/**
 * Source discovery: turn whatever the user gives ("theverge.com", a YouTube
 * channel, "r/LocalLLaMA", "owner/repo", a feed URL) into panel specs.
 *
 * Order: native sources (Hacker News, GitHub), known-site recipes for feeds that
 * sites don't advertise, the page's own <link rel="alternate"> feeds, then common
 * feed paths. Callers test-load every candidate before offering it, so nothing
 * that doesn't load gets added. All fetches go through the caller's guarded fetcher.
 */
import { REPO_PATTERN } from './adapters/github.ts';
import { HN_FEEDS } from './adapters/hn.ts';
import { parseFeed } from './adapters/rss.ts';
import { parseAttrs, tokenize } from './lib/html.ts';
import { clean, decodeEntities, safeHttpUrl } from './lib/text.ts';
import type { Fetcher, SourceKind } from './types.ts';

export interface SourceCandidate {
  source: Exclude<SourceKind, 'saved'>;
  config: Record<string, unknown>;
  title: string;
  /** How it was found: native integration, known-site recipe, the page's own feed link, or a probed path. */
  via: 'native' | 'recipe' | 'page' | 'probe' | 'feed';
}

export interface Discovery {
  candidates: SourceCandidate[];
  /** Guidance when the input can't be resolved on its own (e.g. "youtube" without a channel). */
  hint?: string;
}

const LIMIT = 10;
const rss = (url: string, title: string, via: SourceCandidate['via']): SourceCandidate => ({ source: 'rss', config: { url, limit: LIMIT }, title, via });

const NEEDS_SPECIFICS: Record<string, string> = {
  youtube: 'YouTube needs a channel or playlist: paste its URL, like youtube.com/@fireship.',
  reddit: 'Reddit needs a subreddit: try r/LocalLLaMA or paste its URL.',
  bluesky: 'Bluesky needs a profile: paste it, like bsky.app/profile/name.bsky.social.',
  mastodon: 'Mastodon needs a profile: paste it, like mastodon.social/@name or @name@mastodon.social.',
  medium: 'Medium needs an author or publication: paste its URL, like medium.com/@name.',
  substack: 'Substack needs a newsletter: paste its address, like name.substack.com.',
  github: 'GitHub needs a repository: try owner/repo, or describe a search like "topic:mcp".',
  twitter: "X/Twitter doesn't offer feeds, so MCPortal can't show it.",
  x: "X/Twitter doesn't offer feeds, so MCPortal can't show it.",
  instagram: "Instagram doesn't offer feeds, so MCPortal can't show it.",
  linkedin: "LinkedIn doesn't offer feeds, so MCPortal can't show it.",
  tiktok: "TikTok doesn't offer feeds, so MCPortal can't show it.",
};

/** Turn shorthand into a URL, or return a native candidate / hint directly. */
function interpret(input: string): { url?: URL; direct?: Discovery } {
  const text = input.trim();
  const word = text.toLowerCase().replace(/[^a-z]/g, '');
  if (NEEDS_SPECIFICS[word]) return { direct: { candidates: [], hint: NEEDS_SPECIFICS[word] } };
  if (['hn', 'hackernews'].includes(word)) return { direct: { candidates: [{ source: 'hn', config: { feed: 'top', limit: 12 }, title: 'Hacker News', via: 'native' }] } };

  let m: RegExpMatchArray | null;
  if ((m = text.match(/^\/?r\/([A-Za-z0-9_]{2,21})\/?$/))) return { url: new URL(`https://www.reddit.com/r/${m[1]}/`) };
  if ((m = text.match(/^@([A-Za-z0-9_.]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/))) return { url: new URL(`https://${m[2]}/@${m[1]}`) };
  if (/^@[A-Za-z0-9_.-]+$/.test(text)) {
    return { direct: { candidates: [], hint: `Where is ${text}? Paste the profile URL (YouTube, Bluesky or Mastodon), or use @name@server for Mastodon.` } };
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const first = text.split('/')[0] ?? '';
    if (!first.includes('.') && REPO_PATTERN.test(text)) {
      return { direct: { candidates: [{ source: 'github', config: { mode: 'releases', repo: text, limit: LIMIT }, title: `${text} releases`, via: 'native' }] } };
    }
    if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) return { url: new URL(`https://${text}`) };
    return {
      direct: {
        candidates: [],
        hint: 'Give a site address (theverge.com), a feed URL, r/subreddit, owner/repo, or a YouTube, Bluesky or Mastodon profile URL.',
      },
    };
  }
  const url = safeHttpUrl(text);
  return url ? { url: new URL(url) } : { direct: { candidates: [], hint: 'Only http(s) addresses can be added.' } };
}

/** Known sites whose feeds live at predictable, often unadvertised, addresses. Exported for tests. */
export function recipesFor(url: URL): SourceCandidate[] {
  const host = url.hostname.replace(/^(www|old|m)\./, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const p0 = parts[0] ?? '';

  if (host === 'news.ycombinator.com') {
    const page = p0.replace(/^newest$/, 'new').replace(/^(news|front)$/, 'top') || 'top';
    const feed = (HN_FEEDS as readonly string[]).includes(page) ? page : 'top';
    return [{ source: 'hn', config: { feed, limit: 12 }, title: feed === 'top' ? 'Hacker News' : `Hacker News: ${feed}`, via: 'native' }];
  }
  if (host === 'github.com' && parts.length >= 2 && REPO_PATTERN.test(`${parts[0]}/${parts[1]}`)) {
    const repo = `${parts[0]}/${parts[1]}`;
    return [
      { source: 'github', config: { mode: 'releases', repo, limit: LIMIT }, title: `${repo} releases`, via: 'native' },
      rss(`https://github.com/${repo}/commits.atom`, `${repo} commits`, 'recipe'),
    ];
  }
  if (host === 'github.com' && parts.length === 1) return [rss(`https://github.com/${p0}.atom`, `${p0} on GitHub`, 'recipe')];
  if (host === 'reddit.com' && (p0 === 'r' || p0 === 'user' || p0 === 'u') && parts[1]) {
    const kind = p0 === 'r' ? 'r' : 'user';
    return [rss(`https://www.reddit.com/${kind}/${parts[1]}/.rss`, `${kind === 'r' ? 'r/' : 'u/'}${parts[1]}`, 'recipe')];
  }
  if (host === 'youtube.com') {
    const list = url.searchParams.get('list');
    if (list) return [rss(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(list)}`, 'YouTube playlist', 'recipe')];
    if (p0 === 'channel' && parts[1]) return [rss(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(parts[1])}`, 'YouTube channel', 'recipe')];
    return [];   // @handle, /c/, /user/: the channel page links its own feed; see pageFeeds
  }
  if (host === 'medium.com' && p0) return [rss(`https://medium.com/feed/${p0}`, `${p0} on Medium`, 'recipe')];
  if (host === 'bsky.app' && p0 === 'profile' && parts[1]) return [rss(`https://bsky.app/profile/${parts[1]}/rss`, `${parts[1]} on Bluesky`, 'recipe')];
  if (host === 'pypi.org' && p0 === 'project' && parts[1]) return [rss(`https://pypi.org/rss/project/${parts[1].toLowerCase()}/releases.xml`, `${parts[1]} releases (PyPI)`, 'recipe')];
  if (host === 'dev.to' && p0 && p0 !== 'feed') return [rss(`https://dev.to/feed/${p0}`, `${p0} on DEV`, 'recipe')];
  if (host === 'lobste.rs') return [rss(p0 === 't' && parts[1] ? `https://lobste.rs/t/${parts[1]}.rss` : 'https://lobste.rs/rss', p0 === 't' && parts[1] ? `Lobsters: ${parts[1]}` : 'Lobsters', 'recipe')];
  if (host === 'stackoverflow.com' && p0 === 'questions' && parts[1] === 'tagged' && parts[2]) {
    return [rss(`https://stackoverflow.com/feeds/tag/${parts[2]}`, `Stack Overflow: ${parts[2]}`, 'recipe')];
  }
  if (host === 'arxiv.org' && p0 === 'list' && parts[1]) return [rss(`https://rss.arxiv.org/rss/${parts[1]}`, `arXiv ${parts[1]}`, 'recipe')];
  if (p0.startsWith('@') && p0.length > 1 && parts.length === 1) {
    return [rss(`${url.origin}/${p0}.rss`, `${p0} on ${host}`, 'recipe')];   // Mastodon and other fediverse servers
  }
  return [];
}

function looksLikeFeed(text: string): boolean {
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes('<rss') || head.includes('<feed') || head.includes('<rdf:rdf');
}

/**
 * Feeds a page advertises with <link rel="alternate" type="application/rss+xml|atom+xml">.
 * Scans the whole (size-capped) page: some sites, YouTube included, emit it after <body>.
 */
export function pageFeeds(html: string, baseUrl: string): Array<{ url: string; title: string }> {
  const out: Array<{ url: string; title: string }> = [];
  for (const token of tokenize(html)) {
    if (token.kind !== 'open' || token.name !== 'link') continue;
    const attrs = parseAttrs(token.attrs);
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
    const type = (attrs.type ?? '').toLowerCase();
    if (!rel.includes('alternate') || !/(rss|atom)\+xml/.test(type)) continue;
    const url = safeHttpUrl(decodeEntities(attrs.href ?? ''), baseUrl);
    if (url && !out.some((f) => f.url === url)) out.push({ url, title: clean(decodeEntities(attrs.title ?? ''), 80) });
    if (out.length >= 5) break;
  }
  return out;
}

async function probe(fetcher: Fetcher, url: string): Promise<{ title: string } | null> {
  try {
    const res = await fetcher(url, { maxBytes: 3_000_000, timeoutMs: 8000 });
    if (res.status < 200 || res.status >= 300 || !looksLikeFeed(res.text)) return null;
    const feed = parseFeed(res.text, 1, res.url);
    return feed.items.length ? { title: feed.title } : null;
  } catch {
    return null;
  }
}

const COMMON_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];

export async function discover(input: string, fetcher: Fetcher): Promise<Discovery> {
  const { url, direct } = interpret(input);
  if (direct) return direct;
  const target = url!;

  const recipes = recipesFor(target);
  // A recipe fully identifies the source; only pages without one need to be fetched.
  if (recipes.length) return { candidates: recipes };

  const candidates: SourceCandidate[] = [...recipes];
  let page: Awaited<ReturnType<Fetcher>> | null = null;
  try {
    page = await fetcher(target.href, { maxBytes: 1_500_000, truncate: true, timeoutMs: 10_000 });
  } catch (error) {
    if (!candidates.length) return { candidates, hint: `Couldn't open ${target.hostname}: ${clean((error as Error).message, 120)}` };
  }
  if (page && page.status >= 200 && page.status < 300) {
    if (looksLikeFeed(page.text)) {
      const feed = parseFeed(page.text, 1, page.url);
      return { candidates: [rss(page.url, feed.title, 'feed')] };
    }
    for (const f of pageFeeds(page.text, page.url)) {
      if (!candidates.some((c) => c.config.url === f.url)) candidates.push(rss(f.url, f.title || target.hostname, 'page'));
    }
    // YouTube: fall back to the channel's own id. Not the first "channelId" on the
    // page: that is often a related channel.
    if (!candidates.length && /(^|\.)youtube\.com$/.test(target.hostname)) {
      const id = (page.text.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
        ?? page.text.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/)
        ?? page.text.match(/"externalId":"(UC[\w-]{22})"/))?.[1];
      if (id) candidates.push(rss(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, 'YouTube channel', 'recipe'));
    }
  }
  if (!candidates.length) {
    for (const path of COMMON_PATHS) {
      const guess = new URL(path, target.origin).href;
      const found = await probe(fetcher, guess);
      if (found) {
        candidates.push(rss(guess, found.title, 'probe'));
        break;
      }
    }
  }
  return candidates.length
    ? { candidates }
    : { candidates, hint: `${target.hostname} doesn't publish a feed MCPortal can find. If you know its feed URL, paste that instead.` };
}
