/**
 * Dependency-free RSS 2.0 / Atom parser. Linear time: every search is an
 * indexOf that starts at the current cursor, so unclosed tags can't cause
 * quadratic scans. Every value comes out as plain, single-line text.
 */
import { upstreamStatus } from '../lib/errors.ts';
import { parseAttrs } from '../lib/html.ts';
import { clean, decodeEntities, hostOf, htmlToText, safeHttpUrl, stripCdata, truncate } from '../lib/text.ts';
import { MAX_THUMB_BYTES, type Fetcher, type Item } from '../types.ts';

export interface RssConfig {
  url: string;
  limit: number;
}

export interface ParsedFeed {
  title: string;
  items: Item[];
}

function isBoundary(code: number): boolean {
  return Number.isNaN(code) || code === 62 || code === 47 || code === 32 || code === 9 || code === 10 || code === 13;
}

/** Index of the next `<name` start tag at or after `from` (exact name), or -1. */
function findOpen(lower: string, name: string, from: number): number {
  const needle = `<${name}`;
  let i = lower.indexOf(needle, from);
  while (i !== -1 && !isBoundary(lower.charCodeAt(i + needle.length))) i = lower.indexOf(needle, i + 1);
  return i;
}

/** Split out top-level <item>/<entry> blocks. */
function blocksOf(xml: string, lower: string, name: string, max: number): string[] {
  const out: string[] = [];
  const close = `</${name}>`;
  let i = 0;
  while (out.length < max) {
    const start = findOpen(lower, name, i);
    if (start === -1) break;
    const end = lower.indexOf(close, start);
    if (end === -1) break;
    out.push(xml.slice(start, end + close.length));
    i = end + close.length;
  }
  return out;
}

/** Inner text of the first <name>…</name> in a block, CDATA unwrapped. */
function tagText(block: string, lower: string, name: string): string | undefined {
  const start = findOpen(lower, name, 0);
  if (start === -1) return undefined;
  const gt = lower.indexOf('>', start);
  if (gt === -1) return undefined;
  if (lower.charCodeAt(gt - 1) === 47 /* self-closing */) return '';
  const end = lower.indexOf(`</${name}>`, gt);
  if (end === -1) return undefined;
  return stripCdata(block.slice(gt + 1, end)).trim();
}

function atomLink(block: string, lower: string): string | undefined {
  let first: string | undefined;
  let i = 0;
  while (true) {
    const start = findOpen(lower, 'link', i);
    if (start === -1) break;
    const gt = lower.indexOf('>', start);
    if (gt === -1) break;
    const attrs = parseAttrs(block.slice(start + 5, gt));
    if (attrs.href) {
      if (!attrs.rel || attrs.rel.toLowerCase() === 'alternate') return attrs.href;
      first ??= attrs.href;
    }
    i = gt + 1;
  }
  return first;
}

/** Attributes of the first `<name ...>` tag in a block, or undefined. */
function tagAttrs(block: string, lower: string, name: string): Record<string, string> | undefined {
  const start = findOpen(lower, name, 0);
  if (start === -1) return undefined;
  const gt = lower.indexOf('>', start);
  if (gt === -1) return undefined;
  return parseAttrs(block.slice(start + name.length + 1, gt));
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/**
 * A thumbnail for an item: media:thumbnail, an image media:content or enclosure,
 * itunes:image, else the first <img> in the item's HTML. A rendition the feed says
 * is over MAX_THUMB_BYTES (enclosure length, media:content fileSize) is skipped when
 * there's another candidate: /Film's enclosures are multi-MB originals while its
 * inline <img> is a smaller cut. YouTube thumbnails are swapped for the 320x180 size.
 */
function itemImage(block: string, lower: string, baseUrl?: string): string | undefined {
  const candidates: Array<string | undefined> = [];
  const tooBig = new Set<string>();
  const noteSize = (url: string | undefined, bytes: string | undefined) => {
    if (url && Number(bytes) > MAX_THUMB_BYTES) tooBig.add(url);
  };
  candidates.push(tagAttrs(block, lower, 'media:thumbnail')?.url);
  const content = tagAttrs(block, lower, 'media:content');
  if (content && (content.medium === 'image' || /^image\//.test(content.type ?? '') || IMAGE_EXT.test(content.url ?? ''))) {
    candidates.push(content.url);
    noteSize(content.url, content.filesize);
  }
  const enclosure = tagAttrs(block, lower, 'enclosure');
  if (enclosure && /^image\//.test(enclosure.type ?? '')) {
    candidates.push(enclosure.url);
    noteSize(enclosure.url, enclosure.length);
  }
  candidates.push(tagAttrs(block, lower, 'itunes:image')?.href);
  if (!candidates.some((c) => c && !tooBig.has(c))) {
    // First <img> inside the (usually entity-escaped) HTML content.
    const html = decodeEntities(stripCdata(block.slice(0, 200_000)));
    const img = html.match(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
    candidates.push(img ? decodeEntities(img) : undefined);
  }
  const usable = candidates.filter((c) => c && !tooBig.has(c));
  for (const raw of usable.length ? usable : candidates) {
    const url = safeHttpUrl(raw ? decodeEntities(raw) : undefined, baseUrl);
    if (!url || url.startsWith('data:')) continue;
    const u = new URL(url);
    if (/(^|\.)ytimg\.com$/.test(u.hostname)) u.pathname = u.pathname.replace(/\/(hq|sd|maxres)?default\.jpg$/, '/mqdefault.jpg');
    return u.href;
  }
  return undefined;
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value.trim().slice(0, 64));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseFeed(xml: string, limit = 20, baseUrl?: string): ParsedFeed {
  const lower = xml.toLowerCase();
  const isAtom = findOpen(lower, 'feed', 0) !== -1 && findOpen(lower, 'entry', 0) !== -1;
  const itemTag = isAtom ? 'entry' : 'item';
  const firstItem = findOpen(lower, itemTag, 0);
  const head = firstItem === -1 ? xml : xml.slice(0, firstItem);
  const title = clean(htmlToText(tagText(head, head.toLowerCase(), 'title') ?? ''), 120) || 'Feed';

  const items: Item[] = blocksOf(xml, lower, itemTag, limit).map((block, index) => {
    const bl = block.toLowerCase();
    const itemTitle = clean(htmlToText(tagText(block, bl, 'title') ?? ''), 300) || '(untitled)';
    const link = isAtom ? atomLink(block, bl) : tagText(block, bl, 'link') || tagText(block, bl, 'guid');
    const url = safeHttpUrl(link, baseUrl);
    const rawSummary = isAtom
      ? tagText(block, bl, 'summary') ?? tagText(block, bl, 'content')
      : tagText(block, bl, 'description') ?? tagText(block, bl, 'content:encoded');
    // Summaries are usually entity-escaped HTML: decode, then strip the markup.
    let summaryText = rawSummary ? htmlToText(decodeEntities(rawSummary.slice(0, 50_000))) : '';
    if (summaryText.startsWith(itemTitle)) summaryText = summaryText.slice(itemTitle.length).trim();
    const summary = summaryText ? clean(truncate(summaryText, 240), 240) : undefined;
    const authorBlock = isAtom ? tagText(block, bl, 'author') ?? '' : '';
    const author = clean(
      htmlToText((isAtom ? tagText(authorBlock, authorBlock.toLowerCase(), 'name') : tagText(block, bl, 'dc:creator') ?? tagText(block, bl, 'author')) ?? ''),
      80,
    );
    const publishedAt = toIso(
      isAtom ? tagText(block, bl, 'published') ?? tagText(block, bl, 'updated') : tagText(block, bl, 'pubdate') ?? tagText(block, bl, 'dc:date'),
    );
    const meta: string[] = [];
    if (author) meta.push(`by ${author}`);
    if (url) meta.push(hostOf(url));
    const image = itemImage(block, bl, baseUrl);
    const video = Boolean(url && /^https:\/\/(www\.)?youtube\.com\/(watch|shorts)/.test(url));
    return {
      ...(image ? { image: { url: image, kind: 'thumb' as const } } : {}),
      ...(video ? { video: true } : {}),
      id: clean(htmlToText(tagText(block, bl, isAtom ? 'id' : 'guid') ?? ''), 300) || url || `${index}`,
      title: itemTitle,
      ...(url !== undefined ? { url } : {}),
      ...(summary !== undefined ? { summary } : {}),
      meta,
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    };
  });

  return { title, items };
}

export async function fetchRss(config: RssConfig, fetcher: Fetcher): Promise<ParsedFeed> {
  const res = await fetcher(config.url, {
    headers: { accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' },
    maxBytes: 3_000_000,
  });
  if (res.status < 200 || res.status >= 300) throw upstreamStatus('Feed', res.status);
  return parseFeed(res.text, config.limit, res.url);
}
