/**
 * A selected passage in the reader (docs/explanation/reading.md, phase 1), in a real browser
 * inside a fixture MCP Apps host that records what the room sends it. The host's
 * capabilities come from the page's query string, so each test plays a different host.
 * Skips when no Chrome is installed (set CHROME_PATH to point at one).
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MemoryClipStore } from '../src/clip-stores.ts';
import { MemoryHandoffStore } from '../src/handoffs.ts';
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
  else if (m.method === 'ui/notifications/initialized') send({ method: 'ui/notifications/tool-result', params: await (await fetch('/initial' + location.search)).json() });
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
  ctx = { store: new MemoryProfileStore(), clips: new MemoryClipStore(), handoffs: new MemoryHandoffStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'reader' };
  const call = (body: unknown) => handleMessage(body as never, ctx);
  server = createServer(async (req, res) => {
    const where = new URL(req.url ?? '/', 'http://x');
    const path = where.pathname;
    // The tool whose result the card shows: ?tool=…&args=… (JSON), else read_article.
    const first = { name: where.searchParams.get('tool') ?? 'read_article', arguments: JSON.parse(where.searchParams.get('args') ?? JSON.stringify({ url: ARTICLE })) };
    let body = '';
    for await (const chunk of req) body += chunk;
    if (path === '/app') { res.setHeader('content-type', 'text/html'); res.end(await roomHtml()); }
    else if (path === '/initial') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify((await call({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: first }) as { result: unknown }).result)); }
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
async function selectParagraph(caps: string, card = ''): Promise<string> {
  page.problems.length = 0;
  await page.goto(`${base}/?caps=${caps}${card}`);
  await page.waitFor(`${IN_FRAME}.document.querySelectorAll('[data-passage-url] p').length >= 2`, 'the reader card');
  const text = await page.eval<string>(`(() => { const w = ${IN_FRAME}; const p = w.document.querySelectorAll('[data-passage-url] p')[1]; const r = w.document.createRange(); r.selectNodeContents(p); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); return p.textContent.trim(); })()`);
  await page.waitFor(`${IN_FRAME}.document.querySelector('.passage-bar')`, 'the passage bar');
  return text;
}
const barButtons = () => page.eval<string[]>(`[...${IN_FRAME}.document.querySelectorAll('.passage-bar button')].map((b) => b.textContent)`);
const press = (label: string) => page.eval(`[...${IN_FRAME}.document.querySelectorAll('.passage-bar button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);

test('passage: "Ask about this" gives the model the passage as fenced context, then posts fixed words', { skip }, async () => {
  const text = await selectParagraph('serverTools,updateModelContext,message');
  assert.deepEqual(await barButtons(), ['Ask about this', 'Clip quote', 'Send to new chat']);
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
  assert.deepEqual(await barButtons(), ['Clip quote', 'Send to new chat', 'Copy quote']);
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

test('handoff: "Send to new chat" stores the page, the passage and where it is, and shows what to say', { skip }, async () => {
  const text = await selectParagraph('serverTools,updateModelContext,message');
  assert.deepEqual(await barButtons(), ['Ask about this', 'Clip quote', 'Send to new chat']);
  const block = await page.eval<number>(`(() => { const d = ${IN_FRAME}.document; const p = d.querySelectorAll('[data-passage-url] p')[1]; return [...d.querySelector('[data-passage-url]').children].indexOf(p); })()`);
  await press('Send to new chat');
  const said = await page.waitFor<string>(`${IN_FRAME}.document.querySelector('.handoff-sent code')?.textContent`, 'the sent panel');
  const [handoff] = await ctx.handoffs!.list('reader');
  assert.equal(said, `Open MCPortal handoff ${handoff!.code}`);
  assert.equal(handoff!.url, ARTICLE);
  assert.deepEqual(handoff!.place, { kind: 'article' });
  assert.equal(handoff!.passage, text);
  assert.equal(handoff!.anchor?.block, block);
  assert.ok(await page.eval(`Boolean(${IN_FRAME}.document.querySelector('.reader-top [aria-label="Send to a new chat"]'))`), 'the whole page can be sent from the reader\'s top bar too');
  assert.deepEqual(page.problems, []);
});

test('handoff: the new chat\'s card opens with the sent passage, and a way to its place in the page', { skip }, async () => {
  const sent = await ctx.handoffs!.create('reader', { url: ARTICLE, title: 'Hijacking the PS5', place: { kind: 'article' }, anchor: { block: 3, heading: 'The Problem' }, passage: 'I often stream games with friends on Discord' });
  page.problems.length = 0;
  await page.goto(`${base}/?caps=serverTools,updateModelContext,message&tool=open_handoff&args=${encodeURIComponent(JSON.stringify({ code: sent.code }))}`);
  const note = await page.waitFor<string>(`${IN_FRAME}.document.querySelector('.handoff-note blockquote')?.textContent`, 'the handoff note');
  assert.equal(note, 'I often stream games with friends on Discord');
  assert.equal(await page.eval(`${IN_FRAME}.document.querySelector('.handoff-note button')?.textContent`), 'Go to it in the page');
  assert.ok((await ctx.handoffs!.get('reader', sent.code))?.openedAt, 'marked opened');
  assert.deepEqual(page.problems, []);
});

test('handoff: an unavailable source keeps its quote visible and retries the live page', { skip }, async () => {
  const sent = await ctx.handoffs!.create('reader', { url: ARTICLE, title: 'Retained evidence', place: { kind: 'article' }, passage: 'I often stream games with friends on Discord' });
  const fetcher = ctx.fetcher, cache = ctx.cache;
  ctx.cache = new TtlCache();
  ctx.fetcher = async (url) => ({ url, status: 503, contentType: 'text/plain', truncated: false, text: 'offline' });
  page.problems.length = 0;
  try {
    await page.goto(`${base}/?caps=serverTools&tool=open_handoff&args=${encodeURIComponent(JSON.stringify({ code: sent.code }))}`);
    await page.waitFor(`${IN_FRAME}.document.querySelector('#reader blockquote')?.textContent === ${JSON.stringify(sent.passage)}`, 'retained quote despite the outage');
    assert.match(await page.eval<string>(`${IN_FRAME}.document.querySelector('#reader [role="status"]').textContent`), /live page is unavailable/);
    assert.equal(await page.eval(`${IN_FRAME}.document.activeElement.tagName`), 'H1');
    const retry = `[...${IN_FRAME}.document.querySelectorAll('#reader button')].find(b => b.textContent === 'Retry live page').click()`;
    await page.eval(retry);
    await page.waitFor(`${IN_FRAME}.document.querySelector('#toast').textContent.includes('still unavailable')`, 'failed retry preserves the quote');
    assert.equal(await page.eval(`${IN_FRAME}.document.querySelector('#reader blockquote').textContent`), sent.passage);
    ctx.fetcher = fetcher;
    await page.eval(retry);
    await page.waitFor(`${IN_FRAME}.document.querySelector('[data-passage-url]')`, 'live source recovery');
    assert.equal(await page.eval(`${IN_FRAME}.document.querySelector('.handoff-note blockquote').textContent`), sent.passage);
    assert.deepEqual(page.problems, []);
  } finally { ctx.fetcher = fetcher; ctx.cache = cache; }
});

test('highlights: the card shows each pick as the source\'s item with the agent\'s reason; "Not for me" marks it seen', { skip }, async () => {
  const listed = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_new_items', arguments: {} } }, ctx) as { result: { structuredContent: { items: Array<{ ref: string; portalId: string; item: { id: string; title: string } }> } } };
  const [a, b] = listed.result.structuredContent.items;
  const args = { title: 'Worth your morning', intro: 'Two picks.', picks: [{ ref: a!.ref, why: 'Because you asked about MCP.' }, { ref: b!.ref, why: 'A follow-up to yesterday.' }] };
  page.problems.length = 0;
  await page.goto(`${base}/?caps=serverTools,updateModelContext,message&tool=show_highlights&args=${encodeURIComponent(JSON.stringify(args))}`);
  await page.waitFor(`${IN_FRAME}.document.querySelectorAll('.highlight').length === 2`, 'the highlights card');
  const shown = await page.eval<{ h1: string; titles: string[]; whys: string[] }>(`(() => { const d = ${IN_FRAME}.document; return { h1: d.querySelector('#reader h1').textContent, titles: [...d.querySelectorAll('.highlight .item-title')].map((n) => n.textContent), whys: [...d.querySelectorAll('.highlight-why')].map((n) => n.lastChild.textContent) }; })()`);
  assert.equal(shown.h1, 'Worth your morning');
  assert.deepEqual(shown.titles, [a!.item.title, b!.item.title], "the sources' own titles");
  assert.deepEqual(shown.whys, ['Because you asked about MCP.', 'A follow-up to yesterday.']);
  await page.eval(`${IN_FRAME}.document.querySelector('.highlight .not-for-me').click()`);
  await page.waitFor(`window.log.some((m) => m.method === 'tools/call' && m.params.name === 'mark_seen')`, 'mark_seen');
  const marked = await page.eval<any>(`window.log.find((m) => m.method === 'tools/call' && m.params.name === 'mark_seen').params.arguments`);
  assert.deepEqual(marked, { portals: [{ portalId: a!.portalId, itemIds: [a!.item.id] }] });
  assert.equal(await page.eval(`${IN_FRAME}.document.querySelectorAll('.highlight').length`), 1, 'it leaves the card');
  assert.deepEqual(page.problems, []);
});
