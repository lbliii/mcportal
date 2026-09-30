/**
 * Reader view: turn an article page into clean, plain-text blocks.
 * Output is data only (no HTML), so the UI can render it without injection risk
 * and the agent can treat it as content, never as instructions.
 */
import { decodeEntities, htmlToText } from '../lib/text.ts';
import type { ArticleBlock, Fetcher } from '../types.ts';

export interface Extracted {
  title: string;
  siteName?: string;
  byline?: string;
  blocks: ArticleBlock[];
  wordCount: number;
}

const MAX_BLOCKS = 400;

function meta(html: string, key: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() === key) {
      const content = tag.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i);
      const value = content ? decodeEntities(content[2] ?? content[3] ?? '').trim() : '';
      if (value) return value;
    }
  }
  return undefined;
}

function largest(html: string, tag: string): string | undefined {
  const matches = html.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi')) ?? [];
  return matches.sort((a, b) => b.length - a.length)[0];
}

export function extractArticle(html: string): Extracted {
  const title =
    meta(html, 'og:title') ?? htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') ?? 'Untitled';
  const siteName = meta(html, 'og:site_name');
  const byline = meta(html, 'author') ?? meta(html, 'article:author');

  let body = largest(html, 'article') ?? largest(html, 'main') ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|button|template)\b[\s\S]*?<\/\1>/gi, ' ');

  const blocks: ArticleBlock[] = [];
  const re = /<(h[1-6]|p|li|pre|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) && blocks.length < MAX_BLOCKS) {
    const tag = match[1]!.toLowerCase();
    const inner = match[2]!;
    if (tag === 'pre') {
      const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/^\n+|\s+$/g, '');
      if (text) blocks.push({ type: 'pre', text });
      continue;
    }
    if (tag === 'blockquote' && /<p\b/i.test(inner)) {
      // Let the inner paragraphs be picked up individually as quotes.
      re.lastIndex = match.index + match[0].indexOf('>') + 1;
      continue;
    }
    const text = htmlToText(inner);
    if (!text) continue;
    const type: ArticleBlock['type'] = tag.startsWith('h') ? 'h' : tag === 'li' ? 'li' : tag === 'blockquote' ? 'quote' : 'p';
    if (type === 'h' && text === title) continue;
    blocks.push({ type, text });
  }

  const wordCount = blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  return { title: title || 'Untitled', siteName, byline, blocks, wordCount };
}

export async function fetchArticle(url: string, fetcher: Fetcher): Promise<Extracted & { finalUrl: string }> {
  const res = await fetcher(url, {
    headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    maxBytes: 3_000_000,
    truncate: true,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`Page responded ${res.status}`);
  if (res.contentType && !/html|xml|text\/plain/i.test(res.contentType)) {
    throw new Error(`Reader view only supports web pages (got ${res.contentType.split(';')[0]})`);
  }
  return { ...extractArticle(res.text), finalUrl: res.url };
}
