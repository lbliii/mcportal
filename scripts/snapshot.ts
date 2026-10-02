/**
 * Write a self-contained demo of the room UI with canned data baked in.
 *
 *   node scripts/snapshot.ts [out.html] [--reader] [--packs=developer,ai] [--layout=shelves] [--profile=~/.mcportal/default.json]
 *
 * Uses fixtures by default (no network). Set MCPORTAL_LIVE=1 to snapshot live data.
 * --reader opens the PS5 article (or with --packs, the first article) in reader view on load.
 * --packs builds the portal from starter packs; --layout picks columns or shelves.
 * --profile renders a saved profile (read only; the file is never written).
 * Thumbnails are baked in, so shelves show pictures.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { validateProfile } from '../src/profile.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { safeFetch } from '../src/lib/safe-fetch.ts';
import { handleMessage, roomHtml } from '../src/mcp.ts';
import { MemoryClipStore } from '../src/clips.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'snapshot.html';
const openReader = process.argv.includes('--reader');
const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const packs = flag('packs')?.split(',').filter(Boolean);
const layout = flag('layout');
const profileFile = process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length).replace(/^~(?=\/)/, homedir());
const ctx: ToolContext = {
  store: new MemoryProfileStore(profileFile ? { snapshot: validateProfile(JSON.parse(await readFile(profileFile, 'utf8'))) } : {}),
  clips: new MemoryClipStore(),
  fetcher: process.env.MCPORTAL_LIVE === '1' ? safeFetch : createFixtureFetcher(),
  cache: new TtlCache(),
  userId: 'snapshot',
};

const call = (name: string, args: Record<string, unknown> = {}) =>
  handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);

if (packs) await call('build_room', { packs, layout: layout ?? 'columns' });
else if (layout) {
  await call('arrange_room', { layout });
}
const room = await call('open_room');
const portals = ((room?.result as any)?.structuredContent?.portals ?? []) as Array<{ items: Array<{ url?: string }>; source: string }>;
const articles: Record<string, unknown> = {};
for (const portal of portals.filter((p) => p.source !== 'github')) {
  for (const item of portal.items.slice(0, 3)) {
    if (item.url) articles[item.url] = await call('read_article', { url: item.url });
  }
}
const images: Record<string, string | null> = {};
const thumbUrls = [...new Set(portals.flatMap((p) => p.items.map((i: any) => i.image?.url).filter(Boolean)))] as string[];
for (let i = 0; i < thumbUrls.length; i += 24) {
  const r = await call('get_thumbnails', { urls: thumbUrls.slice(i, i + 24) });
  Object.assign(images, (r?.result as any)?.structuredContent?.images ?? {});
}

const stub = `<script>
window.__MCPORTAL_DEV__ = { token: null };
const ROOM = ${JSON.stringify(room)};
const ARTICLES = ${JSON.stringify(articles)};
const IMAGES = ${JSON.stringify(images)};
window.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const { name, arguments: args } = body.params;
  let r = name === 'open_room' ? ROOM : name === 'read_article' ? ARTICLES[args.url] : null;
  if (name === 'get_thumbnails') r = { result: { content: [], structuredContent: { images: Object.fromEntries(args.urls.map((u) => [u, IMAGES[u] ?? null])) } } };
  if (!r) r = { result: { isError: true, content: [{ type: 'text', text: 'Not available in this snapshot' }] } };
  return { json: async () => ({ ...r, jsonrpc: '2.0', id: body.id }) };
};
</script>`;
// The article to open: the PS5 story in fixtures, else the first one reader view could load.
const readable = portals.filter((p) => p.source !== 'github').flatMap((p: any) => p.items).find((i: any) => i.url && !i.video && (articles[i.url] as any)?.result && !(articles[i.url] as any).result.isError);
const readerTitle = packs ? String(readable?.title ?? '') : 'PS5';
const autoOpen = openReader
  ? `<script>setTimeout(() => { const t = [...document.querySelectorAll('.item, .card')].find((i) => i.textContent.includes(${JSON.stringify(readerTitle)})); if (t) t.click(); }, 300);</script>`
  : '';

const html = (await roomHtml()).replace('<!--MCPORTAL_BOOT-->', stub).replace('</body>', `${autoOpen}</body>`);
await writeFile(out, html);
console.log(`wrote ${out} (${portals.length} portals, ${Object.keys(articles).length} articles, ${Object.values(images).filter(Boolean).length} thumbnails)`);
