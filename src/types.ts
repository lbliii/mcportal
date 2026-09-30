/** 'saved' is the user's own bookmarks: stored in their profile, never fetched. */
export type SourceKind = 'hn' | 'rss' | 'github' | 'saved';

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
}

export type Fetcher = (url: string, options?: FetchOptions) => Promise<FetchResponse>;
