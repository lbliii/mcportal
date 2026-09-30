/**
 * Live smoke test against real upstreams (needs network):
 *
 *   npm run smoke                       # in-process, default profile
 *   MCPORTAL_URL=https://…/mcp npm run smoke   # against a deployed server
 */
import { TtlCache } from '../src/lib/cache.ts';
import { safeFetch } from '../src/lib/safe-fetch.ts';
import { handleMessage } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';

const remote = process.env.MCPORTAL_URL;
const ctx = { store: new MemoryProfileStore(), fetcher: safeFetch, cache: new TtlCache(), userId: 'smoke' };
let id = 0;

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const message = { jsonrpc: '2.0' as const, id: ++id, method, params };
  if (!remote) return handleMessage(message, ctx);
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (process.env.MCPORTAL_TOKEN) headers.authorization = `Bearer ${process.env.MCPORTAL_TOKEN}`;
  const res = await fetch(remote, { method: 'POST', headers, body: JSON.stringify(message) });
  return res.json();
}

const started = Date.now();
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
console.log(`server: ${init.result.serverInfo.name} ${init.result.serverInfo.version} (${remote ?? 'in-process'})`);

const ws = await rpc('tools/call', { name: 'open_workspace', arguments: {} });
let failed = false;
for (const panel of ws.result.structuredContent.panels) {
  const status = panel.error ? `ERROR ${panel.error}` : `${panel.items.length} items`;
  if (panel.error || panel.items.length === 0) failed = true;
  console.log(`  ${panel.title.padEnd(28)} ${status}  <- ${panel.provenance.endpoint}`);
}

const first = ws.result.structuredContent.panels.find((p: any) => p.source === 'rss')?.items[0];
if (first?.url) {
  const article = await rpc('tools/call', { name: 'read_article', arguments: { url: first.url } });
  const a = article.result.structuredContent?.article;
  console.log(`  reader: ${a ? `"${a.title}" ${a.blocks.length} blocks, ${a.wordCount} words` : article.result.content[0].text}`);
  if (!a) failed = true;
}

console.log(`${failed ? 'FAILED' : 'OK'} in ${Date.now() - started}ms`);
process.exit(failed ? 1 : 0);
