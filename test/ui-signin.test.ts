/** Sign-in buttons inside an MCP Apps iframe, with different host link capabilities. */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { handleMessage, roomHtml } from '../src/mcp.ts';
import { defaultProfile } from '../src/profile.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';
import { findChrome, Page } from './browser.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';
const SIGN_IN_URL = 'https://portal.example/oauth/authorize?state=fixture';
const FRAME = `document.querySelector('iframe').contentWindow.document`;
const HOST = `<!doctype html><html><body><iframe src="/app" style="width:1000px;height:800px"></iframe><script>
const mode = new URLSearchParams(location.search).get('links');
const frame = document.querySelector('iframe');
window.log = [];
const send = (data) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...data }, '*');
window.addEventListener('message', async (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  window.log.push(m);
  if (m.method === 'ui/initialize') send({ id: m.id, result: { protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {}, ...(mode !== 'absent' ? { openLinks: {} } : {}) }, hostContext: {} } });
  else if (m.method === 'ui/notifications/initialized') send({ method: 'ui/notifications/tool-result', params: await (await fetch('/initial')).json() });
  else if (m.method === 'tools/call') { const r = await (await fetch('/rpc', { method: 'POST', body: JSON.stringify(m) })).json(); send({ id: m.id, result: r.result, error: r.error }); }
  else if (m.method === 'ui/open-link') send({ id: m.id, result: { isError: mode === 'declined' } });
  else if (m.id !== undefined) send({ id: m.id, result: {} });
});
</script></body></html>`;

let ctx: ToolContext;
let server: Server;
let base: string;
let page: Page;
let starts = 0;

before(async () => {
  if (skip) return;
  ctx = {
    store: new MemoryProfileStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'default',
    link: { linked: false, server: 'https://portal.example', start: async () => { starts++; return { url: SIGN_IN_URL }; }, unlink: async () => 'Signed out' },
  };
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url === '/app') { res.setHeader('content-type', 'text/html'); res.end(await roomHtml()); }
    else if (req.url === '/initial' || req.url === '/rpc') {
      const request = req.url === '/initial' ? { jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'open_room', arguments: {} } } : JSON.parse(body);
      const reply = await handleMessage(request, ctx) as { result: unknown };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/initial' ? reply.result : reply));
    } else { res.setHeader('content-type', 'text/html'); res.end(HOST); }
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

for (const entry of ['menu', 'welcome']) {
  for (const links of ['supported', 'absent', 'declined']) {
    test(`sign-in: ${entry} button starts login with ${links} host links`, { skip }, async () => {
      await ctx.store.put('default', { ...defaultProfile(), onboarded: entry === 'menu', columns: [] });
      starts = 0;
      page.problems.length = 0;
      await page.goto(`${base}/?links=${links}`);
      let target: string;
      if (entry === 'menu') {
        await page.waitFor(`!${FRAME}.getElementById('btnWho').hidden`, 'the Ghost mode menu');
        await page.eval(`${FRAME}.getElementById('btnWho').click()`);
        target = `${FRAME}.getElementById('whoMenu')`;
        await page.eval(`${target}.querySelector('button').click()`);
      } else {
        const button = `[...${FRAME}.querySelectorAll('.welcome-actions button')].find((b) => b.textContent.startsWith('Already have a portal?'))`;
        await page.waitFor(button, 'welcome sign-in');
        await page.eval(`${button}.click()`);
        target = `${FRAME}.querySelector('.welcome-actions + .building')`;
      }
      await page.waitFor(`${target}.textContent.includes('Finish signing in with GitHub')`, 'sign-in instructions');
      assert.equal(starts, 1, 'the actual link_account tool starts sign-in once');
      const requests = await page.eval<Array<{ params: { url: string } }>>(`window.log.filter((m) => m.method === 'ui/open-link')`);
      if (links === 'absent') assert.equal(requests.length, 0, 'no unsupported bridge request');
      else assert.deepEqual(requests.map((r) => r.params.url), [SIGN_IN_URL]);
      if (links !== 'supported') assert.equal(await page.eval(`${FRAME}.querySelector('input[aria-label="Original web address"]').value`), SIGN_IN_URL, 'a usable address is shown immediately');
      assert.deepEqual(page.problems, [], 'clicking never throws an uncaught error');
    });
  }
}
