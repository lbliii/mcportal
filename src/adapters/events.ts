/** Dated public events. Unsupported recurrence and ambiguous wall times are visible coverage limits. */
import { AppError, upstreamStatus } from '../lib/errors.ts';
import { fetchJson } from '../lib/safe-fetch.ts';
import { clean, safeHttpUrl } from '../lib/text.ts';
import type { SourceDeps } from '../sources.ts';
import { validEvent, watchTimezone, type Watch, type WatchedEvent } from '../watches-state.ts';

export interface ArtistCandidate { id: string; name: string; url?: string; genre?: string }
const key = () => { const value = process.env.TICKETMASTER_API_KEY; if (!value) throw new AppError('unavailable','Artist watches need TICKETMASTER_API_KEY on this MCPortal server. Public calendars work without a key.'); return value; };
interface Attraction { id: string; name: string; url?: string; classifications?: Array<{ genre?: { name?: string } }> }
function candidate(a: Attraction): ArtistCandidate { if (!a || typeof a.id !== 'string' || typeof a.name !== 'string') throw new AppError('upstream_error','Ticketmaster returned an unreadable artist.'); const url = safeHttpUrl(a.url); return { id: clean(a.id,100), name: clean(a.name,200), ...(url ? { url } : {}), ...(a.classifications?.[0]?.genre?.name ? { genre: clean(a.classifications[0].genre.name,100) } : {}) }; }
// Shared public cache keys contain no API credentials or private user ids.
let ticketPending = Promise.resolve();
let ticketDay = '', ticketCount = 0;
async function ticket<T>(path: string, params: Record<string,string>, deps: SourceDeps): Promise<T> {
  const apiKey = key();
  const url = new URL(`https://app.ticketmaster.com/discovery/v2/${path}.json`);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  url.searchParams.set('apikey',apiKey);
  let release!: () => void;
  const before = ticketPending;
  ticketPending = new Promise<void>(r => { release = r; });
  await before;
  try {
    const day = new Date().toISOString().slice(0,10);
    if (ticketDay !== day) { ticketDay = day; ticketCount = 0; }
    if (++ticketCount > 4500) throw new AppError('limit_exceeded','The event provider request allowance is exhausted for today.');
    const value = await fetchJson<T>(deps.fetcher,url.href,{ maxBytes: 1500000, maxRedirects: 0 });
    return value;
  } finally { await new Promise(r => setTimeout(r,250)); release(); }
}
export async function findArtists(query: string, deps: SourceDeps): Promise<ArtistCandidate[]> {
  const { value } = await deps.cache.get(`artists:${query.toLowerCase()}`,3600,async () => {
    const data = await ticket<{ _embedded?: { attractions?: Attraction[] } }>('attractions',{ keyword:query,classificationName:'music',size:'8' },deps);
    return (data._embedded?.attractions || []).slice(0,8).map(candidate);
  }); return value;
}
export async function resolveArtist(id: string, deps: SourceDeps): Promise<ArtistCandidate> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new AppError('invalid_argument','Choose a returned attraction ID.');
  return (await deps.cache.get(`artist:${id}`,86400,async () => candidate(await ticket<Attraction>(`attractions/${id}`,{},deps)))).value;
}
interface TicketEvent { id: string; name: string; url: string; dates?: { timezone?: string; status?: { code?: string }; start?: { dateTime?: string; localDate?: string; localTime?: string; dateTBD?: boolean; dateTBA?: boolean; timeTBA?: boolean } }; _embedded?: { venues?: Array<{ name?: string; city?: { name?: string } }> } }
export async function artistEvents(w: Watch, deps: SourceDeps, now = Date.now()): Promise<{ events: WatchedEvent[]; warning?: string }> {
  const { value } = await deps.cache.get(`events:${w.artistId}:${w.city?.toLowerCase()}:${w.country}`,3600,async () => ticket<{ _embedded?: { events?: TicketEvent[] }; page?: { totalElements?: number } }>('events',{ attractionId:w.artistId!,city:w.city!,countryCode:w.country!,size:'100',sort:'date,asc',includeTBA:'no',includeTBD:'no' },deps));
  let uncertain = 0;
  const events: WatchedEvent[] = [];
  for (const e of (value._embedded?.events || []).slice(0,100)) {
    const start = e.dates?.start, zone = e.dates?.timezone || w.timezone;
    if (!start || start.dateTBD || start.dateTBA || !start.localDate) { uncertain++; continue; }
    let startsAt: string;
    try { startsAt = start.dateTime ? new Date(start.dateTime).toISOString() : localInstant(start.localDate.replace(/-/g,'') + 'T' + (start.localTime || '00:00:00').replace(/:/g,''),zone); }
    catch { uncertain++; continue; }
    const status = e.dates?.status?.code, venue = e._embedded?.venues?.[0];
    const event = validEvent({ id:`tm:${e.id}`,title:clean(e.name,300),url:e.url,startsAt,timezone:zone,venue:clean(venue?.name,300),city:clean(venue?.city?.name,200),status:status === 'cancelled' || status === 'postponed' || status === 'rescheduled' ? status : 'scheduled',provider:'ticketmaster',updatedAt:new Date(now).toISOString(),...(!start.localTime || start.timeTBA ? { allDay:true } : {}) });
    events.push(event);
  }
  return { events, ...((value.page?.totalElements || 0) > 100 || uncertain ? { warning: `Coverage: first 100 dated events in ${w.city}; ${uncertain} uncertain dates omitted. Check Ticketmaster for the full listing.` } : {}) };
}
/** Reject DST gaps and repeated wall times rather than inventing a timestamp. */
export function localInstant(raw: string, timezone: string): string {
  watchTimezone(timezone);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/);
  if (!match) throw new AppError('upstream_error','Calendar date is unsupported.');
  const [,y,m,d,hh='00',mm='00',ss='00'] = match, naive = Date.UTC(+y!,+m!-1,+d!,+hh,+mm,+ss);
  const target = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  const format = new Intl.DateTimeFormat('sv-SE',{ timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' });
  const wall = (t: number) => format.format(new Date(t)).replace(' ','T');
  const offsets = new Set<number>();
  for (const shift of [-36,0,36]) { const t = naive+shift*3600000; offsets.add(Date.parse(`${wall(t)}Z`)-t); }
  const candidates = [...offsets].map(o => naive-o).filter(t => wall(t) === target);
  if (candidates.length !== 1) throw new AppError('upstream_error','Calendar time is invalid or ambiguous at a timezone transition.');
  return new Date(candidates[0]!).toISOString();
}
export function parseCalendar(text: string, url: string, timezone: string, now = Date.now()): { events: WatchedEvent[]; warning?: string } {
  if (!/^BEGIN:VCALENDAR\s*$/m.test(text)) throw new AppError('upstream_error','This address did not return an iCalendar feed.');
  const unfolded = text.replace(/\r?\n[ \t]/g,''), chunks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)];
  const events = new Map<string,WatchedEvent>(); let omitted = 0;
  const unescape = (s: string) => s.replace(/\\[nN]/g,' ').replace(/\\([,;\\])/g,'$1');
  for (const chunk of chunks.slice(0,500)) {
    const props = new Map<string,{ value: string; params: string }>();
    for (const line of chunk[1]!.split(/\r?\n/)) { const at = line.indexOf(':'); if (at < 0) continue; const header = line.slice(0,at), name = header.split(';')[0]!.toUpperCase(); props.set(name,{ value:line.slice(at+1),params:header }); }
    const start = props.get('DTSTART'), uid = props.get('UID')?.value, title = props.get('SUMMARY')?.value;
    if (!start || !uid || !title || props.has('RRULE') || props.has('RDATE') || props.has('EXDATE') || props.has('RECURRENCE-ID')) { omitted++; continue; }
    try {
      const zone = start.value.endsWith('Z') ? 'UTC' : start.params.match(/TZID=(?:"([^"]+)"|([^;:]+))/i)?.slice(1).find(Boolean) || timezone;
      const stamp = start.value.endsWith('Z') ? localInstant(start.value.slice(0,-1),'UTC') : localInstant(start.value,zone);
      const allDay = /^\d{8}$/.test(start.value);
      // A calendar without per-event URLs still needs distinct bookmark identities.
      const eventUrl = safeHttpUrl(props.get('URL')?.value) || `${url.split('#')[0]}#mcportal-event=${encodeURIComponent(uid)}`;
      const event = validEvent({ id:`ics:${uid}`,title:clean(unescape(title),300),url:eventUrl,startsAt:stamp,timezone:zone,venue:clean(unescape(props.get('LOCATION')?.value || ''),300),city:'',status:props.get('STATUS')?.value.toUpperCase() === 'CANCELLED' ? 'cancelled' : 'scheduled',provider:'calendar',updatedAt:new Date(now).toISOString(),...(allDay ? { allDay:true } : {}) });
      events.set(event.id,event);
    } catch { omitted++; }
  }
  return { events:[...events.values()].sort((a,b) => a.startsAt.localeCompare(b.startsAt)).filter(e => Date.parse(e.startsAt) >= now-30*86400000).slice(0,100), ...(omitted || chunks.length > 100 ? { warning:`Coverage: up to 100 dated events. ${omitted} recurring, incomplete or ambiguous events omitted; open the original calendar for its full schedule.` } : {}) };
}
export async function calendarEvents(w: Watch, deps: SourceDeps, now = Date.now()) {
  const response = await deps.fetcher(w.url!,{ maxBytes:1000000,timeoutMs:10000 });
  if (response.status < 200 || response.status >= 300) throw upstreamStatus(new URL(w.url!).host,response.status);
  return parseCalendar(response.text,w.url!,w.timezone,now);
}
