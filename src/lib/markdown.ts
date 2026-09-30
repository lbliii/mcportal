/**
 * Markdown parsed into plain-text blocks, never interpreted as HTML.
 *
 *   parseMarkdownLite   headings, paragraphs, lists, code and quotes, as flat text (note clips)
 *   parseMarkdown       the same plus heading levels and anchors, nested and numbered lists,
 *                       code languages and labels, tables, callouts, and inline links, code
 *                       and emphasis as spans (docs pages)
 *   cleanDocsMarkdown   MDX and docs-generator syntax turned into plain markdown first:
 *                       imports, components (<Note>, <Tabs>, <Card>, <ParamField>…), MkDocs
 *                       admonitions. Only PascalCase tags are components, so placeholders
 *                       like <YOUR_API_KEY> and tags aimed at agents like <SYSTEM> stay
 *                       visible as text.
 */
import { CALLOUT_TONES, type ArticleBlock, type CalloutTone, type Span } from '../types.ts';
import { clean, decodeEntities, safeHttpUrl } from './text.ts';

// ---- markdown-lite (clips) -------------------------------------------------------

/** Emphasis markers off, links as "text (url)". The result is shown as text, never HTML. */
function inline(text: string): string {
  return text
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]{1,2000})\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/`([^`\n]+)`/g, '$1');
}

/** Headings, paragraphs, lists, fenced code and quotes; everything else is a paragraph. */
export function parseMarkdownLite(markdown: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const lines = markdown.split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: inline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) code.push(lines[i]!);
      blocks.push({ type: 'pre', text: code.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) { flush(); blocks.push({ type: 'h', text: inline(heading[1]!.replace(/\s+#+\s*$/, '')) }); continue; }
    const item = line.match(/^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/);
    if (item) { flush(); blocks.push({ type: 'li', text: inline(item[1]!) }); continue; }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === 'quote' && i > 0 && /^\s*>/.test(lines[i - 1]!)) last.text += `\n${inline(quote[1]!)}`;
      else blocks.push({ type: 'quote', text: inline(quote[1]!) });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks.filter((b) => b.text.trim() || b.type === 'pre');
}

// ---- inline spans ------------------------------------------------------------------

export const MARKDOWN_LIMITS = { blocks: 1500, blockChars: 8000, totalChars: 400_000, tableColumns: 50, tableRows: 500, cellChars: 2000 };

const ANCHOR = /^#[\w\-.:%~]{1,200}$/;

/** http(s) links (relative ones resolved against the page), or "#anchor" within the page. Nothing else. */
export function linkTarget(raw: string, base?: string): string | undefined {
  const url = raw.trim().replace(/^<|>$/g, '');
  if (url.startsWith('#')) return ANCHOR.test(url) ? url : undefined;
  return safeHttpUrl(url, base);
}

/** The index of the bracket that closes the one at `open`, allowing nesting and escapes; -1 if none. */
function closing(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i;
  }
  return -1;
}

const same = (a: Span, b: Span) => a.href === b.href && a.code === b.code && a.strong === b.strong;

/** Inline markdown as spans: links, code, strong; single-* emphasis markers dropped; images dropped. */
export function parseInline(text: string, base?: string, depth = 0): Span[] {
  const spans: Span[] = [];
  let plain = '';
  const flushPlain = () => {
    if (plain) spans.push({ text: decodeEntities(plain) });
    plain = '';
  };
  const push = (span: Span) => {
    flushPlain();
    if (span.text) spans.push(span);
  };
  const nested = (inner: string) => (depth < 4 ? parseInline(inner, base, depth + 1) : [{ text: inner }]);

  for (let i = 0; i < text.length;) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === '\\' && next && /[\\`*_{}[\]()#+\-.!|<>~]/.test(next)) { plain += next; i += 2; continue; }
    if (c === '`') {
      let n = 1;
      while (text[i + n] === '`') n++;
      const end = text.indexOf('`'.repeat(n), i + n);
      if (end !== -1) {
        push({ text: text.slice(i + n, end).replace(/^ (.+) $/, '$1'), code: true });
        i = end + n;
        continue;
      }
      plain += '`'.repeat(n);
      i += n;
      continue;
    }
    if ((c === '!' && next === '[') || c === '[') {
      const start = c === '!' ? i + 1 : i;
      const close = closing(text, start, '[', ']');
      const end = close !== -1 && text[close + 1] === '(' ? closing(text, close + 1, '(', ')') : -1;
      if (end !== -1) {
        if (c === '[') {
          const href = linkTarget(text.slice(close + 2, end).trim().split(/\s+/)[0] ?? '', base);
          for (const s of nested(text.slice(start + 1, close))) push(href ? { ...s, href } : s);
        }
        i = end + 1; // images are dropped
        continue;
      }
    }
    if (c === '<') {
      const auto = text.slice(i).match(/^<(https?:\/\/[^\s<>]{1,2000})>/);
      const href = auto ? safeHttpUrl(auto[1]) : undefined;
      if (auto && href) { push({ text: auto[1]!, href }); i += auto[0].length; continue; }
    }
    if ((c === '*' || c === '_') && next === c && text[i + 2] && !/\s/.test(text[i + 2]!)) {
      const end = text.indexOf(c + c, i + 3);
      if (end !== -1 && !/\s/.test(text[end - 1]!)) {
        for (const s of nested(text.slice(i + 2, end))) push({ ...s, strong: true });
        i = end + 2;
        continue;
      }
    }
    if (c === '*' && next && !/[\s*]/.test(next)) {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1 && !/\s/.test(text[end - 1]!)) {
        for (const s of nested(text.slice(i + 1, end))) push(s);
        i = end + 1;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flushPlain();
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && same(last, s)) last.text += s.text;
    else merged.push({ ...s });
  }
  return merged;
}

/** A block's text and, when there's any markup, its spans. */
function inlineBlock(markdown: string, base?: string): { text: string; spans?: Span[] } {
  const spans = parseInline(markdown.replace(/\s+/g, ' ').trim(), base);
  const text = clean(spans.map((s) => s.text).join(''), MARKDOWN_LIMITS.blockChars);
  if (!spans.some((s) => s.href || s.code || s.strong) || text.length !== spans.reduce((n, s) => n + s.text.length, 0)) return { text };
  return { text, spans };
}

// ---- blocks ------------------------------------------------------------------------

const TONE_WORDS: Record<string, CalloutTone> = {
  note: 'note', info: 'note', seealso: 'note', abstract: 'note', summary: 'note', example: 'note', quote: 'note', legacy: 'note', callout: 'note', aside: 'note', admonition: 'note',
  tip: 'tip', hint: 'tip', check: 'tip', success: 'tip',
  important: 'warning', warning: 'warning', warn: 'warning', caution: 'warning', attention: 'warning', deprecated: 'warning',
  danger: 'danger', error: 'danger', bug: 'danger', failure: 'danger',
};

export function toneOf(word: string | undefined): CalloutTone | undefined {
  const key = (word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return (CALLOUT_TONES as readonly string[]).includes(key) ? (key as CalloutTone) : TONE_WORDS[key];
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$|^\s*\|\s*:?-{1,}:?\s*\|\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const DIRECTIVE = /^\s*:{3,}\s*([\w-]*)\s*(.*?)\s*$/;
const ALERT = /^\[!(\w+)\]\s*(.*)$/;
const IMAGE_ONLY = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'section';
}

const unquote = (s: string) => clean(s.replace(/^["'{]+|["'}]+$/g, ''), 120);

/** Code fence info: "bash", "bash terminal icon=…", "ts title=\"app.ts\"", "{.python}". */
function fenceInfo(info: string): { lang?: string; label?: string } {
  const lang = info.match(/^\{?\.?([\w+#.-]+)/)?.[1]?.toLowerCase();
  const rest = lang ? info.slice(info.indexOf(lang) + lang.length) : info;
  const titled = rest.match(/\b(?:title|filename|file)\s*=\s*("[^"]*"|'[^']*'|\S+)/i)?.[1];
  const bare = rest.trim().match(/^([^\s={}"']+)(?=\s|$)/)?.[1];
  const label = unquote(titled ?? bare ?? '');
  return { ...(lang ? { lang: clean(lang, 30) } : {}), ...(label ? { label } : {}) };
}

/** Docs markdown (already through cleanDocsMarkdown) into structured blocks. `base` resolves relative links. */
export function parseMarkdown(markdown: string, options: { base?: string } = {}): ArticleBlock[] {
  const { base } = options;
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks: ArticleBlock[] = [];
  const ids = new Set<string>();
  let chars = 0;
  let para: string[] = [];
  let li: { block: ArticleBlock; lines: string[] } | undefined;
  /** Open ::: containers; only callouts collect text. */
  const containers: Array<{ tone?: CalloutTone; label?: string; lines?: string[] }> = [];

  const add = (block: ArticleBlock) => {
    if (blocks.length >= MARKDOWN_LIMITS.blocks || chars + block.text.length > MARKDOWN_LIMITS.totalChars) return;
    if (!block.text.trim() && block.type !== 'pre') return;
    chars += block.text.length;
    blocks.push(block);
  };
  const flushPara = () => {
    if (para.length) add({ type: 'p', ...inlineBlock(para.join(' '), base) });
    para = [];
  };
  const flushLi = () => {
    if (li) add({ ...li.block, ...inlineBlock(li.lines.join(' '), base) });
    li = undefined;
  };
  const flush = () => { flushPara(); flushLi(); };

  /** A callout's lines as one block: paragraphs apart, list items on their own lines. */
  const calloutBlock = (tone: CalloutTone, label: string | undefined, body: string[]) => {
    const paragraphs: string[][] = [[]];
    for (const line of body) {
      if (!line.trim()) { if (paragraphs[paragraphs.length - 1]!.length) paragraphs.push([]); continue; }
      const item = line.match(LIST);
      paragraphs[paragraphs.length - 1]!.push(item ? `\n• ${item[3]}` : line.trim());
    }
    const spans: Span[] = [];
    for (const p of paragraphs.filter((p) => p.length)) {
      if (spans.length) spans.push({ text: '\n\n' });
      const parts = p.join(' ').split('\n').map((part) => part.trim()).filter(Boolean);
      parts.forEach((part, i) => {
        if (i) spans.push({ text: '\n' });
        spans.push(...parseInline(part.replace(/\s+/g, ' '), base));
      });
    }
    const text = spans.map((s) => s.text).join('').replace(/[^\S\n]+/g, ' ').trim().slice(0, MARKDOWN_LIMITS.blockChars);
    if (!text && !label) return;
    const block: ArticleBlock = { type: 'callout', tone, text: text || label! };
    if (label) block.label = label;
    if (spans.some((s) => s.href || s.code || s.strong)) block.spans = spans;
    add(block);
  };
  const openCallout = () => [...containers].reverse().find((c) => c.lines);
  const heading = (level: number, raw: string, explicitId?: string) => {
    const { text, spans } = inlineBlock(raw, base);
    const root = slug(explicitId ?? text);
    let id = root;
    for (let n = 2; ids.has(id); n++) id = `${root}-${n}`;
    ids.add(id);
    add({ type: 'h', level, text, id, ...(spans ? { spans } : {}) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const [, indent, marker, info] = fence as unknown as [string, string, string, string];
      const code: string[] = [];
      for (i++; i < lines.length; i++) {
        const l = lines[i]!;
        if (l.trim().startsWith(marker) && l.trim().replace(/[`~]/g, '') === '') break;
        code.push(l.startsWith(indent) ? l.slice(indent.length) : l.trimStart());
      }
      const callout = openCallout();
      if (callout?.lines?.some((l) => l.trim())) { // text before the code: show it first
        calloutBlock(callout.tone!, callout.label, callout.lines);
        callout.lines = [];
        callout.label = undefined;
      }
      add({ type: 'pre', text: code.join('\n').slice(0, MARKDOWN_LIMITS.blockChars * 4), ...fenceInfo(info) });
      continue;
    }

    const directive = line.match(DIRECTIVE);
    if (directive) {
      flush();
      const [, name, rest] = directive as unknown as [string, string, string];
      if (!name) {
        const closed = containers.pop();
        if (closed?.lines) calloutBlock(closed.tone!, closed.label, closed.lines);
        continue;
      }
      const tone = toneOf(name);
      if (name.toLowerCase() === 'details') {
        if (rest) heading(4, unquote(rest));
        containers.push({});
      } else if (tone) {
        const label = unquote(rest.replace(/^\[|\]$/g, ''));
        containers.push({ tone, lines: [], ...(label ? { label } : {}) });
      } else {
        containers.push({});
      }
      continue;
    }

    const callout = openCallout();
    if (callout) { callout.lines!.push(line); continue; }

    if (!line.trim()) { flush(); continue; }
    if (HR.test(line) || IMAGE_ONLY.test(line)) { flush(); continue; }

    const h = line.match(HEADING);
    if (h) {
      flush();
      let raw = h[2]!.replace(/\s*[¶🔗]+\s*$/u, '');
      let id = raw.match(/\s*\{#([\w-]{1,80})\}\s*$/)?.[1];
      if (id) raw = raw.replace(/\s*\{#[\w-]{1,80}\}\s*$/, '');
      const wrapped = raw.match(/^\[(.*)\]\(#([\w\-.:%~]{1,80})\)$/);
      if (wrapped) { raw = wrapped[1]!; id ??= wrapped[2]; }
      heading(h[1]!.length, raw, id);
      continue;
    }

    if (/^\s*>/.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]!); i++) quoted.push(lines[i]!.replace(/^\s*>\s?/, ''));
      i--;
      const alert = quoted[0]!.trim().match(ALERT);
      const titled = quoted[0]!.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
      if (titled) {
        // "> #### Title" over text: Stripe's callouts.
        const label = clean(parseInline(titled[1]!, base).map((s) => s.text).join(''), 120);
        calloutBlock(toneOf(label.split(/\s/)[0]) ?? 'note', label, quoted.slice(1));
      } else if (alert) {
        const word = alert[1]!;
        const tone = toneOf(word) ?? 'note';
        const label = alert[2] ? unquote(alert[2]) : (CALLOUT_TONES as readonly string[]).includes(word.toLowerCase()) ? undefined : word.charAt(0) + word.slice(1).toLowerCase();
        calloutBlock(tone, label, quoted.slice(1));
      } else {
        const paragraphs = quoted.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const spans = paragraphs.flatMap((p, n) => [...(n ? [{ text: '\n' }] : []), ...parseInline(p, base)]);
        const text = clean(spans.map((s) => s.text).join('').replace(/[^\S\n]+/g, ' '), MARKDOWN_LIMITS.blockChars);
        add({ type: 'quote', text: paragraphs.length > 1 ? spans.map((s) => s.text).join('').slice(0, MARKDOWN_LIMITS.blockChars) : text, ...(spans.some((s) => s.href || s.code || s.strong) ? { spans } : {}) });
      }
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      flush();
      const cell = (c: string) => clean(parseInline(c, base).map((s) => s.text).join(''), MARKDOWN_LIMITS.cellChars);
      const columns = splitRow(line).slice(0, MARKDOWN_LIMITS.tableColumns).map(cell);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim(); i++) {
        if (rows.length < MARKDOWN_LIMITS.tableRows) rows.push(splitRow(lines[i]!).slice(0, columns.length).map(cell));
      }
      i--;
      add({ type: 'table', text: [columns, ...rows].map((r) => r.join(' | ')).join('\n').slice(0, MARKDOWN_LIMITS.blockChars), columns, rows });
      continue;
    }

    const item = line.match(LIST);
    if (item) {
      flush();
      const level = Math.min(3, Math.floor(item[1]!.length / 2));
      const block: ArticleBlock = { type: 'li', text: '', ...(level ? { level } : {}), ...(/\d/.test(item[2]!) ? { ordered: true as const } : {}) };
      li = { block, lines: [item[3]!] };
      continue;
    }
    if (li && !para.length) { li.lines.push(line.trim()); continue; } // continuation, indented or lazy

    para.push(line.trim());
  }
  flush();
  for (const open of containers.reverse()) if (open.lines) calloutBlock(open.tone!, open.label, open.lines);
  return blocks;
}

// ---- MDX and docs-generator cleanup ---------------------------------------------------

const TAG = /<(\/?)([A-Za-z][\w.]*)((?:\s+(?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*)?)\s*(\/?)>/g;
const ATTR = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\}|\{([^{}]*)\}))?/g;
/** A line that is (or starts with) a JSX component or an HTML block tag. */
const TAG_LINE = /^\s*<\/?(?:[A-Z][a-z][\w.]*|div|details|summary|br|img|p|span|section|figure|figcaption|picture|source|video|iframe|center|a|sup|sub|kbd|hr|b|strong|em|i)(?=[\s/>]|$)/;
const INLINE_COMPONENT = /<[A-Z][a-z][\w.]*(?:\s+(?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*)?\s*\/>|<\/?(?:Badge|Tooltip|Tag|Kbd|Mark|Icon)(?:\s+(?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*)?\s*>/g;

const CALLOUT_TAGS = new Set(['note', 'info', 'tip', 'warning', 'danger', 'check', 'callout', 'admonition', 'aside', 'caution', 'important', 'error', 'success']);
const TAB_TAGS = new Set(['tab', 'tabitem', 'codetab']);
const HEADING_TAGS = new Set(['step', 'accordion', 'expandable', 'update']);

function attrsOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) out[m[1]!.toLowerCase()] = clean(m[2] ?? m[3] ?? m[4] ?? m[5] ?? '', 200);
  return out;
}

/** What a component or HTML tag becomes in plain markdown. */
function replaceTag(close: boolean, name: string, rawAttrs: string, selfClosing: boolean): string {
  const tag = name.toLowerCase();
  if (tag === 'br') return ' ';
  const a = close ? {} : attrsOf(rawAttrs);
  if (CALLOUT_TAGS.has(tag)) {
    if (selfClosing) return '';
    if (close) return '\n:::\n';
    const tone = toneOf(a.type ?? a.kind ?? a.variant ?? a.intent) ?? toneOf(tag) ?? 'note';
    return `\n:::${tone}${a.title ? ` ${a.title}` : ''}\n`;
  }
  if (close || selfClosing) return '\n';
  if (TAB_TAGS.has(tag)) {
    const label = a.title ?? a.label ?? a.value;
    return label ? `\n**${label}**\n` : '\n';
  }
  if (HEADING_TAGS.has(tag)) {
    const title = a.title ?? a.label ?? a.description;
    return title ? `\n#### ${title}\n` : '\n';
  }
  if (tag === 'card') {
    const title = a.title ?? '';
    const href = a.href ?? '';
    return title && href ? `\n- [${title}](${href})\n` : title ? `\n**${title}**\n` : '\n';
  }
  if (tag.endsWith('field') && tag !== 'field') {
    const field = a.path ?? a.query ?? a.body ?? a.header ?? a.name ?? a.param ?? a.field ?? Object.values(a)[0] ?? '';
    return field ? `\n- **${field}**${a.type ? ` \`${a.type}\`` : ''}${'required' in a ? ' (required)' : ''}\n` : '\n';
  }
  if (tag === 'summary') return '\n#### ';
  return '\n';
}

/**
 * Turn MDX and generator-specific syntax into plain markdown, leaving code blocks alone.
 * Imports and exports go; known components become callouts, headings, list items and labels;
 * other components and HTML block tags are removed with their text kept.
 */
export function cleanDocsMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let fence: string | undefined;
  let comment = false;
  let jsxComment = false;
  let exportDepth = 0;
  let importOpen = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (fence) {
      out.push(line);
      if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') fence = undefined;
      continue;
    }
    const opens = line.match(/^\s*(`{3,}|~{3,})/);
    if (opens) { fence = opens[1]; out.push(line); continue; }

    if (jsxComment) {
      const end = line.indexOf('*/}');
      if (end === -1) continue;
      jsxComment = false;
      line = line.slice(end + 3);
    }
    if (comment) {
      const end = line.indexOf('-->');
      if (end === -1) continue;
      comment = false;
      line = line.slice(end + 3);
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const start = line.indexOf('<!--');
    if (start !== -1) { comment = true; line = line.slice(0, start); }
    const jsx = line.indexOf('{/*');
    if (jsx !== -1) { jsxComment = true; line = line.slice(0, jsx); }
    if (!line.trim() && lines[i]!.trim()) continue;

    if (importOpen) { if (/\bfrom\s+['"][^'"]+['"]/.test(line)) importOpen = false; continue; }
    if (exportDepth > 0) { exportDepth += (line.match(/[{([]/g)?.length ?? 0) - (line.match(/[})\]]/g)?.length ?? 0); continue; }
    if (/^\s*import\s/.test(line) && (/\bfrom\s+['"]|^\s*import\s+['"]/.test(line) || /\{\s*$/.test(line))) {
      if (!/['"];?\s*$/.test(line)) importOpen = true;
      continue;
    }
    if (/^\s*export\s+(?:const|let|var|function|default|async)\b/.test(line)) {
      exportDepth = (line.match(/[{([]/g)?.length ?? 0) - (line.match(/[})\]]/g)?.length ?? 0);
      continue;
    }

    // MkDocs admonitions: "!!! note "Title"" over an indented body.
    const admonition = line.match(/^(\s*)(?:!!!|\?\?\?\+?)\s+([\w-]+)(?:\s+"([^"]*)")?\s*$/);
    if (admonition) {
      const indent = admonition[1]!.length + 4;
      out.push(`:::${toneOf(admonition[2]) ?? 'note'}${admonition[3] ? ` ${admonition[3]}` : ''}`);
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        const l = lines[i]!;
        if (l.trim() && l.length - l.trimStart().length < indent) break;
        body.push(l.slice(Math.min(indent, l.length - l.trimStart().length)));
      }
      i--;
      while (body.length && !body[body.length - 1]!.trim()) body.pop();
      out.push(...cleanDocsMarkdown(body.join('\n')).split('\n'), ':::');
      continue;
    }

    if (TAG_LINE.test(line)) {
      // An opening tag may run over several lines of attributes.
      let joined = line;
      for (let n = 0; n < 20 && !/>/.test(joined.slice(joined.search(/</))) && i + 1 < lines.length; n++) joined += ` ${lines[++i]!.trim()}`;
      out.push(...joined.replace(TAG, (_m, close: string, name: string, attrs: string, self: string) => replaceTag(!!close, name, attrs ?? '', !!self)).split('\n'));
      continue;
    }
    out.push(line.replace(INLINE_COMPONENT, '').replace(/<br\s*\/?>/gi, ' '));
  }
  return out.join('\n');
}

// ---- back to text ---------------------------------------------------------------------

/** Blocks as compact markdown for the agent: heading levels, fenced code, table rows, labelled callouts. Links stay out. */
export function blocksToText(blocks: ArticleBlock[]): string {
  return blocks.map((b) => {
    switch (b.type) {
      case 'h': return `${'#'.repeat(Math.min(6, Math.max(2, b.level ?? 2)))} ${b.text}`;
      case 'li': return `${'  '.repeat(b.level ?? 0)}${b.ordered ? '1.' : '-'} ${b.text}`;
      case 'pre': return `\`\`\`${b.lang ?? ''}${b.label ? ` ${b.label}` : ''}\n${b.text}\n\`\`\``;
      case 'quote': return b.text.split('\n').map((l) => `> ${l}`).join('\n');
      case 'callout': return `> **${b.label ?? b.tone ?? 'note'}:** ${b.text.replace(/\n/g, '\n> ')}`;
      case 'table': return [b.columns ?? [], ...(b.rows ?? [])].map((r) => `| ${r.join(' | ')} |`).join('\n');
      default: return b.text;
    }
  }).join('\n\n');
}
