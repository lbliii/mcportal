import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {collectShopify,normalizeProduct,robotsAllows,SHOP_LIMITS,storeOrigin} from '../src/adapters/shopify.ts';
import {FileSeenStore,withNews} from '../src/seen.ts';
import {TtlCache} from '../src/lib/cache.ts';
import {StoreWatches} from '../src/store-watches.ts';
import {FileWatchStore,MemoryWatchStore,applyCollection,newStoreWatch,watchItems,WATCH_LIMITS,type WatchStore} from '../src/watches.ts';
import {buildExport,importExport,parseExport} from '../src/portability.ts';
import {normalizeFeatured} from '../src/public-profiles.ts';
import {MemoryProfileStore} from '../src/store.ts';
import {findTool} from '../src/tools/index.ts';
import {API_METHODS} from '../src/api/methods.ts';
import {RemoteWatchStore,remoteWatches} from '../src/link/stores.ts';
import type {StateClient} from '../src/link/client.ts';
import type {ToolContext} from '../src/tools/kit.ts';
import {SHOP,catalogue,product,shopFetcher} from './fixtures/shopify.ts';
const BASE='2026-10-07T12:00:00.000Z';
function setup(watchStore:WatchStore=new MemoryWatchStore()) {
  let now=Date.parse(BASE);
  const {state,fetcher}=shopFetcher(),cache=new TtlCache({now:()=>now}),store=new MemoryProfileStore();
  const watches=new StoreWatches(watchStore,{fetcher,cache},()=>now,store);
  const ctx:ToolContext={userId:'alice',store,watchStore,watches,fetcher,cache};
  return {state,ctx,watchStore,watches,advance:(ms=61_000)=>{now+=ms;}};
}
const collect=(nodes:unknown[])=>({origin:SHOP,name:'Example Store',products:nodes.map(n=>normalizeProduct(n,SHOP)!),partial:false,pages:1});

test('Shopify boundary: public HTTPS origin only; robots longest rule and named agent',()=>{
  assert.equal(storeOrigin(SHOP+'/collections/clothing'),SHOP);
  for(const url of ['http://shop.example.com','https://localhost','https://127.0.0.1','https://shop.example.com?token=x','https://user:pass@shop.example.com','https://shop.example.com:8443'])assert.throws(()=>storeOrigin(url));
  assert.equal(robotsAllows('User-agent: *\nDisallow: /api/\nAllow: /api/2026-10/', '/api/2026-10/graphql.json'),true);
  assert.equal(robotsAllows('User-agent: *\nAllow: /\nUser-agent: MCPortal\nDisallow: /api/', '/api/2026-10/graphql.json'),false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.json$', '/api/2026-10/graphql.json'),false);
});
test('Shopify collector: stops at page budget; correct collection sort; block before catalogue fetch',async()=>{
  const queries:string[]=[];
  const collected=await collectShopify(SHOP,{},async(url,options)=>{
    if(url.endsWith('/robots.txt'))return {url,status:404,text:'',contentType:'text/plain',truncated:false};
    queries.push(JSON.parse(options?.body??'{}').query);
    assert.equal(options?.maxRedirects,0);assert.equal(options?.maxBytes,SHOP_LIMITS.bytes);
    return {url,status:200,text:JSON.stringify(catalogue(Array.from({length:10},(_,i)=>product((queries.length-1)*10+i+1)),true,'page'+queries.length)),contentType:'application/json',truncated:false};
  });
  assert.equal(queries.length,SHOP_LIMITS.pages);assert.equal(collected.products.length,100);assert.equal(collected.partial,true);
  const s=shopFetcher();s.state.robots='User-agent: *\nDisallow: /api/';
  await assert.rejects(collectShopify(SHOP,{},s.fetcher),{code:'fetch_blocked'});assert.equal(s.state.calls,0);
  s.state.robots='';let query='';
  await collectShopify(SHOP,{collection:'clothing'},async(url,options)=>{if(options?.body)query=JSON.parse(options.body).query;return s.fetcher(url,options);});
  assert.match(query,/sortKey: CREATED,/);
});
test('Shopify collector refuses unreadable, truncated, denied and invalid paginated results',async()=>{
  for(const response of [{status:403,text:''},{status:200,text:'<html>login</html>'},{status:200,text:JSON.stringify(catalogue([product()])),truncated:true},{status:200,text:JSON.stringify({errors:[{message:'denied'}]})},{status:200,text:JSON.stringify(catalogue([product()],true,''))}]) {
    await assert.rejects(collectShopify(SHOP,{},async(url)=>({url,contentType:'application/json',truncated:false,...(url.endsWith('robots.txt')?{status:404,text:''}:response)})));
  }
});
test('baseline, stable variant/currency comparisons, new arrivals and partial results',()=>{
  let w=newStoreWatch(collect([product()]),{},BASE);
  assert.equal(w.findings.length,0);
  const drop=product(1,'99.00');
  w=applyCollection(w,collect([drop,product(2,'10',{createdAt:'2026-10-07T12:01:00Z'}),product(3,'50')]),'2026-10-07T13:00:00Z');
  assert.equal(w.findings.find(f=>f.productId.endsWith('/1'))?.kind,'price_drop');
  assert.equal(w.findings.find(f=>f.productId.endsWith('/2'))?.kind,'new');
  assert.equal(w.findings.find(f=>f.productId.endsWith('/3')),undefined,'older product rotating into result is not new');
  assert.equal(watchItems(w)[0]?.offer?.previousPrice,'120.00');
  const changed=product(1,'50',{variants:{nodes:[{...product(1,'50').variants.nodes[0],price:{amount:'50',currencyCode:'EUR'}}],pageInfo:{hasNextPage:false}}});
  w=applyCollection(w,{...collect([changed]),partial:true},'2026-10-07T14:00:00Z');
  assert.equal(w.findings.find(f=>f.productId.endsWith('/1')),undefined,'currency change clears an obsolete comparison');
  assert.equal(w.products.length,3,'missing products retained');assert.equal(w.partial,true);
  assert.equal(watchItems(w).find(i=>i.url?.endsWith('product-2'))?.offer?.observedAt,'2026-10-07T13:00:00Z');
});
test('a price rise clears old drops; decimal comparisons and saved-only restocks',()=>{
  let w=newStoreWatch(collect([product(1,'999999999999.0002')]),{},BASE);
  w=applyCollection(w,collect([product(1,'999999999999.0001')]),'2026-10-07T13:00:00Z');
  assert.equal(w.findings[0]?.kind,'price_drop');
  w=applyCollection(w,collect([product(1,'999999999999.0003')]),'2026-10-07T14:00:00Z');assert.equal(w.findings.length,0);
  const sold=product(1,'20');sold.variants.nodes[0]!.availableForSale=false;
  w=newStoreWatch(collect([sold]),{},BASE);
  assert.equal(applyCollection(w,collect([product(1,'20')])).findings.length,0);
  assert.equal(applyCollection(w,collect([product(1,'20')]),undefined,new Set([SHOP+'/products/product-1'])).findings[0]?.kind,'back');
  sold.variants.pageInfo.hasNextPage=true;
  assert.equal(watchItems(newStoreWatch(collect([sold]),{},BASE))[0]?.offer?.availability,'unknown');
});
test('preview is account-bound, expires, writes nothing; confirmation is idempotent and creates Shop',async()=>{
  const s=setup();const watch=findTool('watch')!;
  const preview=(await watch.handler({kind:'store',url:SHOP,scope:{collection:'clothing',salesOnly:true}},s.ctx)).structuredContent as any;
  assert.equal((await s.watchStore.list('alice')).length,0);
  await assert.rejects(s.watches.confirm('bob',preview.preview.select),{code:'invalid_argument'});
  const confirmed=await watch.handler({kind:'store',select:preview.preview.select},s.ctx);
  assert.ok((confirmed.structuredContent as any).profile.columns.flatMap((c:any)=>c.panels).some((p:any)=>p.source==='watches'));
  await watch.handler({kind:'store',select:preview.preview.select},s.ctx);
  assert.equal((await s.watchStore.list('alice')).length,1);assert.equal((await s.watchStore.list('bob')).length,0);
  s.advance(600_001);await assert.rejects(s.watches.confirm('alice',preview.preview.select),{code:'invalid_argument'});
});
test('daily checks, minute refresh budget, stale failure, pause/remove and private cache ownership',async()=>{
  const s=setup(),p=await s.watches.preview('alice',SHOP,{});await s.watches.confirm('alice',p.select);
  const portal=()=>s.watches.portal('alice','shop','Shop',30,true);
  await portal();assert.equal(s.state.calls,1);
  s.state.nodes=[product(1,'90')];s.advance();
  const refreshed=await portal();assert.equal(refreshed.items[0]?.finding?.kind,'price_drop');
  const bob=await s.watches.preview('bob',SHOP,{});await s.watches.confirm('bob',bob.select);
  assert.equal((await s.watches.portal('bob','shop','Shop',30)).items[0]?.finding,undefined,'shared data is Bob’s baseline');
  s.state.failed=true;s.advance();const failed=await portal();assert.equal(failed.items[0]?.offer?.amount,'90');assert.ok(failed.watches?.[0]?.error);
  const id=failed.watches![0]!.id;await s.watches.unwatch('alice',id,true);const calls=s.state.calls;assert.equal((await portal()).items.length,0);assert.equal(s.state.calls,calls);
  await s.watches.unwatch('alice',id);assert.equal((await portal()).watches?.length,0);
});
for(const failed of [false,true])test(`removal during a ${failed?'failed':'successful'} catalogue fetch never resurrects the watch`,async()=>{
  const s=setup(),p=await s.watches.preview('alice',SHOP,{}),{watch}=await s.watches.confirm('alice',p.select);s.advance();
  let release!:()=>void,started!:()=>void;
  const start=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
  const service=new StoreWatches(s.watchStore,{cache:s.ctx.cache,fetcher:async(url,options)=>{if(!url.endsWith('robots.txt')){started();await gate;}return s.ctx.fetcher(url,options);}},()=>Date.parse(BASE)+61_000);
  const result=service.portal('alice','shop','Shop',30,true);await start;s.state.failed=failed;await service.unwatch('alice',watch.id);release();
  assert.equal((await result).watches?.length,0);assert.equal((await s.watchStore.list('alice')).length,0);
});
for(const backend of ['memory','files'])test(`${backend} watches: clone isolation, concurrent deduplication/quota, atomic bad import and deletion`,async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'mcportal-watches-'));
  try {
    const store=backend==='memory'?new MemoryWatchStore():new FileWatchStore(dir);
    const other=backend==='memory'?store:new FileWatchStore(dir);
    const w=newStoreWatch(collect([product()]),{},BASE);
    const results=await Promise.all([store.import('alice',[w]),other.import('alice',[w])]);assert.equal(results.reduce((a,b)=>a+b,0),1);
    const copy=await store.list('alice');copy[0]!.displayName='changed';assert.equal((await store.list('alice'))[0]!.displayName,'Example Store');
    await assert.rejects(store.import('alice',[{...w,identity:{provider:'shopify',origin:'http://localhost'}}]));assert.equal((await store.list('alice')).length,1);
    const imports=Array.from({length:WATCH_LIMITS.watches},(_,i)=>store.import('alice',[{...w,id:'watch-'+i,identity:{provider:'shopify',origin:`https://shop-${i}.example.com`},products:[],findings:[]}])) ;
    const all=await Promise.allSettled(imports);assert.equal(all.filter(r=>r.status==='rejected').length,1);assert.equal((await store.list('alice')).length,20);
    await store.import('bob',[w]);await store.deleteAll('alice');assert.equal((await store.list('alice')).length,0);assert.equal((await store.list('bob')).length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('export/restore keeps private watches, additive imports; featured profiles exclude Shop',async()=>{
  const s=setup(),p=await s.watches.preview('alice',SHOP,{});await findTool('watch')!.handler({kind:'store',select:p.select},s.ctx);
  const file=await buildExport('mcportal','alice',s.ctx),exported=parseExport(file.body.toString());assert.equal(exported.version,3);
  const target={store:new MemoryProfileStore(),watchStore:new MemoryWatchStore()};
  assert.equal((await importExport(exported,'alice',target)).watchesAdded,1);assert.equal((await importExport(exported,'alice',target)).watchesAdded,0);
  assert.equal((await target.watchStore.list('alice'))[0]?.identity.origin,SHOP);
  assert.equal(normalizeFeatured([{source:'watches',config:{kind:'store'}}]).length,0);
});
test('linked/API watches: authenticated identity only and no offline local fallback',async()=>{
  const s=setup();
  const client={call:async(method:string,params:Record<string,unknown>={})=>API_METHODS[method]!.run(params,s.ctx)} as StateClient;
  const remote=remoteWatches(client,'alice'),store=new RemoteWatchStore(client,'alice');
  const p=await remote.preview('alice',SHOP,{});await remote.confirm('alice',p.select);
  assert.equal((await store.list('alice')).length,1);await assert.rejects(store.list('bob'));
  await assert.rejects(remote.portal('alice','hn','forged',30));
  await assert.rejects(store.import('alice',[]));
  const offline=remoteWatches({call:async()=>{throw new Error('offline');}} as unknown as StateClient,'alice');
  await assert.rejects(offline.unwatch('alice',(await store.list('alice'))[0]!.id));assert.equal((await store.list('alice')).length,1);
});

test('price findings have a fresh seen identity and duplicate scopes remain one card per product',async()=>{
  const s=setup(),seen=new FileSeenStore(null);
  const p=await s.watches.preview('alice',SHOP,{});await s.watches.confirm('alice',p.select);
  await withNews([await s.watches.portal('alice','shop','Shop',30)],'alice',seen);
  s.advance();s.state.nodes=[product(1,'90')];
  const [portal]=await withNews([await s.watches.portal('alice','shop','Shop',30,true)],'alice',seen);
  assert.equal(portal?.items[0]?.new,true);assert.equal(portal?.items[0]?.finding?.kind,'price_drop');
  const second=await s.watches.preview('alice',SHOP,{salesOnly:true});await s.watches.confirm('alice',second.select);
  assert.equal((await s.watches.portal('alice','shop','Shop',30)).items.length,1);
});
