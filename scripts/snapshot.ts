/**
 * Write a self-contained demo of the workspace UI with canned data baked in.
 *
 *   node scripts/snapshot.ts [out.html] [--reader]
 *
 * Uses fixtures by default (no network). Set MCPORTAL_LIVE=1 to snapshot live data.
 * --reader opens the PS5 article in reader view on load.
 */
import { writeFile } from 'node:fs/promises';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { safeFetch } from '../src/lib/safe-fetch.ts';
import { handleMessage, workspaceHtml } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools.ts';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'snapshot.html';
const openReader = process.argv.includes('--reader');
const ctx: ToolContext = {
  store: new MemoryProfileStore(),
  fetcher: process.env.MCPORTAL_LIVE === '1' ? safeFetch : createFixtureFetcher(),
  cache: new TtlCache(),
  userId: 'snapshot',
};

const call = (name: string, args: Record<string, unknown> = {}) =>
  handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);

const workspace = await call('open_workspace');
const panels = ((workspace?.result as any)?.structuredContent?.panels ?? []) as Array<{ items: Array<{ url?: string }>; source: string }>;
const articles: Record<string, unknown> = {};
for (const panel of panels.filter((p) => p.source !== 'github')) {
  for (const item of panel.items.slice(0, 3)) {
    if (item.url) articles[item.url] = await call('read_article', { url: item.url });
  }
}

const stub = `<script>
window.__MCPORTAL_DEV__ = { token: null };
const WORKSPACE = ${JSON.stringify(workspace)};
const ARTICLES = ${JSON.stringify(articles)};
window.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const { name, arguments: args } = body.params;
  let r = name === 'open_workspace' ? WORKSPACE : name === 'read_article' ? ARTICLES[args.url] : null;
  if (!r) r = { result: { isError: true, content: [{ type: 'text', text: 'Not available in this snapshot' }] } };
  return { json: async () => ({ ...r, jsonrpc: '2.0', id: body.id }) };
};
</script>`;
const autoOpen = openReader
  ? `<script>setTimeout(() => { const t = [...document.querySelectorAll('.item')].find((i) => i.textContent.includes('PS5')); if (t) t.click(); }, 300);</script>`
  : '';

const html = (await workspaceHtml()).replace('<!--MCPORTAL_BOOT-->', stub).replace('</body>', `${autoOpen}</body>`);
await writeFile(out, html);
console.log(`wrote ${out} (${panels.length} panels, ${Object.keys(articles).length} articles)`);
