import { addPortalTo } from '../layout.ts';
import { AppError } from '../lib/errors.ts';
import { clean } from '../lib/text.ts';
import { describeLayout, type Profile } from '../profile.ts';
import { storeScope } from '../adapters/shopify.ts';
import { need, ok, ROOM_URI, untrusted, type ToolDef } from './kit.ts';
import type { ToolResults } from './results.ts';

export const WATCH_SCOPE_SCHEMA = { type:'object',additionalProperties:false,properties:{collection:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{0,79}$',maxLength:80,description:'Collection handle from /collections/handle; omit for the whole public catalogue.'},salesOnly:{type:'boolean',description:'Show only products on sale and relevant changes.'}} };
function shopIn(profile:Profile):{profile:Profile;portalId:string}{
  const existing=profile.columns.flatMap(c=>c.panels).find(p=>p.source==='watches');
  if(existing)return {profile,portalId:existing.id};
  const added=addPortalTo(profile,{id:'shop',source:'watches',title:'Shop',config:{kind:'store',limit:30}});
  if('error' in added)throw new AppError('limit_exceeded',added.error);
  return {profile:{...added.profile,onboarded:true},portalId:added.portalId};
}
export const WATCH_TOOLS:ToolDef[]=[{
  name:'watch',title:'Follow a store',access:'write',cost:8,
  description:'Follow a supported Shopify store. First pass kind=store, url and optional collection/salesOnly scope to preview without writing. Ask the user, then pass its select token alone with kind=store to confirm and add Shop. Preview expires in ten minutes. Refresh checks on demand; no continuous monitoring.',
  inputSchema:{type:'object',required:['kind'],additionalProperties:false,properties:{kind:{type:'string',enum:['store']},url:{type:'string',maxLength:2048},scope:WATCH_SCOPE_SCHEMA,select:{type:'string',maxLength:100}}},
  annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true,idempotentHint:true},
  _meta:{ui:{resourceUri:ROOM_URI}},
  async handler(args,ctx){
    const watches=need(ctx.watches,'Store watches are unavailable on this server.');
    if(args.select!==undefined){
      if(args.url!==undefined||args.scope!==undefined)throw new AppError('invalid_argument','Confirm with the preview’s select token; preview again to change its scope.');
      shopIn(await ctx.store.get(ctx.userId)); // refuse a full room before writing a subscription
      const result=await watches.confirm(ctx.userId,String(args.select));
      let room:{profile:Profile;portalId:string};
      try { room=await ctx.store.update(ctx.userId,profile=>{const next=shopIn(profile);return next.profile===profile?{result:next}:{profile:next.profile,result:next};}); }
      catch(error){if(result.added)await watches.unwatch(ctx.userId,result.watch.id);throw error;}
      const spec=room.profile.columns.flatMap(c=>c.panels).find(p=>p.id===room.portalId);
      const portal=await watches.portal(ctx.userId,room.portalId,spec?.title??'Shop',spec?.source==='watches'?spec.config.limit:30);
      const confirmed={id:result.watch.id,displayName:result.watch.displayName,origin:result.watch.identity.origin,scope:result.watch.scope,paused:result.watch.paused};
      return ok(`${result.added?'Following':'Already following'} this store. Shop is in the room (${describeLayout(room.profile)}). First collection is a baseline; future refreshes show changes.\n${untrusted(result.watch.identity.origin,result.watch.displayName)}`,{confirmed,profile:room.profile,portal} satisfies ToolResults['watch']);
    }
    if(typeof args.url!=='string')throw new AppError('invalid_argument','Preview with a store URL, or confirm with a select token.');
    const preview=await watches.preview(ctx.userId,args.url,storeScope(args.scope));
    return ok(`Store preview; nothing followed yet. ${preview.observedProducts} products retrieved${preview.partial?' (partial catalogue)':''}. Confirm only after the user chooses: watch kind=store select=${preview.select}.\n${untrusted(preview.origin,[preview.displayName,...preview.preview.map(p=>`${p.title}: ${p.offer?.amount} ${p.offer?.currency}`)].join('\n'))}`,{preview} satisfies ToolResults['watch']);
  }
},{
  name:'unwatch',title:'Remove or pause a store follow',access:'write',cost:1,
  description:'Remove a store watch by id from open_room/Shop. Pass paused=true to pause, false to resume. Saved products remain saved. Removing the Shop portal does not remove watches.',
  inputSchema:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string',minLength:1,maxLength:80},paused:{type:'boolean'}}},
  annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false,idempotentHint:true},
  async handler(args,ctx){
    const result=await need(ctx.watches,'Store watches are unavailable on this server.').unwatch(ctx.userId,String(args.id),typeof args.paused==='boolean'?args.paused:undefined);
    return ok(result.removed?'Store follow removed. Saved products stay saved.':result.watch?`Store follow ${result.watch.paused?'paused':'resumed'}.`:`No watch with id ${clean(args.id,80)}.`,{removed:result.removed} satisfies ToolResults['unwatch']);
  }
}];
