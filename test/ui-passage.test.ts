/**
 * A selected passage in the reader (docs/plans/attention.md, phase 1), in a real browser
 * inside a fixture MCP Apps host that records what the room sends it. The host's
 * capabilities come from the page's query string, so each test plays a different host.
 * Skips when no Chrome is installed (set CHROME_PATH to point at one).
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MemoryClipStore } from '../src/clip-stores.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { handleMessage, roomHtml } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import { findChrome, Page } from './browser.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';
const ARTICLE = 'https://yashgarg.dev/posts/ps5-rtmp';
const ASK_TEXT = "Let's talk about the passage I just highlighted in MCPortal.";

/** The host: an iframe of the room, answering its requests and logging every message. */
const HOST = `<!doctype html><html><body style="margin:0"><iframe title="MCPortal" src="/app" style="width:1000px;height:800px;border:0"></iframe><script>
const caps = Object.fromEntries((new URLSearchParams(location.search).get('caps') || '').split(',').filter(Boolean).map((c) => [c, {}]));
const frame = document.querySelector('iframe');
window.log = [];
const send = (data) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...data }, '*');
window.addEventListener('message', async (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  window.log.push({ method: m.method, params: m.params });
  if (m.method === 'ui/initialize') send({ id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'fixture-host', version: '1' }, hostCapabilities: caps, hostContext: {} } });
  else if (m.method === 'ui/notifications/initialized') send({ method: 'ui/notifications/tool-result', params: await (await fetch('/initial')).json() });
  else if (m.method === 'tools/call') { const r = await (await fetch('/rpc', { method: 'POST', body: JSON.stringify(m) })).json(); send({ id: m.id, result: r.result, error: r.error }); }
  else if (m.id !== undefined) send({ id: m.id, result: {} });
});
</script></body></html>`;

let ctx: ToolContext;
let server: Server;
let base: string;
let page: Page;

before(async () => {
  if (skip) return;
  ctx = { store: new MemoryProfileStore(), clips: new MemoryClipStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'reader' };
  const call = (body: unknown) => handleMessage(body as never, ctx);
  server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let body = '';
    for await (const chunk of req) body += chunk;
    if (path === '/app') { res.setHeader('content-type', 'text/html'); res.end(await roomHtml()); }
    else if (path === '/initial') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify((await call({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'read_article', arguments: { url: ARTICLE } } }) as { result: unknown }).result)); }
    else if (path === '/rpc') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await call(JSON.parse(body)))); }
    else { res.setHeader('content-type', 'text/html'); res.end(HOST); }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  page = await Page.open(chrome!);
});

after(async () => {
  if (skip) return;
  await page?.close();
  await new Promise((done) => server?.close(done));
});

const IN_FRAME = `document.querySelector('iframe').contentWindow`;

/** Open the reader card on a host with these capabilities and select its second paragraph. */
async function selectParagraph(caps: string): Promise<string> {
  page.problems.length = 0;
  await page.goto(`${base}/?caps=${caps}`);
  await page.waitFor(`${IN_FRAME}.document.querySelectorAll('[data-passage-url] p').length >= 2`, 'the reader card');
  const text = await page.eval<string>(`(() => { const w = ${IN_FRAME}; const p = w.document.querySelectorAll('[data-passage-url] p')[1]; const r = w.document.createRange(); r.selectNodeContents(p); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); return p.textContent.trim(); })()`);
  await page.waitFor(`${IN_FRAME}.document.querySelector('.passage-bar')`, 'the passage bar');
  return text;
}
const barButtons = () => page.eval<string[]>(`[...${IN_FRAME}.document.querySelectorAll('.passage-bar button')].map((b) => b.textContent)`);
const press = (label: string) => page.eval(`[...${IN_FRAME}.document.querySelectorAll('.passage-bar button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);

test('passage: "Ask about this" gives the model the passage as fenced context, then posts fixed words', { skip }, async () => {
  const text = await selectParagraph('serverTools,updateModelContext,message');
  assert.deepEqual(await barButtons(), ['Ask about this', 'Clip quote']);
  await press('Ask about this');
  await page.waitFor(`window.log.some((m) => m.method === 'ui/message')`, 'the message to the host');
  const log = await page.eval<Array<{ method: string; params: any }>>(`window.log.filter((m) => m.method === 'ui/update-model-context' || m.method === 'ui/message')`);
  const context = log.findLast((m) => m.method === 'ui/update-model-context')!;
  const message = log.find((m) => m.method === 'ui/message')!;
  assert.ok(log.indexOf(context) < log.indexOf(message), 'the context arrives before the message');
  assert.equal(context.params.structuredContent.passage.url, ARTICLE);
  assert.equal(context.params.structuredContent.passage.text, text);
  const said = context.params.content[0].text as string;
  assert.ok(said.includes(text), 'the passage is in the context');
  assert.match(said, /<untrusted-content id="([0-9a-f]+)"[^]*<\/untrusted-content id="\1">/, 'fenced as third-party text');
  assert.match(said, /read_article/, 'with a way to read the rest');
  assert.deepEqual(message.params, { role: 'user', content: [{ type: 'text', text: ASK_TEXT }] }, 'the user-voice message is fixed: no site text');
  assert.equal(await page.eval(`${IN_FRAME}.document.querySelector('.passage-bar')`), null, 'the bar goes away');
  assert.deepEqual(page.problems, []);
});

test('passage: "Clip quote" keeps it as a quote clip with its source', { skip }, async () => {
  const text = await selectParagraph('serverTools,updateModelContext,message');
  await press('Clip quote');
  await page.waitFor(`${IN_FRAME}.document.getElementById('toast').textContent.startsWith('Clipped')`, 'the clipped toast');
  const [clip] = await ctx.clips!.list('reader', { limit: 5 });
  assert.equal(clip?.kind, 'quote');
  assert.equal(clip?.source.url, ARTICLE);
  const data = (await ctx.clips!.get('reader', clip!.id))?.data;
  assert.equal(data?.kind === 'quote' ? data.text : null, text, 'the passage, verbatim');
  assert.deepEqual(page.problems, []);
});

test('passage: a host that can\'t take context offers Copy instead of Ask, and sends nothing', { skip }, async () => {
  await selectParagraph('serverTools');
  assert.deepEqual(await barButtons(), ['Clip quote', 'Copy quote']);
  assert.equal(await page.eval(`window.log.some((m) => m.method === 'ui/update-model-context' && m.params?.structuredContent?.passage)`), false, 'selecting alone shares nothing');
  assert.deepEqual(page.problems, []);
});

test('passage: context but no messages: the passage is shared and the user is told to ask', { skip }, async () => {
  await selectParagraph('serverTools,updateModelContext');
  await press('Ask about this');
  await page.waitFor(`${IN_FRAME}.document.getElementById('toast').textContent.includes('Ask it in the chat')`, 'the ask-in-chat toast');
  assert.equal(await page.eval(`window.log.some((m) => m.method === 'ui/message')`), false);
  assert.equal(await page.eval(`window.log.some((m) => m.method === 'ui/update-model-context' && m.params?.structuredContent?.passage)`), true);
  assert.deepEqual(page.problems, []);
});
