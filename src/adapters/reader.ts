/**
 * Reader view: turn an article page into clean, plain-text blocks in one linear
 * pass. Output is data only (no HTML), so the UI renders it without injection
 * risk and the agent can treat it as content, never as instructions.
 */
import { parseAttrs, tokenize } from '../lib/html.ts';
import { linkTarget, toneOf } from '../lib/markdown.ts';
import { clean, decodeEntities, INLINE } from '../lib/text.ts';
import type { ArticleBlock, CalloutTone, Fetcher, Span } from '../types.ts';

export interface Extracted {
  title: string;
  siteName?: string;
  byline?: string;
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
interface Part { text: string; href?: string; code?: true }
interface Container { name: string; main: boolean; callout?: { tone: CalloutTone; n: number }; lang?: string; id?: string }
interface Found extends ArticleBlock { zone: Zone; calloutN?: number }

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Parts to spans: entities decoded, whitespace collapsed across the whole block, neighbours with the same marks joined. */
function toSpans(parts: Part[]): Span[] {
  const spans: Span[] = [];
  for (const part of parts) {
    let text = decodeEntities(part.text).replace(/\s+/g, ' ');
    const last = spans[spans.length - 1];
    if ((!last || last.text.endsWith(' ')) && text.startsWith(' ')) text = text.slice(1);
    if (!text) continue;
    if (last && last.href === part.href && last.code === part.code) last.text += text;
    else spans.push({ text, ...(part.href ? { href: part.href } : {}), ...(part.code ? { code: true as const } : {}) });
  }
  if (spans.length) spans[spans.length - 1]!.text = spans[spans.length - 1]!.text.trimEnd();
  return spans.filter((s) => s.text);
}

/**
 * Article blocks from a page, in one linear pass. `baseUrl` resolves relative links; without
 * it only absolute http(s) links and in-page anchors are kept. Docs pages pass larger limits.
 */
export function extractArticle(html: string, baseUrl?: string, limits: { blocks: number; totalChars: number } = READER_LIMITS): Extracted {
  const meta: Record<string, string> = {};
  let docTitle = '';
  let skip = 0;
  let article = 0;
  let main = 0;
  let quote = 0;
  let pre = 0;
  let code = 0;
  let href: string | undefined;
  let headerlink = false;
  let callouts = 0;
  const labels = new Map<number, string>();
  const stack: Container[] = [];
  const found: Found[] = [];
  let current: { type: ArticleBlock['type'] | 'label'; zone: Zone; parts: Part[]; level?: number; id?: string; lang?: string; callout?: Container['callout'] } | null = null;
  let table: { depth: number; zone: Zone; rows: string[][]; row: string[] | null; cell: string[] | null; header: boolean } | null = null;

  const zone = (): Zone => (article > 0 ? 'article' : main > 0 || stack.some((c) => c.main) ? 'main' : 'body');
  const innerCallout = () => [...stack].reverse().find((c) => c.callout)?.callout;

  const flush = () => {
    if (!current) return;
    const c = current;
    current = null;
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
    const block: Found = { type: c.type, text, zone: c.zone };
    if (c.type === 'h') {
      block.level = c.level ?? 2;
      if (c.id) block.id = c.id;
    }
    if (c.callout && c.type !== 'h') {
      block.type = 'callout';
      block.tone = c.callout.tone;
      block.calloutN = c.callout.n;
    }
    if (text === joined && spans.some((s) => s.href || s.code)) block.spans = spans;
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

  for (const tok of tokenize(html.slice(0, READER_LIMITS.inputBytes))) {
    if (found.length >= limits.blocks * 3) break;
    if (tok.kind === 'raw') {
      if (tok.name === 'title' && !docTitle) docTitle = clean(decodeEntities(tok.text), 300);
      continue;
    }
    if (tok.kind === 'text') {
      if (skip > 0 || headerlink) continue;
      if (table?.cell) table.cell.push(tok.text);
      else if (current) current.parts.push({ text: tok.text, ...(href ? { href } : {}), ...(code > 0 && !pre ? { code: true as const } : {}) });
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
        stack.push(entry);
        continue;
      }
      if (name === 'a') {
        const a = parseAttrs(tok.attrs);
        if (/\bheaderlink\b/.test(a.class ?? '')) { headerlink = true; continue; }
        href = a.href ? linkTarget(decodeEntities(a.href), baseUrl) : undefined;
        continue;
      }
      if (CODE.has(name)) {
        code++;
        if (current?.type === 'pre' && !current.lang) {
          const lang = parseAttrs(tok.attrs).class?.match(LANG)?.[1];
          if (lang) current.lang = lang;
        }
        continue;
      }
      if (name === 'br') { if (current) current.parts.push({ text: pre ? '\n' : ' ' }); continue; }
      const type = BLOCK[name];
      if (type) {
        if (name === 'blockquote') quote++;
        if (name === 'pre') pre++;
        if (pre > 1) continue; // a <pre> inside a <pre> stays one block
        flush();
        const a = type === 'h' || type === 'pre' || type === 'p' || name === 'dt' ? parseAttrs(tok.attrs) : {};
        // A definition term with an id is an API signature (Sphinx: <dt id="os.path.join">); symbol links point at it.
        const signature = name === 'dt' && !!a.id && ID.test(a.id);
        const callout = innerCallout();
        const isLabel = callout && type === 'p' && /\badmonition-title\b/.test(a.class ?? '');
        current = { type: isLabel ? 'label' : signature ? 'h' : type === 'p' && quote > 0 ? 'quote' : type, zone: zone(), parts: [], ...(callout ? { callout } : {}) };
        if (signature) { current.level = 4; current.id = a.id; }
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
    if (SKIP.has(name)) { if (skip > 0) skip--; continue; }
    if (skip > 0) continue;
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
    if (name === 'a') { href = undefined; headerlink = false; continue; }
    if (CODE.has(name)) { if (code > 0) code--; continue; }
    if (BLOCK[name]) {
      if (name === 'blockquote' && quote > 0) quote--;
      if (name === 'pre' && pre > 0) { pre--; if (pre > 0) continue; }
      flush();
      continue;
    }
    if (current && !INLINE.has(name) && !pre) current.parts.push({ text: ' ' });
  }
  flush();
  if (table) endTable();

  const title = meta['og:title'] || docTitle || 'Untitled';
  const preferred: Zone | undefined = found.some((b) => b.zone === 'article') ? 'article' : found.some((b) => b.zone === 'main') ? 'main' : undefined;
  const blocks: ArticleBlock[] = [];
  let chars = 0;
  let lastCallout: { n: number; block: ArticleBlock } | undefined;
  for (const { zone: z, calloutN, ...b } of found) {
    if (preferred && z !== preferred) continue;
    if (b.type === 'h' && b.text === title) continue;
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
  const wordCount = blocks.reduce((n, b) => n + words(b.text), 0);
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
  return { ...extractArticle(res.text, res.url || url), finalUrl: res.url };
}
