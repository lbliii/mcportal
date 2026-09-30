import { tokenize } from './html.ts';

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED[code.toLowerCase()] ?? match;
  });
}

export function stripCdata(input: string): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    const start = input.indexOf('<![CDATA[', i);
    if (start === -1) return out + input.slice(i);
    out += input.slice(i, start);
    const end = input.indexOf(']]>', start + 9);
    if (end === -1) return out + input.slice(start + 9);
    out += input.slice(start + 9, end);
    i = end + 3;
  }
  return out;
}

/** Tags that don't imply a word break ("<a>Discord</a>," stays "Discord,"). */
export const INLINE = new Set(['a', 'b', 'strong', 'em', 'i', 'u', 's', 'span', 'code', 'kbd', 'abbr', 'mark', 'small', 'sub', 'sup', 'time', 'q', 'cite', 'font']);

/** Markup to plain text in linear time. Output is text, never HTML. */
export function htmlToText(input: string): string {
  let out = '';
  for (const tok of tokenize(input)) {
    if (tok.kind === 'text') out += tok.text;
    else if (tok.kind === 'raw') out += tok.name === 'title' ? tok.text : ' ';
    else if (!INLINE.has(tok.name)) out += ' ';
  }
  return decodeEntities(out).replace(/\s+/g, ' ').trim();
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Normalize an untrusted single-line string before it reaches the UI or the
 * model: no control characters or line breaks (so it can't forge structure in
 * tool output), collapsed whitespace, bounded length.
 */
export function clean(input: unknown, max = 300): string {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return truncate(input.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim(), max);
}

/** Only absolute http(s) URLs survive. */
export function safeHttpUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
