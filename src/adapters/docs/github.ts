/**
 * GitHub repos as docs sites: parse what the user gave (owner/repo, a tree, blob or raw
 * link), list the repo's files with one API call, and turn a docs folder's markdown into
 * sections, ordered by SUMMARY.md or _sidebar.md when present.
 */
import { upstreamStatus } from '../../lib/errors.ts';
import { clean, safeHttpUrl } from '../../lib/text.ts';
import type { Fetcher } from '../../types.ts';
import { GITHUB_API, githubHeaders, REPO_PATTERN } from '../github.ts';
import { getText, unescapeTitle, words } from './toc.ts';
import { DOCS_LIMITS, DocsError, type DocPageRef, type DocSection, type DocSite, type DocsToc } from './types.ts';

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

export const MARKDOWN_FILE = /\.(?:md|mdx|markdown)$/i;
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
  if (res.status === 404 || res.status === 409) throw new DocsError(`GitHub has no repository ${g.owner}/${g.repo}${g.ref === 'HEAD' ? '' : ` at ${g.ref}`} (or it's private or empty)`, 'not_found');
  if (res.status === 403 || res.status === 429) throw new DocsError('GitHub is rate-limiting requests right now; try again in a few minutes', 'rate_limited');
  if (res.status < 200 || res.status >= 300) throw upstreamStatus('GitHub', res.status);
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
  if (!files.length) throw new DocsError(`No markdown found in ${g.owner}/${g.repo}${path ? `/${path}` : ''}`, 'not_found');

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
  /** The folders between a page's section and the page: "projects" for concepts/projects/workspaces.md. */
  const below = (f: string) => rel(f).split('/').slice(1, -1).join('/');
  let count = 0;
  const sections: DocSection[] = [...groups.entries()]
    .sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : natural(a[0], b[0])))
    .slice(0, DOCS_LIMITS.sections)
    .map(([key, group]) => {
      // The section's own pages first, then each deeper folder together, led by its index.
      const sorted = group.sort((a, b) => {
        const da = below(a), db = below(b);
        const ai = isIndex(a.split('/').pop()!) ? 0 : 1;
        const bi = isIndex(b.split('/').pop()!) ? 0 : 1;
        return Number(Boolean(da)) - Number(Boolean(db)) || natural(da, db) || ai - bi || natural(a, b);
      });
      const pages: DocPageRef[] = [];
      for (const f of sorted) {
        if (count >= DOCS_LIMITS.pages) break;
        const parts = f.split('/');
        const name = parts.pop()!;
        const folder = parts.pop();
        // A page in a deeper folder names it, "Projects › Workspaces", so two folders' "Overview"s differ.
        const sub = below(f).split('/').filter(Boolean).map(fileTitle);
        const own = isIndex(name)
          ? (sub.length ? undefined : key ? 'Overview' : folder && folder !== path.split('/').pop() ? fileTitle(folder) : 'Introduction')
          : fileTitle(name);
        pages.push({ title: [...sub, ...(own ? [own] : [])].join(' › '), url: githubRawUrl(site, f) });
        count++;
      }
      const section: DocSection = { title: key ? fileTitle(key) : title, pages };
      return section;
    })
    .filter((s) => s.pages.length);
  return { title, summary: path ? `${title} · ${path}` : title, toc, sections };
}
