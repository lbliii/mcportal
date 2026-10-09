/** Synthetic maximum-ish bodies through real handlers; no external network or user data. */
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {MemoryProfileStore} from '../src/store.ts';
import {defaultProfile} from '../src/profile.ts';
import {MemoryClipStore,buildClip} from '../src/clips.ts';
import {MemoryHandoffStore} from '../src/handoffs.ts';
import {TtlCache} from '../src/lib/cache.ts';
import {handleMessage} from '../src/mcp.ts';
import {componentResult,modelResultBytes,MODEL_RESULT_BYTES} from '../src/tools/result-payload.ts';
import type {CallToolResult,ToolContext} from '../src/tools/kit.ts';
import {AppError} from '../src/lib/errors.ts';

export async function resultFixtures() {
  const url='https://example.com/long';
  const body='# A long retained source\n\n'+Array.from({length:1000},(_,i)=>`## Section ${i}\n\nVersion v2 evidence, café and 日本語. ${'Bounded source text. '.repeat(20)}\n\n`).join('');
  const ctx:ToolContext={userId:'benchmark',store:new MemoryProfileStore(),clips:new MemoryClipStore(),handoffs:new MemoryHandoffStore(),cache:new TtlCache(),resultMode:'legacy',fetcher:async url=>{
    if(url.includes('/unavailable'))throw new AppError('unavailable','Synthetic source unavailable');
    return {url,status:200,contentType:url.endsWith('llms.txt')?'text/plain':url.endsWith('.md')?'text/markdown':'text/html',truncated:false,text:url.endsWith('llms.txt')?`# Bench docs\n\n## Manual\n\n- [Long page](${url.replace('llms.txt','long.md')}): full body\n- [Other](https://example.com/other.md)\n- [Third](https://example.com/third.md)\n`:url.endsWith('.md')?body:`<html><head><title>Long article</title></head><body><article><h1>Long article</h1>${body.split('\n\n').map(p=>`<p>${p}</p>`).join('')}</article></body></html>`};
  }};
  await ctx.store.put(ctx.userId,{...defaultProfile(),columns:[],saved:Array.from({length:100},(_,i)=>({url:`https://example.com/${i}`,title:`Retained item ${i} ${'more context '.repeat(8)}`,savedAt:new Date().toISOString()}))});
  const clip=await ctx.clips!.add(ctx.userId,buildClip({kind:'quote',title:'Long quote',source:{kind:'article',url},text:'Retained quoted words. '.repeat(1200)}));
  const live=await ctx.handoffs!.create(ctx.userId,{url,title:'Live long source',place:{kind:'article'},passage:'Retained quoted words.'});
  const unavailable=await ctx.handoffs!.create(ctx.userId,{url:'https://example.com/unavailable',title:'Unavailable source',place:{kind:'article'},passage:'The original retained quote remains readable.'});
  const cases:Array<{name:string;tool:string;args:Record<string,unknown>}>= [
    {name:'room',tool:'open_room',args:{}}, {name:'article',tool:'read_article',args:{url}},
    {name:'docs',tool:'read_doc_page',args:{docs:'https://example.com/llms.txt',url:'https://example.com/long.md'}},
    {name:'clip',tool:'get_clip',args:{id:clip.id}},
    {name:'comparison',tool:'show_comparison',args:{question:'Compare the evidence',sources:[{ref:`url:${url}`,title:'First',excerpt:'a'.repeat(1800)},{ref:'url:https://example.com/other',title:'Second',excerpt:'b'.repeat(1800)}],interpretation:{text:'Agent interpretation. '.repeat(700),refs:[`url:${url}`]}}},
    {name:'handoff-live',tool:'open_handoff',args:{code:live.code}}, {name:'handoff-unavailable',tool:'open_handoff',args:{code:unavailable.code}},
  ];
  const fixtures=[];
  for(const example of cases){
    const reply=await handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:example.tool,arguments:example.args}},ctx);
    const result=reply!.result as CallToolResult;
    if(result.isError)throw new Error(JSON.stringify({example,result}));
    fixtures.push({...example,result,bounded:await componentResult(result,example.tool,ctx)});
  }
  return {ctx,fixtures};
}
export async function benchmarkResults(){
  const {fixtures}=await resultFixtures();
  return {environment:{node:process.version,platform:process.platform,arch:process.arch},corpus:'Synthetic 100 saved items; 1000 section markdown body; 26 KB quote; 15 KB comparison interpretation. Not production latency or token measurements.',contract:'component-v1 explicitly assumes tool-result _meta is component-only. Legacy retains complete structuredContent and has no model result budget. Actual-host validation is required before enabling.',modelBudgetBytes:MODEL_RESULT_BYTES,cases:fixtures.map(({name,result,bounded})=>({name,legacyModelBytes:modelResultBytes(result),componentModelBytes:modelResultBytes(bounded),completeWireBytes:Buffer.byteLength(JSON.stringify(bounded)),componentDataBytes:Buffer.byteLength(JSON.stringify(bounded._meta)),parts:bounded.structuredContent?.resultView}))};
}
if(process.argv[1]===fileURLToPath(import.meta.url))await writeFile(process.argv[2]||'reports/m2-result-payloads.json',JSON.stringify(await benchmarkResults(),null,2)+'\n');
