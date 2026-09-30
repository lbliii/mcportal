/**
 * Reader view: turn an article page into clean, plain-text blocks in one linear
 * pass. Output is data only (no HTML), so the UI renders it without injection
 * risk and the agent can treat it as content, never as instructions.
 */
import { parseAttrs, tokenize } from '../lib/html.ts';
import { clean, decodeEntities, INLINE } from '../lib/text.ts';
import type { ArticleBlock, Fetcher } from '../types.ts';

export interface Extracted {
  title: string;
  siteName?: string;
  byline?: string;
  blocks: ArticleBlock[];
  wordCount: number;
}

export const READER_LIMITS = { inputBytes: 1_500_000, blocks: 400, blockChars: 4000, totalChars: 200_000 };

const SKIP = new Set(['nav', 'header', 'footer', 'aside', 'form', 'iframe', 'button', 'template', 'svg', 'noscript', 'select', 'dialog', 'menu']);
const BLOCK: Record<string, ArticleBlock['type']> = { p: 'p', li: 'li', pre: 'pre', blockquote: 'quote', h1: 'h', h2: 'h', h3: 'h', h4: 'h', h5: 'h', h6: 'h' };

type Zone = 'article' | 'main' | 'body';

export function extractArticle(html: string): Extracted {
  const meta: Record<string, string> = {};
  let docTitle = '';
  let skip = 0;
  let article = 0;
  let main = 0;
  let quote = 0;
  const found: Array<ArticleBlock & { zone: Zone }> = [];
  let current: { type: ArticleBlock['type']; zone: Zone; parts: string[] } | null = null;
  let pre = 0;

  const flush = () => {
    if (!current) return;
    const raw = decodeEntities(current.parts.join(''));
    const text = current.type === 'pre' ? raw.replace(/^\n+|\s+$/g, '').slice(0, READER_LIMITS.blockChars) : clean(raw, READER_LIMITS.blockChars);
    if (text) found.push({ type: current.type, text, zone: current.zone });
    current = null;
  };
  const zone = (): Zone => (article > 0 ? 'article' : main > 0 ? 'main' : 'body');

  for (const tok of tokenize(html.slice(0, READER_LIMITS.inputBytes))) {
    if (found.length >= READER_LIMITS.blocks * 3) break;
    if (tok.kind === 'raw') {
      if (tok.name === 'title' && !docTitle) docTitle = clean(decodeEntities(tok.text), 300);
      continue;
    }
    if (tok.kind === 'text') {
      if (current && skip === 0) current.parts.push(tok.text);
      continue;
    }
    const name = tok.name;
    if (tok.kind === 'open') {
      if (name === 'meta') {
        const a = parseAttrs(tok.attrs);
        const key = (a.property ?? a.name ?? '').toLowerCase();
        if (key && a.content && !(key in meta)) meta[key] = clean(decodeEntities(a.content), 300);
        continue;
      }
      if (SKIP.has(name) && !tok.selfClosing) { skip++; continue; }
      if (name === 'article') { article++; continue; }
      if (name === 'main') { main++; continue; }
      if (name === 'br') { if (current) current.parts.push(pre ? '\n' : ' '); continue; }
      const type = BLOCK[name];
      if (type && skip === 0) {
        if (name === 'blockquote') quote++;
        if (name === 'pre') pre++;
        flush();
        current = { type: type === 'p' && quote > 0 ? 'quote' : type, zone: zone(), parts: [] };
        continue;
      }
      if (current && !INLINE.has(name) && !pre) current.parts.push(' ');
      continue;
    }
    // close
    if (SKIP.has(name)) { if (skip > 0) skip--; continue; }
    if (name === 'article') { if (article > 0) article--; continue; }
    if (name === 'main') { if (main > 0) main--; continue; }
    if (BLOCK[name]) {
      if (name === 'blockquote' && quote > 0) quote--;
      if (name === 'pre' && pre > 0) pre--;
      flush();
      continue;
    }
    if (current && !INLINE.has(name) && !pre) current.parts.push(' ');
  }
  flush();

  const title = meta['og:title'] || docTitle || 'Untitled';
  const preferred: Zone | undefined = found.some((b) => b.zone === 'article') ? 'article' : found.some((b) => b.zone === 'main') ? 'main' : undefined;
  const blocks: ArticleBlock[] = [];
  let chars = 0;
  for (const b of found) {
    if (preferred && b.zone !== preferred) continue;
    if (b.type === 'h' && b.text === title) continue;
    if (blocks.length >= READER_LIMITS.blocks || chars + b.text.length > READER_LIMITS.totalChars) break;
    chars += b.text.length;
    blocks.push({ type: b.type, text: b.text });
  }
  const wordCount = blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  return {
    title,
    siteName: meta['og:site_name'] || undefined,
    byline: meta.author || meta['article:author'] || undefined,
    blocks,
    wordCount,
  };
}

export async function fetchArticle(url: string, fetcher: Fetcher): Promise<Extracted & { finalUrl: string }> {
  const res = await fetcher(url, {
    headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    maxBytes: READER_LIMITS.inputBytes,
    truncate: true,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`Page responded ${res.status}`);
  if (res.contentType && !/html|xml|text\/plain/i.test(res.contentType)) {
    throw new Error('Reader view only supports web pages');
  }
  return { ...extractArticle(res.text), finalUrl: res.url };
}
