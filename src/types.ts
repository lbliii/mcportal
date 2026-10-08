import type { ErrorCode } from './lib/errors.ts';

/**
 * 'saved' is the user's own bookmarks and 'pinned' is data the agent brought from
 * another tool (Jira, Slack, …): both live in the profile and are never fetched.
 * 'clips' come from the clip store (src/clips.ts) and 'following' from shares of
 * people the user follows (src/social.ts); neither is fetched. 'docs' is a docs
 * site's table of contents (src/adapters/docs.ts).
 */
export type SourceKind = 'hn' | 'rss' | 'github' | 'docs' | 'saved' | 'pinned' | 'clips' | 'following' | 'changes' | 'upcoming';

export const CLIP_KINDS = ['quote', 'exchange', 'note', 'table', 'image', 'link'] as const;
export type ClipKind = (typeof CLIP_KINDS)[number];

/** Largest picture get_thumbnails will fetch. Feed adapters use it to skip renditions they know are bigger. */
export const MAX_THUMB_BYTES = 350_000;

/** One row in a portal. Everything here is untrusted data from a source. */
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
  /** Items of a clips portal: open with get_clip. */
  clip?: { id: string; kind: ClipKind };
  /** Items of a following portal: open with get_share. */
  share?: {
    id: string;
    kind: 'link' | 'clip';
    /** A reblog: its original's id, the original's author and note (absent once it's gone, then why), and whose reblog it came through. */
    reblog?: { root: string; by?: string; note?: string; removed?: 'removed' | 'detached'; via?: string };
    /** Reblogs of the original, pooled. */
    reblogs?: number;
    /** The viewer's own reblog of it, to undo. */
    mine?: string;
    /** Whether the viewer may reblog it now. */
    canReblog?: boolean;
  };
  /** Not yet seen by this user (src/seen.ts). */
  new?: true;
  /** Structured GitHub release metadata, distinct from a search result or generic RSS. */
  watch?: { id: string; findingId?: string };
  event?: import('./watches-state.ts').WatchedEvent;
  release?: { repo: string; version: string };
}

/** "Show your work": where a block's data came from and how fresh it is. */
export interface Provenance {
  source: SourceKind | 'reader';
  endpoint: string;
  /** Only account-owned content: shared cache activity is private. */
  fetchedAt?: string;
  cached?: boolean;
  ttlSeconds: number;
}

export interface PortalResult {
  portalId: string;
  source: SourceKind;
  title: string;
  items: Item[];
  provenance: Provenance;
  error?: string;
  /** Why it failed, when it did (see src/lib/errors.ts). */
  errorCode?: ErrorCode;
  /** Pinned portals: where the items came from and how the agent fetches them again. */
  pin?: { from: string; recipe: string };
  /** How many of its items are new to this user (portals that track it; src/seen.ts). */
  newCount?: number;
}

/** A run of inline text: plain, a link (http(s), or "#anchor" within the page), code, or strong. */
export interface Span {
  text: string;
  href?: string;
  code?: true;
  strong?: true;
}

export const CALLOUT_TONES = ['note', 'tip', 'warning', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/**
 * One block of reader text. `text` is always the whole block as plain text (what the
 * agent reads and what older views show); the optional fields add structure.
 */
export interface ArticleBlock {
  type: 'h' | 'p' | 'li' | 'pre' | 'quote' | 'table' | 'callout';
  text: string;
  /** h: heading level 1–6. li: nesting depth 0–3. */
  level?: number;
  /** h: anchor id within the page. */
  id?: string;
  /** li: a numbered item. */
  ordered?: true;
  /** pre: language, e.g. "bash". */
  lang?: string;
  /** pre: file or tab name. callout: its title. */
  label?: string;
  /** callout */
  tone?: CalloutTone;
  /** p, li, quote, callout: inline links, code and emphasis; only present when there are some. */
  spans?: Span[];
  /** table */
  columns?: string[];
  rows?: string[][];
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
