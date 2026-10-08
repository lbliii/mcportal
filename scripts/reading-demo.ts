/** Isolated, fictional data for reviewing the delivered reading experiences. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/http.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { validateProfile, defaultProfile } from '../src/profile.ts';
import { FileClipStore, buildClip } from '../src/clips.ts';
import { FileCollectionStore } from '../src/collections.ts';
import { FileExperienceStore } from '../src/experiences.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore } from '../src/seen.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { silentLogger } from '../src/lib/log.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { watchAction, checkWatch } from '../src/watches.ts';
import type { Fetcher } from '../src/types.ts';

const dir = await mkdtemp(path.join(tmpdir(),'mcportal-reading-demo-'));
const userId = 'demo', base = 'https://docs.example.com', now = Date.now();
const passages: readonly [string,string,string] = ['A heartbeat gives an idle agent a reason to resume useful work.','Durable state makes progress independent of the current conversation.','Explicit boundaries keep saved evidence separate from live subscriptions.'];
let watched = '# Persistence\n\nKeep state in a local file.\n\nA restart resumes the last saved position.';
const fetcher: Fetcher = async (url,options) => {
  if (url.endsWith('/watch.md')) return {status:200,url,contentType:'text/markdown',text:watched,truncated:false};
  if (url === `${base}/llms.txt`) return {status:200,url,contentType:'text/plain',text:`# Example Docs\n\nFictional demonstration documentation.\n\n## Concepts\n\n- [Heartbeats](${base}/heartbeat.md): Work that resumes\n- [Persistence](${base}/persistence.md): State that survives\n- [Reading](${base}/reading.md): Keep actual evidence`,truncated:false};
  if (url.startsWith(base) && url.endsWith('.md')) return {status:200,url,contentType:'text/markdown',text:`# ${url.includes('heartbeat')?'Heartbeats':'Persistence'}\n\nFictional demo material.\n\n${passages.join('\n\n')}\n\n## What happens on restart\n\n${Array.from({length:14},(_,i)=>`### Step ${i+1}\n\nSave the source, retain the passage and resume the work when you return.`).join('\n\n')}`,truncated:false};
  if (url.includes('venue.example.com/calendar.ics')) {
    const date = new Date(now+7*86400000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    return {status:200,url,contentType:'text/calendar',text:['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:demo-evening','DTSTART:'+date,'SUMMARY:An evening at Town Hall','LOCATION:Town Hall','URL:https://venue.example.com/show','END:VEVENT','END:VCALENDAR'].join('\r\n'),truncated:false};
  }
  return createFixtureFetcher()(url,options);
};
const profile = validateProfile({...defaultProfile(),name:'Your reading · fictional demo',onboarded:true,layout:'columns',saved:[{url:`${base}/heartbeat.md`,title:'How heartbeats resume useful work',savedAt:new Date(now).toISOString()},{url:`${base}/persistence.md`,title:'A small guide to durable state',savedAt:new Date(now).toISOString()}],columns:[{panels:[{id:'hn-top',source:'hn',title:'Hacker News',config:{feed:'top',limit:10}}]},{panels:[{id:'docs',source:'docs',title:'Example Docs',config:{url:base,toc:{kind:'llms',url:`${base}/llms.txt`}}}]},{panels:[{id:'clips',source:'clips',title:'Kept passages',config:{},view:'quotes'}]},{panels:[{id:'saved',source:'saved',title:'Saved reading',config:{},view:'cards'}]}]});
const store = new MemoryProfileStore({[userId]:profile}),clips=new FileClipStore(dir),collections=new FileCollectionStore(dir),experiences=new FileExperienceStore(dir),reading=new FileReadingStore(dir),seen=new FileSeenStore(dir),cache=new TtlCache();
const quote=buildClip({kind:'quote',title:'The work can survive the conversation',text:passages[1],tags:['local-first','agents'],source:{kind:'article',title:'Example Docs',url:`${base}/persistence.md`,locator:{text:passages[1]!,block:3}}});await clips.add(userId,quote);
const note=buildClip({kind:'note',title:'Questions for the next reading session',markdown:'What lives on my machine?\n\nWhich evidence should I keep?\n\nHow will the next chat resume?',tags:['local-first']});await clips.add(userId,note);
const entries=[{ref:`url:${base}/heartbeat.md`,title:'How heartbeats resume useful work',docs:base,source:'Example Docs'},{ref:`clip:${quote.id}`,title:quote.title,source:'A quote you kept'},{ref:`clip:${note.id}`,title:note.title,source:'Your own note'}];
await collections.change(userId,{action:'create',title:'Local first software',purpose:'Understand how agents keep useful work across conversations.',entries,livePortals:['hn-top','docs'],orientation:{text:'Fictional demo agent orientation: start with the heartbeat guide, then read the retained passage about durable state. Keep your own questions beside the evidence.',refs:entries.map(e=>e.ref)}});
await collections.change(userId,{action:'create',kind:'trail',title:'Build a durable reading practice',purpose:'A short path from the source to evidence you can find again.',entries:entries.map((e,i)=>({...e,reason:['Start with the core idea.','Inspect the retained evidence.','Write the next question.'][i] || 'Read the evidence.'}))});
await collections.change(userId,{action:'create',kind:'comparison',title:'What survives when a chat ends?',purpose:'How do heartbeat and persistence differ?',entries:[{ref:`url:${base}/heartbeat.md`,title:'Heartbeats',docs:base,fetchedAt:new Date(now).toISOString(),excerpt:passages[0]},{ref:`url:${base}/persistence.md`,title:'Persistence',docs:base,fetchedAt:new Date(now).toISOString(),excerpt:passages[1]}],orientation:{text:'Fictional demo agent interpretation:\n\nAgreement: both support work that continues.\n\nDifference: a heartbeat decides when to resume; persistence keeps what can be resumed.\n\nOpen question: which state needs to be retained for this task?',refs:[`url:${base}/heartbeat.md`,`url:${base}/persistence.md`]}});
await reading.record(userId,{url:`${base}/heartbeat.md`,title:'How heartbeats resume useful work',status:'opened',anchor:{heading:'What happens on restart',block:6}});
const context={store,clips,collections,experiences,reading,seen,cache,fetcher,userId};
const w=(await watchAction({action:'add',kind:'page',title:'Persistence documentation',url:`${base}/watch.md`},context,now-7*3600000)).watches[0]!;
await checkWatch(w.id,context,now-7*3600000);watched='# Persistence\n\nKeep state in a local file or a database.\n\nA restart resumes the last saved position.\n\nExport your retained material in open formats.';await checkWatch(w.id,context,now);
const events=(await watchAction({action:'add',kind:'calendar',title:'Town Hall public calendar',url:'https://venue.example.com/calendar.ics',timezone:'America/New_York'},context,now)).watches.find(w=>w.kind==='calendar')!;await checkWatch(events.id,context,now);
const config={host:'127.0.0.1',port:0,publicUrl:'http://localhost',staticUser:userId,allowedGithubUsers:[],allowedHosts:['localhost','127.0.0.1'],allowedOrigins:[],allowUnauthenticated:true,trustProxy:false,dataDir:dir,limits:{perMinute:10000,perDay:100000,globalPerDay:1000000}};
const server=createApp(config,{store,clips,collections,experiences,reading,seen,cache,fetcher,log:silentLogger});
server.listen(0,'127.0.0.1',()=>{const address=server.address();if(address && typeof address==='object') process.stdout.write(`Reading demo: http://127.0.0.1:${address.port}/preview\nFictional data in an isolated temporary directory.\n`);});
const stop=()=>server.close(()=>void rm(dir,{recursive:true,force:true}).then(()=>process.exit(0)));process.on('SIGINT',stop);process.on('SIGTERM',stop);
