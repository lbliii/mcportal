import { savedPortal } from '../src/sources.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artistEvents,findArtists,resolveArtist,parseCalendar } from '../src/adapters/events.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { DocumentExperienceStore } from '../src/experiences.ts';
import { currentSavedEvents,eventIsPast,type Watch,type WatchedEvent } from '../src/watches-state.ts';
import { textDiff } from '../src/reading-watches.ts';
import type { Fetcher } from '../src/types.ts';

const event:WatchedEvent={id:'ics:festival',title:'Festival',url:'https://example.com/festival',startsAt:'2027-07-04T04:00:00.000Z',timezone:'America/New_York',allDay:true,venue:'Town Hall',city:'',status:'scheduled',provider:'calendar',updatedAt:'2027-07-01T00:00:00.000Z'};
const watch:Watch={id:'watch_012345678901234567890123',kind:'artist',title:'Phoenix',artistId:'artist-1',city:'Boston',country:'US',timezone:'America/New_York',paused:false,addedAt:event.updatedAt,nextCheck:event.updatedAt,failures:0,events:[]};

test('Ticketmaster confirms a selected artist, limits events by city and preserves explicit date/status evidence',async()=>{
  const before=process.env.TICKETMASTER_API_KEY;process.env.TICKETMASTER_API_KEY='fixture-key';
  const requests:URL[]=[];
  const fetcher:Fetcher=async raw=>{
    const url=new URL(raw);requests.push(url);
    const text=url.pathname.endsWith('/attractions.json')?{_embedded:{attractions:[{id:'artist-1',name:'Phoenix',classifications:[{genre:{name:'Rock'}}]},{id:'artist-2',name:'Phoenix Tribute'}]}}:url.pathname.endsWith('/artist-1.json')?{id:'artist-1',name:'Phoenix'}:{_embedded:{events:[
      {id:'show',name:'Phoenix',url:'https://example.com/show',dates:{timezone:'America/New_York',start:{localDate:'2027-07-04',localTime:'19:30:00',dateTime:'2027-07-04T23:30:00Z'},status:{code:'cancelled'}},_embedded:{venues:[{name:'Town Hall',city:{name:'Boston'}}]}},
      {id:'uncertain',name:'TBD',url:'https://example.com/tbd',dates:{start:{dateTBD:true}}}
    ]},page:{totalElements:120}};
    return {status:200,url:raw,contentType:'application/json',text:JSON.stringify(text),truncated:false};
  };
  const deps={fetcher,cache:new TtlCache()};
  try {
    const candidates=await findArtists('Phoenix',deps);assert.equal(candidates.length,2);assert.equal(candidates[0]!.genre,'Rock');
    await findArtists('Phoenix',deps);assert.equal(requests.length,1,'public artist cache avoids repeated provider calls');
    assert.equal((await resolveArtist('artist-1',deps)).name,'Phoenix');
    await assert.rejects(resolveArtist('../invalid',deps),{code:'invalid_argument'});
    const result=await artistEvents(watch,deps,Date.parse('2027-07-01'));
    assert.equal(result.events.length,1);assert.equal(result.events[0]!.status,'cancelled');assert.equal(result.events[0]!.startsAt,'2027-07-04T23:30:00.000Z');assert.equal(result.events[0]!.timezone,'America/New_York');assert.equal(result.events[0]!.venue,'Town Hall');assert.match(result.warning!,/1 uncertain/);
    assert.equal(requests.at(-1)!.searchParams.get('city'),'Boston');assert.equal(requests.at(-1)!.searchParams.get('countryCode'),'US');assert.equal(requests.at(-1)!.searchParams.get('attractionId'),'artist-1');
    delete process.env.TICKETMASTER_API_KEY;
    await assert.rejects(findArtists('unconfigured artist',{...deps,cache:new TtlCache()}),{code:'unavailable'});
  }finally{if(before===undefined)delete process.env.TICKETMASTER_API_KEY;else process.env.TICKETMASTER_API_KEY=before;}
});

test('date-only events stay upcoming all local day and saved events project reschedules without mutating bookmarks',()=>{
  assert.equal(eventIsPast(event,Date.parse('2027-07-05T03:59:59Z')),false);
  assert.equal(eventIsPast(event,Date.parse('2027-07-05T04:00:00Z')),true);
  assert.equal(eventIsPast({...event,allDay:false},Date.parse('2027-07-04T04:00:01Z')),true);
  const profile={saved:[{url:event.url,event}],name:'Room'},updated={...event,status:'rescheduled' as const,startsAt:'2027-07-06T04:00:00.000Z'};
  const projected=currentSavedEvents(profile,{watches:[{...watch,events:[updated]}],inbox:[]});
  assert.equal(projected.saved[0]!.event.status,'rescheduled');assert.equal(profile.saved[0]!.event.status,'scheduled');assert.equal(projected.name,'Room');
});

test('scheduled retention removes expired evidence even on paused watches and advances its revision',async()=>{
  const store=new DocumentExperienceStore(),now=Date.now(),old=new Date(now-31*86400000).toISOString();
  await store.update('alice',state=>{state.watches=[{...watch,paused:true,events:[{...event,startsAt:old}]}];state.inbox=[{id:'finding-old',watchId:watch.id,kind:'availability',title:'Unavailable',at:new Date(now).toISOString(),dedup:'old',read:false}];return {state,result:undefined};});
  // Store writes also enforce retention. Schedule expiry independently from a later user write.
  const before=await store.get('alice');assert.equal(before.state.watches[0]!.events.length,0);
  assert.equal(await store.purgeExpired(now+31*86400000),1);
  const after=await store.get('alice');assert.equal(after.rev,before.rev+1);assert.equal(after.state.inbox.length,0);assert.equal(after.state.watches[0]!.paused,true);
  assert.equal(await store.purgeExpired(now+31*86400000),0);
});

test('diff bounds disclose changes beyond the displayed line window',()=>{
  const common=Array.from({length:200},(_,i)=>`Line ${i}`).join('\n');
  const diff=textDiff(common+'\nBefore',common+'\nAfter');
  assert.match(diff.at(-1)!.text,/bounded/);assert.ok(diff.reduce((n,d)=>n+d.text.length,0)<=12000);
});


test('calendar events without detail URLs remain distinct when bookmarked',()=>{
  const text=['BEGIN:VCALENDAR',...['one','two'].flatMap(id=>['BEGIN:VEVENT',`UID:${id}`,'DTSTART:20270704T193000Z',`SUMMARY:Show ${id}`,'END:VEVENT']),'END:VCALENDAR'].join('\r\n');
  const {events}=parseCalendar(text,'https://example.com/calendar.ics','UTC',Date.parse('2027-07-01'));
  assert.equal(events.length,2);assert.notEqual(events[0]!.url,events[1]!.url);assert.match(events[0]!.url,/#mcportal-event=one$/);
});

test('Saved events retain typed dates, updated status and personal notes when projected into the room', () => {
  const savedEvent = { ...event, status: 'cancelled' as const };
  const portal = savedPortal({ id: 'saved', source: 'saved', config: {} }, [{ url: savedEvent.url, title: savedEvent.title, savedAt: savedEvent.updatedAt, note: 'Go with a friend', event: savedEvent }]);
  assert.deepEqual(portal.items[0]!.event, savedEvent);
  assert.equal(portal.items[0]!.summary, 'Go with a friend');
  assert.ok(portal.items[0]!.meta.includes('cancelled'));
  assert.ok(portal.items[0]!.meta.includes(savedEvent.timezone));
});
