import { readFileSync } from 'node:fs';
import { APP_VERSION } from './version.ts';
import { parseMarkdown } from './lib/markdown.ts';
import { escapeHtml } from './lib/web.ts';

const GUIDE = readFileSync(new URL('./upgrade.md', import.meta.url), 'utf8');
export function upgradeGuide(publicUrl: string): string {
  return GUIDE.replaceAll('{{VERSION}}', APP_VERSION).replaceAll('{{PUBLIC_URL}}', publicUrl);
}
/** Render our bundled guide, with the same parsed links as the reader. Never evaluate remote Markdown/HTML. */
export function upgradeGuideHtml(publicUrl: string): string {
  return parseMarkdown(upgradeGuide(publicUrl).replace(/^# Upgrade MCPortal\s+/, ''), { base: publicUrl }).map(block => {
    if (block.type === 'pre') return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    const text = block.spans?.map(span => {
      let value = escapeHtml(span.text);
      if (span.code) value = `<code>${value}</code>`;
      if (span.strong) value = `<strong>${value}</strong>`;
      if (span.href) value = `<a href="${escapeHtml(span.href)}">${value}</a>`;
      return value;
    }).join('') ?? escapeHtml(block.text);
    return block.type === 'h' ? `<h2>${text}</h2>` : `<p>${text}</p>`;
  }).join('\n');
}
