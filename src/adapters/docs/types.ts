/**
 * The docs adapter's shared vocabulary: table-of-contents kinds, site and page shapes,
 * size limits, and DocsError. Imports nothing else from the adapter, so every other
 * docs module can depend on it.
 */
import { AppError, type AppErrorOptions, type ErrorCode } from '../../lib/errors.ts';

export const TOC_KINDS = ['llms', 'sphinx', 'sitemap', 'github'] as const;
export type TocKind = (typeof TOC_KINDS)[number];

export interface DocsToc {
  kind: TocKind;
  url: string;
}

export interface DocsConfig {
  /** The docs root the user asked for, e.g. https://docs.stripe.com */
  url: string;
  /** How the table of contents was found; fixed when the portal is added, resolved on first load if missing. */
  toc?: DocsToc;
  /** Show only this section's pages. */
  section?: string;
  limit: number;
}

export interface DocPageRef {
  title: string;
  url: string;
  description?: string;
  /** The link is another llms.txt: a nested docs index (Cloudflare's products, Svelte's packages). */
  index?: true;
}

export interface DocSection {
  title: string;
  /** Some sites link the section heading itself (Next.js). */
  url?: string;
  pages: DocPageRef[];
}

export interface DocSymbol {
  name: string;
  /** Sphinx role, e.g. "py:function". */
  role: string;
  url: string;
}

export interface DocSite {
  title: string;
  summary?: string;
  toc: DocsToc;
  sections: DocSection[];
  /** Sphinx sites only: functions, classes, modules… */
  symbols?: DocSymbol[];
}

export const DOCS_LIMITS = {
  indexBytes: 2_000_000,
  inventoryBytes: 2_000_000,
  inventoryInflated: 20_000_000,
  sitemapBytes: 5_000_000,
  sitemapChildren: 5,
  treeBytes: 20_000_000,
  outlineBytes: 500_000,
  pageBytes: 1_500_000,
  pages: 3000,
  sections: 200,
  symbols: 20_000,
};

/** A docs site or page that can't be found, read or used. Defaults to invalid_argument; pass a code when it's something else. */
export class DocsError extends AppError {
  override name = 'DocsError';

  constructor(message: string, code: ErrorCode = 'invalid_argument', options?: AppErrorOptions) {
    super(code, message, options);
  }
}
