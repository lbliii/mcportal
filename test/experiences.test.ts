import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DocumentExperienceStore,FileExperienceStore,validateExperiences } from '../src/experiences.ts';
import { catchup } from '../src/catchup.ts';
import { watchAction,checkWatch,watchText,textDiff } from '../src/reading-watches.ts';
import { localInstant,parseCalendar } from '../src/adapters/events.ts';
import { comparison } from '../src/comparison.ts';
import { FileClipStore,buildClip } from '../src/clips.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore,seenHash } from '../src/seen.ts';
import { defaultProfile } from '../src/profile.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { buildExport,parseExport,importExport } from '../src/portability.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import type { Fetcher } from '../src/types.ts';

const scratch=()=>mkdtemp(path.join(tmpdir(),'mcportal-experiences-'));
const ctx=(experiences=new DocumentExperienceStore(),fetcher=createFixtureFetcher()):ToolContext=>({userId:'alice',experiences,store:new MemoryProfileStore({alice:{...defaultProfile(),onboarded:true}}),fetcher,cache:new TtlCache()});

test('catch-up freezes retrieved candidates, survives restart and acknowledges only captured IDs without marking read',async()=>{
  const dir=await scratch();
  try {
    const experiences=new FileExperienceStore(dir),seen=new FileSeenStore(dir),reading=new FileReadingStore(dir);
    const context={...ctx(experiences),seen,reading};
    const captured=(await catchup({action:'start',count:2,portalIds:['hn-top']},context))!;
    assert.equal(captured.stories.length,2);
    assert.equal((await catchup({action:'start',count:30},context))!.id,captured.id);
    const restarted={...context,experiences:new FileExperienceStore(dir)};
    assert.deepEqual(await catchup({action:'open'},restarted),captured);
    await catchup({action:'skip',sessionId:captured.id,index:0},restarted);
    await assert.rejects(catchup({action:'finish',sessionId:captured.id,index:0},context),{code:'conflict'});
    const finished=(await catchup({action:'finish',sessionId:captured.id,index:1},restarted))!;
    assert.ok(finished.acknowledgedAt);assert.deepEqual(finished.outcomes,['skipped','finished']);
    const marked=(await seen.get('alice',['hn-top'])).get('hn-top')!;
    assert.deepEqual([...marked].sort(),captured.stories.map(s=>seenHash(s.item.id)).sort());
    assert.deepEqual(await reading.list('alice'),[]);
    assert.equal((await experiences.get('bob')).state.catchup,null);
    await assert.rejects(catchup({action:'end',sessionId:captured.id,index:2},{...context,userId:'bob'}),{code:'not_found'});
    const file=parseExport((await buildExport('mcportal','alice',{store:context.store,experiences})).body.toString());
    const dest=new DocumentExperienceStore();await importExport(file,'bob',{store:context.store,experiences:dest});
    assert.equal((await dest.get('bob')).state.catchup!.id,captured.id);
    await experiences.deleteAll('alice');assert.equal((await restarted.experiences.get('alice')).state.catchup,null);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('watches retain actual diffs, failures leave baselines, retries and restart recover without duplicate findings',async()=>{
  const dir=await scratch();let body='# Persistence\n\nThe state lives in a file.',status=200,calls=0;
  const fetcher:Fetcher=async(url)=>{calls++;return {status,url,contentType:'text/markdown',text:body,truncated:false};};
  try {
    const now=Date.now(),experiences=new FileExperienceStore(dir),context=ctx(experiences,fetcher);
    const added=await watchAction({action:'add',kind:'page',title:'Persistence',url:'https://example.com/docs.md'},context,now),id=added.watches[0]!.id;
    assert.equal(added.inbox.length,0);
    await checkWatch(id,context,now);assert.equal((await experiences.get('alice')).state.inbox.length,0);
    body='# Persistence\n\nThe state lives in a database.';
    await checkWatch(id,context,now+6*3600000);
    const changed=(await experiences.get('alice')).state;
    assert.equal(changed.inbox.length,1);
    assert.ok(changed.inbox[0]!.diff!.some(d=>d.kind==='removed'&&d.text.includes('file')));
    assert.ok(changed.inbox[0]!.diff!.some(d=>d.kind==='added'&&d.text.includes('database')));
    assert.equal(changed.inbox[0]!.beforeAt,new Date(now).toISOString());
    status=503;await checkWatch(id,context,now+12*3600000);
    const failed=(await experiences.get('alice')).state;
    assert.equal(failed.watches[0]!.baseline!.text,changed.watches[0]!.baseline!.text);
    assert.equal(failed.inbox[1]!.kind,'availability');assert.equal(failed.watches[0]!.failures,1);
    const restarted=ctx(new FileExperienceStore(dir),fetcher);
    await checkWatch(id,restarted,now+13*3600000);assert.equal((await experiences.get('alice')).state.inbox.length,2);
    status=200;await checkWatch(id,restarted,now+14*3600000);assert.equal((await experiences.get('alice')).state.watches[0]!.failures,0);
    assert.equal((await experiences.get('alice')).state.inbox.length,2);
    await assert.rejects(watchAction({action:'check',id},{...context,userId:'bob'},now),{code:'not_found'});
    await watchAction({action:'pause',id,paused:true},context,now);const before=calls;
    assert.equal(await checkWatch(id,context,now+24*3600000),false);assert.equal(calls,before);
    const exported=parseExport((await buildExport('mcportal','alice',{store:context.store,experiences})).body.toString());
    const target=new DocumentExperienceStore();await importExport(exported,'bob',{store:context.store,experiences:target});
    assert.equal((await target.get('bob')).state.watches[0]!.paused,true);assert.ok((await target.get('bob')).state.inbox[0]!.diff);
    await watchAction({action:'delete',id},context);assert.deepEqual((await experiences.get('alice')).state.watches,[]);assert.deepEqual((await experiences.get('alice')).state.inbox,[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('leases prevent two workers fetching the same watch and late responses cannot restore a deleted watch',async()=>{
  let finish!:(text:string)=>void,calls=0;
  const fetcher:Fetcher=async url=>{calls++;return {status:200,url,contentType:'text/markdown',text:await new Promise<string>(r=>{finish=r;}),truncated:false};};
  const context=ctx(undefined,fetcher),now=Date.now();
  const id=(await watchAction({action:'add',kind:'page',url:'https://example.com/lease.md'},context,now)).watches[0]!.id;
  const first=checkWatch(id,context,now);
  while(!finish) await new Promise(r=>setImmediate(r));
  assert.equal(await checkWatch(id,context,now),false);assert.equal(calls,1);
  await watchAction({action:'delete',id},context,now);finish('# Deleted\n\nNever restore this watch.');await first;
  assert.equal((await context.experiences!.get('alice')).state.watches.length,0);
});

test('calendars parse explicit timezones, date-only and cancellations; ambiguous DST and recurrence are visible omissions',()=>{
  assert.equal(localInstant('20260704T193000','America/New_York'),'2026-07-04T23:30:00.000Z');
  assert.throws(()=>localInstant('20261101T013000','America/New_York'),/ambiguous/);
  assert.throws(()=>localInstant('20260308T023000','America/New_York'),/ambiguous/);
  const feed=['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:show-1','DTSTART;TZID=America/New_York:20270704T193000','SUMMARY:A very good show','LOCATION:Town Hall','URL:https://example.com/show','STATUS:CANCELLED','END:VEVENT','BEGIN:VEVENT','UID:day-2','DTSTART;VALUE=DATE:20270705','SUMMARY:Festival','END:VEVENT','BEGIN:VEVENT','UID:repeat','DTSTART:20270705T190000Z','SUMMARY:Weekly show','RRULE:FREQ=WEEKLY','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const parsed=parseCalendar(feed,'https://example.com/calendar.ics','America/New_York',Date.parse('2027-07-01'));
  assert.equal(parsed.events.length,2);assert.equal(parsed.events[0]!.timezone,'America/New_York');assert.equal(parsed.events[0]!.status,'cancelled');assert.equal(parsed.events[1]!.allDay,true);assert.match(parsed.warning!,/1 recurring/);
  assert.equal(watchText('  One   fact. \n\n Another fact. '),'One fact.\nAnother fact.');
  assert.deepEqual(textDiff('One fact.','One fact.'),[{kind:'same',text:'One fact.'}]);
});

test('event date/status changes are retained updates, provider absence never implies cancellation',async()=>{
  let day='20280704T193000',cancelled=false;
  const fetcher:Fetcher=async url=>({status:200,url,contentType:'text/calendar',text:['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:one',`DTSTART;TZID=America/New_York:${day}`,'SUMMARY:Live show',...(cancelled?['STATUS:CANCELLED']:[]),'END:VEVENT','END:VCALENDAR'].join('\r\n'),truncated:false});
  const context=ctx(undefined,fetcher),now=Date.parse('2028-07-01');
  const id=(await watchAction({action:'add',kind:'calendar',url:'https://example.com/calendar.ics',timezone:'America/New_York'},context,now)).watches[0]!.id;
  await checkWatch(id,context,now);assert.equal((await context.experiences!.get('alice')).state.inbox.length,1);
  day='20280705T193000';await checkWatch(id,context,now+6*3600000);assert.equal((await context.experiences!.get('alice')).state.watches[0]!.events[0]!.status,'rescheduled');
  await checkWatch(id,context,now+12*3600000);assert.equal((await context.experiences!.get('alice')).state.inbox.length,2,'no repeated reschedule finding');
  cancelled=true;await checkWatch(id,context,now+18*3600000);assert.equal((await context.experiences!.get('alice')).state.watches[0]!.events[0]!.status,'cancelled');
});

test('temporary comparison validates citations and private clip access; no shadow content survives missing clips',async()=>{
  const dir=await scratch();
  try {
    const clips=new FileClipStore(dir),clip=buildClip({kind:'quote',text:'An owned explanation.'});await clips.add('alice',clip);
    const context={...ctx(),clips};
    const input={question:'How do these differ?',sources:[{ref:`clip:${clip.id}`,title:'Owned quote',excerpt:'Never shadow a clip'},{ref:'url:https://example.com/b',title:'Other source'}],interpretation:{text:'An explicit agent interpretation.',refs:[`clip:${clip.id}`]}};
    assert.equal((await comparison(input,context)).sources[0]!.excerpt,'');
    await assert.rejects(comparison({...input,interpretation:{text:'Invented claim',refs:['url:https://example.com/invented']}},context),{code:'invalid_argument'});
    const other=await comparison(input,{...context,userId:'bob'});assert.equal(other.sources[0]!.source,'Unavailable clip');assert.equal(other.sources[0]!.excerpt,'');
    assert.equal((await context.experiences!.get('alice')).state.catchup,null);
    assert.throws(()=>validateExperiences({version:1,catchup:null,unknown:true}),{code:'failed_precondition'});
  }finally{await rm(dir,{recursive:true,force:true});}
});
