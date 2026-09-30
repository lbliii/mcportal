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

// Share bars and article toolbars ("Share • Pin • Email", "Comments • Read Later") are lists
// of short links. An action label, or a link to a share endpoint, marks a list as chrome; network
// names alone ("Facebook", "LinkedIn") don't, so a real list of platforms survives.
const SHARE_ACTION = /^(?:\d[\d,.]*k?\s*)?(?:share(?: (?:this|on|via|to) [\w .]+)?|pin(?: it)?|e-?mail(?: this)?|mail|print|comments?|read later|save(?: for later)?|bookmark|copy(?: link)?|tweet)(?:\s*\d[\d,.]*k?)?$/i;
const SHARE_NETWORK = /^(?:x|x\.com|twitter|facebook|linkedin|reddit|pinterest|whatsapp|threads|bluesky|mastodon|tumblr|telegram|flipboard|pocket|hacker news|messenger|link)$/i;
const SHARE_HREF = /\/\/(?:[\w-]+\.)*(?:twitter\.com\/(?:intent|share)|x\.com\/intent|facebook\.com\/(?:sharer|dialog\/share)|linkedin\.com\/(?:share|cws\/share)|pinterest\.com\/pin\/create|reddit\.com\/submit|wa\.me\/|api\.whatsapp\.com\/send|t\.me\/share|bsky\.app\/intent|news\.ycombinator\.com\/submitlink|tumblr\.com\/(?:share|widgets\/share))/i;
const SHARE_HEADING = /^share(?: this(?: article| story| post| page)?)?\s*:?$/i;

type Found = ArticleBlock & { zone: Zone; list?: number; shareLink?: boolean };

/** Lists (by id) whose every item is a share or utility link. */
function shareLists(found: Found[]): Set<number> {
  const items = new Map<number, Found[]>();
  for (const b of found) {
    if (b.type !== 'li' || b.list === undefined) continue;
    const lis = items.get(b.list);
    if (lis) lis.push(b); else items.set(b.list, [b]);
  }
  const out = new Set<number>();
  for (const [id, lis] of items) {
    const allShort = lis.every((b) => b.text.length <= 40 && (SHARE_ACTION.test(b.text) || SHARE_NETWORK.test(b.text) || b.shareLink));
    if (allShort && lis.some((b) => SHARE_ACTION.test(b.text) || b.shareLink)) out.add(id);
  }
  return out;
}

export function extractArticle(html: string): Extracted {
  const meta: Record<string, string> = {};
  let docTitle = '';
  let skip = 0;
  let article = 0;
  let main = 0;
  let quote = 0;
  const found: Found[] = [];
  let current: { type: ArticleBlock['type']; zone: Zone; parts: string[]; list?: number; shareLink?: boolean } | null = null;
  let pre = 0;
  const lists: number[] = [];   // open <ul>/<ol> ids, innermost last
  let listId = 0;

  const flush = () => {
    if (!current) return;
    const raw = decodeEntities(current.parts.join(''));
    const text = current.type === 'pre' ? raw.replace(/^\n+|\s+$/g, '').slice(0, READER_LIMITS.blockChars) : clean(raw, READER_LIMITS.blockChars);
    if (text) found.push({ type: current.type, text, zone: current.zone, list: current.list, shareLink: current.shareLink });
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
      if ((name === 'ul' || name === 'ol') && skip === 0) { lists.push(listId++); continue; }
      if (name === 'a' && current && skip === 0 && SHARE_HREF.test(parseAttrs(tok.attrs).href ?? '')) current.shareLink = true;
      if (name === 'br') { if (current) current.parts.push(pre ? '\n' : ' '); continue; }
      const type = BLOCK[name];
      if (type && skip === 0) {
        if (name === 'blockquote') quote++;
        if (name === 'pre') pre++;
        flush();
        current = { type: type === 'p' && quote > 0 ? 'quote' : type, zone: zone(), parts: [], list: name === 'li' ? lists.at(-1) : undefined };
        continue;
      }
      if (current && !INLINE.has(name) && !pre) current.parts.push(' ');
      continue;
    }
    // close
    if (SKIP.has(name)) { if (skip > 0) skip--; continue; }
    if (name === 'article') { if (article > 0) article--; continue; }
    if (name === 'main') { if (main > 0) main--; continue; }
    if ((name === 'ul' || name === 'ol') && skip === 0) { flush(); lists.pop(); continue; }
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
  const chrome = shareLists(found);
  const isChrome = (b: Found | undefined) => b?.list !== undefined && chrome.has(b.list);
  const blocks: ArticleBlock[] = [];
  let chars = 0;
  for (const [i, b] of found.entries()) {
    if (preferred && b.zone !== preferred) continue;
    if (isChrome(b)) continue;
    if (b.type === 'h' && SHARE_HEADING.test(b.text) && isChrome(found[i + 1])) continue;
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
