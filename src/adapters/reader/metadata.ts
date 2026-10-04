import { clean, decodeEntities, hostOf } from '../../lib/text.ts';

export function titleKey(text: string): string {
  return clean(text, 400).normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').toLowerCase();
}
export function withoutSite(title: string, site?: string, base?: string): string {
  const candidates = [site, base ? hostOf(base) : undefined].filter((s): s is string => !!s);
  for (const name of candidates) {
    for (const separator of [' | ', ' - ', ' – ', ' — ']) {
      const suffix = separator + name;
      if (titleKey(title).endsWith(titleKey(suffix)) && title.length > suffix.length) return title.slice(0, -suffix.length).trim();
    }
  }
  return title;
}
/** Require an ISO date; Date.parse alone accepts values such as '2' and rolls invalid days. */
export function articleDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return undefined;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (month! < 1 || month! > 12 || day! < 1 || day! > new Date(Date.UTC(year!, month!, 0)).getUTCDate()) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
function urlKey(value: string, base?: string): string {
  try { const u = new URL(value, base); return `${u.origin}${u.pathname.replace(/\/$/, '')}`; } catch { return ''; }
}
function names(value: unknown): string[] {
  const items = Array.isArray(value) ? value.slice(0, 8) : [value];
  return items.flatMap((item) => {
    const raw = typeof item === 'string' ? item : item && typeof item === 'object' && 'name' in item ? item.name : undefined;
    const name = clean(raw, 120).replace(/^by\s+/i, '');
    return name && !/^https?:\/\//i.test(name) ? [name] : [];
  });
}
export function articleMetadata(meta: Record<string, string>, docTitle: string, scripts: string[], authors: string[], dates: Partial<Record<'publishedAt' | 'updatedAt', string>>, base?: string) {
  const siteName = meta['og:site_name'] || (base ? hostOf(base) : undefined);
  let title = withoutSite(meta['og:title'] || docTitle || 'Untitled', siteName, base);
  let byline = names(meta.author || meta['article:author']).join(', ') || authors.join(', ') || undefined;
  let publishedAt = articleDate(meta['article:published_time'] || meta['datepublished'] || dates.publishedAt);
  let updatedAt = articleDate(meta['article:modified_time'] || meta['datemodified'] || dates.updatedAt);
  const candidates: Record<string, unknown>[] = [];
  for (const script of scripts) {
    let root: unknown;
    try { root = JSON.parse(script); } catch { continue; }
    const queue: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
    for (let i = 0; i < queue.length && i < 500; i++) {
      const { value, depth } = queue[i]!;
      if (!value || typeof value !== 'object' || depth > 12) continue;
      if (Array.isArray(value)) { for (const v of value.slice(0, 100)) if (queue.length < 500) queue.push({ value: v, depth: depth + 1 }); continue; }
      const obj = value as Record<string, unknown>;
      const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
      if (types.some((t) => typeof t === 'string' && /^(?:Article|NewsArticle|BlogPosting|Review|ReportageNewsArticle|AnalysisNewsArticle)$/i.test(t))) candidates.push(obj);
      for (const v of Object.values(obj)) if (v && typeof v === 'object' && queue.length < 500) queue.push({ value: v, depth: depth + 1 });
    }
  }
  for (const obj of candidates) {
    const entity = obj.mainEntityOfPage;
    const ref = typeof obj.url === 'string' ? obj.url : typeof entity === 'string' ? entity : entity && typeof entity === 'object' && '@id' in entity && typeof entity['@id'] === 'string' ? entity['@id'] : undefined;
    const headline = clean(decodeEntities(clean(obj.headline, 400)), 300);
    const matchesUrl = !!base && !!ref && urlKey(ref, base) === urlKey(base);
    const matchesTitle = !!headline && titleKey(withoutSite(headline, siteName, base)) === titleKey(title);
    if (ref && base && !matchesUrl || !matchesUrl && !matchesTitle) continue;
    if (headline) title = withoutSite(headline, siteName, base);
    byline = names(obj.author).join(', ') || byline;
    publishedAt = articleDate(obj.datePublished) || publishedAt;
    updatedAt = articleDate(obj.dateModified) || updatedAt;
    break;
  }
  return { title, ...(siteName ? { siteName } : {}), ...(byline ? { byline } : {}), ...(publishedAt ? { publishedAt } : {}), ...(updatedAt ? { updatedAt } : {}) };
}
