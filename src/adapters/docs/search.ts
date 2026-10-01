/** Search over a loaded docs site: page titles, descriptions and section names, and Sphinx symbols. */
import type { DocSite } from './types.ts';

export interface DocHit {
  kind: 'page' | 'symbol';
  title: string;
  url: string;
  section?: string;
  role?: string;
}

/** Search a site's page titles, descriptions and section names, and (Sphinx) its symbols. */
export function searchDocs(site: DocSite, query: string, limit = 20): DocHit[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/[^\p{L}\p{N}_.]+/u).filter(Boolean);
  if (!tokens.length) return [];
  const scored: Array<{ hit: DocHit; score: number }> = [];
  for (const section of site.sections) {
    for (const page of section.pages) {
      const title = page.title.toLowerCase();
      const hay = `${title} ${(page.description ?? '').toLowerCase()} ${section.title.toLowerCase()}`;
      if (!tokens.every((t) => hay.includes(t))) continue;
      const score = (title === q ? 100 : title.startsWith(q) ? 60 : title.includes(q) ? 40 : 0) + tokens.filter((t) => title.includes(t)).length * 10;
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
