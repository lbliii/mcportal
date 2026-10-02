/** Fixture-only MCP Apps host. No credentials, persistent state or upstream requests.
 * Run node scripts/design-preview.ts; open http://127.0.0.1:8799.
 * Browser checks use the shipped resource and bridge, not a copied mock UI.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {roomHtml,handleMessage} from '../src/mcp.ts';
import {MemoryProfileStore} from '../src/store.ts';
import {defaultProfile} from '../src/profile.ts';
import {createFixtureFetcher} from '../src/lib/fixture-fetch.ts';
import {TtlCache} from '../src/lib/cache.ts';
import {MemoryEditionStore} from '../src/editions.ts';
import {page} from '../src/page.ts';
import {serveSite,DEFAULT_SUPPORT_URL} from '../src/site.ts';
const ctx={store:new MemoryProfileStore({room:{...defaultProfile(),onboarded:true},frontpage:{...defaultProfile(),onboarded:true,layout:'frontpage'},river:{...defaultProfile(),onboarded:true,layout:'river'}}),editions:new MemoryEditionStore(),fetcher:createFixtureFetcher(),cache:new TtlCache(),userId:'room'};
const rpc=(name:string,args:Record<string,unknown>,userId:string)=>handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},{...ctx,userId}).then((r)=>(r as {result:{structuredContent:any}}).result);
const now='2026-09-30T12:00:00Z',url='https://example.com/guide';
const blocks=[{type:'h',level:2,id:'room',text:'A room for your internet'},{type:'p',text:'Your agent brings reading, saved clips and shared ideas into one conversational space.'},{type:'callout',kind:'note',text:'Keep useful actions visible before hover.'},{type:'pre',text:'const theme = "adaptive";',lang:'javascript'}];
const article={url,title:'Conversational portals',byline:'MCPortal fixtures',wordCount:230,blocks,provenance:{endpoint:url,fetchedAt:now,cached:false}};
const clip={id:'c_fixture',title:'Ideas worth keeping',kind:'note',tags:['design'],createdAt:now,source:{kind:'conversation'},note:'A clipped thought from a conversation.',data:{kind:'note',blocks}};
const share={id:'s_fixture',title:clip.title,kind:'clip',clip,note:'Bring the web into the conversation.',author:{handle:'reader'},audience:'mcportal',createdAt:now,mine:false};
const space={handle:'reader',spaceTitle:'Dispatches from my room',displayName:'Reader',bio:'Small discoveries, collected and shared.',accent:'teal',mine:false,following:false,followers:3,posts:[share],sources:[{source:'rss',title:'Design transmissions',config:{url:'https://example.com/feed.xml'}}]};
const docs={docs:url,site:{title:'Portal handbook',sections:[{title:'Getting started',pages:[{title:'A room for your internet',url}]}]}};
const result=(structuredContent:unknown)=>({content:[],structuredContent});
async function fixture(view:string){
 // The front page as the agent leaves it: three picks with reasons, the lab on.
 if(view==='frontpage'){const items=(await rpc('list_new_items',{},'frontpage')).structuredContent.items;await rpc('show_highlights',{title:'Morning edition',intro:'Three worth your coffee.',picks:[items[1],items[4],items[2]].map((c:{ref:string},i:number)=>({ref:c.ref,why:['It answers the question you asked yesterday about agent tooling.','A release you have been waiting on.','Short, and close to what you saved last week.'][i]}))},'frontpage');const r=await rpc('open_room',{},'frontpage');r.structuredContent.labs=['frontpage'];return r;}
 // The river with the same picks, the lab on.
 if(view==='river'){const items=(await rpc('list_new_items',{},'river')).structuredContent.items;await rpc('show_highlights',{title:'Morning edition',picks:[items[1],items[4]].map((c:{ref:string},i:number)=>({ref:c.ref,why:['It answers the question you asked yesterday about agent tooling.','A release you have been waiting on.'][i]}))},'river');const r=await rpc('open_room',{},'river');r.structuredContent.labs=['river'];return r;}
 if(view==='shelves'){const r=await fixture('room') as {structuredContent:{profile:{layout:string}}};r.structuredContent.profile.layout='shelves';return r;}
 if(view==='welcome'||view==='room')return (await handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'open_room',arguments:{}}},{...ctx,userId:view}))!.result;
 return result(view==='reader'?{article}:view==='docs'?docs:view==='clip'?{clip}:view==='share'?{share}:{space});
}
createServer(async(req,res)=>{try{
 const u=new URL(req.url??'/','http://127.0.0.1:8799');res.setHeader('content-type','text/html; charset=utf-8');
 if(u.pathname==='/app'){res.end(await roomHtml());return;}
 if(u.pathname.startsWith('/admin/api/')){res.setHeader('content-type','application/json');
  if(req.method!=='GET'||u.pathname!=='/admin/api/state'){res.statusCode=405;res.end(JSON.stringify({error:'Admin writes are disabled in the design fixture'}));return;}
  res.end(JSON.stringify({csrf:'fixture',me:{accountId:'fixture',login:'design-review'},invites:[],accounts:[],reports:[],audit:[],usage:{budget:{limits:{perMinute:120,perDay:3000,globalPerDay:60000},global:{used:1840,resetsAt:new Date(Date.now()+6*3600e3).toISOString()},today:[{userId:'github-1',login:'design-review',used:1210},{userId:'github-2',login:null,used:630}]},tools:{since:new Date(Date.now()-3600e3).toISOString(),tools:[{tool:'open_room',calls:212,outcomes:{ok:209,error:3},codes:{upstream_error:3},totalMs:0,maxMs:2210,avgMs:340},{tool:'find_source',calls:41,outcomes:{ok:37,invalid:4},codes:{invalid_argument:4},totalMs:0,maxMs:5120,avgMs:1890},{tool:'get_thumbnails',calls:398,outcomes:{ok:398},codes:{},totalMs:0,maxMs:900,avgMs:120}]}}}));return;}
 if(u.pathname==='/fixture'){res.setHeader('content-type','application/json');res.end(JSON.stringify(await fixture(u.searchParams.get('view')??'room')));return;}
 if(u.pathname==='/rpc'){let text='';for await(const chunk of req){text+=chunk;if(text.length>100000)throw new Error('Large request');}const msg=JSON.parse(text);
  res.setHeader('content-type','application/json');
  const name=msg.params?.name;
  const canned=name==='read_doc_page'?result({page:article,section:'Getting started',provenance:article.provenance}):name==='get_clip'?result({clip}):name==='get_share'?result({share}):name==='open_space'?result({space}):name==='search_docs'?result({hits:[{url,title:article.title}]}):null;
  res.end(JSON.stringify(canned?{jsonrpc:'2.0',id:msg.id,result:canned}:await handleMessage(msg,ctx)));return;
 }
 if(u.pathname==='/auth'){res.end(page('Sign in','<h1>Welcome to MCPortal</h1><p class="muted">Your personal portal.</p><button class="primary">Continue with GitHub</button><button>Cancel</button>'));return;}
 if(u.pathname==='/admin'){res.end((await readFile(new URL('../src/ui/admin.html',import.meta.url),'utf8')).replace('/*MCPORTAL_DESIGN*/',(await import('../src/design/generated.ts')).DESIGN_CSS+(await import('../src/design/generated.ts')).PRIMITIVES_CSS));return;}
 if(u.pathname==='/site'){await serveSite(res,'/',{publicUrl:'http://127.0.0.1:8799',supportUrl:DEFAULT_SUPPORT_URL,inviteOnly:false});return;}
 if(u.pathname.startsWith('/site/')){const file=u.pathname.slice(6);if(!/^[\w.-]+$/.test(file))throw new Error('Invalid asset');res.setHeader('content-type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.ttf')?'font/ttf':'image/png');res.end(await readFile(new URL(`../src/site/${file}`,import.meta.url)));return;}
 res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>MCPortal design regression host</title><style>body{margin:0;font:14px system-ui;background:#000}header{padding:12px;background:#eee;color:#111}button,select{font:inherit;padding:6px;margin:4px}iframe{display:block;width:100%;height:900px;border:0;background:transparent}pre{margin:0;padding:12px;background:#eee;color:#111;white-space:pre-wrap}</style></head><body><header>
 <label>View <select id="view">${['welcome','room','shelves','frontpage','river','reader','docs','clip','share','space'].map(v=>`<option>${v}</option>`).join('')}</select></label>
 <label>Theme <select id="mode"><option>light</option><option>dark</option></select></label>
 <label>Display <select id="display"><option>inline</option><option>fullscreen</option></select></label>
 <label>Inputs <select id="inputs"><option>complete</option><option>theme-only</option><option>background-only</option><option>hostile</option><option>none</option></select></label>
 <button id="switch">Theme-only switch</button><button id="reset">Reset inputs</button><button id="run">Run browser checks</button>
 <a href="/site">Site</a> <a href="/auth">Auth</a> <a href="/admin">Admin</a></header><iframe title="MCPortal" src="/app"></iframe><pre id="report" aria-live="polite">Loading fixture…</pre><script>
 const frame=document.querySelector('iframe'), report=document.querySelector('#report'), fields=['view','mode','display','inputs'];let ready=false, current=null;
 const presets={light:{'--color-background-primary':'#FFFFFF','--color-text-primary':'#1B1B1A','--color-text-secondary':'#646460'},dark:{'--color-background-primary':'#161616','--color-text-primary':'#ECECEA','--color-text-secondary':'#A5A59F'}};
 function context(){const mode=document.querySelector('#mode').value,input=document.querySelector('#inputs').value;const display=document.querySelector('#display').value;return input==='none'?{}:{theme:mode,displayMode:display,availableDisplayModes:['inline','fullscreen'],styles:{variables:input==='complete'?presets[mode]:input==='background-only'?{'--color-background-primary':'#161616'}:input==='hostile'?{'--color-background-primary':'#888','--color-text-primary':'#888','--color-text-secondary':'transparent','--mp-surface-canvas':'transparent','--lane-h':'0px'}:{}}};}
 const send=(data)=>frame.contentWindow.postMessage({jsonrpc:'2.0',...data},'*');
 async function load(){ready=false;current=await(await fetch('/fixture?view='+document.querySelector('#view').value)).json();document.body.style.background=document.querySelector('#mode').value==='dark'?'#fff':'#000';frame.src='/app?view='+document.querySelector('#view').value+'&nonce='+Date.now();}
 window.addEventListener('message',async e=>{if(e.source!==frame.contentWindow)return;const m=e.data;
  if(m.method==='ui/initialize')send({id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'fixture-host',version:'1'},hostCapabilities:{serverTools:{},openLinks:{},message:{},updateModelContext:{}},hostContext:context()}});
  else if(m.method==='ui/notifications/initialized'){send({method:'ui/notifications/tool-result',params:current});ready=true;report.textContent='Fixture ready';}
  else if(m.method==='tools/call'){const r=await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();send({id:m.id,result:r.result,error:r.error});}
  else if(m.id!==undefined)send({id:m.id,result:{}});
 });
 fields.forEach(id=>document.querySelector('#'+id).onchange=load);
 document.querySelector('#switch').onclick=()=>{const m=document.querySelector('#mode');m.value=m.value==='light'?'dark':'light';send({method:'ui/notifications/host-context-changed',params:{theme:m.value}});};
 document.querySelector('#reset').onclick=()=>send({method:'ui/notifications/host-context-changed',params:{styles:{variables:Object.fromEntries(Object.keys(presets.light).map(k=>[k,null]))}}});
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const luminance=c=>{const x=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return x[0]*.2126+x[1]*.7152+x[2]*.0722;};
 const ratio=(a,b)=>{a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 let focusUnchecked=false;
 function check(){const d=frame.contentDocument,w=frame.contentWindow,fail=[];const visible=n=>n.getClientRects().length&&w.getComputedStyle(n).visibility!=='hidden';
  const body=w.getComputedStyle(d.body);if(parseFloat(body.fontSize)<13)fail.push('rem scale shrank default text');if(body.backgroundColor==='rgba(0, 0, 0, 0)')fail.push('transparent backing');
  if(d.querySelector('.error')&&visible(d.querySelector('.error')))fail.push('render error: '+d.querySelector('.error').textContent);
  for(const n of d.querySelectorAll('button,a,[role="button"],input,select,textarea')){if(!visible(n))continue;const s=w.getComputedStyle(n);if(Number(s.opacity)===0)fail.push('invisible action '+n.title);if(n.querySelector('button,a,input,select,textarea,[role="button"]'))fail.push('nested control');
   if(n.matches('button,[role="button"]')&&n.getBoundingClientRect().height<23.9)fail.push('small target '+n.title);
   if(n.disabled||n.closest('.art,.thumb,.post img'))continue;let bg=n;while(bg&&w.getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;
   if(bg&&ratio(s.color,w.getComputedStyle(bg).backgroundColor)<4.49)fail.push('text contrast '+(n.title||n.textContent.slice(0,24)));
  }
  // A host window without focus never shows focus rings: say so rather than fail every case.
  const first=[...d.querySelectorAll('button')].find(visible);if(first&&!document.hasFocus())focusUnchecked=true;else if(first){first.focus();const s=w.getComputedStyle(first);if(s.outlineStyle==='none'||parseFloat(s.outlineWidth)<2)fail.push('missing keyboard focus');}
  if(d.querySelector('img')&&[...d.querySelectorAll('img')].some(n=>w.getComputedStyle(n).filter!=='none'))fail.push('recoloured image');for(const card of d.querySelectorAll('.card')){const meta=card.querySelector('.item-meta');if(meta&&meta.getBoundingClientRect().bottom>card.getBoundingClientRect().bottom+1)fail.push('clipped card actions');}return [...new Set(fail)];
 }
 // Report-only until room-layouts phase 6: what scrolls on its own inside the inline frame.
 // Code blocks and tables are allowed to (design-system.md); everything else should page.
 function scrollers(){const d=frame.contentDocument,w=frame.contentWindow,out=[];for(const n of d.querySelectorAll('body *')){if(n.closest('pre,table,.table-wrap'))continue;const s=w.getComputedStyle(n);
  const y=/auto|scroll/.test(s.overflowY)&&n.scrollHeight>n.clientHeight+1,x=/auto|scroll/.test(s.overflowX)&&n.scrollWidth>n.clientWidth+1;
  if(x||y)out.push((x&&y?'xy ':x?'x ':'y ')+n.tagName.toLowerCase()+(n.className&&typeof n.className==='string'?'.'+n.className.trim().split(/\\s+/).join('.'):''));}
  return [...new Set(out)];}
 document.querySelector('#run').onclick=async()=>{const rows=[];document.querySelector('#run').disabled=true;
  for(const width of [360,760,1000])for(const view of ['welcome','room','shelves','frontpage','river','reader','docs','clip','share','space'])for(const input of ['complete','theme-only','background-only','hostile','none']){
   frame.style.width=width+'px';document.querySelector('#view').value=view;document.querySelector('#inputs').value=input;document.querySelector('#mode').value=width===1000?'dark':'light';document.querySelector('#display').value='inline';await load();
   for(let i=0;i<100&&!ready;i++)await delay(20);await delay(150);const failures=ready?check():['bridge timeout'];if(ready){frame.contentDocument.documentElement.style.fontSize='200%';failures.push(...check().map(f=>'200% text: '+f));frame.contentDocument.documentElement.style.fontSize='100%';}rows.push({width,view,input,failures,scrolls:ready?scrollers():[]});report.textContent=rows.length+'/135 checked…';
  }
  frame.style.width='100%';window.designResults=rows;const scrolling=rows.filter(r=>r.input==='complete'&&r.scrolls.length).map(r=>({width:r.width,view:r.view,scrolls:r.scrolls}));
  report.textContent=JSON.stringify({passed:rows.filter(r=>!r.failures.length).length,total:rows.length,failures:rows.filter(r=>r.failures.length),...(focusUnchecked?{focus:'not checked: this window lacks focus; click into it and run again'}:{}),innerScrolling:scrolling},null,2);document.querySelector('#run').disabled=false;
 };load();
 </script></body></html>`);
}catch(error){res.statusCode=500;res.end(String(error));}}).listen(8799,'127.0.0.1',()=>console.log('Design fixture host: http://127.0.0.1:8799'));
