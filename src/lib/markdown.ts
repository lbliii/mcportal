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
 *
 * Inline spans live in markdown-inline.ts and MDX cleanup in mdx-clean.ts; both are
 * re-exported from here.
 */
import { CALLOUT_TONES, type ArticleBlock, type CalloutTone, type Span } from '../types.ts';
import { inlineBlock, MARKDOWN_LIMITS, parseInline, toneOf } from './markdown-inline.ts';
import { clean } from './text.ts';

export { linkTarget, MARKDOWN_LIMITS, parseInline, toneOf } from './markdown-inline.ts';
export { cleanDocsMarkdown } from './mdx-clean.ts';

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

// ---- blocks ------------------------------------------------------------------------

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
  const lang = info.match(/^\{?\.?([\w+#-]+(?:\.[\w+#-]+)*)/)?.[1]?.toLowerCase();
  // mdBook and rustdoc add build flags after a comma ("rust,ignore,does_not_compile"): not a label.
  const rest = (lang ? info.slice(info.toLowerCase().indexOf(lang) + lang.length) : info).replace(/^,[\w,-]*/, '');
  const titled = rest.match(/\b(?:title|filename|file)\s*=\s*("[^"]*"|'[^']*'|\S+)/i)?.[1];
  const bare = rest.trim().match(/^([^\s={}"']+)(?=\s|$)/)?.[1];
  const label = unquote(titled ?? bare ?? '');
  return { ...(lang ? { lang: clean(lang, 30) } : {}), ...(label ? { label } : {}) };
}

/** Docs markdown (already through cleanDocsMarkdown) into structured blocks. `base` resolves relative links. */
export function parseMarkdown(markdown: string, options: { base?: string } = {}): ArticleBlock[] {
  const { base } = options;
  const refs = new Map<string, string>();
  let inFence = false;
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').filter((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const def = !inFence && line.match(/^\s{0,3}\[([^\]]{1,200})\]:\s*<?(\S+?)>?(?:\s+["'(].*["')])?\s*$/);
    if (!def) return true;
    const label = def[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!refs.has(label)) refs.set(label, def[2]!);
    return false;
  });
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
    if (para.length) add({ type: 'p', ...inlineBlock(para.join(' '), base, refs) });
    para = [];
  };
  const flushLi = () => {
    if (li) add({ ...li.block, ...inlineBlock(li.lines.join(' '), base, refs) });
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
        spans.push(...parseInline(part.replace(/\s+/g, ' '), base, 0, refs));
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
    const { text, spans } = inlineBlock(raw, base, refs);
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
        delete callout.label;
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
        const spans = paragraphs.flatMap((p, n) => [...(n ? [{ text: '\n' }] : []), ...parseInline(p, base, 0, refs)]);
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

/**
 * A page's text in parts of at most about `maxChars`, split between blocks (a block
 * longer than that is a part of its own). What a tool hands the model one part at a time.
 */
export function textParts(blocks: ArticleBlock[], maxChars: number): string[] {
  const parts: string[] = [];
  let current: ArticleBlock[] = [];
  let size = 0;
  for (const block of blocks) {
    const length = blocksToText([block]).length + 2;
    if (current.length && size + length > maxChars) {
      parts.push(blocksToText(current));
      current = [];
      size = 0;
    }
    current.push(block);
    size += length;
  }
  if (current.length) parts.push(blocksToText(current));
  return parts.length ? parts : [''];
}
