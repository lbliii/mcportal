/**
 * Finding people (docs/plans/finding-people.md, phase 3): what the user is into as signals
 * to match, and how one listed person's public choices match them. Pure: Social gathers
 * the people and their posts, and the find_people tool words the reasons. Nothing here
 * calls a model or the network.
 *
 * Signals, strongest first: a source they feature that the user follows or named (rarer
 * sources count for more, so everyone featuring Hacker News says little), a feed from the
 * same site, posts they shared with everyone from sites the user cares about, and the
 * user's words in their Space or posts.
 */
import type { FeaturedSource } from './public-profiles.ts';

/** A source as matching sees it: what it is (key), the site it's from, and its title. */
export interface SourceSignal { key: string; site?: string | undefined; title: string }

/** What to look for. */
export interface Wanted {
  sources: SourceSignal[];
  /** Sites whose posts count (from the sources, and addresses the user named). */
  hosts: string[];
  /** Words, from what the user said they're into. */
  terms: string[];
}

/** One listed person, as far as matching needs: only what they made public. */
export interface Candidate {
  handle: string;
  displayName?: string | undefined;
  spaceTitle?: string | undefined;
  bio?: string | undefined;
  featured: FeaturedSource[];
  /** Their recent posts shared with everyone. */
  posts: Array<{ title: string; url?: string | undefined; note?: string | undefined }>;
}

/** Why a person matched, in parts the tool turns into sentences. */
export interface Match {
  score: number;
  /** Titles of their featured sources that are the user's (or named) sources. */
  sources: string[];
  /** Sites they feature other feeds from. */
  sites: string[];
  /** Sites they shared posts from, with how many. */
  hosts: Array<{ host: string; count: number }>;
  /** The user's words found in their Space, and in their posts. */
  terms: { space: string[]; posts: string[] };
}

/** How many listed people feature each source key and site: rarer means more telling. */
export interface Commonness { keys: Map<string, number>; sites: Map<string, number> }

/** Sites where "the same site" says nothing about taste: every channel or subreddit lives there. */
const SHARED_SITES = new Set(['reddit.com', 'old.reddit.com', 'youtube.com', 'medium.com', 'news.ycombinator.com', 'bsky.app', 'mastodon.social', 'github.com', 'substack.com', 'feeds.feedburner.com']);

const STOP = new Set(['the', 'and', 'for', 'with', 'about', 'from', 'that', 'this', 'into', 'are', 'you', 'your', 'who', 'what', 'people', 'person', 'stuff', 'things', 'like', 'likes', 'love', 'loves', 'really', 'lot', 'lots', 'mcportal', 'portal', 'space', 'posts', 'post', 'feed', 'feeds', 'news', 'blog', 'blogs']);

/** "simonwillison.net" from a web address; no www, lower case. */
export function hostOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase().replace(/^www\./, '') : undefined;
  } catch {
    return undefined;
  }
}

/** A source's identity and site, loose enough that www, http(s) and a trailing slash don't matter. */
export function sourceSignal(source: string, config: unknown, title: string): SourceSignal | undefined {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  if (source === 'hn') return { key: `hn:${typeof c.feed === 'string' ? c.feed : 'top'}`, title };
  if (source === 'rss' || source === 'docs') {
    const url = typeof c.url === 'string' ? c.url : '';
    const host = hostOf(url);
    if (!host) return undefined;
    const path = new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
    return { key: `web:${host}${path}`, site: SHARED_SITES.has(host) ? undefined : host, title };
  }
  if (source === 'github') {
    if (c.mode === 'releases' && typeof c.repo === 'string') return { key: `github:${c.repo.toLowerCase()}`, title };
    if (typeof c.query === 'string') return { key: `github?${c.query.toLowerCase().trim()}`, title };
  }
  return undefined;
}

/**
 * What the user named, as signals: a web address or bare domain (a site, and that exact
 * feed if it is one), or a GitHub owner/repo. Nothing is fetched.
 */
export function namedSignal(raw: string): { source?: SourceSignal; host?: string } {
  const text = raw.trim();
  const repo = /^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(text);
  if (repo && !text.includes(' ') && (text.includes('github.com') || !/\.[a-z]{2,}$/i.test(repo[1]!.split('/')[0]!))) {
    return { source: { key: `github:${repo[1]!.toLowerCase()}`, title: repo[1]! } };
  }
  const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const host = hostOf(url);
  if (!host || !host.includes('.')) return {};
  const signal = sourceSignal('rss', { url }, text);
  return { ...(signal && new URL(url).pathname.length > 1 ? { source: signal } : {}), host };
}

/** Distinct words worth matching from what the user said: three letters or more, no filler. */
export function termsOf(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 12);
}

/** Whether a term is in a text: whole words, or the start of one for longer terms ("synth" finds "synths"). */
function mentions(text: string, term: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) ?? [];
  return words.some((w) => w === term || (term.length >= 4 && w.startsWith(term)));
}

/** How common each source and site is among everyone listed. */
export function commonness(people: Array<{ featured: FeaturedSource[] }>): Commonness {
  const keys = new Map<string, number>();
  const sites = new Map<string, number>();
  for (const person of people) {
    const signals = person.featured.map((f) => sourceSignal(f.source, f.config, f.title)).filter((s) => s !== undefined);
    for (const key of new Set(signals.map((s) => s.key))) keys.set(key, (keys.get(key) ?? 0) + 1);
    for (const site of new Set(signals.map((s) => s.site).filter((s) => s !== undefined))) sites.set(site, (sites.get(site) ?? 0) + 1);
  }
  return { keys, sites };
}

/** How one person matches what's wanted; a score of 0 means not at all. */
export function match(person: Candidate, wanted: Wanted, common: Commonness): Match {
  const out: Match = { score: 0, sources: [], sites: [], hosts: [], terms: { space: [], posts: [] } };
  const wantedKeys = new Set(wanted.sources.map((s) => s.key));
  const wantedSites = new Set([...wanted.sources.map((s) => s.site).filter((s) => s !== undefined), ...wanted.hosts.filter((h) => !SHARED_SITES.has(h))]);
  const theirs = person.featured.map((f) => ({ f, signal: sourceSignal(f.source, f.config, f.title) }));
  const exactSites = new Set<string>();
  for (const { f, signal } of theirs) {
    if (!signal || !wantedKeys.has(signal.key)) continue;
    out.sources.push(f.title);
    out.score += 1 + 4 / (common.keys.get(signal.key) ?? 1);
    if (signal.site) exactSites.add(signal.site);
  }
  for (const site of new Set(theirs.map(({ signal }) => signal?.site).filter((s) => s !== undefined))) {
    if (!wantedSites.has(site) || exactSites.has(site)) continue;
    out.sites.push(site);
    out.score += 0.5 + 1.5 / (common.sites.get(site) ?? 1);
  }
  const hostCounts = new Map<string, number>();
  for (const post of person.posts) {
    const host = post.url ? hostOf(post.url) : undefined;
    if (host && (wanted.hosts.includes(host) || wantedSites.has(host))) hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }
  for (const [host, count] of hostCounts) {
    out.hosts.push({ host, count });
    out.score += 0.75 * Math.min(count, 3);
  }
  const space = [person.handle, person.displayName, person.spaceTitle, person.bio, ...person.featured.map((f) => f.title)].filter(Boolean).join(' \n ');
  const posts = person.posts.map((p) => `${p.title} \n ${p.note ?? ''}`).join(' \n ');
  for (const term of wanted.terms) {
    if (mentions(space, term)) { out.terms.space.push(term); out.score += 2; }
    else if (mentions(posts, term)) { out.terms.posts.push(term); out.score += 1; }
  }
  return out;
}
