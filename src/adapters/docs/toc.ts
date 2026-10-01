/**
 * Tables of contents from a docs site's own indexes: llms.txt, Sphinx's objects.inv and
 * sitemap.xml. Each parser returns null when the body isn't one; each loader fetches one
 * and parses it. Also the small helpers the GitHub and page modules share
 * (looksLikeMarkdown, titles from paths, getText).
 */
import { inflateSync } from 'node:zlib';
import { clean, decodeEntities, safeHttpUrl } from '../../lib/text.ts';
import type { Fetcher } from '../../types.ts';
import { DOCS_LIMITS, type DocPageRef, type DocSection, type DocSite, type DocSymbol } from './types.ts';

// ---- validation ---------------------------------------------------------------

export const HTMLISH = /^\s*(?:<!doctype|<html|<head|<body|<\?xml)/i;

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

export const unescapeTitle = (title: string) => clean(title.replace(/\\([[\]\\()*_`])/g, '$1'), 200);

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

/** A path segment as a title: "getting-started" → "Getting started". */
export const words = (segment: string) => {
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

// ---- loaders ----------------------------------------------------------------------

/** A 2xx text body, or null for anything else (a failed fetch included). */
export async function getText(url: string, fetcher: Fetcher, maxBytes: number, accept: string): Promise<{ text: string; contentType: string; url: string } | null> {
  try {
    const res = await fetcher(url, { headers: { accept }, maxBytes, truncate: false });
    return res.status >= 200 && res.status < 300 ? { text: res.text, contentType: res.contentType, url: res.url || url } : null;
  } catch {
    return null;
  }
}

export async function loadLlms(url: string, fetcher: Fetcher): Promise<DocSite | null> {
  const res = await getText(url, fetcher, DOCS_LIMITS.indexBytes, 'text/markdown, text/plain;q=0.9, */*;q=0.1');
  if (!res || !looksLikeMarkdown(res.text, res.contentType)) return null;
  const site = parseLlmsTxt(res.text, res.url);
  return site && { ...site, toc: { kind: 'llms', url } };
}

export async function loadInventory(url: string, fetcher: Fetcher): Promise<DocSite | null> {
  try {
    const res = await fetcher(url, { maxBytes: DOCS_LIMITS.inventoryBytes, binary: true });
    if (res.status < 200 || res.status >= 300) return null;
    const site = parseObjectsInv(Buffer.from(res.text, 'base64'), res.url || url);
    return site && { ...site, toc: { kind: 'sphinx', url } };
  } catch {
    return null;
  }
}

export async function loadSitemap(url: string, fetcher: Fetcher): Promise<DocSite | null> {
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
