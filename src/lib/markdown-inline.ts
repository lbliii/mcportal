/**
 * Inline markdown as spans (links, code, strong; emphasis markers dropped, images
 * dropped), plus what the block parser and MDX cleanup both lean on: the size limits,
 * link targets and callout tone words. The bottom of the markdown modules: it imports
 * neither of the others.
 */
import { CALLOUT_TONES, type CalloutTone, type Span } from '../types.ts';
import { clean, decodeEntities, safeHttpUrl } from './text.ts';

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
export function parseInline(text: string, base?: string, depth = 0, refs?: Map<string, string>): Span[] {
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
  const nested = (inner: string) => (depth < 4 ? parseInline(inner, base, depth + 1, refs) : [{ text: inner }]);

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
      // Reference links: [text][label], [label][] and a bare [label], when the label is defined.
      if (close !== -1 && refs?.size && text[close + 1] !== '(') {
        const labelled = text[close + 1] === '[' ? closing(text, close + 1, '[', ']') : -1;
        const label = (labelled > close + 2 ? text.slice(close + 2, labelled) : text.slice(start + 1, close)).trim().toLowerCase().replace(/\s+/g, ' ');
        const target = refs.get(label);
        if (target) {
          const href = linkTarget(target, base);
          if (c === '[') for (const s of nested(text.slice(start + 1, close))) push(href ? { ...s, href } : s);
          i = (labelled !== -1 ? labelled : close) + 1;
          continue;
        }
      }
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
    // _emphasis_: markers dropped, but only at word edges (snake_case stays as it is).
    if (c === '_' && next && next !== '_' && !/\s/.test(next) && !/[\p{L}\p{N}]/u.test(text[i - 1] ?? '')) {
      let end = text.indexOf('_', i + 1);
      while (end !== -1 && /[\p{L}\p{N}]/u.test(text[end + 1] ?? '')) end = text.indexOf('_', end + 1);
      if (end > i + 1 && !/\s/.test(text[end - 1]!)) {
        for (const s of nested(text.slice(i + 1, end))) push(s);
        i = end + 1;
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
export function inlineBlock(markdown: string, base?: string, refs?: Map<string, string>): { text: string; spans?: Span[] } {
  const spans = parseInline(markdown.replace(/\s+/g, ' ').trim(), base, 0, refs);
  const text = clean(spans.map((s) => s.text).join(''), MARKDOWN_LIMITS.blockChars);
  if (!spans.some((s) => s.href || s.code || s.strong) || text.length !== spans.reduce((n, s) => n + s.text.length, 0)) return { text };
  return { text, spans };
}

// ---- callout tones -------------------------------------------------------------------

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
