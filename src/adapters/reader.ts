/**
 * Reader view: turn an article page into clean, plain-text blocks in bounded linear
 * passes. Output is data only (no HTML), so the UI renders it without injection
 * risk and the agent can treat it as content, never as instructions.
 */
import { AppError, upstreamStatus } from '../lib/errors.ts';
import { parseAttrs } from '../lib/html.ts';
import { linkTarget, toneOf } from '../lib/markdown.ts';
import { clean, decodeEntities, INLINE, safeHttpUrl } from '../lib/text.ts';
import { articleStructure } from './reader/structure.ts';
import { articleDate, articleMetadata, titleKey } from './reader/metadata.ts';
import type { ArticleBlock, CalloutTone, Fetcher, Span } from '../types.ts';

export interface Extracted {
  title: string;
  siteName?: string;
  byline?: string;
  publishedAt?: string;
  updatedAt?: string;
  blocks: ArticleBlock[];
  wordCount: number;
}

export const READER_LIMITS = { inputBytes: 1_500_000, blocks: 400, blockChars: 4000, totalChars: 200_000, tableColumns: 50, tableRows: 500, cellChars: 2000 };

const SKIP = new Set(['nav', 'header', 'footer', 'aside', 'form', 'iframe', 'button', 'template', 'svg', 'noscript', 'select', 'dialog', 'menu']);
const BLOCK: Record<string, ArticleBlock['type']> = { p: 'p', li: 'li', pre: 'pre', blockquote: 'quote', dt: 'p', dd: 'p', h1: 'h', h2: 'h', h3: 'h', h4: 'h', h5: 'h', h6: 'h' };
/** Containers whose attributes matter: role="main", admonitions, Sphinx's highlight-<lang> wrappers. */
const CONTAINERS = new Set(['div', 'section']);
const CODE = new Set(['code', 'kbd', 'tt', 'samp']);
const ADMONITION = /\b(?:admonition|callout|alert|markdown-alert)\b/;
const LANG = /\b(?:language|lang|highlight)-([\w+#-]{1,30})/;
const ID = /^[\w\-.:]{1,80}$/;

type Zone = 'article' | 'main' | 'body';
interface Part extends Span {}
interface Container { name: string; main: boolean; callout?: { tone: CalloutTone; n: number }; lang?: string; id?: string; gallery?: number }
interface Found extends ArticleBlock { zone: Zone; calloutN?: number; list?: number; shareLink?: boolean; gallery?: number }

// Share bars and article toolbars ("Share • Pin • Email", "Comments • Read Later") are lists
// of short links. An action label, or a link to a share endpoint, marks a list as chrome; network
// names alone ("Facebook", "LinkedIn") don't, so a real list of platforms survives.
const SHARE_ACTION = /^(?:\d[\d,.]*k?\s*)?(?:share(?: (?:this|on|via|to) [\w .]+)?|pin(?: it)?|e-?mail(?: this)?|mail|print|comments?|read later|save(?: for later)?|bookmark|copy(?: link)?|tweet)(?:\s*\d[\d,.]*k?)?$/i;
const SHARE_NETWORK = /^(?:x|x\.com|twitter|facebook|linkedin|reddit|pinterest|whatsapp|threads|bluesky|mastodon|tumblr|telegram|flipboard|pocket|hacker news|messenger|link)$/i;
const SHARE_HREF = /\/\/(?:[\w-]+\.)*(?:twitter\.com\/(?:intent|share)|x\.com\/intent|facebook\.com\/(?:sharer|dialog\/share)|linkedin\.com\/(?:share|cws\/share)|pinterest\.com\/pin\/create|reddit\.com\/submit|wa\.me\/|api\.whatsapp\.com\/send|t\.me\/share|bsky\.app\/intent|news\.ycombinator\.com\/submitlink|tumblr\.com\/(?:share|widgets\/share))/i;
const SHARE_HEADING = /^share(?: this(?: article| story| post| page)?)?\s*:?$/i;

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

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Parts to spans: entities decoded, whitespace collapsed across the whole block, neighbours with the same marks joined. */
function toSpans(parts: Part[]): Span[] {
  const spans: Span[] = [];
  for (const part of parts) {
    let text = decodeEntities(part.text).replace(/\s+/g, ' ');
    const last = spans[spans.length - 1];
    if ((!last || last.text.endsWith(' ')) && text.startsWith(' ')) text = text.slice(1);
    if (!text) continue;
    if (last && !part.breakBefore && last.href === part.href && last.code === part.code && last.strong === part.strong && last.em === part.em) last.text += text;
    else spans.push({ ...part, text });
  }
  if (spans.length) spans[spans.length - 1]!.text = spans[spans.length - 1]!.text.trimEnd();
  return spans.filter((s) => s.text);
}

/**
 * Article blocks from a page, in bounded linear passes. `baseUrl` resolves relative links; without
 * it only absolute http(s) links and in-page anchors are kept. Docs pages pass larger limits.
 */
export function extractArticle(html: string, baseUrl?: string, limits: { blocks: number; totalChars: number } = READER_LIMITS, options: { mode?: 'article' | 'docs' } = {}): Extracted {
  const docs = options.mode === 'docs';
  const structure = articleStructure(html.slice(0, READER_LIMITS.inputBytes), docs);
  const meta: Record<string, string> = {};
  let docTitle = '';
  let skip = 0;
  let article = 0;
  let main = 0;
  let quote = 0;
  let pre = 0;
  let code = 0, strong = 0, em = 0;
  let breakBefore = false;
  let quoteId = 0;
  const quotes: string[] = [];
  let galleryId = 0;
  let figure: { blocks: Found[]; caption: string; inCaption: number; credit: string; inCredit: number } | null = null;
  let mediaKind: 'video' | 'audio' | undefined;
  let href: string | undefined;
  let headerlink = false;
  let callouts = 0;
  const labels = new Map<number, string>();
  const stack: Container[] = [];
  const found: Found[] = [];
  let current: { type: ArticleBlock['type'] | 'label'; zone: Zone; parts: Part[]; level?: number; id?: string; lang?: string; callout?: Container['callout']; list?: number; ordered?: true; listStart?: number; value?: number; quoteId?: string; shareLink?: boolean } | null = null;
  const lists: { id: number; ordered: boolean; start: number; next: number; itemValue?: number; itemOpen?: boolean }[] = [];   // open <ul>/<ol> ids, innermost last
  let listId = 0;
  let table: { depth: number; zone: Zone; rows: string[][]; row: string[] | null; cell: string[] | null; header: boolean } | null = null;

  const zone = (): Zone => (article > 0 ? 'article' : main > 0 || stack.some((c) => c.main) ? 'main' : 'body');
  const innerCallout = () => [...stack].reverse().find((c) => c.callout)?.callout;

  const flush = () => {
    if (!current) return;
    const c = current;
    current = null;
    breakBefore = false;
    if (c.type === 'pre') {
      const text = decodeEntities(c.parts.map((p) => p.text).join('')).replace(/^\n+|\s+$/g, '').slice(0, READER_LIMITS.blockChars);
      if (text) found.push({ type: 'pre', text, zone: c.zone, ...(c.lang ? { lang: c.lang } : {}) });
      return;
    }
    const spans = toSpans(c.parts);
    if (c.type === 'h' && spans.length) {
      const last = spans[spans.length - 1]!;
      last.text = last.text.replace(/\s*[¶#🔗]+$/u, '');
      if (!last.text) spans.pop();
    }
    const joined = spans.map((s) => s.text).join('');
    const text = clean(joined, READER_LIMITS.blockChars);
    if (!text) return;
    if (c.type === 'label') {
      if (c.callout) labels.set(c.callout.n, clean(text, 120));
      return;
    }
    const block: Found = { type: c.type, text, zone: c.zone, ...(c.list !== undefined ? { list: c.list } : {}), ...(c.shareLink ? { shareLink: true } : {}) };
    if (c.list !== undefined) {
      block.level = Math.min(3, lists.length - 1);
      block.listId = `html-list-${c.list ?? 0}`;
      if (c.ordered) { block.ordered = true; if (c.listStart !== undefined) block.listStart = c.listStart; if (c.value !== undefined) block.value = c.value; }
    }
    if (c.quoteId) block.quoteId = c.quoteId;
    if (c.type === 'h') {
      block.level = c.level ?? 2;
      if (c.id) block.id = c.id;
    }
    if (c.callout && c.type !== 'h') {
      block.type = 'callout';
      block.tone = c.callout.tone;
      block.calloutN = c.callout.n;
    }
    if (text === joined && spans.some((s) => s.href || s.code || s.strong || s.em || s.breakBefore)) block.spans = spans;
    found.push(block);
  };

  const endTable = () => {
    const t = table!;
    table = null;
    const rows = t.rows.filter((r) => r.some(Boolean));
    if (!rows.length) return;
    // A layout table (one column, or a cell holding a whole article) reads better as paragraphs.
    if (rows.every((r) => r.length < 2) || rows.some((r) => r.some((cell) => cell.length > 1000))) {
      for (const cell of rows.flat()) if (cell) found.push({ type: 'p', text: clean(cell, READER_LIMITS.blockChars), zone: t.zone });
      return;
    }
    const width = Math.min(READER_LIMITS.tableColumns, Math.max(...rows.map((r) => r.length)));
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
    const [columns, ...body] = rows.map(pad);
    const text = rows.map((r) => r.join(' | ')).join('\n').slice(0, READER_LIMITS.blockChars);
    found.push({ type: 'table', text, zone: t.zone, columns: columns!, rows: body.slice(0, READER_LIMITS.tableRows) });
  };

  const continuation = () => {
    const list = lists.at(-1);
    return { type: quote ? 'quote' as const : 'p' as const, zone: zone(), parts: [] as Part[], ...(quotes.at(-1) ? { quoteId: quotes.at(-1)! } : {}), ...(list?.itemOpen ? { list: list.id, ...(list.ordered ? { ordered: true as const, listStart: list.start, ...(list.itemValue !== undefined ? { value: list.itemValue } : {}) } : {}) } : {}) };
  };
  const listFields = () => {
    const list = lists.at(-1);
    return list?.itemOpen ? { listId: `html-list-${list.id}`, level: Math.min(3, lists.length - 1), ...(list.ordered ? { ordered: true as const, listStart: list.start, ...(list.itemValue !== undefined ? { value: list.itemValue } : {}) } : {}) } : {};
  };
  const integer = (value: string | undefined, fallback: number) => value && /^-?\d{1,6}$/.test(value) ? Number(value) : fallback;
  const finishFigure = () => {
    for (const block of figure?.blocks ?? []) {
      const f = block.figure!;
      const caption = clean(decodeEntities(figure!.caption), 1200), credit = clean(decodeEntities(figure!.credit), 300);
      if (caption) f.caption = caption;
      if (credit) f.credit = credit;
      block.text = [f.alt, caption, credit].filter(Boolean).join(' — ') || 'Image';
      block.spans = [{ text: block.text, href: f.url }];
    }
    figure = null;
  };
  const addMedia = (url: string | undefined, kind: 'video' | 'audio', label: string) => {
    if (!url) return;
    const resume = current ? { ...current, parts: [] as Part[] } : null;
    flush();
    found.push({ type: 'p', zone: zone(), ...listFields(), text: label, spans: [{ text: label, href: url }], media: { url, kind, label } });
    current = resume;
  };
  for (const tok of structure.tokens) {
    if (found.length >= limits.blocks * 3) break;
    if (tok.kind === 'raw') {
      if (tok.name === 'title' && !docTitle) docTitle = clean(decodeEntities(tok.text), 300);
      continue;
    }
    if (tok.kind === 'text') {
      if (skip > 0 || headerlink) continue;
      if (figure?.inCaption || figure?.inCredit) { if (figure.inCredit) figure.credit += tok.text; else figure.caption += tok.text; continue; }
      if (!current && (quote || lists.at(-1)?.itemOpen) && !table) current = continuation();
      if (table?.cell) table.cell.push(tok.text);
      else if (current) current.parts.push({ text: tok.text, ...(href ? { href } : {}), ...(code > 0 && !pre ? { code: true as const } : {}), ...(strong ? { strong: true as const } : {}), ...(em ? { em: true as const } : {}), ...(breakBefore ? { breakBefore: true as const } : {}) });
      if (current && tok.text.trim()) breakBefore = false;
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
      if (!docs && !skip) {
        if (name === 'iframe') {
          const a = parseAttrs(tok.attrs), url = safeHttpUrl(a.src, baseUrl);
          if (url) {
            const host = new URL(url).hostname;
            if (/^(?:www\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be|player\.vimeo\.com)$/.test(host)) addMedia(url, 'video', 'Watch video');
            else if (/^(?:w\.)?(?:soundcloud\.com|bandcamp\.com)$/.test(host) || host.endsWith('.bandcamp.com')) addMedia(url, 'audio', 'Listen to audio');
          }
        }
        if (name === 'video' || name === 'audio') {
          mediaKind = name;
          addMedia(safeHttpUrl(parseAttrs(tok.attrs).src, baseUrl), mediaKind, mediaKind === 'video' ? 'Watch video' : 'Listen to audio');
        }
        if (name === 'source' && mediaKind) addMedia(safeHttpUrl(parseAttrs(tok.attrs).src, baseUrl), mediaKind, mediaKind === 'video' ? 'Watch video' : 'Listen to audio');
        if (name === 'figure') { flush(); if (figure) finishFigure(); figure = { blocks: [], caption: '', inCaption: 0, credit: '', inCredit: 0 }; }
        if (figure && name === 'figcaption') { figure.inCaption = 1; continue; }
        if (figure?.inCaption) {
          if (!tok.selfClosing && !['br', 'img', 'hr'].includes(name)) figure.inCaption++;
          if (/(?:^|[\s_-])(?:image-credit|photo-credit|credit)(?:$|[\s_-])/i.test(parseAttrs(tok.attrs).class ?? '')) figure.inCredit = figure.inCaption;
          if (name === 'br') figure.caption += ' ';
          continue;
        }
        if (figure && /(?:^|[\s_-])(?:image-credit|photo-credit|credit)(?:$|[\s_-])/i.test(parseAttrs(tok.attrs).class ?? '')) { figure.inCredit++; continue; }
        if (name === 'img') {
          const a = parseAttrs(tok.attrs);
          const width = integer(a.width, 0), height = integer(a.height, 0);
          if (width && height && width < 64 && height < 64 || /(?:^|[\s_-])(?:avatar|logo|icon|emoji)(?:$|[\s_-])/i.test(a.class ?? '')) continue;
          const set = (a['data-srcset'] || a.srcset || '').split(',').slice(0, 32).map((part) => part.trim().split(/\s+/)).filter((part) => /^\d{1,5}w$/.test(part[1] ?? '')).sort((a, b) => parseInt(b[1]!) - parseInt(a[1]!));
          const candidate = set.find((part) => parseInt(part[1]!) <= 1600) ?? set.at(-1);
          const url = safeHttpUrl(a['data-src'] || a['data-lazy-src'] || candidate?.[0] || a.src, baseUrl);
          if (url) {
            const resume = current ? { ...current, parts: [] as Part[] } : null;
            flush();
            const alt = clean(decodeEntities(a.alt ?? ''), 500);
            const block: Found = { type: 'p', zone: zone(), ...listFields(), text: alt || 'Image', ...(stack.find((c) => c.gallery)?.gallery !== undefined ? { gallery: stack.find((c) => c.gallery)!.gallery! } : {}), figure: { url, ...(alt ? { alt } : {}), ...(width > 0 && width <= 10_000 ? { width } : {}), ...(height > 0 && height <= 10_000 ? { height } : {}) }, spans: [{ text: alt || 'Image', href: url }] };
            found.push(block);
            if (figure) figure.blocks.push(block);
            current = resume;
          }
          continue;
        }
      }
      if ((SKIP.has(name) && (name !== 'header' || docs)) && !tok.selfClosing) { skip++; continue; }
      if (skip > 0) continue;
      if (table) {
        if (name === 'table') table.depth++;
        else if (table.depth === 1 && name === 'tr') { if (table.row) table.rows.push(table.row); table.row = []; table.cell = null; }
        else if (table.depth === 1 && (name === 'td' || name === 'th')) { table.cell = []; if (name === 'th' && !table.rows.length) table.header = true; }
        else if (table.cell && (name === 'br' || name === 'p' || name === 'li')) table.cell.push(' ');
        continue;
      }
      if (name === 'table' && !tok.selfClosing) { flush(); table = { depth: 1, zone: zone(), rows: [], row: null, cell: null, header: false }; continue; }
      if (name === 'article') { article++; continue; }
      if (name === 'main') { main++; continue; }
      if (CONTAINERS.has(name) && !tok.selfClosing) {
        const a = parseAttrs(tok.attrs);
        const cls = (a.class ?? '').toLowerCase();
        const entry: Container = { name, main: (a.role ?? '').toLowerCase() === 'main' };
        if (ADMONITION.test(cls)) {
          const tone = cls.split(/\s+/).map((w) => w.replace(/^(?:admonition|callout|alert|markdown-alert)-?/, '')).map((w) => toneOf(w)).find(Boolean) ?? 'note';
          entry.callout = { tone, n: ++callouts };
        }
        const lang = cls.match(LANG)?.[1];
        if (lang && lang !== 'default') entry.lang = lang;
        if (a.id && ID.test(a.id)) entry.id = a.id;
        if (/\b(?:gallery|carousel|slideshow)\b/.test(cls)) entry.gallery = ++galleryId;
        stack.push(entry);
        continue;
      }
      if (name === 'ul' || name === 'ol') { flush(); const start = integer(parseAttrs(tok.attrs).start, 1); lists.push({ id: listId++, ordered: name === 'ol', start, next: start }); continue; }
      if (name === 'cite' && quote && !current) current = { type: 'quote', zone: zone(), parts: [], quoteId: quotes.at(-1)! };
      if (name === 'a') {
        const a = parseAttrs(tok.attrs);
        if (current && SHARE_HREF.test(a.href ?? '')) current.shareLink = true;
        if (/\bheaderlink\b/.test(a.class ?? '')) { headerlink = true; continue; }
        href = a.href ? linkTarget(decodeEntities(a.href), baseUrl) : undefined;
        continue;
      }
      if (name === 'strong' || name === 'b') { strong++; continue; }
      if (name === 'em' || name === 'i') { em++; continue; }
      if (CODE.has(name)) {
        code++;
        if (current?.type === 'pre' && !current.lang) {
          const lang = parseAttrs(tok.attrs).class?.match(LANG)?.[1];
          if (lang) current.lang = lang;
        }
        continue;
      }
      if (name === 'br') { if (current) { current.parts.push({ text: pre ? '\n' : ' ' }); if (!pre) breakBefore = true; } continue; }
      // Common HTML list items wrap their first paragraph; keep its numbering.
      if (name === 'p' && current?.type === 'li' && !current.parts.some((p) => p.text.trim())) continue;
      const type = BLOCK[name];
      if (type) {
        if (name === 'blockquote') { quote++; quotes.push(`html-quote-${++quoteId}`); }
        if (name === 'pre') pre++;
        if (pre > 1) continue; // a <pre> inside a <pre> stays one block
        flush();
        const a = parseAttrs(tok.attrs);
        // A definition term with an id is an API signature (Sphinx: <dt id="os.path.join">); symbol links point at it.
        const signatureId = name === 'dt' && a.id && ID.test(a.id) ? a.id : undefined;
        const callout = innerCallout();
        const isLabel = callout && type === 'p' && /\badmonition-title\b/.test(a.class ?? '');
        const list = name === 'li' || type === 'p' && lists.at(-1)?.itemOpen ? lists.at(-1) : undefined;
        const value = list?.ordered ? name === 'li' ? integer(a.value, list.next) : list.itemValue : undefined;
        if (list && name === 'li') { list.itemOpen = true; if (value !== undefined) { list.next = value + 1; list.itemValue = value; } }
        current = { type: isLabel ? 'label' : signatureId ? 'h' : type === 'p' && quote > 0 ? 'quote' : type, zone: zone(), parts: [], ...(callout ? { callout } : {}), ...(list !== undefined ? { list: list.id, ...(list.ordered ? { ordered: true as const, listStart: list.start, ...(value !== undefined ? { value } : {}) } : {}) } : {}), ...(quote && quotes.at(-1) ? { quoteId: quotes.at(-1)! } : {}) };
        if (signatureId) { current.level = 4; current.id = signatureId; }
        if (type === 'h') {
          current.level = Number(name[1]);
          const top = stack[stack.length - 1];
          const id = a.id && ID.test(a.id) ? a.id : top?.name === 'section' ? top.id : undefined;
          if (id) current.id = id;
        }
        if (type === 'pre') {
          const lang = (a.class ?? '').match(LANG)?.[1] ?? [...stack].reverse().find((c) => c.lang)?.lang;
          if (lang) current.lang = lang;
        }
        continue;
      }
      if (current && !INLINE.has(name) && !pre) current.parts.push({ text: ' ' });
      continue;
    }
    // close
    if (SKIP.has(name) && (name !== 'header' || docs)) { if (skip > 0) skip--; continue; }
    if (skip > 0) continue;
    if (!docs && figure) {
      if (figure.inCaption) { if (figure.inCredit === figure.inCaption) figure.inCredit = 0; figure.inCaption--; continue; }
      if (figure.inCredit && (name === 'span' || name === 'div' || name === 'small')) { figure.inCredit = 0; continue; }
      if (name === 'figure') { finishFigure(); continue; }
    }
    if (name === 'video' || name === 'audio') mediaKind = undefined;
    if (name === 'strong' || name === 'b') { strong = Math.max(0, strong - 1); continue; }
    if (name === 'em' || name === 'i') { em = Math.max(0, em - 1); continue; }
    if (table) {
      if (name === 'table' && --table.depth === 0) { if (table.row) table.rows.push(table.row); endTable(); }
      else if (table.depth === 1 && (name === 'td' || name === 'th') && table.cell) {
        (table.row ??= []).push(clean(decodeEntities(table.cell.join('')), READER_LIMITS.cellChars));
        table.cell = null;
      } else if (table.depth === 1 && name === 'tr' && table.row) { table.rows.push(table.row); table.row = null; }
      continue;
    }
    if (name === 'article') { if (article > 0) article--; continue; }
    if (name === 'main') { if (main > 0) main--; continue; }
    if (CONTAINERS.has(name)) {
      const at = stack.map((c) => c.name).lastIndexOf(name);
      if (at !== -1) { flush(); stack.length = at; }
      continue;
    }
    if (name === 'ul' || name === 'ol') { flush(); lists.pop(); if (lists.at(-1)?.itemOpen || quote) current = continuation(); continue; }
    if (name === 'a') { href = undefined; headerlink = false; continue; }
    if (CODE.has(name)) { if (code > 0) code--; continue; }
    if (BLOCK[name]) {
      if (name === 'blockquote' && quote > 0) { quote--; quotes.pop(); }
      if (name === 'pre' && pre > 0) { pre--; if (pre > 0) continue; }
      flush();
      if (name === 'li' && lists.at(-1)) lists.at(-1)!.itemOpen = false;
      if (name === 'blockquote' && quote > 0) current = continuation();
      continue;
    }
    if (current && !INLINE.has(name) && !pre) current.parts.push({ text: ' ' });
  }
  flush();
  if (table) endTable();
  if (figure) finishFigure();

  const metadata = articleMetadata(meta, docTitle, structure.scripts, structure.authors, structure.dates, baseUrl);
  const title = metadata.title;
  const preferred: Zone | undefined = found.some((b) => b.zone === 'article') ? 'article' : found.some((b) => b.zone === 'main') ? 'main' : undefined;
  const blocks: ArticleBlock[] = [];
  let chars = 0;
  const chrome = shareLists(found);
  const isChrome = (b: Found | undefined) => b?.list !== undefined && chrome.has(b.list);
  const seenFigures = new Set<string>(), seenMedia = new Set<string>();
  const mediaKey = (url: string) => { const u = new URL(url); for (const name of ['w', 'width', 'h', 'height', 'q', 'quality', 'fit', 'format', 'dpr']) u.searchParams.delete(name); return u.href; };
  let lastCallout: { n: number; block: ArticleBlock } | undefined;
  for (const [i, { zone: z, calloutN, list: _list, shareLink: _share, gallery, ...b }] of found.entries()) {
    if (preferred && z !== preferred) continue;
    if (isChrome(found[i])) continue;
    if (b.figure) {
      const key = `${gallery ?? 'adjacent'}:${mediaKey(b.figure.url)}:${b.figure.credit ?? ''}`;
      const previous = blocks.at(-1);
      if (gallery !== undefined && seenFigures.has(key) || gallery === undefined && previous?.figure && mediaKey(previous.figure.url) === mediaKey(b.figure.url) && previous.figure.caption === b.figure.caption && previous.figure.credit === b.figure.credit) continue;
      if (gallery !== undefined) seenFigures.add(key);
    }
    if (b.media) { const key = b.media.url; if (seenMedia.has(key)) continue; seenMedia.add(key); }
    if (b.type === 'h' && SHARE_HEADING.test(b.text) && isChrome(found[i + 1])) continue;
    if (b.type === 'h' && (docs ? b.text === title : (blocks.length === 0 || b.level === 1 && blocks.length < 3) && titleKey(b.text) === titleKey(title))) continue;
    if (!docs && blocks.length < 4 && metadata.byline && b.text.replace(/^by\s+/i, '') === metadata.byline) continue;
    if (!docs && blocks.length < 4 && (articleDate(b.text) === metadata.publishedAt && metadata.publishedAt || articleDate(b.text) === metadata.updatedAt && metadata.updatedAt)) continue;
    if (blocks.length >= limits.blocks || chars + b.text.length > limits.totalChars) break;
    chars += b.text.length;
    // One admonition, one callout: its paragraphs join up, under its title.
    if (calloutN !== undefined && lastCallout?.n === calloutN && blocks[blocks.length - 1] === lastCallout.block) {
      const prev = lastCallout.block;
      if (prev.spans || b.spans) prev.spans = [...(prev.spans ?? [{ text: prev.text }]), { text: '\n\n' }, ...(b.spans ?? [{ text: b.text }])];
      prev.text = `${prev.text}\n\n${b.text}`.slice(0, READER_LIMITS.blockChars);
      continue;
    }
    if (calloutN !== undefined) {
      const label = labels.get(calloutN);
      if (label) b.label = label;
      lastCallout = { n: calloutN, block: b };
    }
    blocks.push(b);
  }
  const wordCount = blocks.reduce((n, b) => n + (b.figure || b.media ? 0 : words(b.text)), 0);

  return {
    ...metadata,
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
  if (res.status < 200 || res.status >= 300) throw upstreamStatus('Page', res.status);
  if (res.contentType && !/html|xml|text\/plain/i.test(res.contentType)) {
    throw new AppError('invalid_argument', 'Reader view only supports web pages');
  }
  return { ...extractArticle(res.text, res.url || url), finalUrl: res.url };
}
