/**
 * Markdown-lite: markdown parsed into plain-text blocks, never interpreted as
 * HTML. Used for note clips and for docs pages.
 */
import type { ArticleBlock } from '../types.ts';

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
