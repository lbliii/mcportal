/**
 * 'saved' is the user's own bookmarks and 'pinned' is data the agent brought from
 * another tool (Jira, Slack, …): both live in the profile and are never fetched.
 * 'clips' come from the clip store (src/clips.ts), also never fetched.
 */
export type SourceKind = 'hn' | 'rss' | 'github' | 'saved' | 'pinned' | 'clips';

export const CLIP_KINDS = ['quote', 'exchange', 'note', 'table', 'image', 'link'] as const;
export type ClipKind = (typeof CLIP_KINDS)[number];

/** One row in a panel. Everything here is untrusted data from a source. */
export interface Item {
  id: string;
  title: string;
  url?: string;
  discussionUrl?: string;
  summary?: string;
  meta: string[];
  score?: number;
  publishedAt?: string;
  /** A picture for the item: a content thumbnail, or a small avatar (GitHub owners). Fetched via get_thumbnails. */
  image?: { url: string; kind: 'thumb' | 'avatar' };
  /** The link is a video (YouTube). */
  video?: boolean;
  /** Items of a clips panel: open with get_clip. */
  clip?: { id: string; kind: ClipKind };
}

/** "Show your work": where a block's data came from and how fresh it is. */
export interface Provenance {
  source: SourceKind | 'reader';
  endpoint: string;
  fetchedAt: string;
  cached: boolean;
  ttlSeconds: number;
}

export interface PanelResult {
  panelId: string;
  source: SourceKind;
  title: string;
  items: Item[];
  provenance: Provenance;
  error?: string;
  /** Pinned panels: where the items came from and how the agent fetches them again. */
  pin?: { from: string; recipe: string };
}

export interface ArticleBlock {
  type: 'h' | 'p' | 'li' | 'pre' | 'quote';
  text: string;
}

export interface Article {
  url: string;
  title: string;
  siteName?: string;
  byline?: string;
  blocks: ArticleBlock[];
  wordCount: number;
  provenance: Provenance;
}

export interface FetchResponse {
  status: number;
  url: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** When true, oversized bodies are cut off instead of rejected (used for HTML). */
  truncate?: boolean;
  /** When true, `text` is the body as base64 (images). */
  binary?: boolean;
}

export type Fetcher = (url: string, options?: FetchOptions) => Promise<FetchResponse>;
