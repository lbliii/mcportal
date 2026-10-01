/**
 * One docs page as blocks. A page comes from the first route that returns what it should:
 * the URL asked for markdown, the URL plus ".md", then the HTML reader. The route that
 * worked is remembered per host.
 */
import { upstreamStatus } from '../../lib/errors.ts';
import { cleanDocsMarkdown, MARKDOWN_LIMITS, parseMarkdown } from '../../lib/markdown.ts';
import { clean } from '../../lib/text.ts';
import type { ArticleBlock, Fetcher } from '../../types.ts';
import { extractArticle } from '../reader.ts';
import { HTMLISH, looksLikeMarkdown } from './toc.ts';
import { DOCS_LIMITS, DocsError } from './types.ts';

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
  throw lastStatus >= 400 ? upstreamStatus('Page', lastStatus) : new DocsError('No readable version of this page', 'upstream_error');
}
