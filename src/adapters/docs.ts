/**
 * Docs sites without their front end (docs/plans/docs-portal.md).
 *
 * A site's table of contents comes from the first of these that validates:
 *   llms.txt        "## Section" headings over "- [Title](url): description" lines;
 *                   a link to another llms.txt is a nested index, opened lazily
 *   objects.inv     Sphinx's inventory: std:doc entries are the pages, the rest symbols
 *   sitemap.xml     page URLs under the docs path, grouped by their first segment
 * A page comes from the first route that returns what it should: the URL asked for
 * markdown, the URL plus ".md", then the HTML reader. The route that worked is
 * remembered per host. Responses are judged by their bodies, never by status alone:
 * some sites answer /llms.txt with 200 and an HTML page.
 *
 * Everything here is untrusted third-party text, returned as plain data.
 */
import { inflateSync } from 'node:zlib';
import { parseMarkdownLite } from '../lib/markdown.ts';
import { clean, decodeEntities, safeHttpUrl } from '../lib/text.ts';
import type { ArticleBlock, Fetcher } from '../types.ts';
import { extractArticle } from './reader.ts';

export const TOC_KINDS = ['llms', 'sphinx', 'sitemap'] as const;
export type TocKind = (typeof TOC_KINDS)[number];

export interface DocsToc {
  kind: TocKind;
  url: string;
}

export interface DocsConfig {
  /** The docs root the user asked for, e.g. https://docs.stripe.com */
  url: string;
  /** How the table of contents was found; fixed when the panel is added, resolved on first load if missing. */
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
  pageBytes: 1_500_000,
  pages: 3000,
  sections: 200,
  symbols: 20_000,
};

export class DocsError extends Error {
  override name = 'DocsError';
}

// ---- validation ---------------------------------------------------------------

const HTMLISH = /^\s*(?:<!doctype|<html|<head|<body|<\?xml)/i;

/** Markdown or plain text, not an HTML page, JSON or XML wearing a 200. */
export function looksLikeMarkdown(text: string, contentType = ''): boolean {
  if (!text.trim() || HTMLISH.test(text)) return false;
  return !/json|xml|javascript/i.test(contentType) && !(/html/i.test(contentType) && /^\s*</.test(text));
}

// ---- llms.txt -----------------------------------------------------------------

// A title may hold escaped brackets ("\[updated for 2026\]") or one level of nested ones ("Joins [SQL]").
const LINK_LINE = /^\s*[-*+]\s+\[((?:\\.|[^[\]\\]|\[[^\]]*\])+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*(?::\s*(.*))?$/;
const HEADING = /^(#{2,4})\s+(.*?)\s*#*\s*$/;
const HEADING_LINK = /^\[((?:\\.|[^[\]\\]|\[[^\]]*\])+)\]\(\s*([^)\s]+)\s*\)$/;
/** Whole-docs dumps linked from an index: llms-full.txt, llms-small.txt, llms-medium.txt, llms-ctx.txt… */
const DUMP = /\/llms-[\w-]+\.txt$/i;
const NESTED = /\/llms\.txt$/i;

const unescapeTitle = (title: string) => clean(title.replace(/\\([[\]\\()*_`])/g, '$1'), 200);

/** Parse an llms.txt into sections of page links. Returns null when it isn't one. */
export function parseLlmsTxt(text: string, base: string): Omit<DocSite, 'toc'> | null {
  if (!looksLikeMarkdown(text)) return null;
  const lines = text.split('\n');
  let title = '';
  const summary: string[] = [];
  const sections: DocSection[] = [];
  const seen = new Set<string>();
  let current: DocSection | undefined;
  let h2 = '';
  let pages = 0;

  for (const line of lines) {
    if (!title) {
      const h1 = line.match(/^#\s+(.+)$/);
      // The spec starts with "# Name"; anything before it is skipped (Pydantic puts instructions for agents there).
      if (h1) title = clean(h1[1], 120);
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const raw = heading[2]!;
      const linked = raw.match(HEADING_LINK);
      const name = linked ? unescapeTitle(linked[1]!) : unescapeTitle(raw);
      if (heading[1] === '##') h2 = name;
      current = { title: heading[1] === '##' || !h2 ? name : `${h2} › ${name}`, pages: [] };
      const url = linked ? safeHttpUrl(linked[2], base) : undefined;
      if (url) current.url = url;
      if (sections.length < DOCS_LIMITS.sections) sections.push(current);
      continue;
    }
    if (!sections.length && /^>\s?/.test(line)) { summary.push(line.replace(/^>\s?/, '')); continue; }
    const link = line.match(LINK_LINE);
    if (!link || pages >= DOCS_LIMITS.pages) continue;
    const url = safeHttpUrl(link[2], base);
    if (!url || seen.has(url)) continue;
    const path = new URL(url).pathname;
    if (DUMP.test(path)) continue;
    seen.add(url);
    const ref: DocPageRef = { title: unescapeTitle(link[1]!) || url, url };
    const description = clean(link[3], 300);
    if (description) ref.description = description;
    if (NESTED.test(path)) ref.index = true;
    if (!current) {
      current = { title, pages: [] };
      sections.push(current);
    }
    current.pages.push(ref);
    pages++;
  }
  if (!title || pages < 3) return null;
  const site: Omit<DocSite, 'toc'> = { title, sections: sections.filter((s) => s.pages.length) };
  const about = clean(summary.join(' '), 400);
  if (about) site.summary = about;
  return site;
}

// ---- Sphinx objects.inv ---------------------------------------------------------

const INVENTORY_HEADER = '# Sphinx inventory version 2';
/** The line format Sphinx itself parses: name, domain:role, priority, uri, display name. */
const INVENTORY_LINE = /^(.+?)\s+(\S+:\S+)\s+(-?\d+)\s+?(\S*)\s+(.*)$/;
/** Roles worth jumping to by name; labels, doc entries and parameters are not. */
const skipRole = (role: string) => (role.startsWith('std:') && !['std:term', 'std:envvar', 'std:cmdoption'].includes(role)) || role.endsWith(':functionParam');
/** Sections that read best first, when a Sphinx site has them. */
const FIRST = ['tutorial', 'intro', 'getting-started', 'quickstart', 'user', 'guide', 'howto', 'topics', 'library', 'reference', 'api'];

const words = (segment: string) => {
  const text = segment.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Parse a Sphinx objects.inv (the whole file, header and zlib body). Returns null when it isn't one. */
export function parseObjectsInv(data: Buffer, base: string): Omit<DocSite, 'toc'> | null {
  const header: string[] = [];
  let offset = 0;
  while (header.length < 4) {
    const end = data.indexOf(10, offset);
    if (end === -1) return null;
    header.push(data.subarray(offset, end).toString('utf8'));
    offset = end + 1;
  }
  if (header[0] !== INVENTORY_HEADER || !/zlib/.test(header[3]!)) return null;
  let body: string;
  try {
    body = inflateSync(data.subarray(offset), { maxOutputLength: DOCS_LIMITS.inventoryInflated }).toString('utf8');
  } catch {
    return null;
  }
  const project = clean(header[1]!.replace(/^# Project:\s*/, ''), 120) || 'Docs';
  const version = clean(header[2]!.replace(/^# Version:\s*/, ''), 40);

  const docs: Array<{ name: string; title: string; url: string }> = [];
  const symbols: DocSymbol[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(INVENTORY_LINE);
    if (!m) continue;
    const [, name, role, , uri, display] = m as unknown as [string, string, string, string, string, string];
    const url = safeHttpUrl(uri.endsWith('$') ? uri.slice(0, -1) + name : uri, base);
    if (!url) continue;
    if (role === 'std:doc') {
      if (docs.length < DOCS_LIMITS.pages) docs.push({ name, title: clean(display === '-' ? name : display, 200), url });
    } else if (!skipRole(role) && symbols.length < DOCS_LIMITS.symbols) {
      symbols.push({ name: clean(name, 200), role, url });
    }
  }
  if (docs.length < 3) return null;

  // Group pages by their first path segment; a folder's index page names its section.
  const groups = new Map<string, Array<{ name: string; title: string; url: string }>>();
  for (const doc of docs) {
    const slash = doc.name.indexOf('/');
    const key = slash === -1 ? '' : doc.name.slice(0, slash);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }
  const rank = (key: string) => (key === '' ? FIRST.length + 1 : FIRST.includes(key) ? FIRST.indexOf(key) : FIRST.length);
  const sections: DocSection[] = [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .slice(0, DOCS_LIMITS.sections)
    .map(([key, group]) => {
      const index = group.find((d) => d.name === `${key}/index`);
      const pages = index ? [index, ...group.filter((d) => d !== index)] : group;
      const section: DocSection = { title: key ? (index?.title ?? words(key)) : project, pages: pages.map((d) => ({ title: d.title, url: d.url })) };
      if (index) section.url = index.url;
      return section;
    });
  const site: Omit<DocSite, 'toc'> = { title: project, sections };
  if (version) site.summary = `Version ${version}`;
  if (symbols.length) site.symbols = symbols;
  return site;
}

// ---- sitemap.xml ----------------------------------------------------------------

const LOC = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi;

/** Page URLs of a sitemap, or the child sitemaps of a sitemap index. */
export function parseSitemap(xml: string): { urls: string[]; children: string[] } | null {
  if (!/<(?:urlset|sitemapindex)[\s>]/i.test(xml)) return null;
  const locs = [...xml.matchAll(LOC)].map((m) => safeHttpUrl(decodeEntities(m[1]!))).filter((u): u is string => !!u);
  return /<sitemapindex[\s>]/i.test(xml) ? { urls: [], children: locs } : { urls: locs, children: [] };
}

/** Pages under the docs root, in sections by their first path segment below it, titled from the URL. */
export function sitemapSite(urls: string[], root: string): Omit<DocSite, 'toc'> | null {
  const rootUrl = new URL(root);
  const prefix = rootUrl.pathname.endsWith('/') ? rootUrl.pathname : `${rootUrl.pathname}/`;
  const groups = new Map<string, DocPageRef[]>();
  const seen = new Set<string>();
  let count = 0;
  for (const href of urls) {
    const url = new URL(href);
    if (url.host !== rootUrl.host || !(url.pathname === rootUrl.pathname || url.pathname.startsWith(prefix))) continue;
    url.hash = '';
    if (seen.has(url.href) || count >= DOCS_LIMITS.pages) continue;
    seen.add(url.href);
    const rest = url.pathname.slice(prefix.length).replace(/\/$/, '').replace(/\.html?$/, '');
    const parts = rest.split('/').filter(Boolean);
    const key = parts.length > 1 ? parts[0]! : '';
    const last = parts[parts.length - 1];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ title: last ? words(decodeURIComponent(last)) : 'Overview', url: url.href });
    count++;
  }
  if (count < 3) return null;
  const title = words(rootUrl.hostname.replace(/^(?:www|docs)\./, '').split('.')[0] ?? 'Docs');
  const sections = [...groups.entries()]
    .sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : 0))
    .slice(0, DOCS_LIMITS.sections)
    .map(([key, pages]) => ({ title: key ? words(decodeURIComponent(key)) : title, pages }));
  return { title, sections };
}

// ---- resolving a site -------------------------------------------------------------

/** "docs.stripe.com" or a page URL → an http(s) URL. */
export function docsUrl(input: string): URL {
  const text = input.trim();
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
  for (let n = parts.length; n >= 0; n--) bases.push(`${url.origin}/${parts.slice(0, n).map((p) => `${p}/`).join('')}`);
  if (!parts.length && !/^docs\./i.test(url.hostname)) {
    const host = url.host.replace(/^www\./i, '');
    bases.push(`${url.protocol}//docs.${host}/`, `${url.origin}/docs/`);
  }
  return [...new Set(bases)];
}

async function getText(url: string, fetcher: Fetcher, maxBytes: number, accept: string): Promise<{ text: string; contentType: string; url: string } | null> {
  try {
    const res = await fetcher(url, { headers: { accept }, maxBytes, truncate: false });
    return res.status >= 200 && res.status < 300 ? { text: res.text, contentType: res.contentType, url: res.url || url } : null;
  } catch {
    return null;
  }
}

async function loadLlms(url: string, fetcher: Fetcher): Promise<DocSite | null> {
  const res = await getText(url, fetcher, DOCS_LIMITS.indexBytes, 'text/markdown, text/plain;q=0.9, */*;q=0.1');
  if (!res || !looksLikeMarkdown(res.text, res.contentType)) return null;
  const site = parseLlmsTxt(res.text, res.url);
  return site && { ...site, toc: { kind: 'llms', url } };
}

async function loadInventory(url: string, fetcher: Fetcher): Promise<DocSite | null> {
  try {
    const res = await fetcher(url, { maxBytes: DOCS_LIMITS.inventoryBytes, binary: true });
    if (res.status < 200 || res.status >= 300) return null;
    const site = parseObjectsInv(Buffer.from(res.text, 'base64'), res.url || url);
    return site && { ...site, toc: { kind: 'sphinx', url } };
  } catch {
    return null;
  }
}

async function loadSitemap(url: string, fetcher: Fetcher): Promise<DocSite | null> {
  const res = await getText(url, fetcher, DOCS_LIMITS.sitemapBytes, 'application/xml, text/xml;q=0.9');
  const map = res && parseSitemap(res.text);
  if (!map) return null;
  let urls = map.urls;
  if (map.children.length) {
    const children = await Promise.all(map.children.slice(0, DOCS_LIMITS.sitemapChildren).map((child) => getText(child, fetcher, DOCS_LIMITS.sitemapBytes, 'application/xml')));
    urls = children.flatMap((c) => (c && parseSitemap(c.text)?.urls) || []);
  }
  const root = url.replace(/sitemap(?:_index)?\.xml$/, '');
  const site = sitemapSite(urls, root);
  return site && { ...site, toc: { kind: 'sitemap', url } };
}

const LOADERS: Record<TocKind, { file: string[]; load: (url: string, fetcher: Fetcher) => Promise<DocSite | null> }> = {
  llms: { file: ['llms.txt'], load: loadLlms },
  sphinx: { file: ['objects.inv'], load: loadInventory },
  sitemap: { file: ['sitemap.xml', 'sitemap_index.xml'], load: loadSitemap },
};

/** Load a site's table of contents from a known source (a panel's stored toc, or a nested llms.txt). */
export async function loadDocs(toc: DocsToc, fetcher: Fetcher): Promise<DocSite> {
  const site = await LOADERS[toc.kind].load(toc.url, fetcher);
  if (!site) throw new DocsError(`${toc.url} isn't a readable ${toc.kind === 'llms' ? 'llms.txt' : toc.kind === 'sphinx' ? 'Sphinx inventory' : 'sitemap'}`);
  return site;
}

/**
 * Find a docs site's table of contents: llms.txt, then objects.inv, then a sitemap, nearest
 * directory first. One request at a time: some docs hosts rate-limit bursts (Django answers 429).
 */
export async function resolveDocs(input: string, fetcher: Fetcher): Promise<DocSite> {
  const bases = candidateBases(input);
  for (const kind of TOC_KINDS) {
    const { file, load } = LOADERS[kind];
    for (const url of bases.flatMap((base) => file.map((f) => base + f))) {
      const site = await load(url, fetcher);
      if (site) return site;
    }
  }
  throw new DocsError(`No docs index found for ${docsUrl(input).href}: tried llms.txt, a Sphinx objects.inv and a sitemap`);
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
  const domains = new Set([siteDomain(new URL(site.toc.url).hostname)]);
  for (const section of site.sections) {
    for (const page of section.pages) {
      if (page.url === target.href) return true;
      domains.add(siteDomain(new URL(page.url).hostname));
    }
  }
  return domains.has(siteDomain(target.hostname));
}

// ---- pages ----------------------------------------------------------------------

export type PageRoute = 'markdown' | 'suffix' | 'html';
const ROUTES: PageRoute[] = ['markdown', 'suffix', 'html'];

export interface DocPage {
  /** The page as linked from the table of contents. */
  url: string;
  /** Where the content actually came from (after redirects, or the .md sibling). */
  sourceUrl: string;
  title: string;
  route: PageRoute;
  blocks: ArticleBlock[];
  wordCount: number;
}

/** Per host, the route that last worked. Bounded; oldest forgotten first. */
const learned = new Map<string, PageRoute>();
function learn(host: string, route: PageRoute): void {
  learned.delete(host);
  learned.set(host, route);
  if (learned.size > 1000) learned.delete(learned.keys().next().value!);
}
export function learnedRoute(url: string): PageRoute | undefined {
  try { return learned.get(new URL(url).host); } catch { return undefined; }
}

const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** Markdown into blocks: front matter off, the leading H1 used as the title. */
export function markdownPage(markdown: string, fallbackTitle: string): { title: string; blocks: ArticleBlock[] } {
  let text = markdown;
  let title = '';
  const front = text.match(FRONT_MATTER);
  if (front) {
    title = clean(front[1]!.match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1], 200);
    text = text.slice(front[0].length);
  }
  const h1 = text.match(/^\s*#\s+(.+)$/m);
  if (!title && h1) title = clean(h1[1]!.replace(/^\[(.*)\]\(#[^)]*\)$/, '$1'), 200);
  const blocks = parseMarkdownLite(text);
  if (blocks[0]?.type === 'h' && (blocks[0].text === title || blocks[0].text.startsWith(`${title} (#`))) blocks.shift();
  return { title: title || fallbackTitle, blocks };
}

function mdSibling(url: string): string | undefined {
  const u = new URL(url);
  u.hash = '';
  if (u.pathname.endsWith('.md')) return undefined;
  u.pathname = u.pathname.replace(/\/$/, '').replace(/\.html?$/, '') + '.md';
  return u.href;
}

const countWords = (blocks: ArticleBlock[]) => blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);

/**
 * One docs page as blocks. Tries the host's learned route first, then the rest in order.
 * An HTML answer to the markdown request is kept, so the reader fallback costs no second fetch.
 */
export async function fetchDocPage(url: string, fetcher: Fetcher, options: { title?: string } = {}): Promise<DocPage> {
  const target = new URL(url);
  const first = learned.get(target.host);
  const order = first ? [first, ...ROUTES.filter((r) => r !== first)] : ROUTES;
  const fallbackTitle = options.title ?? target.pathname.split('/').filter(Boolean).pop() ?? target.hostname;
  let html: { text: string; url: string } | undefined;
  let lastStatus = 0;

  const get = async (href: string, accept: string) => {
    try {
      const res = await fetcher(href, { headers: { accept }, maxBytes: DOCS_LIMITS.pageBytes, truncate: true });
      lastStatus = res.status;
      return res.status >= 200 && res.status < 300 ? res : null;
    } catch (error) {
      lastStatus = 0;
      if (href === url) throw error; // blocked or unreachable: no point trying siblings
      return null;
    }
  };
  const done = (route: PageRoute, sourceUrl: string, page: { title: string; blocks: ArticleBlock[] }): DocPage => {
    learn(target.host, route);
    return { url, sourceUrl, title: page.title, route, blocks: page.blocks, wordCount: countWords(page.blocks) };
  };

  for (const route of order) {
    if (route === 'markdown') {
      const res = await get(url, 'text/markdown, text/x-markdown;q=0.95, text/plain;q=0.9, text/html;q=0.5, */*;q=0.1');
      if (!res) continue;
      if (looksLikeMarkdown(res.text, res.contentType)) return done('markdown', res.url || url, markdownPage(res.text, fallbackTitle));
      if (/html/i.test(res.contentType) || HTMLISH.test(res.text)) html = { text: res.text, url: res.url || url };
    } else if (route === 'suffix') {
      const sibling = mdSibling(url);
      const res = sibling && (await get(sibling, 'text/markdown, text/plain;q=0.9'));
      if (res && looksLikeMarkdown(res.text, res.contentType)) return done('suffix', res.url || sibling!, markdownPage(res.text, fallbackTitle));
    } else {
      if (!html) {
        const res = await get(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
        if (res && (/html|xml/i.test(res.contentType) || HTMLISH.test(res.text))) html = { text: res.text, url: res.url || url };
      }
      if (html) {
        const article = extractArticle(html.text);
        if (article.blocks.length) return done('html', html.url, { title: options.title ?? article.title, blocks: article.blocks });
      }
    }
  }
  throw new DocsError(lastStatus >= 400 ? `Page responded ${lastStatus}` : 'No readable version of this page');
}
