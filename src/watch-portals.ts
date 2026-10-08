/** Watches join the ordinary room without making background fetches a side effect of opening it. */
import { eventIsPast } from './watches-state.ts';
import { normalizeSourceConfig, type PortalInput } from './profile.ts';
import type { ToolContext } from './tools/kit.ts';
import type { Item, PortalResult } from './types.ts';
export async function watchPortal(spec: PortalInput,ctx:ToolContext,now=Date.now()):Promise<PortalResult> {
  const {limit}=normalizeSourceConfig(spec.source==='changes'?'changes':'upcoming',spec.config,spec.id),state=(await ctx.experiences?.get(ctx.userId))?.state;
  let items:Item[]=[];
  if (spec.source==='changes') items=[...(state?.inbox || [])].filter(f=>f.kind!=='event').reverse().slice(0,limit).map(f=>({id:f.id,title:f.title,...(f.url?{url:f.url}:{}),summary:f.kind==='availability'?'Availability problem; retained baseline unchanged.':f.diff?.filter(d=>d.kind!=='same').map(d=>`${d.kind==='added'?'+':'−'} ${d.text}`).join(' ').slice(0,1000) || 'Retained text changed. Inspect the dated evidence.',meta:[f.kind,f.read?'acknowledged':'unread'],publishedAt:f.at,watch:{id:f.watchId,findingId:f.id}}));
  else {
    const events=new Map((state?.watches || []).flatMap(w=>w.events.map(event=>({event,watchId:w.id}))).map(e=>[e.event.id,e]));
    items=[...events.values()].filter(({event})=>!eventIsPast(event,now)).sort((a,b)=>a.event.startsAt.localeCompare(b.event.startsAt)).slice(0,limit).map(({event:e,watchId})=>({id:e.id,title:e.title,url:e.url,event:e,watch:{id:watchId},meta:[new Date(e.startsAt).toLocaleString('en',{timeZone:e.timezone}),e.timezone,e.status,e.venue].filter(Boolean),publishedAt:e.updatedAt}));
  }
  return {portalId:spec.id,source:spec.source,title:spec.title || (spec.source==='changes'?'Changes':'Upcoming'),items,provenance:{source:spec.source,endpoint:'your private watch findings',ttlSeconds:0,fetchedAt:new Date(now).toISOString(),cached:false}};
}
