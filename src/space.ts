/** Public Space projections. Never copy saved content, private integration data or auth. */
import { assertPublicUrl } from './lib/safe-fetch.ts';
import type { TtlCache } from './lib/cache.ts';
import { normalizeFeatured, type FeaturedSource, type SectionCuration } from './public-profiles.ts';
import type { Fetcher } from './types.ts';

export type SpaceSource = FeaturedSource & { key: string; pinned: boolean };
export type SpacePerson = { key: string; handle: string; displayName?: string; pinned: boolean };
export interface SpaceSections { sources: SpaceSource[]; people: SpacePerson[] }
export { sourceKey, spaceKey } from './public-profiles.ts';

/** Most query feeds are capability URLs. Allow only recognizable public feed selectors. */
function publicFeedUrl(raw: string): URL {
  const url = assertPublicUrl(raw);
  if (!url.hostname.includes('.') || url.hash || /[A-Za-z0-9_-]{24,}/.test(url.pathname) ||
    /(?:^|[\/=_-])(?:token|secret|private|auth|key|password)(?:[\/=_-]|$)/i.test(url.pathname)) throw new Error('Restricted feed URL');
  for (const [key, value] of url.searchParams) {
    const publicFormat = ['format', 'feed', 'alt', 'output', 'type'].includes(key) && /^(?:rss2?|atom|xml)$/i.test(value);
    const publicYoutube = ['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/feeds/videos.xml' &&
      ((key === 'channel_id' && /^UC[A-Za-z0-9_-]{22}$/.test(value)) || (key === 'playlist_id' && /^(?:PL|UU)[A-Za-z0-9_-]{16,40}$/.test(value)));
    if (!publicFormat && !publicYoutube) throw new Error('Unrecognized feed selector');
  }
  return url;
}

async function publicRepo(repo: string, fetcher: Fetcher, cache: TtlCache): Promise<boolean> {
  return (await cache.get(`space-public:github:https://api.github.com/repos/${repo}`, 60, async () => {
    try {
      const response = await fetcher(`https://api.github.com/repos/${repo}`, { timeoutMs: 3000, maxBytes: 100_000,
        headers: { accept: 'application/vnd.github+json' } });
      if (response.status !== 200) return false;
      assertPublicUrl(response.url);
      const data = JSON.parse(response.text);
      return data.private === false && data.visibility !== 'private';
    } catch { return false; }
  })).value;
}

/** A private feed can work without auth through a secret URL. Exclude query/fragment
 * URLs apart from recognized public feed selectors, credential paths and local
 * addresses, then probe without auth.
 * Fail closed when public accessibility cannot be established. */
export async function publicSources(raw: Array<{ title?: string; source: string; config: unknown }>, fetcher: Fetcher, cache: TtlCache): Promise<FeaturedSource[]> {
  const candidates = normalizeFeatured(raw.slice(0, 500), 500);
  const allowed = await Promise.all(candidates.map(async (source) => {
    if (source.source === 'hn') return true;
    let endpoint: string;
    if (source.source === 'rss' && 'url' in source.config) {
      try {
        const url = publicFeedUrl(source.config.url);
        endpoint = url.href;
      } catch { return false; }
    } else if (source.source === 'github' && 'mode' in source.config) {
      if (source.config.mode === 'search') {
        // Repository-specific searches can work with the room's GitHub token. Verify
        // every named repository without it before publishing the search settings.
        if (/(?:is|visibility):(?:private|internal)|token|password|secret/i.test(source.config.query)) return false;
        for (const match of source.config.query.matchAll(/\brepo:([^\s]+)/gi)) {
          const repo = match[1]!;
          if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
            !(await publicRepo(repo, fetcher, cache))) return false;
        }
        return true;
      }
      return publicRepo(source.config.repo, fetcher, cache);
    } else return false;
    return (await cache.get(`space-public:rss:${endpoint}`, 60, async () => {
      try {
        const response = await fetcher(endpoint, { timeoutMs: 3000, maxBytes: 100_000, truncate: true,
          headers: { accept: 'application/atom+xml, application/rss+xml, application/xml' } });
        if (response.status !== 200) return false;
        publicFeedUrl(response.url);
        return /<(?:rss|feed|rdf:RDF)\b/i.test(response.text);
      } catch { return false; }
    })).value;
  }));
  return candidates.filter((_source, i) => allowed[i]);
}

/** Pins first; explicit ordering next; new entries follow alphabetical order with identity tie-breakers. */
export function curate<T extends { key: string; pinned: boolean }>(entries: T[], preference?: SectionCuration, legacyPins: string[] = [], preview = false): T[] {
  const pins = preference?.pinned ?? legacyPins;
  const order = preference?.order ?? [];
  const rank = (key: string, list: string[]) => { const i = list.indexOf(key); return i < 0 ? list.length : i; };
  const label = (entry: T) => 'title' in entry ? String(entry.title) : 'handle' in entry ? String(entry.handle) : entry.key;
  return entries.filter((entry) => preview || !preference?.hidden.includes(entry.key))
    .map((entry) => ({ ...entry, pinned: pins.includes(entry.key) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
      (a.pinned ? rank(a.key, pins) - rank(b.key, pins) : 0) || rank(a.key, order) - rank(b.key, order) || label(a).localeCompare(label(b)) || a.key.localeCompare(b.key));
}
