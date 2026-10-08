/** Bounded private subscriptions, dated findings and exact retained change evidence. */
import { AppError } from './lib/errors.ts';
import { assertPublicUrl } from './lib/safe-fetch.ts';
import { REPO_PATTERN } from './adapters/github.ts';
export interface WatchedEvent { id: string; title: string; url: string; startsAt: string; timezone: string; allDay?: boolean; venue: string; city: string; status: 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled'; provider: 'calendar' | 'ticketmaster'; updatedAt: string }
export interface Watch { id: string; kind: 'page' | 'releases' | 'calendar' | 'artist'; title: string; url?: string; repo?: string; artistId?: string; city?: string; country?: string; timezone: string; paused: boolean; addedAt: string; nextCheck: string; lastAttempt?: string; lastSuccess?: string; failures: number; error?: string; warning?: string; baseline?: { text: string; fetchedAt: string; digest: string }; events: WatchedEvent[]; lease?: { token: string; until: string } }
export interface WatchFinding { id: string; watchId: string; kind: 'change' | 'availability' | 'event'; title: string; url?: string; at: string; dedup: string; read: boolean; beforeAt?: string; afterAt?: string; diff?: Array<{ kind: 'same' | 'added' | 'removed'; text: string }>; event?: WatchedEvent }
export interface WatchState { watches: Watch[]; inbox: WatchFinding[] }
export const WATCH_LIMITS = { watches: 20, inbox: 40, baseline: 24000, diff: 12000, events: 100, retentionDays: 30, checkMs: 6 * 3600000 };
const invalid = (s: string) => new AppError('invalid_argument', s);
function text(raw: unknown, n: number, name: string): string { if (typeof raw !== 'string' || !raw.trim() || raw.length > n) throw invalid(`Invalid watch ${name}.`); return raw; }
export function watchDate(raw: unknown): string { if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw))) throw invalid('Invalid watch date.'); return new Date(raw).toISOString(); }
export function watchTimezone(raw: unknown): string { const zone = text(raw, 100, 'timezone'); try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { throw invalid('Choose an IANA timezone, such as America/New_York.'); } return zone; }
export function validEvent(raw: WatchedEvent): WatchedEvent {
  if (!raw || !['calendar','ticketmaster'].includes(raw.provider) || !['scheduled','cancelled','postponed','rescheduled'].includes(raw.status)) throw invalid('Invalid watched event.');
  return { id: text(raw.id, 500, 'event ID'), title: text(raw.title, 300, 'event title'), url: assertPublicUrl(text(raw.url,4096,'event URL')).href, startsAt: watchDate(raw.startsAt), timezone: watchTimezone(raw.timezone), venue: typeof raw.venue === 'string' && raw.venue.length <= 300 ? raw.venue : '', city: typeof raw.city === 'string' && raw.city.length <= 200 ? raw.city : '', status: raw.status, provider: raw.provider, updatedAt: watchDate(raw.updatedAt), ...(raw.allDay === true ? { allDay: true } : {}) };
}
function validWatch(w: Watch): Watch {
  if (!w || !/^watch_[a-f0-9]{24}$/.test(w.id) || !['page','releases','calendar','artist'].includes(w.kind) || typeof w.paused !== 'boolean' || !Number.isSafeInteger(w.failures) || w.failures < 0 || !Array.isArray(w.events) || w.events.length > WATCH_LIMITS.events) throw invalid('Invalid watch.');
  const r: Watch = { id: w.id, kind: w.kind, title: text(w.title,200,'title'), timezone: watchTimezone(w.timezone), paused: w.paused, addedAt: watchDate(w.addedAt), nextCheck: watchDate(w.nextCheck), failures: w.failures, events: w.events.map(validEvent) };
  if (w.kind === 'page' || w.kind === 'calendar') r.url = assertPublicUrl(text(w.url,4096,'URL')).href;
  if (w.kind === 'releases') { if (typeof w.repo !== 'string' || !REPO_PATTERN.test(w.repo) || w.repo.length > 200) throw invalid('Use a repository owner/name.'); r.repo = w.repo; }
  if (w.kind === 'artist') { r.artistId = text(w.artistId,100,'artist ID'); r.city = text(w.city,200,'city'); r.country = text(w.country,2,'country').toUpperCase(); if (!/^[A-Z]{2}$/.test(r.country)) throw invalid('Use a two-letter country.'); }
  if (w.lastAttempt) r.lastAttempt = watchDate(w.lastAttempt);
  if (w.lastSuccess) r.lastSuccess = watchDate(w.lastSuccess);
  if (w.error) r.error = text(w.error,500,'error');
  if (w.warning) r.warning = text(w.warning,500,'warning');
  if (w.baseline) r.baseline = { text: text(w.baseline.text,WATCH_LIMITS.baseline,'baseline'), fetchedAt: watchDate(w.baseline.fetchedAt), digest: text(w.baseline.digest,64,'digest') };
  if (w.lease) r.lease = { token: text(w.lease.token,100,'lease'), until: watchDate(w.lease.until) };
  return r;
}
export function validateWatchState(raw: Partial<WatchState>): WatchState {
  if (raw.watches !== undefined && (!Array.isArray(raw.watches) || raw.watches.length > WATCH_LIMITS.watches) || raw.inbox !== undefined && (!Array.isArray(raw.inbox) || raw.inbox.length > WATCH_LIMITS.inbox)) throw invalid('Watch storage limits exceeded.');
  const watches = (raw.watches || []).map(validWatch), ids = new Set(watches.map(w => w.id));
  if (ids.size !== watches.length) throw invalid('Watch IDs must be unique.');
  const inbox = (raw.inbox || []).map(f => {
    if (!f || !ids.has(f.watchId) || !['change','availability','event'].includes(f.kind) || typeof f.read !== 'boolean') throw invalid('Invalid watch finding.');
    const r: WatchFinding = { id: text(f.id,100,'finding ID'), watchId: f.watchId, kind: f.kind, title: text(f.title,300,'finding title'), at: watchDate(f.at), dedup: text(f.dedup,500,'deduplication ID'), read: f.read };
    if (f.url) r.url = assertPublicUrl(text(f.url,4096,'finding URL')).href;
    if (f.beforeAt) r.beforeAt = watchDate(f.beforeAt);
    if (f.afterAt) r.afterAt = watchDate(f.afterAt);
    if (f.diff) { if (!Array.isArray(f.diff) || f.diff.length > 400 || f.diff.some(d => !['same','added','removed'].includes(d.kind) || typeof d.text !== 'string') || f.diff.reduce((n,d) => n+d.text.length,0) > WATCH_LIMITS.diff) throw invalid('Change evidence exceeds its budget.'); r.diff = f.diff.map(d => ({ kind: d.kind, text: d.text })); }
    if (f.event) r.event = validEvent(f.event);
    return r;
  });
  if (new Set(inbox.map(f => f.id)).size !== inbox.length) throw invalid('Finding IDs must be unique.');
  return { watches, inbox };
}
export function pruneWatches(state: WatchState, now = Date.now()): void {
  const cutoff = now - WATCH_LIMITS.retentionDays * 86400000;
  state.inbox = state.inbox.filter(f => Date.parse(f.at) >= cutoff).slice(-WATCH_LIMITS.inbox);
  for (const w of state.watches) w.events = w.events.filter(e => Date.parse(e.startsAt) >= cutoff).slice(0,WATCH_LIMITS.events);
}
/** Project current event metadata onto bookmarks without a background write to the layout store. */
export function currentSavedEvents<T extends { saved: Array<{ event?: WatchedEvent }> }>(profile: T,state: WatchState | undefined): T {
  if (!state || !profile.saved.some(s=>s.event)) return profile;
  const events = new Map(state.watches.flatMap(w=>w.events).map(e=>[e.id,e]));
  return {...profile,saved:profile.saved.map(s=>s.event && events.has(s.event.id) ? {...s,event:events.get(s.event.id)!} : s)};
}

/** A date-only event remains upcoming throughout its local calendar day. */
export function eventIsPast(event: WatchedEvent, now = Date.now()): boolean {
  if (!event.allDay) return Date.parse(event.startsAt) < now;
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return date.format(new Date(event.startsAt)) < date.format(new Date(now));
}
