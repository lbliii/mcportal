/** Account-owned watch state; shared provider responses never contain this data. */
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { normalizeProduct, SHOP_LIMITS, storeOrigin, storeScope, type ProductObservation, type StoreCollection, type StoreScope } from './adapters/shopify.ts';
import { AppError } from './lib/errors.ts';
import { atomicWrite, defaultDataDir, KeyedMutex } from './lib/files.ts';
import { sha256Hex } from './lib/ids.ts';
import { clean } from './lib/text.ts';
import type { Item } from './types.ts';

export const WATCH_LIMITS = { watches: 20, products: 200, findings: 30, bytes: 5_000_000 } as const;
export interface WatchFinding { productId: string; kind: 'new' | 'price_drop' | 'sale' | 'back'; noticedAt: string; variantId?: string; previousPrice?: string }
export interface StoreWatch {
  id: string; kind: 'store'; displayName: string; identity: { provider: 'shopify'; origin: string };
  scope: StoreScope; addedAt: string; updatedAt: string; paused: boolean;
  products: ProductObservation[]; findings: WatchFinding[];
  collectedAt?: string; partial?: boolean; pages?: number;
}
export interface WatchDocument { version: 1; watches: StoreWatch[] }
export interface WatchStore {
  list(userId: string): Promise<StoreWatch[]>;
  update<T>(userId: string, change: (state: WatchDocument) => { state?: WatchDocument; result: T }): Promise<T>;
  import(userId: string, records: unknown[]): Promise<number>;
  deleteAll(userId: string): Promise<void>;
}
export const emptyWatches = (): WatchDocument => ({ version: 1, watches: [] });
const invalid = (message: string) => new AppError('invalid_argument', message);
const time = (v: unknown): string => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw invalid('Invalid watch timestamp.'); return new Date(v).toISOString(); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Validate every field on import/read, including product addresses and prices. */
export function importedWatch(raw: unknown): StoreWatch {
  const r = record(raw), identity = record(r.identity);
  if (r.kind !== 'store' || identity.provider !== 'shopify' || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) || typeof r.paused !== 'boolean') throw invalid('Invalid store watch.');
  const origin = storeOrigin(identity.origin), name = clean(r.displayName, 100);
  if (!name || !Array.isArray(r.products) || r.products.length > WATCH_LIMITS.products || !Array.isArray(r.findings) || r.findings.length > WATCH_LIMITS.findings) throw invalid('Invalid store watch contents.');
  const products: ProductObservation[] = r.products.map(rawProduct => {
    const p = record(rawProduct);
    if (!Array.isArray(p.variants) || p.variants.length > SHOP_LIMITS.variants || typeof p.url !== 'string') throw invalid('Invalid saved product.');
    let url:URL;
    try {url = new URL(p.url);}catch{throw invalid('Invalid saved product address.');}
    if (url.origin !== origin || !/^\/products\/[a-zA-Z0-9-]+$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw invalid('Invalid saved product address.');
    const product = normalizeProduct({ ...p, handle: url.pathname.split('/')[2], featuredImage: { url: p.image }, variants: { nodes: p.variants.map(rawVariant => { const v = record(rawVariant); return { id: v.id, title: v.title, availableForSale: v.available, price: { amount: v.amount, currencyCode: v.currency }, compareAtPrice: { amount: v.compareAt, currencyCode: v.currency } }; }), pageInfo: { hasNextPage: p.variantsPartial } } }, origin);
    if (!product || product.variants.length !== p.variants.length) throw invalid('Invalid saved product fields.');
    return product;
  });
  if (new Set(products.map(p => p.id)).size !== products.length) throw invalid('Duplicate saved product identity.');
  const ids = new Set(products.map(p=>p.id));
  const findings: WatchFinding[] = r.findings.map(rawFinding => {
    const f = record(rawFinding);
    if (typeof f.productId !== 'string' || !ids.has(f.productId) || !['new','price_drop','sale','back'].includes(String(f.kind))) throw invalid('Invalid saved product finding.');
    const finding: WatchFinding = { productId: f.productId, kind: f.kind as WatchFinding['kind'], noticedAt: time(f.noticedAt) };
    if (f.variantId !== undefined) {
      if (typeof f.variantId !== 'string' || !products.find(p=>p.id===f.productId)?.variants.some(v=>v.id===f.variantId)) throw invalid('Invalid finding variant.');
      finding.variantId = f.variantId;
    }
    if (f.previousPrice !== undefined) { if (typeof f.previousPrice !== 'string' || !/^\d{1,12}(?:\.\d{1,4})?$/.test(f.previousPrice)) throw invalid('Invalid previous price.'); finding.previousPrice = f.previousPrice; }
    return finding;
  });
  if(new Set(findings.map(f=>f.productId)).size!==findings.length)throw invalid('Duplicate product finding.');
  const watch: StoreWatch = { id:r.id, kind:'store', displayName:name, identity:{provider:'shopify',origin}, scope:storeScope(r.scope), addedAt:time(r.addedAt), updatedAt:time(r.updatedAt), paused:r.paused, products, findings };
  if (r.collectedAt !== undefined) watch.collectedAt=time(r.collectedAt);
  if (r.partial !== undefined) { if(typeof r.partial!=='boolean')throw invalid('Invalid coverage.');watch.partial=r.partial; }
  if (r.pages !== undefined) { if(!Number.isInteger(r.pages)||Number(r.pages)<1||Number(r.pages)>SHOP_LIMITS.pages)throw invalid('Invalid page count.');watch.pages=r.pages as number; }
  return watch;
}
export function validateWatchDocument(raw: unknown): WatchDocument {
  const r=record(raw);
  if(r.version!==1||!Array.isArray(r.watches)||r.watches.length>WATCH_LIMITS.watches)throw invalid('Invalid watch document.');
  if(Buffer.byteLength(JSON.stringify(raw))>WATCH_LIMITS.bytes)throw new AppError('limit_exceeded','Watch data exceeds its size limit.');
  const watches=r.watches.map(importedWatch);
  if(new Set(watches.map(w=>w.id)).size!==watches.length||new Set(watches.map(watchKey)).size!==watches.length)throw invalid('Duplicate watch identity.');
  return {version:1,watches};
}
export const watchKey=(w: Pick<StoreWatch,'identity'|'scope'>) => `${w.identity.origin}|${w.scope.collection??''}|${w.scope.salesOnly===true}`;
export function newStoreWatch(collection: StoreCollection, scope: StoreScope, now=new Date().toISOString()): StoreWatch {
  return { id:randomUUID(),kind:'store',displayName:collection.name,identity:{provider:'shopify',origin:collection.origin},scope:storeScope(scope),addedAt:now,updatedAt:now,paused:false,products:collection.products.map(p=>({...p,observedAt:collection.observedAt??now})),findings:[],collectedAt:collection.observedAt??now,partial:collection.partial,pages:collection.pages };
}
export const comparePrice = (a:string,b:string):number => {
  const decimal=(s:string)=>{const [whole,fraction='']=s.split('.');return BigInt(whole!)*10_000n+BigInt(fraction.padEnd(4,'0'));};
  const x=decimal(a),y=decimal(b);return x<y?-1:x>y?1:0;
};
const onSale = (p: ProductObservation) => p.variants.some(v=>v.compareAt!==undefined&&comparePrice(v.compareAt,v.amount)>0);

/** A bounded catalogue can rotate: only a product created after our baseline is new. */
export function applyCollection(watch: StoreWatch, collection: StoreCollection, now=new Date().toISOString(), savedUrls:ReadonlySet<string>=new Set()): StoreWatch {
  const previous=new Map(watch.products.map(p=>[p.id,p]));
  const findings=new Map(watch.findings.map(f=>[f.productId,f]));
  for(const p of collection.products) {
    const old=previous.get(p.id);
    const existingFinding=findings.get(p.id);
    if(existingFinding?.variantId){
      const before=old?.variants.find(v=>v.id===existingFinding.variantId);
      const after=p.variants.find(v=>v.id===existingFinding.variantId);
      if(!before || !after || before.currency!==after.currency || before.amount!==after.amount || (existingFinding.kind==='sale'&&(!after.compareAt||comparePrice(after.compareAt,after.amount)<=0)) || (existingFinding.kind==='back'&&!after.available))findings.delete(p.id);
    }
    let finding: WatchFinding|undefined;
    if(!old&&watch.collectedAt&&Date.parse(p.createdAt)>Date.parse(watch.collectedAt)&&(!watch.scope.salesOnly||onSale(p))) finding={productId:p.id,kind:'new',noticedAt:now};
    if(old) for(const variant of p.variants) {
      const before=old.variants.find(v=>v.id===variant.id&&v.currency===variant.currency);
      if(!before)continue;
      if(comparePrice(variant.amount,before.amount)<0)finding={productId:p.id,kind:'price_drop',variantId:variant.id,previousPrice:before.amount,noticedAt:now};
      else if(variant.compareAt&&comparePrice(variant.compareAt,variant.amount)>0&&(!before.compareAt||comparePrice(before.compareAt,before.amount)<=0))finding={productId:p.id,kind:'sale',variantId:variant.id,noticedAt:now};
      else if(!before.available&&variant.available&&savedUrls.has(p.url))finding={productId:p.id,kind:'back',variantId:variant.id,noticedAt:now};
    }
    if(watch.scope.salesOnly&&!onSale(p))findings.delete(p.id);
    else if(finding)findings.set(p.id,finding);
    previous.set(p.id,{...p,observedAt:now});
  }
  // Missing/partial responses never manufacture a removal or sold-out finding.
  const products=[...previous.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,WATCH_LIMITS.products);
  const productIds=new Set(products.map(p=>p.id));
  return {...watch,products,findings:[...findings.values()].filter(f=>productIds.has(f.productId)).sort((a,b)=>b.noticedAt.localeCompare(a.noticedAt)||a.productId.localeCompare(b.productId)).slice(0,WATCH_LIMITS.findings),collectedAt:now,updatedAt:now,partial:collection.partial,pages:collection.pages};
}
export function watchItems(watch: StoreWatch): Item[] {
  const byId=new Map(watch.products.map(p=>[p.id,p]));
  const out:Item[]=[];
  const findings=new Map(watch.findings.map(f=>[f.productId,f]));
  const ordered=[...watch.findings.map(f=>byId.get(f.productId)).filter((p):p is ProductObservation=>!!p),...watch.products.filter(p=>!findings.has(p.id))];
  for(const p of ordered) {
    if(watch.scope.salesOnly&&!onSale(p))continue;
    const finding=findings.get(p.id);
    const variant=p.variants.find(v=>v.id===finding?.variantId)??p.variants.filter(v=>v.currency===p.variants[0]!.currency).sort((a,b)=>comparePrice(a.amount,b.amount))[0]!;
    const availability=variant.available?'in_stock':p.variantsPartial?'unknown':'sold_out';
    out.push({id:`shopify:${sha256Hex(watch.identity.origin)}:${p.id.split('/').at(-1)}${finding ? ':'+finding.kind+':'+finding.noticedAt : ''}`,title:p.title,url:p.url,meta:[watch.displayName,`${variant.amount} ${variant.currency}`,availability==='in_stock'?'In stock':availability==='sold_out'?'Sold out':'Stock unknown'],publishedAt:finding?.noticedAt??p.createdAt,...(p.image?{image:{url:p.image,kind:'thumb'}}:{}),offer:{amount:variant.amount,currency:variant.currency,availability,store:watch.displayName,variant:variant.title,variantsPartial:p.variantsPartial,...(p.observedAt?{observedAt:p.observedAt}:{}),...(finding?.previousPrice?{previousPrice:finding.previousPrice}:{})},...(finding?{finding:{kind:finding.kind,noticedAt:finding.noticedAt}}:{})});
  }
  return out;
}

export abstract class DocumentWatchStore implements WatchStore {
  abstract update<T>(userId:string,change:(state:WatchDocument)=>{state?:WatchDocument;result:T}):Promise<T>;
  abstract deleteAll(userId:string):Promise<void>;
  list(userId:string):Promise<StoreWatch[]> { return this.update(userId,s=>({result:structuredClone(s.watches)})); }
  async import(userId:string,raw:unknown[]):Promise<number> {
    const incoming=validateWatchDocument({version:1,watches:raw});
    return this.update(userId,state=>{
      const existing=new Set(state.watches.map(watchKey)),ids=new Set(state.watches.map(w=>w.id));
      const fresh=incoming.watches.filter(w=>!existing.has(watchKey(w))).map(w=>ids.has(w.id)?{...w,id:randomUUID()}:w);
      if(state.watches.length+fresh.length>WATCH_LIMITS.watches)throw new AppError('limit_exceeded','Too many store watches to restore.');
      return {state:validateWatchDocument({...state,watches:[...state.watches,...fresh]}),result:fresh.length};
    });
  }
}
const fileMutex=new KeyedMutex();
export class FileWatchStore extends DocumentWatchStore {
  private dir:string;
  constructor(dir=defaultDataDir()){super();this.dir=dir;}
  private file(userId:string){return path.join(this.dir,'watches',sha256Hex(userId)+'.json');}
  update<T>(userId:string,change:(state:WatchDocument)=>{state?:WatchDocument;result:T}):Promise<T>{return fileMutex.run(this.file(userId),async()=>{
    let state:WatchDocument;
    try{state=validateWatchDocument(JSON.parse(await readFile(this.file(userId),'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;state=emptyWatches();}
    const result=change(state);if(result.state)await atomicWrite(this.file(userId),JSON.stringify(validateWatchDocument(result.state))+'\n');return structuredClone(result.result);
  });}
  deleteAll(userId:string):Promise<void>{return fileMutex.run(this.file(userId),()=>rm(this.file(userId),{force:true}));}
}
export class MemoryWatchStore extends DocumentWatchStore {
  private data=new Map<string,WatchDocument>();private mutex=new KeyedMutex();
  update<T>(userId:string,change:(state:WatchDocument)=>{state?:WatchDocument;result:T}):Promise<T>{return this.mutex.run(userId,async()=>{const result=change(structuredClone(this.data.get(userId)??emptyWatches()));if(result.state)this.data.set(userId,validateWatchDocument(result.state));return structuredClone(result.result);});}
  async deleteAll(userId:string){await this.mutex.run(userId,async()=>{this.data.delete(userId);});}
}
