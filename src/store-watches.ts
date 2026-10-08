/** Shared public collection cache; all subscriptions and comparisons belong to an account. */
import { randomBytes } from 'node:crypto';
import { collectShopify, storeOrigin, storeScope, type StoreCollection, type StoreScope } from './adapters/shopify.ts';
import { mapLimit } from './lib/async.ts';
import { AppError, userMessage } from './lib/errors.ts';
import { KeyedMutex } from './lib/files.ts';
import type { ProfileStore } from './store.ts';
import type { SourceDeps } from './sources.ts';
import type { PortalResult } from './types.ts';
import { applyCollection, newStoreWatch, WATCH_LIMITS, watchItems, watchKey, type StoreWatch, type WatchStore } from './watches.ts';

export const WATCH_FRESH_SECONDS=86_400;
const PREVIEW_MS=10*60_000;
export interface WatchPreview { select:string; displayName:string; origin:string; scope:StoreScope; preview:PortalResult['items']; observedProducts:number; partial:boolean; expiresAt:string }
export interface WatchConfirmation { watch:StoreWatch; added:boolean }
export interface Watches {
  preview(userId:string,url:string,scope:StoreScope):Promise<WatchPreview>;
  confirm(userId:string,select:string):Promise<WatchConfirmation>;
  unwatch(userId:string,id:string,paused?:boolean):Promise<{removed:boolean;watch?:StoreWatch}>;
  portal(userId:string,portalId:string,title:string,limit:number,force?:boolean):Promise<PortalResult>;
}
export class StoreWatches implements Watches {
  private profiles:ProfileStore|undefined;
  private store:WatchStore;private deps:SourceDeps;private now:()=>number;
  private previews=new Map<string,{userId:string;scope:StoreScope;collection:StoreCollection;expires:number;bytes:number}>();
  private collectionMutex=new KeyedMutex();
  private lastFetch=new Map<string,number>();
  private calls:Array<number>=[];
  constructor(store:WatchStore,deps:SourceDeps,now:()=>number=Date.now,profiles?:ProfileStore){this.profiles=profiles;this.store=store;this.deps=deps;this.now=now;}
  private async collect(origin:string,scope:StoreScope,force=false):Promise<StoreCollection>{
    const key=`shopify:${origin}:${scope.collection??''}`;
    return this.collectionMutex.run(key,async()=>{
      const cached=this.deps.cache.peek<StoreCollection>(key);
      // Explicit refresh can bypass daily freshness, at most once a minute per query.
      if(cached&&(!force||this.now()-(this.lastFetch.get(key)??0)<60_000))return cached.value;
      this.calls=this.calls.filter(t=>this.now()-t<60_000);
      if(this.calls.length>=30)throw new AppError('rate_limited','Store refresh budget is busy. Try again in a minute.');
      this.calls.push(this.now());
      for(const [k,at] of this.lastFetch)if(this.now()-at>WATCH_FRESH_SECONDS*1000)this.lastFetch.delete(k);
      const result=await this.deps.cache.get(key,WATCH_FRESH_SECONDS,async()=>({...await collectShopify(origin,scope,this.deps.fetcher),observedAt:new Date(this.now()).toISOString()}),force);
      this.lastFetch.set(key,this.now());
      return result.value;
    });
  }
  async preview(userId:string,url:string,input:StoreScope):Promise<WatchPreview>{
    const scope=storeScope(input),origin=storeOrigin(url);
    const collection=await this.collect(origin,scope);
    let bytes=0;
    for(const [key,p] of this.previews){if(p.expires<=this.now())this.previews.delete(key);else bytes+=p.bytes;}
    const size=Buffer.byteLength(JSON.stringify(collection));
    while(this.previews.size>=100||bytes+size>8_000_000){const first=this.previews.entries().next().value;if(!first)break;bytes-=first[1].bytes;this.previews.delete(first[0]);}
    const select=randomBytes(24).toString('base64url'),expires=this.now()+PREVIEW_MS;
    this.previews.set(select,{userId,scope,collection,expires,bytes:size});
    return {select,displayName:collection.name,origin,scope,preview:watchItems(newStoreWatch(collection,scope,new Date(this.now()).toISOString())).slice(0,4),observedProducts:collection.products.length,partial:collection.partial,expiresAt:new Date(expires).toISOString()};
  }
  async confirm(userId:string,select:string):Promise<WatchConfirmation>{
    const p=this.previews.get(select);
    if(!p||p.userId!==userId||p.expires<=this.now())throw new AppError('invalid_argument','This store preview expired or belongs to another account. Preview the store again.');
    const watch=newStoreWatch(p.collection,p.scope,new Date(this.now()).toISOString());
    const result=await this.store.update(userId,state=>{
      const existing=state.watches.find(w=>watchKey(w)===watchKey(watch));
      if(existing)return {result:{watch:existing,added:false}};
      if(state.watches.length>=WATCH_LIMITS.watches)throw new AppError('limit_exceeded',`You can follow up to ${WATCH_LIMITS.watches} stores.`);
      return {state:{...state,watches:[...state.watches,watch]},result:{watch,added:true}};
    });
    // Idempotent retries can reuse the selection until it expires; storage deduplicates.
    return result;
  }
  async unwatch(userId:string,id:string,paused?:boolean):Promise<{removed:boolean;watch?:StoreWatch}>{
    return this.store.update<{removed:boolean;watch?:StoreWatch}>(userId,state=>{
      const watch=state.watches.find(w=>w.id===id);
      if(!watch)return {result:{removed:false}};
      if(paused!==undefined){const next={...watch,paused,updatedAt:new Date(this.now()).toISOString()};return {state:{...state,watches:state.watches.map(w=>w.id===id?next:w)},result:{removed:false,watch:next}};}
      return {state:{...state,watches:state.watches.filter(w=>w.id!==id)},result:{removed:true}};
    });
  }
  async portal(userId:string,portalId:string,title:string,limit:number,force=false):Promise<PortalResult>{
    const current=await this.store.list(userId);
    const savedUrls=new Set(this.profiles && current.length ? (await this.profiles.get(userId)).saved.map(s=>s.url) : []);
    const loaded=await mapLimit(current,2,async watch=>{
      if(watch.paused)return {watch};
      // Don't advance the private snapshot simply because another account warmed the cache.
      if(!force&&watch.collectedAt&&this.now()-Date.parse(watch.collectedAt)<WATCH_FRESH_SECONDS*1000)return {watch};
      try{
        const collection=await this.collect(watch.identity.origin,watch.scope,force);
        const next=await this.store.update(userId,state=>{
          const existing=state.watches.find(w=>w.id===watch.id);
          // A pause/removal or a concurrent collection wins over this in-flight response.
          if(!existing||existing.paused||existing.updatedAt!==watch.updatedAt)return {result:existing};
          if(collection.observedAt && existing.collectedAt && collection.observedAt <= existing.collectedAt)return {result:existing};
          const updated=applyCollection(existing,collection,collection.observedAt??new Date(this.now()).toISOString(),savedUrls);
          return {state:{...state,watches:state.watches.map(w=>w.id===watch.id?updated:w)},result:updated};
        });
        return {watch:next};
      }catch(error){
        const latest=(await this.store.list(userId)).find(w=>w.id===watch.id);
        return {watch:latest,error:userMessage(error,'This store could not be refreshed.')};
      }
    });
    const surviving=loaded.filter((l):l is typeof l&{watch:StoreWatch}=>!!l.watch);
    const merged=new Map<string,PortalResult['items'][number]>();
    for(const row of surviving)if(!row.watch.paused)for(const item of watchItems(row.watch)){const key=item.url??item.id,previous=merged.get(key);if(!previous || (item.finding && (!previous.finding || item.finding.noticedAt > previous.finding.noticedAt)))merged.set(key,item);}
    const items=[...merged.values()].sort((a,b)=>Number(!!b.finding)-Number(!!a.finding)||(b.publishedAt??'').localeCompare(a.publishedAt??'')||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(30,limit)));
    return {portalId,source:'watches',title,items,provenance:{source:'watches',endpoint:'your followed stores; on-demand public Shopify catalogues',ttlSeconds:WATCH_FRESH_SECONDS},watches:surviving.map(({watch:w,...rest})=>({id:w.id,displayName:w.displayName,origin:w.identity.origin,...w.scope,paused:w.paused,...(w.collectedAt?{checkedAt:w.collectedAt}:{}),...(w.partial?{partial:true}:{}),...rest}))};
  }
}
