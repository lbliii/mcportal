/**
 * Docs sites without their front end (docs/plans/docs-portal.md).
 *
 * A site's table of contents comes from the first of these that validates:
 *   llms.txt        "## Section" headings over "- [Title](url): description" lines;
 *                   a link to another llms.txt is a nested index, opened lazily
 *   objects.inv     Sphinx's inventory: std:doc entries are the pages, the rest symbols
 *   sitemap.xml     page URLs under the docs path, grouped by their first segment
 * GitHub repos take their own route: one API call lists the repo's files, and a docs
 * folder's markdown becomes the pages, ordered by SUMMARY.md or _sidebar.md when present.
 * A page comes from the first route that returns what it should: the URL asked for
 * markdown, the URL plus ".md", then the HTML reader. The route that worked is
 * remembered per host. Responses are judged by their bodies, never by status alone:
 * some sites answer /llms.txt with 200 and an HTML page.
 *
 * Everything here is untrusted third-party text, returned as plain data.
 *
 * This file resolves a site and decides what's in scope. The rest lives in ./docs/:
 * types.ts (shapes, limits, DocsError), toc.ts (llms.txt, objects.inv, sitemap),
 * github.ts, search.ts and pages.ts, all re-exported from here.
 */
import { clean, safeHttpUrl } from '../lib/text.ts';
import type { Fetcher } from '../types.ts';
import { githubTocUrl, loadGithubDocs, MARKDOWN_FILE, parseGithubDocs } from './docs/github.ts';
import { loadInventory, loadLlms, loadSitemap } from './docs/toc.ts';
import { DocsError, type DocSite, type DocsToc, type TocKind } from './docs/types.ts';

export { DOCS_LIMITS, DocsError, TOC_KINDS } from './docs/types.ts';
export type { DocPageRef, DocSection, DocSite, DocsConfig, DocSymbol, DocsToc, TocKind } from './docs/types.ts';
export { looksLikeMarkdown, parseLlmsTxt, parseObjectsInv, parseSitemap, sitemapSite } from './docs/toc.ts';
export { githubRawUrl, githubTocUrl, loadGithubDocs, originalUrl, parseGithubDocs, parseOutline, type GithubDocs } from './docs/github.ts';
export { searchDocs, type DocHit } from './docs/search.ts';
export { fetchDocPage, learnedRoute, markdownPage, type DocPage, type PageRoute } from './docs/pages.ts';

// ---- resolving a site -------------------------------------------------------------

/** What a user typed ("docs.stripe.com", "owner/repo", a folder link) as the URL a docs portal stores. */
export function docsInputUrl(input: string): string {
  const github = parseGithubDocs(input);
  return github ? githubTocUrl({ ...github, file: undefined }) : docsUrl(input).href;
}

/** "docs.stripe.com" or a page URL → an http(s) URL. */
export function docsUrl(input: string): URL {
  const text = input.trim();
  // Another scheme (ftp:, file:, javascript:) is refused, not taken for a host name; "host:port" is fine.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text) && !/^https?:/i.test(text)) throw new DocsError(`"${clean(text, 100)}" isn't a web address`);
  const url = safeHttpUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!url) throw new DocsError(`"${clean(text, 100)}" isn't a web address`);
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  return parsed;
}

/**
 * Directories to look in, most specific first: the path given and each parent up to the
 * root, then docs.<domain> and <domain>/docs when only a bare domain was given.
 */
export function candidateBases(input: string): string[] {
  const url = docsUrl(input);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length && /\.[a-z0-9]+$/i.test(parts[parts.length - 1]!)) parts.pop(); // a page like os.html
  const bases: string[] = [];
  // On shared hosts each project lives under its own first path segment: never look above it.
  const floor = /\.(?:github|gitlab)\.io$/i.test(url.hostname) && parts.length ? 1 : 0;
  for (let n = parts.length; n >= floor; n--) bases.push(`${url.origin}/${parts.slice(0, n).map((p) => `${p}/`).join('')}`);
  if (!parts.length && !/^docs\./i.test(url.hostname)) {
    const host = url.host.replace(/^www\./i, '');
    bases.push(`${url.protocol}//docs.${host}/`, `${url.origin}/docs/`);
  }
  return [...new Set(bases)];
}

const LOADERS: Record<TocKind, { file: string[]; load: (url: string, fetcher: Fetcher) => Promise<DocSite | null> }> = {
  llms: { file: ['llms.txt'], load: loadLlms },
  sphinx: { file: ['objects.inv'], load: loadInventory },
  sitemap: { file: ['sitemap.xml', 'sitemap_index.xml'], load: loadSitemap },
  github: { file: [], load: (url, fetcher) => loadGithubDocs(url, fetcher) },
};

const KIND_NAMES: Record<TocKind, string> = { llms: 'llms.txt', sphinx: 'Sphinx inventory', sitemap: 'sitemap', github: 'GitHub docs folder' };

/** Load a site's table of contents from a known source (a portal's stored toc, or a nested llms.txt). */
export async function loadDocs(toc: DocsToc, fetcher: Fetcher): Promise<DocSite> {
  const site = await LOADERS[toc.kind].load(toc.url, fetcher);
  if (!site) throw new DocsError(`${toc.url} isn't a readable ${KIND_NAMES[toc.kind]}`);
  return site;
}

/**
 * Find a docs site's table of contents, nearest directory first, trying llms.txt,
 * objects.inv and a sitemap at each directory. One request at a time: some docs hosts rate-limit bursts (Django answers 429).
 */
export async function resolveDocs(input: string, fetcher: Fetcher): Promise<DocSite> {
  const github = parseGithubDocs(input);
  if (github) return loadGithubDocs(githubTocUrl(github), fetcher);
  const host = docsUrl(input).hostname.toLowerCase();
  // Walking up a GitHub URL would find GitHub's own docs, not the repo's.
  if (/^(?:www\.)?(?:github|gitlab)\.com$|^raw\.githubusercontent\.com$/.test(host)) {
    throw new DocsError('That GitHub address isn\'t a repository or folder: use owner/repo, or a link to a folder or file in the repo');
  }
  const bases = candidateBases(input);
  const requested = new URL(bases[0]!);
  for (const base of bases) {
    for (const kind of ['llms', 'sphinx', 'sitemap'] as const) {
      const { file, load } = LOADERS[kind];
      for (const name of file) {
        const site = await load(base + name, fetcher);
        if (!site) continue;
        // A broad parent llms.txt can describe many unrelated products. Only use it
        // for a path request when its entire index belongs to that subtree. Merely
        // finding one matching link is not enough: reloading its stored toc must
        // still open the requested documentation, rather than the parent catalog.
        if (kind === 'llms' && base !== bases[0] && requested.pathname !== '/') {
          const pages = site.sections.flatMap((section) => section.pages);
          if (!pages.every((page) => {
            const url = new URL(page.url);
            return url.origin === requested.origin &&
              (url.pathname === requested.pathname.slice(0, -1) || url.pathname.startsWith(requested.pathname));
          })) continue;
        }
        return site;
      }
    }
  }
  throw new DocsError(`No docs index found for ${docsUrl(input).href}: tried llms.txt, a Sphinx objects.inv and a sitemap`, 'not_found');
}

// ---- scope ----------------------------------------------------------------------

/** The registrable part of a host, near enough: "docs.stripe.com" → "stripe.com", "docs.foo.co.uk" → "foo.co.uk". */
export function siteDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const two = labels.slice(-2);
  const n = labels.length > 2 && two[1]!.length === 2 && /^(?:co|com|org|net|ac|gov|edu)$/.test(two[0]!) ? 3 : 2;
  return labels.slice(-n).join('.');
}

/** A page the viewer may fetch: in the table of contents, or on a domain the site's docs live on. */
export function inDocsScope(site: DocSite, url: string): boolean {
  let target: URL;
  try { target = new URL(url); } catch { return false; }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
  if (site.toc.kind === 'github') {
    // Only this repo's raw files: raw.githubusercontent.com serves every public repo.
    const g = parseGithubDocs(site.toc.url);
    return !!g && target.hostname === 'raw.githubusercontent.com' && target.pathname.startsWith(`/${g.owner}/${g.repo}/`) && MARKDOWN_FILE.test(target.pathname);
  }
  const domains = new Set([siteDomain(new URL(site.toc.url).hostname)]);
  for (const section of site.sections) {
    for (const page of section.pages) {
      if (page.url === target.href) return true;
      domains.add(siteDomain(new URL(page.url).hostname));
    }
  }
  return domains.has(siteDomain(target.hostname));
}
