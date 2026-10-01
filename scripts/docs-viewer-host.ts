/** Local MCP Apps host simulator for docs rendering. Run: node scripts/docs-viewer-host.ts
 * Open http://127.0.0.1:8791, then submit a docs address. Uses in-memory storage
 * and the real MCP handlers/resource, including viewer page/search tool calls.
 * This validates the app bridge; it cannot prove a deployed host attaches the card.
 */
import http from 'node:http';
import {roomHtml, handleMessage} from '../src/mcp.ts';
import {MemoryProfileStore} from '../src/store.ts';
import {TtlCache} from '../src/lib/cache.ts';
import {safeFetch} from '../src/lib/safe-fetch.ts';
const ctx={store:new MemoryProfileStore(), cache:new TtlCache(),fetcher:safeFetch,userId:'viewer-test'};
http.createServer(async(req,res)=>{
try {
if(req.url==='/app'){res.setHeader('content-type','text/html');res.end(await roomHtml());return;}
if(req.url==='/rpc'){let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');res.end(JSON.stringify(await handleMessage(JSON.parse(body),ctx)));return;}
res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Docs MCP host harness</title><form><input aria-label="Docs address" size="100" value="https://github.com/fastapi/fastapi/blob/HEAD/docs/en/docs/tutorial/first-steps.md"><button>Open docs</button></form><button id="bad">Malformed result</button><iframe title="MCPortal app" src="/app" style="width:100%;height:900px;border:0"></iframe><script>
const frame=document.querySelector('iframe');let ready=false;let queued=null;
const send=(method,params)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');
async function rpc(name,args){const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return (await r.json()).result;}
window.addEventListener('message',async(e)=>{if(e.source!==frame.contentWindow)return;const m=e.data;if(m.method==='ui/notifications/initialized'){ready=true;if(queued)open(queued);return;}if(m.id===undefined)return;let result={};if(m.method==='ui/initialize')result={hostContext:{theme:'light'}};if(m.method==='tools/call')result=await rpc(m.params.name,m.params.arguments);frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');});
async function open(docs){if(!ready){queued=docs;return;}send('ui/notifications/tool-input',{arguments:{docs}});send('ui/notifications/tool-result',await rpc('open_docs',{docs}));}
document.querySelector('form').onsubmit=e=>{e.preventDefault();open(document.querySelector('input').value)};
document.querySelector('#bad').onclick=()=>send('ui/notifications/tool-result',{structuredContent:{site:{sections:[{}]}}});
</script>`);
}catch(e){res.statusCode=500;res.end(String(e));}
}).listen(8791,'127.0.0.1',()=>console.log('http://127.0.0.1:8791'));
