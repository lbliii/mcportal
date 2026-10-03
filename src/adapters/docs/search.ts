/** Search docs outlines, Sphinx symbols and content already held in the bounded page cache. */
import type { DocPage } from './pages.ts';
import type { DocSite } from './types.ts';

export interface DocHit {
  kind: 'page' | 'symbol';
  title: string;
  url: string;
  section?: string;
  role?: string;
}

/** Search the outline and symbols, plus fresh page content supplied by the caller. */
export function searchDocs(site: DocSite, query: string, limit = 20, cachedPage?: (url: string) => DocPage | undefined): DocHit[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/[^\p{L}\p{N}_.]+/u).filter(Boolean);
  if (!tokens.length) return [];
  const scored: Array<{ hit: DocHit; score: number }> = [];
  for (const section of site.sections) {
    for (const page of section.pages) {
      const title = page.title.toLowerCase();
      const hay = `${title} ${(page.description ?? '').toLowerCase()} ${section.title.toLowerCase()}`;
      const outlineMatch = tokens.every((t) => hay.includes(t));
      // The lookup stays scoped to TOC pages, excluding nested indexes. No page
      // loads or extra retained index: the shared cache owns freshness and bytes.
      const cached = !page.index ? cachedPage?.(page.url) : undefined;
      const body = cached?.blocks.map((block) => block.type === 'table'
        ? [block.text, ...(block.columns ?? []), ...(block.rows ?? []).flat()].join(' ')
        : block.text).join(' ').toLowerCase() ?? '';
      const full = `${hay} ${body}`;
      if (!outlineMatch && !tokens.every((t) => full.includes(t))) continue;
      const score = (title === q ? 100 : title.startsWith(q) ? 60 : title.includes(q) ? 40 : 0) + tokens.filter((t) => title.includes(t)).length * 10 + (outlineMatch ? 10 : 0);
      scored.push({ hit: { kind: 'page', title: page.title, url: page.url, section: section.title }, score });
    }
  }
  for (const symbol of site.symbols ?? []) {
    const name = symbol.name.toLowerCase();
    const score = name === q ? 120 : name.endsWith(`.${q}`) ? 90 : name.startsWith(q) ? 70 : name.includes(q) ? 30 : 0;
    if (score) scored.push({ hit: { kind: 'symbol', title: symbol.name, url: symbol.url, role: symbol.role }, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.hit.title.length - b.hit.title.length)
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((s) => s.hit);
}
