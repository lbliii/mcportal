import { UpstreamError } from '../lib/errors.ts';
import { fetchJson } from '../lib/safe-fetch.ts';
import { clean, safeHttpUrl } from '../lib/text.ts';
import type { Fetcher, Item } from '../types.ts';

export const GITHUB_API = 'https://api.github.com';

export interface GithubConfig {
  mode: 'search' | 'releases';
  query?: string;
  sort?: 'stars' | 'updated';
  repo?: string;
  limit: number;
}

/** owner/name, where neither segment is "." or ".." (no path traversal on api.github.com). */
export const REPO_PATTERN = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

interface Repo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  owner?: { avatar_url?: string };
}

interface Release {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  author?: { login: string; avatar_url?: string };
}

export function githubEndpoint(config: GithubConfig): string {
  if (config.mode === 'releases') {
    const [owner, name] = (config.repo ?? '').split('/');
    return `${GITHUB_API}/repos/${encodeURIComponent(owner ?? '')}/${encodeURIComponent(name ?? '')}/releases?per_page=${config.limit}`;
  }
  const params = new URLSearchParams({
    q: config.query ?? 'topic:mcp',
    sort: config.sort ?? 'stars',
    order: 'desc',
    per_page: String(config.limit),
  });
  return `${GITHUB_API}/search/repositories?${params}`;
}

export function githubHeaders(token = process.env.GITHUB_TOKEN): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** Owner avatars, requested small. Only GitHub's own avatar host. */
function avatar(raw: unknown): Item['image'] {
  const url = safeHttpUrl(raw);
  if (!url || new URL(url).hostname !== 'avatars.githubusercontent.com') return undefined;
  const u = new URL(url);
  u.searchParams.set('s', '64');
  return { url: u.href, kind: 'avatar' };
}

export async function fetchGithub(config: GithubConfig, fetcher: Fetcher): Promise<Item[]> {
  const url = githubEndpoint(config);
  if (config.mode === 'releases') {
    const releases = await fetchJson<Release[]>(fetcher, url, { headers: githubHeaders() });
    if (!Array.isArray(releases)) throw new UpstreamError('upstream_error', 'GitHub returned an unexpected response');
    return releases
      .filter((r) => r && !r.draft)
      .map((r) => {
        const url = safeHttpUrl(r.html_url), image = avatar(r.author?.avatar_url);
        return {
          id: String(r.id),
          title: clean(r.name, 200) || clean(r.tag_name, 100),
          ...(url !== undefined ? { url } : {}),
          meta: [clean(r.tag_name, 60), ...(r.prerelease ? ['pre-release'] : []), ...(r.author ? [`by ${clean(r.author.login, 40)}`] : [])],
          ...(r.published_at != null ? { publishedAt: r.published_at } : {}),
          ...(image !== undefined ? { image } : {}),
        };
      });
  }
  const data = await fetchJson<{ items: Repo[] }>(fetcher, url, { headers: githubHeaders() });
  if (!Array.isArray(data?.items)) throw new UpstreamError('upstream_error', 'GitHub returned an unexpected response');
  return data.items.map((r) => {
    const url = safeHttpUrl(r.html_url), summary = clean(r.description, 240), image = avatar(r.owner?.avatar_url);
    return {
      id: String(r.id),
      title: clean(r.full_name, 140),
      ...(url !== undefined ? { url } : {}),
      ...(summary ? { summary } : {}),
      score: Number(r.stargazers_count) || 0,
      meta: [`★ ${compact(Number(r.stargazers_count) || 0)}`, ...(r.language ? [clean(r.language, 30)] : [])],
      publishedAt: r.pushed_at,
      ...(image !== undefined ? { image } : {}),
    };
  });
}
