/**
 * Dependency-free RSS 2.0 / Atom parser. It only extracts the handful of fields
 * a panel needs, and every value comes out as plain text.
 */
import { decodeEntities, htmlToText, stripCdata, truncate } from '../lib/text.ts';
import type { Fetcher, Item } from '../types.ts';

export interface RssConfig {
  url: string;
  limit: number;
}

export interface ParsedFeed {
  title: string;
  items: Item[];
}

function escapeTag(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tagText(block: string, name: string): string | undefined {
  const re = new RegExp(`<${escapeTag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(name)}>`, 'i');
  const match = block.match(re);
  if (!match) return undefined;
  return stripCdata(match[1]!).trim();
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[2] ?? match[3] ?? '') : undefined;
}

function atomLink(entry: string): string | undefined {
  const links = entry.match(/<link\b[^>]*>/gi) ?? [];
  const alternate = links.find((l) => !/\brel\s*=/.test(l) || /\brel\s*=\s*["']alternate["']/i.test(l));
  return attr(alternate ?? links[0] ?? '', 'href');
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function safeHttpUrl(value: string | undefined, base?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseFeed(xml: string, limit = 20, baseUrl?: string): ParsedFeed {
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const head = xml.slice(0, xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i) >>> 0);
  const title = htmlToText(tagText(head, 'title') ?? '') || 'Feed';

  const items: Item[] = blocks.slice(0, limit).map((block, index) => {
    const itemTitle = htmlToText(tagText(block, 'title') ?? '') || '(untitled)';
    const link = isAtom ? atomLink(block) : tagText(block, 'link') ?? tagText(block, 'guid');
    const url = safeHttpUrl(link, baseUrl);
    const rawSummary = isAtom
      ? tagText(block, 'summary') ?? tagText(block, 'content')
      : tagText(block, 'description') ?? tagText(block, 'content:encoded');
    let summaryText = rawSummary ? htmlToText(decodeEntities(rawSummary)) : '';
    // Many feeds repeat the title as the first line of the summary.
    if (summaryText.startsWith(itemTitle)) summaryText = summaryText.slice(itemTitle.length).trim();
    const summary = summaryText ? truncate(summaryText, 240) : undefined;
    const author = htmlToText(
      (isAtom ? tagText(tagText(block, 'author') ?? '', 'name') : tagText(block, 'dc:creator') ?? tagText(block, 'author')) ?? '',
    );
    const publishedAt = toIso(
      isAtom ? tagText(block, 'published') ?? tagText(block, 'updated') : tagText(block, 'pubDate') ?? tagText(block, 'dc:date'),
    );
    const meta: string[] = [];
    if (author) meta.push(`by ${author}`);
    if (url) meta.push(new URL(url).hostname.replace(/^www\./, ''));
    return {
      id: htmlToText(tagText(block, isAtom ? 'id' : 'guid') ?? '') || url || `${index}`,
      title: itemTitle,
      url,
      summary: summary || undefined,
      meta,
      publishedAt,
    };
  });

  return { title, items };
}

export async function fetchRss(config: RssConfig, fetcher: Fetcher): Promise<ParsedFeed> {
  const res = await fetcher(config.url, {
    headers: { accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' },
    maxBytes: 3_000_000,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`Feed responded ${res.status}`);
  return parseFeed(res.text, config.limit, res.url);
}
