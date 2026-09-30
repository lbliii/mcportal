import { fetchJson } from '../lib/safe-fetch.ts';
import type { Fetcher, Item } from '../types.ts';

export const GITHUB_API = 'https://api.github.com';

export interface GithubConfig {
  mode: 'search' | 'releases';
  query?: string;
  sort?: 'stars' | 'updated';
  repo?: string;
  limit: number;
}

export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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
    return `${GITHUB_API}/repos/${config.repo}/releases?per_page=${config.limit}`;
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
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
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
    return releases
      .filter((r) => !r.draft)
      .map((r) => ({
        id: String(r.id),
        title: r.name?.trim() || r.tag_name,
        url: r.html_url,
        meta: [r.tag_name, ...(r.prerelease ? ['pre-release'] : []), ...(r.author ? [`by ${r.author.login}`] : [])],
        publishedAt: r.published_at ?? undefined,
      }));
  }
  const data = await fetchJson<{ items: Repo[] }>(fetcher, url, { headers: headers() });
  return data.items.map((r) => ({
    id: String(r.id),
    title: r.full_name,
    url: r.html_url,
    summary: r.description ?? undefined,
    score: r.stargazers_count,
    meta: [`★ ${compact(r.stargazers_count)}`, ...(r.language ? [r.language] : [])],
    publishedAt: r.pushed_at,
  }));
}
