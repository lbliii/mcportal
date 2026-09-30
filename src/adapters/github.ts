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
}

interface Release {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  author?: { login: string };
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

function headers(token = process.env.GITHUB_TOKEN): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

export async function fetchGithub(config: GithubConfig, fetcher: Fetcher): Promise<Item[]> {
  const url = githubEndpoint(config);
  if (config.mode === 'releases') {
    const releases = await fetchJson<Release[]>(fetcher, url, { headers: headers() });
    if (!Array.isArray(releases)) throw new Error('GitHub returned an unexpected response');
    return releases
      .filter((r) => r && !r.draft)
      .map((r) => ({
        id: String(r.id),
        title: clean(r.name, 200) || clean(r.tag_name, 100),
        url: safeHttpUrl(r.html_url),
        meta: [clean(r.tag_name, 60), ...(r.prerelease ? ['pre-release'] : []), ...(r.author ? [`by ${clean(r.author.login, 40)}`] : [])],
        publishedAt: r.published_at ?? undefined,
      }));
  }
  const data = await fetchJson<{ items: Repo[] }>(fetcher, url, { headers: headers() });
  if (!Array.isArray(data?.items)) throw new Error('GitHub returned an unexpected response');
  return data.items.map((r) => ({
    id: String(r.id),
    title: clean(r.full_name, 140),
    url: safeHttpUrl(r.html_url),
    summary: clean(r.description, 240) || undefined,
    score: Number(r.stargazers_count) || 0,
    meta: [`★ ${compact(Number(r.stargazers_count) || 0)}`, ...(r.language ? [clean(r.language, 30)] : [])],
    publishedAt: r.pushed_at,
  }));
}
