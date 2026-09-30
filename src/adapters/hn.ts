import { fetchJson } from '../lib/safe-fetch.ts';
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
  type?: string;
  deleted?: boolean;
  dead?: boolean;
}

export function hnEndpoint(config: HnConfig): string {
  return `${HN_API}/${config.feed}stories.json`;
}

export async function fetchHn(config: HnConfig, fetcher: Fetcher): Promise<Item[]> {
  const ids = await fetchJson<number[]>(fetcher, hnEndpoint(config));
  const stories = await Promise.all(
    ids.slice(0, config.limit).map((id) =>
      fetchJson<HnStory | null>(fetcher, `${HN_API}/item/${id}.json`).catch(() => null),
    ),
  );
  return stories
    .filter((s): s is HnStory => Boolean(s && s.title && !s.deleted && !s.dead))
    .map((s) => {
      const discussionUrl = `https://news.ycombinator.com/item?id=${s.id}`;
      const meta = [`${s.score ?? 0} points`, `${s.descendants ?? 0} comments`];
      if (s.by) meta.push(`by ${s.by}`);
      if (s.url) meta.push(new URL(s.url).hostname.replace(/^www\./, ''));
      return {
        id: String(s.id),
        title: s.title!,
        url: s.url ?? discussionUrl,
        discussionUrl,
        score: s.score,
        meta,
        publishedAt: s.time ? new Date(s.time * 1000).toISOString() : undefined,
      };
    });
}
