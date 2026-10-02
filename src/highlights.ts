/**
 * Highlights (docs/plans/attention.md, phase 4): the agent picks what's worth the user's
 * time from what's new in their room. MCPortal never ranks or summarizes; it gives the
 * agent compact candidates and taste signals (list_new_items), and shows the agent's picks
 * with the sources' own titles and links (show_highlights). Refs name an item by portal and
 * a short hash of its id, so a pick can only be an item the room really has.
 */
import { clean } from './lib/text.ts';
import type { Profile } from './profile.ts';
import type { ReadingState } from './reading.ts';
import { seenHash, tracksSeen } from './seen.ts';
import type { ClipSummary } from './clips.ts';
import type { Item, PortalResult } from './types.ts';

export const CANDIDATES = { perPortal: 8, total: 60, excerpt: 160 };
export const PICKS = { max: 12, why: 200, title: 80, intro: 300 };

/** "hn-top/3fa9c1d2": the portal, and the first 8 characters of the item's id hash. */
export const itemRef = (portalId: string, item: Item) => `${portalId}/${seenHash(item.id).slice(0, 8)}`;

export function parseRef(ref: unknown): { portalId: string; hash: string } | null {
  const m = typeof ref === 'string' ? /^([a-z0-9-]{1,80})\/([0-9a-f]{8})$/.exec(ref.trim()) : null;
  return m ? { portalId: m[1]!, hash: m[2]! } : null;
}

/** The item a ref names among a portal's items. */
export const findByRef = (items: Item[], hash: string) => items.find((i) => seenHash(i.id).startsWith(hash));

export interface Candidate { ref: string; portalId: string; portalTitle: string; source: PortalResult['source']; item: Item }

/**
 * Items the user hasn't seen, at most CANDIDATES.perPortal from each portal (in the
 * source's own order: its ranking or newest first), taken in turn across portals up to
 * CANDIDATES.total. A portal with no seen set yet has seen nothing: all of it counts.
 */
export function candidates(portals: PortalResult[], seen: Map<string, Set<string>> | null): Candidate[] {
  const lanes = portals
    .filter((p) => tracksSeen(p.source) && !p.error && !p.pin)
    .map((p) => {
      const set = seen?.get(p.portalId);
      return p.items.filter((i) => !set || !set.has(seenHash(i.id))).slice(0, CANDIDATES.perPortal)
        .map((item) => ({ ref: itemRef(p.portalId, item), portalId: p.portalId, portalTitle: p.title, source: p.source, item }));
    });
  const out: Candidate[] = [];
  for (let round = 0; out.length < CANDIDATES.total && lanes.some((l) => l.length > round); round++) {
    for (const lane of lanes) if (lane[round] && out.length < CANDIDATES.total) out.push(lane[round]!);
  }
  return out;
}

/** One candidate as a line: ref, where, title, age, a short excerpt. */
export function candidateLine(c: Candidate, now = Date.now()): string {
  const age = c.item.publishedAt ? ageText(now - Date.parse(c.item.publishedAt)) : '';
  const excerpt = c.item.summary ? clean(c.item.summary, CANDIDATES.excerpt) : '';
  return `[${c.ref}] ${c.portalTitle} · ${c.item.title}${age ? ` · ${age}` : ''}${c.item.meta.length ? ` · ${c.item.meta.slice(0, 2).join(', ')}` : ''}${excerpt ? `\n  ${excerpt}` : ''}`;
}

function ageText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const h = Math.round(ms / 3_600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** What MCPortal knows of the user's taste, for an agent with no memory of them. */
export function tasteSignals(profile: Profile, reading: ReadingState[], clips: ClipSummary[]): string[] {
  const lines: string[] = [];
  const saved = profile.saved.slice(0, 10).map((s) => clean(s.title, 100)).filter(Boolean);
  if (saved.length) lines.push(`recently saved: ${saved.join(' | ')}`);
  const finished = reading.filter((r) => r.status === 'read' && r.title).slice(0, 10).map((r) => clean(r.title, 100));
  if (finished.length) lines.push(`recently finished reading: ${finished.join(' | ')}`);
  const tags = new Map<string, number>();
  for (const c of clips) for (const t of c.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  const topTags = [...tags].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => `#${t}`);
  if (topTags.length) lines.push(`clip tags: ${topTags.join(' ')}`);
  const sites = new Map<string, number>();
  for (const r of reading) { try { const host = new URL(r.url).host.replace(/^www\./, ''); sites.set(host, (sites.get(host) ?? 0) + 1); } catch { /* not a URL */ } }
  const topSites = [...sites].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h]) => h);
  if (topSites.length) lines.push(`reads most from: ${topSites.join(', ')}`);
  return lines;
}
