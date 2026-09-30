/**
 * OPML: the subscription list format every feed reader imports and exports.
 * Import brings someone's subscriptions in from another reader; export takes
 * theirs anywhere. Parsing reuses the linear-time HTML tokenizer (OPML is flat
 * XML), so hostile files can't blow up.
 */
import { REPO_PATTERN } from './adapters/github.ts';
import { parseAttrs, tokenize } from './lib/html.ts';
import { clean, decodeEntities, safeHttpUrl } from './lib/text.ts';
import type { PanelSpec, Profile } from './profile.ts';

export interface OpmlFeed {
  url: string;
  title: string;
  /** The enclosing folder in the reader, if any. */
  category?: string;
}

export const OPML_LIMITS = { bytes: 1_000_000, feeds: 500 } as const;

/** Feeds in document order, one per URL. Folders become categories (innermost wins). */
export function parseOpml(xml: string): { title: string; feeds: OpmlFeed[] } {
  const feeds: OpmlFeed[] = [];
  const seen = new Set<string>();
  const folders: Array<string | null> = [];   // stack of open <outline> elements: folder name, or null for a feed
  let title = '';
  for (const token of tokenize(xml.slice(0, OPML_LIMITS.bytes))) {
    if (token.kind === 'raw' && token.name === 'title') {
      title ||= clean(decodeEntities(token.text), 120);
      continue;
    }
    if (token.kind === 'close' && token.name === 'outline') { folders.pop(); continue; }
    if (token.kind !== 'open' || token.name !== 'outline') continue;
    const a = parseAttrs(token.attrs);
    const label = clean(decodeEntities(a.title || a.text || ''), 120);
    const url = safeHttpUrl(decodeEntities(a.xmlurl ?? ''));
    if (url) {
      if (!seen.has(url) && feeds.length < OPML_LIMITS.feeds) {
        seen.add(url);
        const category = [...folders].reverse().find((f): f is string => Boolean(f));
        feeds.push({ url, title: label || new URL(url).hostname, ...(category ? { category } : {}) });
      }
      if (!token.selfClosing) folders.push(null);
    } else if (!token.selfClosing) {
      folders.push(label || null);
    }
  }
  return { title, feeds };
}

const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A feed URL for a panel, if the source has one that other readers can use. */
export function feedUrlFor(panel: PanelSpec): string | undefined {
  const c = panel.config as Record<string, unknown>;
  if (panel.source === 'rss' && typeof c.url === 'string') return c.url;
  if (panel.source === 'hn') {
    const feed = String(c.feed ?? 'top');
    return feed === 'top' ? 'https://news.ycombinator.com/rss' : `https://hnrss.org/${feed === 'new' ? 'newest' : feed}`;
  }
  if (panel.source === 'github' && c.mode === 'releases' && typeof c.repo === 'string' && REPO_PATTERN.test(c.repo)) {
    return `https://github.com/${c.repo}/releases.atom`;
  }
  return undefined;   // GitHub searches, saved items and pinned results have no feed
}

/** OPML 2.0 for the user's sources, one folder per column. Returns what was left out. */
export function buildOpml(profile: Profile, now = new Date()): { opml: string; count: number; skipped: string[] } {
  const skipped: string[] = [];
  let count = 0;
  const body = profile.columns.map((column, i) => {
    const lines = column.panels.flatMap((panel) => {
      const url = feedUrlFor(panel);
      const name = panel.title ?? panel.id;
      if (!url) { if (panel.source !== 'saved' && panel.source !== 'pinned') skipped.push(name); return []; }
      count++;
      return [`      <outline type="rss" text="${xmlAttr(name)}" title="${xmlAttr(name)}" xmlUrl="${xmlAttr(url)}"/>`];
    });
    return lines.length ? [`    <outline text="Column ${i + 1}">`, ...lines, '    </outline>'].join('\n') : '';
  }).filter(Boolean).join('\n');
  const opml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${xmlAttr(profile.name)} (MCPortal)</title>`,
    `    <dateCreated>${now.toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    body,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
  return { opml, count, skipped };
}
