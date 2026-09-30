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
 */
import { inflateSync } from 'node:zlib';
import { cleanDocsMarkdown, MARKDOWN_LIMITS, parseMarkdown } from '../lib/markdown.ts';
import { clean, decodeEntities, safeHttpUrl } from '../lib/text.ts';
import type { ArticleBlock, Fetcher } from '../types.ts';
import { GITHUB_API, githubHeaders, REPO_PATTERN } from './github.ts';
import { extractArticle } from './reader.ts';

export const TOC_KINDS = ['llms', 'sphinx', 'sitemap', 'github'] as const;
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
  treeBytes: 20_000_000,
  outlineBytes: 500_000,
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

// ---- GitHub docs folders ------------------------------------------------------------

export interface GithubDocs {
  owner: string;
  repo: string;
  /** Branch, tag or commit; HEAD is the default branch. */
  ref: string;
  /** The docs folder, '' for the repo root. */
  path: string;
  /** Set when a single file was given (a blob or raw URL): open it. */
  file?: string;
}

const MARKDOWN_FILE = /\.(?:md|mdx|markdown)$/i;
const SKIP_DIR = /(?:^|\/)(?:node_modules|vendor|\.[^/]*)(?:\/|$)/;
const LOCALE = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;
/** Where docs usually live, tried in order when only a repo is given. */
const DOCS_FOLDERS = ['docs', 'doc', 'documentation', 'book/src', 'src/docs', 'website/docs', 'src/content/docs', 'guide', 'guides'];
const OUTLINES = ['SUMMARY.md', '_sidebar.md'];
/** github.com paths that are GitHub's own pages, not owner/repo. */
const GITHUB_RESERVED = new Set(['about', 'apps', 'codespaces', 'collections', 'customer-stories', 'enterprise', 'events', 'explore', 'features', 'issues', 'login', 'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls', 'readme', 'search', 'security', 'settings', 'site', 'sponsors', 'topics', 'trending', 'users']);
/** Files for agents or repo upkeep, not documentation. */
const NOT_DOCS = /^(?:agents|claude|gemini|copilot-instructions|code_of_conduct|security|license|licence|pull_request_template|issue_template)\.(?:md|mdx|markdown)$/i;

function cleanPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return parts.some((p) => p === '.' || p === '..' || /[\\\0]/.test(p)) ? null : parts.join('/');
}

/** owner/repo, github.com/owner/repo[/tree|blob/ref/path], or a raw.githubusercontent.com file. Null when it's none of these. */
export function parseGithubDocs(input: string): GithubDocs | null {
  const text = input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[?#].*$/, '');
  const short = text.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/);
  if (short && REPO_PATTERN.test(`${short[1]}/${short[2]}`)) return { owner: short[1]!, repo: short[2]!, ref: 'HEAD', path: '' };
  const [host, owner, repoRaw, ...rest] = text.split('/');
  const repo = repoRaw?.replace(/\.git$/, '');
  if (!owner || !repo || !REPO_PATTERN.test(`${owner}/${repo}`)) return null;
  if (host?.toLowerCase() === 'github.com') {
    if (GITHUB_RESERVED.has(owner.toLowerCase())) return null;
    const [kind, ref, ...path] = rest;
    if (!kind) return { owner, repo, ref: 'HEAD', path: '' };
    if ((kind !== 'tree' && kind !== 'blob') || !ref) return null;
    const clean = cleanPath(path.join('/'));
    if (clean === null) return null;
    if (kind === 'blob' && MARKDOWN_FILE.test(clean)) return { owner, repo, ref, path: clean.split('/').slice(0, -1).join('/'), file: clean };
    return { owner, repo, ref, path: clean };
  }
  if (host?.toLowerCase() === 'raw.githubusercontent.com') {
    const [ref, ...path] = rest;
    const clean = ref ? cleanPath(path.join('/')) : null;
    if (!ref || clean === null) return null;
    return MARKDOWN_FILE.test(clean) ? { owner, repo, ref, path: clean.split('/').slice(0, -1).join('/'), file: clean } : { owner, repo, ref, path: clean };
  }
  return null;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export const githubTocUrl = (g: GithubDocs) => `https://github.com/${g.owner}/${g.repo}/tree/${encodeURIComponent(g.ref)}${g.path ? `/${encodePath(g.path)}` : ''}`;
export const githubRawUrl = (g: GithubDocs, file: string) => `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${encodeURIComponent(g.ref)}/${encodePath(file)}`;

/** Where a page reads best in a browser: a raw GitHub file's page on github.com; anything else as is. */
export function originalUrl(url: string): string {
  const g = parseGithubDocs(url);
  return g?.file && /^https:\/\/raw\.githubusercontent\.com\//.test(url) ? `https://github.com/${g.owner}/${g.repo}/blob/${encodeURIComponent(g.ref)}/${encodePath(g.file)}` : url;
}

async function githubFiles(g: GithubDocs, fetcher: Fetcher): Promise<string[]> {
  const url = `${GITHUB_API}/repos/${g.owner}/${g.repo}/git/trees/${encodeURIComponent(g.ref)}?recursive=1`;
  const res = await fetcher(url, { headers: githubHeaders(), maxBytes: DOCS_LIMITS.treeBytes });
  if (res.status === 404 || res.status === 409) throw new DocsError(`GitHub has no repository ${g.owner}/${g.repo}${g.ref === 'HEAD' ? '' : ` at ${g.ref}`} (or it's private or empty)`);
  if (res.status === 403 || res.status === 429) throw new DocsError('GitHub is rate-limiting requests right now; try again in a few minutes');
  if (res.status < 200 || res.status >= 300) throw new DocsError(`GitHub responded ${res.status}`);
  const data = JSON.parse(res.text) as { tree?: Array<{ path?: unknown; type?: unknown }> };
  return (data.tree ?? []).filter((e) => e.type === 'blob' && typeof e.path === 'string').map((e) => e.path as string);
}

/** An outline file (mdBook SUMMARY.md, docsify _sidebar.md): link lines, nested by indent, under optional headings. */
export function parseOutline(text: string, base: string, known: Set<string>, fallbackTitle: string): { title?: string; sections: DocSection[] } {
  const LINK = /^(\s*)(?:[-*+]\s+|\d{1,3}[.)]\s+)?\[((?:\\.|[^[\]\\]|\[[^\]]*\])+)\]\(\s*<?([^)\s>]+)>?[^)]*\)\s*$/;
  const lines = text.split('\n');
  const sections: DocSection[] = [];
  let title: string | undefined;
  let current: DocSection | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (heading[1] === '#' && !title && !sections.length) title = clean(heading[2], 120);
      else { current = { title: unescapeTitle(heading[2]!), pages: [] }; sections.push(current); }
      continue;
    }
    const link = line.match(LINK);
    if (!link) continue;
    const resolved = safeHttpUrl(link[3], base);
    if (!resolved) continue;
    const url = resolved.replace(/#.*$/, '');
    if (!known.has(url) || seen.has(url)) continue;
    seen.add(url);
    const page: DocPageRef = { title: unescapeTitle(link[2]!) || url, url };
    const indent = link[1]!.length;
    const next = lines.slice(i + 1).find((l) => l.trim());
    const hasChildren = indent === 0 && !!next && LINK.test(next) && next.match(LINK)![1]!.length > 0;
    if (hasChildren) {
      current = { title: page.title, url, pages: [page] };
      sections.push(current);
    } else if (indent === 0 && current?.url) {
      // A chapter without sub-pages, after chapters with them: its own section.
      current = { title: page.title, url, pages: [page] };
      sections.push(current);
    } else {
      if (!current) { current = { title: title ?? fallbackTitle, pages: [] }; sections.push(current); }
      current.pages.push(page);
    }
  }
  return { ...(title ? { title } : {}), sections: sections.filter((s) => s.pages.length).slice(0, DOCS_LIMITS.sections) };
}

const fileTitle = (name: string) => words(name.replace(MARKDOWN_FILE, '').replace(/^\d+[-_.\s]+/, '')) || name;
const isIndex = (name: string) => /^(?:readme|index)\.(?:md|mdx|markdown)$/i.test(name);
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/**
 * A GitHub docs folder as a site. With no folder given, the first of the usual docs folders
 * that holds markdown; failing that, the repo's top-level markdown (the README).
 */
export async function loadGithubDocs(tocUrl: string, fetcher: Fetcher): Promise<DocSite> {
  const g = parseGithubDocs(tocUrl);
  if (!g) throw new DocsError(`${tocUrl} isn't a GitHub repository or folder`);
  const all = (await githubFiles(g, fetcher)).filter((f) => MARKDOWN_FILE.test(f) && !SKIP_DIR.test(f) && !NOT_DOCS.test(f.split('/').pop()!));
  const under = (dir: string) => all.filter((f) => (dir ? f.startsWith(`${dir}/`) : true));
  let path = g.path;
  if (!path) {
    // A shallow folder with an outline file (mdBook's src/SUMMARY.md, docsify's docs/_sidebar.md) is the docs; else the usual names.
    const outlined = all.filter((f) => OUTLINES.includes(f.split('/').pop()!) && f.split('/').length <= 3).sort((a, b) => a.length - b.length)[0];
    const outlineDir = outlined?.split('/').slice(0, -1).join('/');
    path = outlineDir && under(outlineDir).length >= 3 ? outlineDir : (DOCS_FOLDERS.find((dir) => under(dir).length >= 2) ?? '');
  }
  let files = path ? under(path) : all.filter((f) => !f.includes('/'));
  if (!files.length) throw new DocsError(`No markdown found in ${g.owner}/${g.repo}${path ? `/${path}` : ''}`);

  // Translated docs: keep English when the folder has several locale folders and an en/ one.
  const rel = (f: string) => (path ? f.slice(path.length + 1) : f);
  const dirs = new Set(files.map(rel).filter((f) => f.includes('/')).map((f) => f.split('/')[0]!));
  const locales = [...dirs].filter((d) => LOCALE.test(d));
  const en = locales.find((d) => /^en(?:[-_]us)?$/i.test(d));
  if (en && locales.length >= 2) {
    path = path ? `${path}/${en}` : en;
    files = under(path);
  }
  files = files.filter((f) => !/^_/.test(f.split('/').pop()!) || OUTLINES.includes(f.split('/').pop()!)).slice(0, DOCS_LIMITS.pages * 2);

  const site: GithubDocs = { ...g, path };
  const title = `${g.owner}/${g.repo}`;
  const known = new Set(files.map((f) => githubRawUrl(site, f)));
  const toc: DocsToc = { kind: 'github', url: githubTocUrl(site) };

  // An outline file orders the pages when there is one.
  for (const name of OUTLINES) {
    const outline = files.find((f) => rel(f) === name);
    if (!outline) continue;
    const res = await getText(githubRawUrl(site, outline), fetcher, DOCS_LIMITS.outlineBytes, 'text/plain');
    if (!res) continue;
    const parsed = parseOutline(res.text, githubRawUrl(site, outline), known, title);
    if (parsed.sections.reduce((n, s) => n + s.pages.length, 0) >= 2) {
      return { title: parsed.title ?? title, summary: path ? `${title} · ${path}` : title, toc, sections: parsed.sections };
    }
  }

  // Otherwise: a section per subfolder, the folder's README or index first.
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const name = f.split('/').pop()!;
    if (OUTLINES.includes(name)) continue;
    const parts = rel(f).split('/');
    const key = parts.length > 1 ? parts[0]! : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  let count = 0;
  const sections: DocSection[] = [...groups.entries()]
    .sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : natural(a[0], b[0])))
    .slice(0, DOCS_LIMITS.sections)
    .map(([key, group]) => {
      const sorted = group.sort((a, b) => {
        const depth = a.split('/').length - b.split('/').length;
        const ai = isIndex(a.split('/').pop()!) ? 0 : 1;
        const bi = isIndex(b.split('/').pop()!) ? 0 : 1;
        return depth || ai - bi || natural(a, b);
      });
      const pages: DocPageRef[] = [];
      for (const f of sorted) {
        if (count >= DOCS_LIMITS.pages) break;
        const parts = f.split('/');
        const name = parts.pop()!;
        const folder = parts.pop();
        pages.push({ title: isIndex(name) ? (key ? 'Overview' : folder && folder !== path.split('/').pop() ? fileTitle(folder) : 'Introduction') : fileTitle(name), url: githubRawUrl(site, f) });
        count++;
      }
      const section: DocSection = { title: key ? fileTitle(key) : title, pages };
      return section;
    })
    .filter((s) => s.pages.length);
  return { title, summary: path ? `${title} · ${path}` : title, toc, sections };
}

// ---- search ------------------------------------------------------------------------

export interface DocHit {
  kind: 'page' | 'symbol';
  title: string;
  url: string;
  section?: string;
  role?: string;
}

/** Search a site's page titles, descriptions and section names, and (Sphinx) its symbols. */
export function searchDocs(site: DocSite, query: string, limit = 20): DocHit[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/[^\p{L}\p{N}_.]+/u).filter(Boolean);
  if (!tokens.length) return [];
  const scored: Array<{ hit: DocHit; score: number }> = [];
  for (const section of site.sections) {
    for (const page of section.pages) {
      const title = page.title.toLowerCase();
      const hay = `${title} ${(page.description ?? '').toLowerCase()} ${section.title.toLowerCase()}`;
      if (!tokens.every((t) => hay.includes(t))) continue;
      const score = (title === q ? 100 : title.startsWith(q) ? 60 : title.includes(q) ? 40 : 0) + tokens.filter((t) => title.includes(t)).length * 10;
      scored.push({ hit: { kind: 'page', title: page.title, url: page.url, section: section.title }, score });
    }
  }
  for (const symbol of site.symbols ?? []) {
    const name = symbol.name.toLowerCase();
    const score = name === q ? 120 : name.endsWith(`.${q}`) ? 90 : name.startsWith(q) ? 70 : name.includes(q) ? 30 : 0;
    if (score) scored.push({ hit: { kind: 'symbol', title: symbol.name, url: symbol.url, role: symbol.role }, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.hit.title.length - b.hit.title.length)
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((s) => s.hit);
}

// ---- resolving a site -------------------------------------------------------------

/** What a user typed ("docs.stripe.com", "owner/repo", a folder link) as the URL a docs panel stores. */
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
  github: { file: [], load: (url, fetcher) => loadGithubDocs(url, fetcher) },
};

const KIND_NAMES: Record<TocKind, string> = { llms: 'llms.txt', sphinx: 'Sphinx inventory', sitemap: 'sitemap', github: 'GitHub docs folder' };

/** Load a site's table of contents from a known source (a panel's stored toc, or a nested llms.txt). */
export async function loadDocs(toc: DocsToc, fetcher: Fetcher): Promise<DocSite> {
  const site = await LOADERS[toc.kind].load(toc.url, fetcher);
  if (!site) throw new DocsError(`${toc.url} isn't a readable ${KIND_NAMES[toc.kind]}`);
  return site;
}

/**
 * Find a docs site's table of contents: llms.txt, then objects.inv, then a sitemap, nearest
 * directory first. One request at a time: some docs hosts rate-limit bursts (Django answers 429).
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
  for (const kind of ['llms', 'sphinx', 'sitemap'] as const) {
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

/** Notices for agents that generators put at the top of every page ("Fetch the complete documentation index at …/llms.txt"). */
const AGENT_NOTICE = /\bllms(?:-full)?\.txt\b|^documentation index\b/i;

/** Markdown into blocks: front matter off, MDX cleaned, the leading H1 used as the title. */
export function markdownPage(markdown: string, fallbackTitle: string, base?: string): { title: string; blocks: ArticleBlock[] } {
  let text = markdown;
  let title = '';
  const front = text.match(FRONT_MATTER);
  if (front) {
    title = clean(front[1]!.match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1], 200);
    text = text.slice(front[0].length);
  }
  const h1 = text.match(/^\s*#\s+(.+)$/m);
  if (!title && h1) title = clean(h1[1]!.replace(/^\[(.*)\]\(#[^)]*\)$/, '$1').replace(/\s*\{#[\w-]+\}\s*$/, ''), 200);
  const blocks = parseMarkdown(cleanDocsMarkdown(text), base ? { base } : {})
    .filter((b, i) => i > 3 || !((b.type === 'quote' || b.type === 'callout') && AGENT_NOTICE.test(b.text)));
  const first = blocks.findIndex((b) => b.type !== 'quote');
  // In a GitHub docs folder, books link their built pages (ch02.html); the source is the .md beside it.
  if (base && /^https:\/\/raw\.githubusercontent\.com\//.test(base)) {
    for (const b of blocks) for (const s of b.spans ?? []) {
      if (s.href?.startsWith('https://raw.githubusercontent.com/')) s.href = s.href.replace(/\.html?(?=#|$)/, '.md');
    }
  }
  // The page's own title heading (an H1, or an H2 in books whose chapters start at ##) is shown as the title already.
  if (blocks[first]?.type === 'h' && (blocks[first].level ?? 1) <= 2 && blocks[first].text.toLowerCase() === (title || fallbackTitle).toLowerCase()) blocks.splice(first, 1);
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
      if (looksLikeMarkdown(res.text, res.contentType)) return done('markdown', res.url || url, markdownPage(res.text, fallbackTitle, res.url || url));
      if (/html/i.test(res.contentType) || HTMLISH.test(res.text)) html = { text: res.text, url: res.url || url };
    } else if (route === 'suffix') {
      const sibling = mdSibling(url);
      const res = sibling && (await get(sibling, 'text/markdown, text/plain;q=0.9'));
      if (res && looksLikeMarkdown(res.text, res.contentType)) return done('suffix', res.url || sibling!, markdownPage(res.text, fallbackTitle, res.url || sibling!));
    } else {
      if (!html) {
        const res = await get(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
        if (res && (/html|xml/i.test(res.contentType) || HTMLISH.test(res.text))) html = { text: res.text, url: res.url || url };
      }
      if (html) {
        const article = extractArticle(html.text, html.url, MARKDOWN_LIMITS);
        const title = options.title ?? article.title;
        const blocks = article.blocks[0]?.type === 'h' && article.blocks[0].level === 1 && article.blocks[0].text === title ? article.blocks.slice(1) : article.blocks;
        if (blocks.length) return done('html', html.url, { title, blocks });
      }
    }
  }
  throw new DocsError(lastStatus >= 400 ? `Page responded ${lastStatus}` : 'No readable version of this page');
}
