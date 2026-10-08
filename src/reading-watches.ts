/** Subscription operations and a bounded worker. No model runs in the background. */
import { createHash, randomBytes } from 'node:crypto';
import { fetchDocPage } from './adapters/docs/pages.ts';
import { fetchGithub, REPO_PATTERN } from './adapters/github.ts';
import { artistEvents, calendarEvents, findArtists, resolveArtist, type ArtistCandidate } from './adapters/events.ts';
import { AppError, isAppError } from './lib/errors.ts';
import { assertPublicUrl } from './lib/safe-fetch.ts';
import { clean } from './lib/text.ts';
import type { Logger } from './lib/log.ts';
import { need, type ToolContext } from './tools/kit.ts';
import { pruneWatches, watchTimezone, WATCH_LIMITS, type Watch, type WatchFinding, type WatchState, type WatchedEvent } from './watches-state.ts';

export interface WatchInput { action: 'list' | 'add' | 'pause' | 'delete' | 'check' | 'acknowledge' | 'find_artist' | 'open'; id?: string; kind?: Watch['kind']; title?: string; url?: string; repo?: string; artistId?: string; city?: string; country?: string; timezone?: string; paused?: boolean; query?: string; findingIds?: string[] }
export interface WatchResult extends WatchState { artists?: ArtistCandidate[]; finding?: WatchFinding; artistAvailable: boolean; checkedAt: string; worker: string }
export const WATCH_SCHEMA = { type:'object',required:['action'],additionalProperties:false,properties:{ action:{type:'string',enum:['list','add','pause','delete','check','acknowledge','find_artist','open']}, id:{type:'string',maxLength:100}, kind:{type:'string',enum:['page','releases','calendar','artist']}, title:{type:'string',maxLength:200}, url:{type:'string',maxLength:4096}, repo:{type:'string',maxLength:200}, artistId:{type:'string',maxLength:100}, city:{type:'string',maxLength:200}, country:{type:'string',minLength:2,maxLength:2}, timezone:{type:'string',maxLength:100}, paused:{type:'boolean'}, query:{type:'string',minLength:1,maxLength:200}, findingIds:{type:'array',maxItems:40,items:{type:'string',maxLength:100}} } };
const nonce = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const stamp = (n: number) => new Date(n).toISOString();
/** Whitespace normalization removes formatting noise; words, punctuation and dates stay evidence. */
export function watchText(text: string): string { return text.split(/\r?\n/).map(line => line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n'); }
/** Exact line diff, bounded in work and display. Common lines are context, never rewritten. */
export function textDiff(before: string, after: string): NonNullable<WatchFinding['diff']> {
  const lines = (s: string) => s.split('\n').flatMap(line => line.match(/.{1,200}/gu) || []);
  const allA = lines(before), allB = lines(after), a = allA.slice(0,180), b = allB.slice(0,180), width = b.length+1;
  const lcs = new Uint16Array((a.length+1)*width);
  for (let i=a.length-1;i>=0;i--) for (let j=b.length-1;j>=0;j--) lcs[i*width+j] = a[i] === b[j] ? lcs[(i+1)*width+j+1]!+1 : Math.max(lcs[(i+1)*width+j]!,lcs[i*width+j+1]!);
  let i=0,j=0,chars=0;
  const out: NonNullable<WatchFinding['diff']> = [];
  while ((i<a.length || j<b.length) && chars<11000) {
    let change: NonNullable<WatchFinding['diff']>[number];
    if (i<a.length && j<b.length && a[i]===b[j]) change={kind:'same',text:a[i++]!},j++;
    else if (j<b.length && (i===a.length || lcs[i*width+j+1]! >= lcs[(i+1)*width+j]!)) change={kind:'added',text:b[j++]!};
    else change={kind:'removed',text:a[i++]!};
    chars+=change.text.length; out.push(change);
  }
  if (i<a.length || j<b.length || allA.length>a.length || allB.length>b.length || before.length>11000 || after.length>11000) out.push({kind:'same',text:'… Diff display is bounded. Open the source to inspect the full page.'});
  return out;
}
function addFinding(state: WatchState, f: Omit<WatchFinding,'id'|'read'>) { if (state.inbox.some(old => old.watchId===f.watchId && old.dedup===f.dedup)) return; state.inbox.push({...f,id:nonce('finding'),read:false}); }
export async function watchAction(input: WatchInput, ctx: ToolContext, now = Date.now()): Promise<WatchResult> {
  const store = need(ctx.experiences,'Watches are unavailable.');
  let artists: ArtistCandidate[] | undefined;
  if (input.action==='find_artist') { if (!input.query?.trim()) throw new AppError('invalid_argument','Enter an artist name.'); artists=await findArtists(input.query.trim(),ctx); }
  else if (input.action==='add') {
    if (!input.kind || !['page','releases','calendar','artist'].includes(input.kind)) throw new AppError('invalid_argument','Choose a watch kind.');
    const timezone=watchTimezone(input.timezone || 'UTC');
    let title=clean(input.title,200), url: string|undefined, repo: string|undefined, artistId: string|undefined;
    if (input.kind==='page' || input.kind==='calendar') { url=assertPublicUrl(input.url || '').href; title ||=new URL(url).hostname; }
    if (input.kind==='releases') { if (!input.repo || !REPO_PATTERN.test(input.repo)) throw new AppError('invalid_argument','Use a repository owner/name.'); repo=input.repo; title ||=repo; }
    if (input.kind==='artist') { const artist=await resolveArtist(input.artistId || '',ctx); artistId=artist.id; title=artist.name; if (!input.city?.trim() || !/^[A-Za-z]{2}$/.test(input.country || '')) throw new AppError('invalid_argument','Artist watches need a city and two-letter country.'); }
    const watch: Watch={id:nonce('watch'),kind:input.kind,title,timezone,paused:false,addedAt:stamp(now),nextCheck:stamp(now),failures:0,events:[],...(url?{url}:{}),...(repo?{repo}:{}),...(artistId?{artistId,city:input.city!.trim(),country:input.country!.toUpperCase()}: {})};
    await store.update(ctx.userId,state=>{
      if (state.watches.some(w=>w.kind===watch.kind && (w.url && w.url===watch.url || w.repo && w.repo===watch.repo || w.artistId && w.artistId===watch.artistId && w.city===watch.city && w.country===watch.country))) return {result:undefined};
      if (state.watches.length>=WATCH_LIMITS.watches) throw new AppError('limit_exceeded','You have 20 watches. Delete one to add another.');
      state.watches.push(watch); return {state,result:undefined};
    });
  } else if (input.action==='pause' || input.action==='delete' || input.action==='acknowledge') {
    await store.update(ctx.userId,state=>{
      if (input.action==='acknowledge') { const ids=input.findingIds || []; if (!ids.length || ids.some(id=>!state.inbox.some(f=>f.id===id))) throw new AppError('not_found','Choose current findings to acknowledge.'); for (const f of state.inbox) if (ids.includes(f.id)) f.read=true; }
      else {
        const w=state.watches.find(w=>w.id===input.id); if (!w) throw new AppError('not_found','This watch is unavailable.');
        if (input.action==='delete') { state.watches=state.watches.filter(w=>w.id!==input.id); state.inbox=state.inbox.filter(f=>f.watchId!==input.id); }
        else { if (typeof input.paused!=='boolean') throw new AppError('invalid_argument','Set paused true or false.'); w.paused=input.paused; delete w.lease; if (!w.paused) w.nextCheck=stamp(now); }
      }
      return {state,result:undefined};
    });
  } else if (input.action!=='list' && input.action!=='check' && input.action!=='open') throw new AppError('invalid_argument','Unknown watch action.');
  if (input.action==='check') {
    if (!input.id) throw new AppError('invalid_argument','Choose one watch to check.');
    if (!(await store.get(ctx.userId)).state.watches.some(w=>w.id===input.id)) throw new AppError('not_found','This watch is unavailable.');
    await checkWatch(input.id,ctx,now,true);
  }
  const state=(await store.get(ctx.userId)).state;
  const finding = input.action === 'open' ? state.inbox.find(f => f.id === input.id) : undefined;
  if (input.action === 'open' && !finding) throw new AppError('not_found', 'This retained finding is unavailable.');
  return {...validateVisible(state,now),...(artists?{artists}:{}),...(finding?{finding}:{}),artistAvailable:Boolean(process.env.TICKETMASTER_API_KEY),checkedAt:stamp(now),worker:'Checks run every six hours while this MCPortal server is running. Missed checks resume at startup. Imported watches start paused.'};
}
function validateVisible(state: WatchState, now: number): WatchState { const visible=structuredClone(state); pruneWatches(visible,now); for (const w of visible.watches) { delete w.baseline; delete w.lease; } return {watches:visible.watches,inbox:visible.inbox}; }
/** Acquire a durable lease before fetching. Deletion, pause or a replaced lease discards late results. */
export async function checkWatch(id: string,ctx: ToolContext,now=Date.now(),force=false): Promise<boolean> {
  const store=need(ctx.experiences,'Watches are unavailable.'), token=nonce('lease');
  const watch=await store.update(ctx.userId,state=>{
    const w=state.watches.find(w=>w.id===id);
    if (!w || w.paused || w.lease && Date.parse(w.lease.until)>now || !force && Date.parse(w.nextCheck)>now) return {result:null};
    // Manual refreshes have a minimum interval too; one person's UI cannot create a tight poller.
    if (force && w.lastAttempt && now-Date.parse(w.lastAttempt)<60000) throw new AppError('conflict','This watch was checked less than a minute ago.');
    w.lease={token,until:stamp(now+120000)}; w.lastAttempt=stamp(now);
    return {state,result:structuredClone(w)};
  });
  if (!watch) return false;
  let text: string|undefined, events: WatchedEvent[]|undefined, warning: string|undefined, failure: string|undefined;
  try {
    if (watch.kind==='page') {
      const page=await fetchDocPage(watch.url!,ctx.fetcher);
      text=watchText([page.title,...page.blocks.map(b=>b.text)].join('\n'));
      if (!text.trim()) throw new AppError('upstream_error','No readable text was returned; the retained baseline is unchanged.');
      if (text.length>WATCH_LIMITS.baseline) warning='Coverage: the first 24,000 characters of readable page text. Changes beyond this bound are not detected.';
      text=text.slice(0,WATCH_LIMITS.baseline);
    } else if (watch.kind==='releases') {
      const items=await fetchGithub({mode:'releases',repo:watch.repo!,limit:30},ctx.fetcher);
      text=items.map(i=>`${i.release?.version || i.id} | ${i.title} | ${i.publishedAt || ''} | ${i.url || ''}`).join('\n') || '(No published releases)';
      warning='Coverage: the latest 30 release names, versions and dates; release body edits are not checked.';
    } else {
      const result=watch.kind==='artist' ? await artistEvents(watch,ctx,now) : await calendarEvents(watch,ctx,now);
      events=result.events; warning=result.warning;
    }
  } catch (error) { if (!isAppError(error)) throw error; failure=clean(error.message,500); }
  await store.update(ctx.userId,state=>{
    const w=state.watches.find(w=>w.id===id); if (!w || w.paused || w.lease?.token!==token) return {result:undefined};
    delete w.lease;
    if (failure) {
      w.failures++; w.error=failure; w.nextCheck=stamp(now+Math.min(WATCH_LIMITS.checkMs,300000*2**Math.min(w.failures-1,7)));
      addFinding(state,{watchId:id,kind:'availability',title:`${w.title}: ${failure}`.slice(0,300),at:stamp(now),dedup:`unavailable:${digest(failure)}`,...(w.url?{url:w.url}:{})});
    } else {
      delete w.error; w.failures=0; w.lastSuccess=stamp(now); w.nextCheck=stamp(now+WATCH_LIMITS.checkMs);
      if (warning) w.warning=warning; else delete w.warning;
      if (text!==undefined) {
        const nextDigest=digest(text);
        if (w.baseline && w.baseline.digest!==nextDigest) addFinding(state,{watchId:id,kind:'change',title:`${w.title} changed`,at:stamp(now),dedup:`${w.baseline.digest}:${nextDigest}`,url:w.url || `https://github.com/${w.repo}/releases`,beforeAt:w.baseline.fetchedAt,afterAt:stamp(now),diff:textDiff(w.baseline.text,text)});
        w.baseline={text,digest:nextDigest,fetchedAt:stamp(now)};
      }
      if (events) {
        const previous=new Map(w.events.map(e=>[e.id,e]));
        for (const e of events) {
          const old=previous.get(e.id);
          if (old?.status==='rescheduled' && e.status==='scheduled' && old.startsAt===e.startsAt) e.status='rescheduled';
          const signature=(v:WatchedEvent)=>JSON.stringify([v.title,v.startsAt,v.venue,v.city,v.status]);
          if (!old || signature(old)!==signature(e)) {
            if (old && e.status==='scheduled' && old.startsAt!==e.startsAt) e.status='rescheduled';
            addFinding(state,{watchId:id,kind:'event',title:`${old?'Updated: ':''}${e.title}`.slice(0,300),url:e.url,at:stamp(now),dedup:`event:${e.id}:${digest(signature(e))}`,event:e});
          } else if (old.status==='rescheduled') e.status='rescheduled';
        }
        // Absence in a bounded provider result never means cancellation. Retain known events for 30 days.
        const returned=new Set(events.map(e=>e.id));
        w.events=[...events,...w.events.filter(e=>!returned.has(e.id))].slice(0,WATCH_LIMITS.events);
      }
    }
    pruneWatches(state,now); return {state,result:undefined};
  });
  return true;
}
/** Fair, bounded pass: rotate across owners and execute at most 20 due watches. */
export function startWatchWorker(store: NonNullable<ToolContext['experiences']>,context:(owner:string)=>ToolContext,log:Logger,timing={firstAfterMs:10000,everyMs:60000}, enabled:()=>boolean|Promise<boolean>=()=>true):()=>void {
  let busy=false,offset=0,stopped=false;
  const run=async()=>{
    if (busy || stopped) return; busy=true;
    try {
      if (!(await enabled())) return;
      const owners=await store.owners(); if (!owners.length) return;
      let jobs=0;
      for (let n=0;n<owners.length && n<100 && jobs<20 && !stopped;n++) {
        const owner=owners[(offset+n)%owners.length]!,ctx=context(owner);
        // Access revocation suspends background work, too.
        if (ctx.actor && ctx.actor.status!=='active') continue;
        const state=(await store.get(owner)).state;
        for (const w of state.watches.filter(w=>!w.paused && Date.parse(w.nextCheck)<=Date.now()).sort((a,b)=>a.nextCheck.localeCompare(b.nextCheck)).slice(0,5)) {
          if (jobs>=20 || stopped) break;
          jobs++; try { await checkWatch(w.id,ctx); } catch (error) { log.warn('watch.failed',{code:isAppError(error)?error.code:'internal'}); }
        }
      }
      offset=(offset+1)%owners.length;
    } catch (error) { log.warn('watch.worker_failed',{code:isAppError(error)?error.code:'internal'}); }
    finally { busy=false; }
  };
  const first=setTimeout(()=>void run(),timing.firstAfterMs),every=setInterval(()=>void run(),timing.everyMs); first.unref(); every.unref();
  return ()=>{stopped=true;clearTimeout(first);clearInterval(every);};
}
