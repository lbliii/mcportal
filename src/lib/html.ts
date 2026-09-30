/**
 * A small, linear-time HTML tokenizer. Every step moves the cursor forward and
 * every search starts at the cursor, so hostile input (thousands of unclosed
 * tags, stray "<", unterminated quotes or comments) costs O(n), not O(n²).
 */

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'open'; name: string; attrs: string; selfClosing: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'raw'; name: string; text: string };

/** Elements whose content is not markup. */
const RAW = new Set(['script', 'style', 'title', 'textarea', 'xmp']);

function isNameStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function readName(src: string, start: number): number {
  let i = start;
  while (i < src.length) {
    const c = src.charCodeAt(i);
    // letters, digits, '-', ':', '_'
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 58 || c === 95) i++;
    else break;
  }
  return i;
}

/** Find the '>' that ends a tag, honoring quoted attribute values. Returns -1 if none. */
function tagEnd(src: string, start: number): number {
  let quote = 0;
  for (let i = start; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) {
      quote = c;
    } else if (c === 62) {
      return i;
    }
  }
  return -1;
}

export function* tokenize(src: string): Generator<Token> {
  const lower = src.toLowerCase();
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      yield { kind: 'text', text: src.slice(i) };
      return;
    }
    if (lt > i) yield { kind: 'text', text: src.slice(i, lt) };
    const next = src.charCodeAt(lt + 1);

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      yield { kind: 'text', text: src.slice(lt + 9, end === -1 ? n : end) };
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      const gt = src.indexOf('>', lt + 2);
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    if (next === 47 /* / */ && isNameStart(src.charCodeAt(lt + 2))) {
      const nameEnd = readName(src, lt + 2);
      const gt = src.indexOf('>', nameEnd);
      yield { kind: 'close', name: lower.slice(lt + 2, nameEnd) };
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    if (isNameStart(next)) {
      const nameEnd = readName(src, lt + 1);
      const gt = tagEnd(src, nameEnd);
      if (gt === -1) return; // unterminated tag: nothing useful after it
      const name = lower.slice(lt + 1, nameEnd);
      const attrs = src.slice(nameEnd, gt);
      const selfClosing = attrs.endsWith('/');
      yield { kind: 'open', name, attrs, selfClosing };
      i = gt + 1;
      if (RAW.has(name) && !selfClosing) {
        const close = lower.indexOf(`</${name}`, i);
        const end = close === -1 ? n : close;
        yield { kind: 'raw', name, text: src.slice(i, end) };
        if (close === -1) return;
        const closeGt = src.indexOf('>', close);
        yield { kind: 'close', name };
        i = closeGt === -1 ? n : closeGt + 1;
      }
      continue;
    }
    // A '<' that doesn't start a tag is just text.
    yield { kind: 'text', text: '<' };
    i = lt + 1;
  }
}

/** Parse the attribute string of one tag (bounded by that tag's length). */
export function parseAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    const key = m[1]!.toLowerCase();
    if (!(key in out)) out[key] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
