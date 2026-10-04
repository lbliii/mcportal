/** Bounded structural selection. No publisher names or paragraph keyword cutoffs. */
import { parseAttrs, tokenize, type Token } from '../../lib/html.ts';
import { clean, decodeEntities } from '../../lib/text.ts';

const ACTION = /\b(?:sign up (?:for|to) (?:our|the|a|[^.]{0,50})?[^.]{0,50}newsletter|enter your email|subscribe (?:now|to our newsletter)|privacy policy.*recaptcha)\b/i;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const CHROME = /(?:^|[\s_-])(?:newsletter|subscription|subscribe|recaptcha|consent|cookie-banner|author-bio(?:graphy)?|author-profile|author-mini-bio|author-avatar|author-img|author-image|breadcrumbs?|related-(?:posts|articles|stories|content)|recommended-(?:posts|articles|stories)|recommendations|recommendation-card|social-share|share-tools|article-tags|post-tags|tag-list)(?:$|[\s_-])/i;
const BODY = /(?:^|[\s_-])(?:article-body|story-body|post-content|entry-content|article-content)(?:$|[\s_-])/i;
const AUTHOR = /(?:^|[\s_-])(?:byline|author-name|article-author|post-author)(?:$|[\s_-])/i;
interface Node { name: string; start: number; end: number; parent: number; chars: number; linked: number; prose: number; excluded: boolean; candidate: number; author: boolean; chrome: boolean; ambiguous: boolean; utility: boolean; sample: string; body: boolean; containsBody: boolean; scope: number; images: number; actionProse: number; peripheral: boolean; linkedCard: boolean; commerce: boolean; date?: 'publishedAt' | 'updatedAt'; datetime?: string; text: string }
export interface Structure { tokens: Token[]; scripts: string[]; authors: string[]; dates: Partial<Record<'publishedAt' | 'updatedAt', string>> }

/** Token/node/depth caps keep all ancestry work bounded, including malformed HTML. */
export function articleStructure(html: string, docs: boolean): Structure {
  const tokens: Token[] = [], nodes: Node[] = [], stack: number[] = [], scripts: string[] = [];
  let overflow = 0, overflowStart = -1, scriptType = '', scriptBytes = 0;
  const overflowRanges: [number, number][] = [];
  for (const tok of tokenize(html)) {
    if (tokens.length >= 100_000) break;
    const i = tokens.push(tok) - 1;
    if (tok.kind === 'raw') {
      if (tok.name === 'script' && /application\/ld\+json/i.test(scriptType) && tok.text.length <= 65_536 && scriptBytes + tok.text.length <= 262_144 && scripts.length < 16) {
        scripts.push(tok.text); scriptBytes += tok.text.length;
      }
      continue;
    }
    if (overflow) {
      if (tok.kind === 'open' && !tok.selfClosing && !VOID.has(tok.name)) overflow++;
      if (tok.kind === 'close' && --overflow === 0) overflowRanges.push([overflowStart, i]);
      continue;
    }
    if (tok.kind === 'open') {
      const a = parseAttrs(tok.attrs), attrs = `${a.id ?? ''} ${a.class ?? ''}`;
      if (tok.name === 'script') scriptType = a.type ?? '';
      // Browsers implicitly close repeated paragraphs and sibling list items.
      if (tok.name === 'p' && nodes[stack.at(-1) ?? -1]?.name === 'p') nodes[stack.pop()!]!.end = i - 1;
      if (tok.name === 'li' && nodes[stack.at(-1) ?? -1]?.name === 'li') nodes[stack.pop()!]!.end = i - 1;
      if (stack.length >= 64 || nodes.length >= 30_000) { overflow = tok.selfClosing || VOID.has(tok.name) ? 0 : 1; overflowStart = i; if (!overflow) overflowRanges.push([i, i]); continue; }
      const parent = stack.at(-1) ?? -1;
      const date = a.itemprop === 'datePublished' ? 'publishedAt' : a.itemprop === 'dateModified' ? 'updatedAt' : undefined;
      const n: Node = { name: tok.name, start: i, end: i, parent, chars: 0, linked: 0, prose: 0, text: '', excluded: (parent >= 0 && nodes[parent]!.excluded) || (!docs && (a['aria-hidden'] === 'true' || 'hidden' in a)), chrome: !docs && CHROME.test(attrs), ambiguous: /(?:^|[\s_-])(?:newsletter|subscription|subscribe|related-content)(?:$|[\s_-])/i.test(attrs), utility: ['form', 'input', 'button'].includes(tok.name), sample: '', body: (parent >= 0 && nodes[parent]!.body) || a.itemprop === 'articleBody' || BODY.test(attrs), containsBody: a.itemprop === 'articleBody' || BODY.test(attrs), scope: tok.name === 'article' || tok.name === 'main' ? nodes.length : parent >= 0 ? nodes[parent]!.scope : -1, images: tok.name === 'img' ? 1 : 0, actionProse: 0, peripheral: (parent >= 0 && nodes[parent]!.peripheral) || /(?:^|[\s_-])post-bottom(?:$|[\s_-])/i.test(attrs), linkedCard: /(?:^|[\s_-])(?:listing-item|topic-card)(?:$|[\s_-])/i.test(attrs), commerce: /(?:^|[\s_-])(?:merchrow|mpmerchitem|mpmerch)(?:$|[\s_-])/i.test(attrs), candidate: tok.name === 'article' ? 3 : a.itemprop === 'articleBody' || BODY.test(attrs) ? 2 : tok.name === 'main' || a.role === 'main' ? 1 : 0, author: a.itemprop === 'author' || a.rel === 'author' || AUTHOR.test(attrs), ...(date ? { date, datetime: a.datetime ?? a.content } : {}) };
      const id = nodes.push(n) - 1;
      if (!tok.selfClosing && !VOID.has(tok.name)) stack.push(id);
    } else if (tok.kind === 'close') {
      let at = stack.length - 1;
      while (at >= 0 && nodes[stack[at]!]!.name !== tok.name) at--;
      if (at >= 0) { for (let j = at; j < stack.length; j++) nodes[stack[j]!]!.end = i; stack.length = at; }
    } else if (tok.kind === 'text') {
      const id = stack.at(-1);
      if (id === undefined || nodes[id]!.excluded) continue;
      const n = nodes[id]!, text = clean(decodeEntities(tok.text), 4000);
      n.chars += text.length;
      if (n.sample.length < 400) n.sample += ` ${text}`;
      if (stack.some((id) => nodes[id]!.name === 'a')) n.linked += text.length;
      if (stack.some((id) => nodes[id]!.name === 'p')) n.prose += text.length;
      for (const id of stack) { const capture = nodes[id]!; if ((capture.author || capture.date) && capture.text.length < 400) capture.text += ` ${text}`; }
    }
  }
  if (overflow) overflowRanges.push([overflowStart, tokens.length]);
  for (const id of stack) nodes[id]!.end = tokens.length;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.name === 'p' && n.chars < 800 && ACTION.test(n.sample)) n.actionProse = n.prose;
    if (n.parent < 0 || n.excluded) continue;
    const p = nodes[n.parent]!;
    p.chars += n.chars; p.linked += n.linked; p.prose += n.prose; p.utility ||= n.utility; p.containsBody ||= n.containsBody; p.images += n.images; p.actionProse += n.actionProse;
    if (p.sample.length < 400) p.sample += n.sample.slice(0, 400 - p.sample.length);

  }
  const bodyScopes = new Set(nodes.filter((n) => n.candidate === 2).map((n) => n.scope));
  // Exact utility headings identify their own peripheral panel only when the
  // same story supplies an explicit body. Identical editorial headings in that
  // body, and arbitrary later sections/corrections/source links, remain intact.
  if (!docs) for (const n of nodes) {
    if (n.body || !bodyScopes.has(n.scope) || !/^h[1-6]$/.test(n.name)) continue;
    const heading = clean(n.sample, 120);
    if (!/^(?:about the author|most popular)$/i.test(heading)) continue;
    let id = n.parent;
    while (id >= 0 && !['div', 'section', 'article', 'main'].includes(nodes[id]!.name)) id = nodes[id]!.parent;
    const panel = nodes[id];
    if (panel && ['div', 'section'].includes(panel.name) && !panel.containsBody && (heading.toLowerCase() === 'about the author' && panel.prose < 1200 || panel.linked > 0 || panel.images > 0)) panel.chrome = true;
  }
  // Identity alone is insufficient for ambiguous editorial section names. Remove
  // those only with utility/action evidence, short prose, or link-dense cards.
  for (const n of nodes) {
    if (!docs && !n.containsBody) {
      if (n.commerce || n.linkedCard && n.images > 0 && (n.prose < 160 || n.linked > n.chars * .45)) n.chrome = true;
      if (!n.body && bodyScopes.has(n.scope) && n.name === 'p' && n.actionProse > 0) n.chrome = true;
      if (!n.body && n.peripheral && n.images > 0 && n.prose <= n.actionProse && n.actionProse > 0) n.chrome = true;
      if (!n.body && n.peripheral && n.name === 'a' && n.images > 0 && n.prose < 160) n.chrome = true;
    }
    if (n.parent >= 0 && nodes[n.parent]!.excluded) n.excluded = true;
    if (n.chrome && (!n.ambiguous || n.utility || n.prose < 160 || n.linked > n.chars * .45 || /\b(?:sign up|subscribe (?:now|to|for)|enter your email|join (?:our|the) newsletter|get (?:our|the) newsletter|privacy policy|recaptcha)\b/i.test(n.sample))) n.excluded = true;
    if (n.excluded && n.parent >= 0 && !nodes[n.parent]!.excluded) {
      let ancestor = n.parent;
      while (ancestor >= 0) { const p = nodes[ancestor]!; p.chars -= n.chars; p.linked -= n.linked; p.prose -= n.prose; ancestor = p.parent; }
    }
  }
  let selected: Node | undefined;
  if (!docs) {
    // Prefer an encompassing article over a subsection. Cards dominated by links
    // cannot beat prose; when no semantic article exists, use an explicit body/main.
    const eligible = nodes.filter((n) => !n.excluded && n.candidate && n.chars > n.linked * 1.3);
    const articles = eligible.filter((n) => n.candidate === 3);
    const pool = articles.length ? articles : eligible;
    for (const n of pool) {
      const score = n.prose * 2 + n.chars - n.linked * 2;
      if (!selected || score > selected.prose * 2 + selected.chars - selected.linked * 2) selected = n;
    }
  }
  const within = (n: Node) => !selected || n.start >= selected.start && n.end <= selected.end;
  const authors: string[] = [], dates: Structure['dates'] = {};
  for (const n of nodes) {
    if (!within(n) || n.excluded) continue;
    if (n.author && n.chars < 200) {
      const value = clean(n.text, 160).replace(/^by\s+/i, '');
      if (value && !authors.includes(value) && authors.length < 8) authors.push(value);
    }
    if (n.date && !dates[n.date]) dates[n.date] = n.datetime ?? clean(n.text, 80);
  }
  const ranges: [number, number][] = [...overflowRanges];
  if (!docs) for (const n of nodes) if (n.excluded && (n.parent < 0 || !nodes[n.parent]!.excluded)) ranges.push([n.start, n.end]);
  // Difference-array interval union avoids rescanning overlapping subtrees or sorting.
  const changes = new Int32Array(tokens.length + 2);
  for (const [start, end] of ranges) { changes[start]!++; changes[Math.min(end + 1, tokens.length + 1)]!--; }
  let excluded = 0;
  const kept = tokens.filter((tok, i) => {
    excluded += changes[i]!;
    if (excluded > 0) return false;
    if (!selected || i >= selected.start && i <= selected.end) return true;
    return tok.kind === 'raw' && tok.name === 'title' || tok.kind === 'open' && tok.name === 'meta';
  });
  return { tokens: kept, scripts, authors, dates };
}
