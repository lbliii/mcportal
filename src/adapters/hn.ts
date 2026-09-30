import { fetchJson } from '../lib/safe-fetch.ts';
import { clean, hostOf, safeHttpUrl } from '../lib/text.ts';
import type { Fetcher, Item } from '../types.ts';

export const HN_API = 'https://hacker-news.firebaseio.com/v0';
export const HN_FEEDS = ['top', 'new', 'best', 'ask', 'show'] as const;
export type HnFeed = (typeof HN_FEEDS)[number];

export interface HnConfig {
  feed: HnFeed;
  limit: number;
}

interface HnStory {
  id: number;
  title?: string;
  url?: string;
  by?: string;
  score?: number;
  descendants?: number;
  time?: number;
  deleted?: boolean;
  dead?: boolean;
}

export function hnEndpoint(config: HnConfig): string {
  return `${HN_API}/${config.feed}stories.json`;
}

function toItem(s: HnStory): Item | null {
  if (!s || typeof s.id !== 'number' || !s.title || s.deleted || s.dead) return null;
  const discussionUrl = `https://news.ycombinator.com/item?id=${s.id}`;
  const url = safeHttpUrl(s.url) ?? discussionUrl;
  const meta = [`${Number(s.score) || 0} points`, `${Number(s.descendants) || 0} comments`];
  const by = clean(s.by, 40);
  if (by) meta.push(`by ${by}`);
  if (url !== discussionUrl) meta.push(hostOf(url));
  return {
    id: String(s.id),
    title: clean(s.title, 300),
    url,
    discussionUrl,
    score: Number(s.score) || 0,
    meta,
    publishedAt: typeof s.time === 'number' ? new Date(s.time * 1000).toISOString() : undefined,
  };
}

export async function fetchHn(config: HnConfig, fetcher: Fetcher): Promise<Item[]> {
  const ids = await fetchJson<unknown>(fetcher, hnEndpoint(config));
  if (!Array.isArray(ids)) throw new Error('Hacker News returned an unexpected response');
  const stories = await Promise.all(
    ids
      .filter((id): id is number => Number.isInteger(id))
      .slice(0, config.limit)
      .map((id) => fetchJson<HnStory>(fetcher, `${HN_API}/item/${id}.json`).catch(() => null)),
  );
  // One malformed story must never take down the panel.
  return stories.flatMap((s) => {
    try {
      const item = s ? toItem(s) : null;
      return item ? [item] : [];
    } catch {
      return [];
    }
  });
}
