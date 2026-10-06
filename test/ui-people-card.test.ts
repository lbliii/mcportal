/**
 * The People card end to end inside an MCP Apps iframe: the agent's find_people and
 * suggest_people run for real, the host hands the room suggest_people's result, and the
 * card's Follow and Not for me call the real tools.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { memoryPersistence } from '../src/accounts.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { handleMessage, roomHtml } from '../src/mcp.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import { findChrome, Page } from './browser.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';
const FRAME = `document.querySelector('iframe').contentWindow.document`;
const HOST = `<!doctype html><html><body><iframe src="/app" style="width:1000px;height:800px"></iframe><script>
const frame = document.querySelector('iframe');
const send = (data) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...data }, '*');
window.addEventListener('message', async (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m.method === 'ui/initialize') send({ id: m.id, result: { protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {} }, hostContext: {} } });
  else if (m.method === 'ui/notifications/initialized') send({ method: 'ui/notifications/tool-result', params: await (await fetch('/initial')).json() });
  else if (m.method === 'tools/call') { const r = await (await fetch('/rpc', { method: 'POST', body: JSON.stringify(m) })).json(); send({ id: m.id, result: r.result, error: r.error }); }
  else if (m.id !== undefined) send({ id: m.id, result: {} });
});
</script></body></html>`;

let ctx: ToolContext;
let social: Social;
let server: Server;
let base: string;
let page: Page;

const call = async (name: string, args: Record<string, unknown>) => ((await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)) as { result: any }).result;

before(async () => {
  if (skip) return;
  const profiles = new PublicProfiles(memoryPersistence());
  social = new Social({ store: new DocumentSocialStore(), profiles });
  await profiles.set('me', { handle: 'reader' });
  await profiles.set('ana', { handle: 'ana', listed: true, spaceTitle: 'Cat Physics Quarterly', bio: 'Cat behavior research, mostly' });
  await profiles.set('ben', { handle: 'ben', listed: true, bio: 'World of Warcraft raid guides' });
  ctx = {
    store: new MemoryProfileStore({ me: validateProfile({ ...defaultProfile(), onboarded: true }) }), fetcher: createFixtureFetcher(), cache: new TtlCache(),
    userId: 'me', social, publicProfiles: profiles, accountUrl: 'https://mcportal.example/account',
  };
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('content-type', req.url === '/initial' || req.url === '/rpc' ? 'application/json' : 'text/html');
    if (req.url === '/app') res.end(await roomHtml());
    else if (req.url === '/initial') {
      // What the agent did in the chat: looked, then kept two picks with its reasons.
      await call('find_people', { about: 'cats warcraft' });
      res.end(JSON.stringify(await call('suggest_people', { picks: [
        { handle: 'ana', why: 'Posts mostly about cat behavior research.' },
        { handle: 'ben', why: 'Writes World of Warcraft raid guides.' }] })));
    } else if (req.url === '/rpc') res.end(JSON.stringify(await handleMessage(JSON.parse(body), ctx)));
    else res.end(HOST);
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

test("browser: suggest_people's card lists the picks with the agent's reasons; Follow and Not for me act on the real account", { skip }, async () => {
  const rows = `[...${FRAME}.querySelectorAll('#reader .people-card .item')]`;
  await page.goto(base);
  await page.waitFor(`${FRAME}.querySelector('#reader .people-card') && ${rows}.length === 2`, 'the People card');
  assert.equal(await page.eval(`${FRAME}.querySelector('#reader h1').textContent`), 'People you might follow');
  assert.deepEqual(await page.eval(`${rows}.map((n) => [n.querySelector('.item-title').textContent, n.querySelector('.item-summary').textContent])`), [
    ['@ana', 'Posts mostly about cat behavior research.'],
    ['@ben', 'Writes World of Warcraft raid guides.']]);

  await page.eval(`${rows}[0].querySelector('.person-act.follow').click()`);
  await page.waitFor(`${rows}[0].querySelector('.person-act.follow').textContent === 'Following'`, 'the follow');
  assert.deepEqual((await social.connections('me')).following, ['ana'], 'followed for real');

  await page.eval(`[...${rows}[1].querySelectorAll('.person-act')].find((b) => b.textContent === 'Not for me').click()`);
  await page.waitFor(`${rows}.length === 1`, 'ben passed on');
  const stored = await ctx.store.get('me');
  assert.deepEqual(stored.people?.picks.map((p) => p.handle), ['ana']);
  assert.deepEqual(stored.people?.passed.map((p) => p.handle), ['ben']);
  assert.ok(stored.columns.some((c) => c.panels.some((p) => p.source === 'people')), 'the People portal is in the room');
});
