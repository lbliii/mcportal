/** Unified retrieval over retained material. Searching never fetches source pages. */
import { CLIP_LIMITS, queryWords, type ClipKind, type ClipStore, type ClipSummary } from './clips.ts';
import { AppError } from './lib/errors.ts';
import type { PassageLocator } from './evidence.ts';
import { clean } from './lib/text.ts';
import type { Profile } from './profile.ts';
import { canonicalReadingUrl, READING_LIMIT, type ReadingState, type ReadingStore } from './reading.ts';
import type { ProfileStore } from './store.ts';

export const LIBRARY_KINDS = ['saved', 'reading', 'quote', 'note', 'exchange', 'table', 'image', 'link'] as const;
export type LibraryKind = typeof LIBRARY_KINDS[number];
export interface LibraryQuery { query?: string; kind?: LibraryKind; site?: string; tag?: string; status?: ReadingState['status']; limit?: number; offset?: number }
export interface LibraryHit {
  ref: string;
  kind: 'page' | 'clip';
  title: string;
  source: string;
  url?: string;
  docs?: string;
  clipId?: string;
  clipKind?: ClipKind;
  origin?: ClipSummary['source']['kind'];
  locator?: PassageLocator;
  tags: string[];
  excerpt: string;
  updatedAt: string;
  saved: boolean;
  reading?: ReadingState;
  matched: string[];
}
export const LIBRARY_COVERAGE = 'Searches saved-link titles and notes, retained clip text and metadata, and reading-history titles and addresses. Saved links and history do not index live article bodies. Seen-only items appear only with the seen filter. Other accounts are never searched.';
export interface LibraryResult { query: string; effectiveQuery?: string; coverage?: string; hits: LibraryHit[]; total: number; offset: number; nextOffset: number | null }
export interface LibrarySearch { search(userId: string, query: LibraryQuery): Promise<LibraryResult> }
export interface LibrarySources { store: ProfileStore; clips?: ClipStore | undefined; reading?: ReadingStore | undefined }
export const LIBRARY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  query: { type: 'string', maxLength: 300 }, kind: { type: 'string', enum: LIBRARY_KINDS },
  site: { type: 'string', maxLength: 200 }, tag: { type: 'string', maxLength: 60 },
  status: { type: 'string', enum: ['seen', 'opened', 'read'] },
  limit: { type: 'integer', minimum: 1, maximum: 50 }, offset: { type: 'integer', minimum: 0, maximum: 2200 },
} };

function host(url?: string): string {
  try { return new URL(url!).hostname.replace(/^www\./, ''); } catch { return ''; }
}
/** Preserve selectors and query strings; only the reading canonicalizer removes fragments. */
function canonical(url: string): string | undefined {
  try { return canonicalReadingUrl(url); } catch { return undefined; }
}
/** A docs route is a hint from the caller's own subscribed docs, never from an unrelated account. */
function docsFor(url: string, profile: Profile): string | undefined {
  for (const p of profile.columns.flatMap(c => c.panels)) {
    if (p.source !== 'docs') continue;
    try {
      const page = new URL(url);
      let base = new URL(p.config.toc?.url || p.config.url);
      if (base.hostname === 'github.com') {
        const [owner, repo, kind, ref, ...folder] = base.pathname.split('/').filter(Boolean);
        if (kind !== 'tree' || !ref) continue;
        base = new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${folder.join('/')}`);
      } else if (p.config.toc || /\/(?:llms\.txt|objects\.inv|sitemap(?:_index)?\.xml)$/i.test(base.pathname)) base = new URL('.', base);
      if (page.origin === base.origin && (page.pathname === base.pathname || page.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/'))) return p.config.url;
    } catch { /* A named repo needs its original portal route; do not invent an address. */ }
  }
  return undefined;
}

/** Match and rank metadata; clip-body matches are supplied by the clip store's text index. */
function relevance(hit: LibraryHit, query: string, bodyMatch = false): number {
  const words = queryWords(query);
  const fields: Array<[string, string, number]> = [
    ['Title', hit.title, 12], ['Note or preview', hit.excerpt, 5], ['Tag', hit.tags.join(' '), 8], ['Address or source', `${hit.url ?? ''} ${hit.source}`, 2],
  ];
  if (!words.length) return 0;
  const text = fields.map(f => f[1]).join(' ').toLowerCase();
  if (!bodyMatch && !words.every(w => text.includes(w))) return -1;
  let score = bodyMatch ? 1 : 0;
  for (const [label, value, weight] of fields) {
    const lower = value.toLowerCase();
    const matches = words.filter(w => lower.includes(w)).length;
    if (!matches) continue;
    hit.matched.push(label);
    score += matches * weight;
    if (query.trim() && lower.includes(query.trim().toLowerCase())) score += weight * 2;
    // Exact tokens outrank substrings: v2 must precede v20/v22, request_id precedes request_id_extra.
    const tokens = lower.split(/[^\p{L}\p{N}_+.:%=-]+/u);
    score += words.filter(w => tokens.includes(w)).length * weight * 3;
  }
  if (bodyMatch && !words.every(w => text.includes(w))) hit.matched.push('Clip text');
  return score;
}

/** The hosted API calls this with its own stores, avoiding linked-client list-page caps. */
async function searchLiteral(userId: string, raw: LibraryQuery, stores: LibrarySources): Promise<LibraryResult> {
  const query = clean(raw.query, 300);
  if (raw.kind !== undefined && !LIBRARY_KINDS.includes(raw.kind)) throw new AppError('invalid_argument', 'Unknown library kind.');
  if (raw.status !== undefined && !['seen', 'opened', 'read'].includes(raw.status)) throw new AppError('invalid_argument', 'Unknown reading status.');
  const limit = raw.limit ?? 25, offset = raw.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 2200) throw new AppError('invalid_argument', 'Library pages need a limit of 1–50 and an offset of 0–2200.');
  const clipKind = raw.kind && raw.kind !== 'saved' && raw.kind !== 'reading' ? raw.kind : undefined;
  const [profile, clips, history] = await Promise.all([
    stores.store.get(userId),
    raw.kind === 'saved' || raw.kind === 'reading' ? [] : (stores.clips?.list(userId, { query, ...(clipKind ? { kind: clipKind } : {}), ...(raw.tag ? { tag: raw.tag } : {}), limit: CLIP_LIMITS.perUser }) ?? []),
    stores.reading?.list(userId, { limit: READING_LIMIT }) ?? [],
  ]);
  const pages = new Map<string, LibraryHit>();
  for (const s of profile.saved) {
    const url = canonical(s.url);
    if (!url) continue;
    pages.set(url, { ref: `url:${url}`, kind: 'page', title: s.title, source: host(url), url, tags: [], excerpt: s.note ?? '', updatedAt: s.savedAt, saved: true, matched: [], ...(docsFor(url, profile) ? { docs: docsFor(url, profile)! } : {}) });
  }
  for (const r of history) {
    const url = canonical(r.url);
    if (!url) continue;
    const kept = pages.get(url);
    if (kept) {
      kept.reading = r;
      const date = r.lastOpenedAt ?? r.lastSeenAt;
      if (date > kept.updatedAt) kept.updatedAt = date;
    } else if (r.status !== 'seen' || raw.status === 'seen') pages.set(url, {
      ref: `url:${url}`, kind: 'page', title: r.title || url, source: host(url), url, tags: [], excerpt: '', updatedAt: r.lastOpenedAt ?? r.lastSeenAt,
      saved: false, reading: r, matched: [], ...(docsFor(url, profile) ? { docs: docsFor(url, profile)! } : {}),
    });
  }
  const ranked: Array<{ hit: LibraryHit; score: number; sourceRank: number }> = [];
  for (const hit of pages.values()) {
    if (clipKind || raw.tag || (raw.kind === 'saved' && !hit.saved) || (raw.kind === 'reading' && !hit.reading)) continue;
    const score = relevance(hit, query);
    if (score >= 0) ranked.push({ hit, score, sourceRank: 0 });
  }
  for (const [index, c] of clips.entries()) {
    const hit: LibraryHit = { ref: `clip:${c.id}`, kind: 'clip', clipId: c.id, clipKind: c.kind, origin: c.source.kind,
      ...(c.source.locator ? { locator: c.source.locator } : {}),
      title: c.title, source: host(c.source.url) || c.source.title || (c.source.kind === 'conversation' ? 'A conversation' : 'Kept material'),
      ...(c.source.url ? { url: c.source.url } : {}), tags: c.tags, excerpt: clean([c.note, c.preview].filter(Boolean).join(' · '), 500),
      updatedAt: c.updatedAt, saved: false, matched: [], ...(c.source.url && docsFor(c.source.url, profile) ? { docs: docsFor(c.source.url, profile)! } : {}),
    };
    // Preserve the store's relevance order for ties, including Postgres body matches.
    ranked.push({ hit, score: relevance(hit, query, true), sourceRank: index });
  }
  const site = clean(raw.site, 200).toLowerCase();
  const matches = ranked.filter(({ hit }) => (!site || hit.source.toLowerCase().includes(site) || host(hit.url).includes(site)) && (!raw.status || hit.reading?.status === raw.status));
  // A numeric bonus preserves indexed clip order without a pair-dependent comparator.
  const rank = (r: typeof ranked[number]) => r.score + (query && r.hit.kind === 'clip' ? 0.5 / (r.sourceRank + 1) : 0);
  matches.sort((a, b) => rank(b) - rank(a) || b.hit.updatedAt.localeCompare(a.hit.updatedAt) || a.hit.ref.localeCompare(b.hit.ref));
  const hits = matches.slice(offset, offset + limit).map(({ hit }) => hit);
  return { query, coverage: LIBRARY_COVERAGE, hits, total: matches.length, offset, nextOffset: offset + hits.length < matches.length ? offset + hits.length : null };
}

/** A disclosed lexical retry for common recall questions, only after literal search misses.
 * Never remove identifier punctuation or broaden an already successful literal search.
 */
export async function searchLibrary(userId: string, raw: LibraryQuery, stores: LibrarySources): Promise<LibraryResult> {
  const literal = await searchLiteral(userId, raw, stores);
  if (literal.total || !/^(?:where (?:was|is)|find (?:me )?(?:the|a)|what was)\b/i.test(literal.query)) return literal;
  const keywords = literal.query.toLowerCase().replace(/[?]$/, '').split(/\s+/)
    .filter(w => !new Set(['where', 'was', 'is', 'find', 'me', 'what', 'the', 'a', 'an', 'about', 'quote', 'page', 'article', 'that', 'of', 'and', 'in']).has(w));
  if (keywords.length < 2 || keywords.join(' ') === literal.query) return literal;
  const result = await searchLiteral(userId, { ...raw, query: keywords.join(' ') }, stores);
  return { ...result, query: literal.query, effectiveQuery: keywords.join(' ') };
}
