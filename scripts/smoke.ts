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

const room = await rpc('tools/call', { name: 'open_room', arguments: {} });
let failed = false;
for (const portal of room.result.structuredContent.portals) {
  const status = portal.error ? `ERROR ${portal.error}` : `${portal.items.length} items`;
  if (portal.error || portal.items.length === 0) failed = true;
  console.log(`  ${portal.title.padEnd(28)} ${status}  <- ${portal.provenance.endpoint}`);
}

const first = room.result.structuredContent.portals.find((p: any) => p.source === 'rss')?.items[0];
if (first?.url) {
  const article = await rpc('tools/call', { name: 'read_article', arguments: { url: first.url } });
  const a = article.result.structuredContent?.article;
  console.log(`  reader: ${a ? `"${a.title}" ${a.blocks.length} blocks, ${a.wordCount} words` : article.result.content[0].text}`);
  if (!a) failed = true;
}

console.log(`${failed ? 'FAILED' : 'OK'} in ${Date.now() - started}ms`);
process.exit(failed ? 1 : 0);
