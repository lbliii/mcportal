import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { LocalUpdates, UPDATE_INTERVAL_MS, updateStatus } from '../src/updates.ts';
import { memoryPersistence } from '../src/lib/document.ts';
import type { Fetcher } from '../src/types.ts';
import { handleMessage, SERVER_INFO, roomHtml } from '../src/mcp.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { defaultProfile } from '../src/profile.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { startApp, raw } from './helpers.ts';
import { ROOM_URI } from '../src/tools/kit.ts';

const origin = 'https://mcportal.example';
const response = (body: unknown, url = origin) => ({ status: 200, url, text: JSON.stringify(body), contentType: 'application/json', truncated: false });
const metadata = (recommendedVersion='2.0.0', minClientVersion='1.0.0') => ({ version: 1, recommendedVersion, minClientVersion });

test('updates: ghost checks are explicit, deduplicated, bounded and cached across restart', async () => {
  let count=0, now=Date.now();
  const persistence=memoryPersistence();
  const fetcher: Fetcher=async (url,options)=>{count++;assert.equal(url,`${origin}/.well-known/mcportal`);assert.deepEqual(options,{timeoutMs:3000,maxBytes:16384,maxRedirects:0});return response(metadata());};
  const options={dataDir:'/unused',server:origin,installedVersion:'1.0.0',fetcher,persistence,now:()=>now};
  const u=new LocalUpdates(options);
  assert.equal((await u.check(false)).status,'unchecked');assert.equal(count,0);
  const results=await Promise.all([u.check(false,true),u.check(false,true),u.check(false,true)]);
  assert.ok(results.every(r=>r.status==='update_available'));assert.equal(count,1);
  assert.equal((await u.read(false)).automatic,false,'manual checks do not opt in');
  await u.configure(false,{automatic:true});
  await new LocalUpdates(options).check(false);assert.equal(count,1,'restart uses persisted check time');
  now+=UPDATE_INTERVAL_MS+1;await u.check(false);assert.equal(count,2);
  await u.configure(true,{automatic:false});now+=UPDATE_INTERVAL_MS+1;await u.check(true);assert.equal(count,2,'explicit opt-out also covers linked mode');
});

test('updates: version-specific dismissal survives disk/restart, later releases reappear, required updates cannot hide', async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'mcportal-updates-'));let now=Date.now(),body=metadata();
  const opts={dataDir,server:origin,installedVersion:'1.0.0',fetcher:async()=>response(body),now:()=>now};
  try {
    let u=new LocalUpdates(opts);await u.check(true);await u.configure(true,{dismissedVersion:'2.0.0'});
    u=new LocalUpdates(opts);assert.equal((await u.read(true)).dismissed,true);
    now+=UPDATE_INTERVAL_MS+1;body=metadata('2.1.0');assert.equal((await u.check(true)).dismissed,false);
    now+=UPDATE_INTERVAL_MS+1;body=metadata('3.0.0','2.0.0');assert.equal((await u.check(true)).status,'update_required');
    await assert.rejects(u.configure(true,{dismissedVersion:'3.0.0'}),/optional/);
    const upgraded=new LocalUpdates({...opts,installedVersion:'3.0.0'});assert.equal((await upgraded.read(true)).status,'current');
    assert.ok((await readFile(path.join(dataDir,'updates.json'),'utf8')).length<1024);
    const moved=new LocalUpdates({...opts,server:'https://other.example'});assert.equal((await moved.read(true)).status,'unchecked','another server cannot inherit freshness');
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test('updates: failure and malformed metadata retain known updates and never claim freshness', async()=>{
  let now=Date.now(),body:unknown=metadata(),offline=false;
  const u=new LocalUpdates({dataDir:'/unused',server:origin,installedVersion:'1.0.0',persistence:memoryPersistence(),now:()=>now,fetcher:async()=>{if(offline)throw Error('offline');return response(body);}});
  await u.check(true);
  for(body of [{version:1,minClientVersion:'0.1.0',recommendedVersion:'<script>'},metadata('0.1.0','99.0.0'),{...metadata(),version:2,recommendedVersion:null}]) {
    now+=UPDATE_INTERVAL_MS;const status=await u.check(true);assert.equal(status.status,'update_available');assert.equal(status.recommendedVersion,'2.0.0');assert.equal(status.stale,true);
  }
  offline=true;now+=UPDATE_INTERVAL_MS;assert.equal((await u.check(true)).stale,true);
  const fresh=new LocalUpdates({dataDir:'/unused',server:origin,installedVersion:'2.0.0',persistence:memoryPersistence(),fetcher:async()=>{throw Error('offline');}});
  assert.equal((await fresh.check(false,true)).status,'unavailable');
  const corrupt=memoryPersistence();
  await corrupt.write(JSON.stringify({server:origin,metadata:metadata(),checkedAt:1e300,attemptedAt:1e300}));
  const invalidTime=new LocalUpdates({dataDir:'/unused',server:origin,persistence:corrupt,fetcher:async()=>response(metadata())});
  assert.equal((await invalidTime.read(false)).checkedAt,undefined,'unrepresentable timestamps do not crash version status');
});

test('updates: tools expose installed version, and a broken preferences file cannot block room loading', async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'mcportal-update-broken-'));
  try {
    await writeFile(path.join(dataDir,'updates.json'),'{invalid');
    const ctx={userId:'default',store:new MemoryProfileStore({default:{...defaultProfile(),onboarded:true}}),cache:new TtlCache(),fetcher:createFixtureFetcher(),updates:new LocalUpdates({dataDir,server:origin,fetcher:createFixtureFetcher()})};
    assert.equal((await updateStatus(ctx)).status,'unavailable');
    const reply=await handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'open_room',arguments:{}}},ctx);
    assert.equal((reply!.result as any).structuredContent.update.status,'unavailable');
    assert.equal((reply!.result as any).isError,undefined);
    assert.equal(await readFile(path.join(dataDir,'updates.json'),'utf8'),'{invalid');
    const hosted=await handleMessage({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'check_updates',arguments:{}}},{...ctx,updates:undefined,updateOrigin:origin});
    assert.equal((hosted!.result as any).structuredContent.update.upgradeUrl,`${origin}/upgrade`);
    assert.equal((hosted!.result as any).structuredContent.update.installedVersion,SERVER_INFO.version);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test('upgrade guide serves HTML and agent-readable Markdown with the running version and instance URL',async()=>{
  const app=await startApp({publicUrl:origin});
  try {
    for(const url of ['/upgrade','/upgrade.md']) {
      const page=await raw(app.port,{path:url});assert.equal(page.status,200);assert.match(page.body,new RegExp(SERVER_INFO.version.replaceAll('.','\\.')));assert.ok(page.body.includes(`${origin}/mcp`));assert.ok(!page.body.includes('{{VERSION}}'));
      assert.ok(page.body.includes('claude plugin update mcportal@mcportal'));assert.ok(page.body.includes('git switch --detach v'+SERVER_INFO.version));
    }
    assert.match((await raw(app.port,{path:'/llms.txt'})).body,/upgrade\.md/);
    assert.equal(JSON.parse((await raw(app.port,{path:'/.well-known/mcportal'})).body).upgradeUrl,`${origin}/upgrade.md`);
    const html=await roomHtml();assert.ok(html.includes(`version: '${SERVER_INFO.version}'`));assert.ok(!html.includes('__MCPORTAL_UI_VERSION__'));
  }finally{await app.close();}
});

test('room resources have a release cache key and retain legacy and earlier release addresses',async()=>{
  assert.equal(ROOM_URI,`ui://mcportal/room-v${SERVER_INFO.version}.html`);
  const ctx={userId:'default',store:new MemoryProfileStore(),cache:new TtlCache(),fetcher:createFixtureFetcher()};
  for(const uri of ['ui://mcportal/room.html','ui://mcportal/room-v0.1.0.html',ROOM_URI]) {
    const reply=await handleMessage({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri}},ctx);
    const content=(reply!.result as any).contents[0];
    assert.equal(content.uri,uri);assert.ok(content.text.includes(`version: '${SERVER_INFO.version}'`));
  }
});
