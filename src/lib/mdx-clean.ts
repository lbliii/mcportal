/**
 * MDX and docs-generator syntax turned into plain markdown before parsing: imports and
 * exports dropped, components (<Note>, <Tabs>, <Card>, <ParamField>…) and MkDocs
 * admonitions rewritten, other HTML block tags removed with their text kept.
 */
import { clean } from './text.ts';
import { toneOf } from './markdown-inline.ts';

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
