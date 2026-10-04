import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PAGE_CSP } from '../src/lib/web.ts';
import { page as webPage } from '../src/page.ts';
import { LinkFile } from '../src/link/link-file.ts';
import { startSignIn } from '../src/link/signin.ts';
import { findChrome, Page } from './browser.ts';
import { pkce, raw, startApp } from './helpers.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';

test('standalone shell escapes its title and local destinations and carries its own brand assets', () => {
  const html = webPage('<Sign in>', '<p>Keep the diagnostic.</p>', { siteUrl: 'https://portal.example/private?state=private' });
  assert.match(html, /<title>&lt;Sign in&gt; · MCPortal<\/title>/);
  assert.match(html, /<h1>&lt;Sign in&gt;<\/h1>/);
  assert.match(html, /data-mcportal-brand/);
  assert.match(html, /font\/ttf;base64,/);
  assert.match(html, /href="https:\/\/portal.example\/support"/);
  assert.doesNotMatch(html, /state=private|src="https?:|url\(https?:|<script/i);
  assert.equal((webPage('Existing', '<h1>Existing heading</h1>').match(/<h1>/g) ?? []).length, 1);
  assert.throws(() => webPage('Bad origin', '', { siteUrl: 'javascript:alert(1)' }), /HTTP\(S\)/);
});

test('browser-facing hosted pages use the brand shell while API errors remain JSON', async () => {
  const app = await startApp({ github: { clientId: 'fixture', clientSecret: 'fixture' } });
  try {
    for (const route of ['/account', '/admin', '/join/expired', '/preview', '/missing']) {
      const res = await raw(app.port, { path: route, headers: { accept: 'text/html' } });
      assert.match(res.body, /data-mcportal-brand/, route);
      assert.match(res.body, /<main class="web-main">/, route);
      assert.match(res.body, /<h1>/, `${route}: meaningful heading even on formerly bare error pages`);
      assert.equal(res.headers['content-security-policy'], PAGE_CSP);
      assert.match(res.body, /MCPortal information/);
      assert.doesNotMatch(res.body, /<a[^>]*><button|<script/i);
    }
    assert.equal((await raw(app.port, { path: '/missing' })).headers['content-type'], 'application/json');
    assert.equal((await raw(app.port, { path: '/api/missing', headers: { accept: 'text/html' } })).headers['content-type'], 'application/json');
  } finally { await app.close(); }
});

async function inspect(page: Page): Promise<void> {
  await page.waitFor(`document.fonts.check('700 32px "MCPortal Jost"') && document.fonts.status === 'loaded'`, 'embedded Jost font');
  assert.ok(await page.eval(`document.fonts.check('700 32px "MCPortal Jost"')`));
  assert.ok(await page.eval(`document.querySelector('[data-mcportal-brand] svg')`));
  assert.equal(await page.eval(`document.querySelectorAll('h1').length`), 1);
  assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), 'text and controls fit the frame');
  assert.ok(await page.eval(`!document.querySelector('a button, button a')`));
  // Real computed contrast rather than checking a token name or duplicating CSS.
  const ratios = await page.eval<number[]>(`(() => {
    const lum = (c) => { const v = c.match(/[0-9.]+/g).slice(0,3).map(Number).map(x => {x/=255; return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}); return v[0]*.2126+v[1]*.7152+v[2]*.0722; };
    const ratio = (a,b) => {a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    const card = document.querySelector('.card'), bg = getComputedStyle(card).backgroundColor;
    return [...card.querySelectorAll('h1,p,a,button')].map(n => {const s=getComputedStyle(n);return ratio(s.color, s.backgroundColor==='rgba(0, 0, 0, 0)' ? bg : s.backgroundColor);});
  })()`);
  assert.ok(ratios.every((r) => r >= 4.5), `readable card text: ${ratios}`);
}

test('browser: consent and local callback success/denial keep assets, controls and diagnostics at narrow enlarged text and dark mode', { skip }, async () => {
  const app = await startApp({ github: { clientId: 'fixture', clientSecret: 'fixture' } });
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-web-pages-'));
  const page = await Page.open(chrome!);
  try {
    const registered = await raw(app.port, { method: 'POST', path: '/oauth/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'A very long application name for a narrow frame', redirect_uris: ['http://127.0.0.1:50108/callback'] }) });
    const authorize = new URL('/oauth/authorize', app.base);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: JSON.parse(registered.body).client_id, redirect_uri: 'http://127.0.0.1:50108/callback', code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 'test', resource: 'http://localhost/mcp' }).toString();
    for (const width of [897, 320]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 984, deviceScaleFactor: 1, mobile: false });
      await page.goto(authorize.href);
      await page.eval(`document.documentElement.style.fontSize='200%'`);
      await inspect(page);
      assert.ok(await page.eval(`document.querySelector('button[value="approve"]').getBoundingClientRect().width > 0`));
    }
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await inspect(page);

    const fixtureFetch: typeof fetch = async (input) => {
      const route = new URL(String(input)).pathname;
      return Response.json(route.startsWith('/.well-known') ? { resource: 'https://portal.example/mcp' } : route === '/oauth/register' ? { client_id: 'fixture' } : route === '/oauth/token' ? { access_token: 'fixture-token', refresh_token: 'fixture-refresh' } : { results: [{ id: 0, result: { accountId: 'fixture', login: 'reader' } }] });
    };
    for (const outcome of ['success', 'denied']) {
      const pending = await startSignIn({ server: 'https://portal.example', link: new LinkFile(dir), fetch: fixtureFetch });
      try {
        const auth = new URL(pending.url);
        const callback = new URL(auth.searchParams.get('redirect_uri')!);
        callback.search = new URLSearchParams({ state: auth.searchParams.get('state')!, ...(outcome === 'success' ? { code: 'fixture' } : { error: 'access_denied', error_description: 'This MCPortal server is invite-only. Use your invited GitHub account. <script>hostile()</script>' }) }).toString();
        await page.goto(callback.href);
        await page.eval(`document.documentElement.style.fontSize='200%'`);
        await inspect(page);
        assert.equal(await page.eval(`document.querySelector('.web-footer a').href`), 'https://portal.example/support', 'no nonexistent local support route');
        const text = await page.eval<string>(`document.querySelector('main').innerText`);
        if (outcome === 'success') { await pending.done; assert.match(text, /This computer is signed in/); }
        else { await assert.rejects(pending.done, /invite-only/); assert.match(text, /Reference:/); assert.match(text, /<script>hostile\(\)<\/script>/); }
        assert.ok(await page.eval(`!document.querySelector('script')`), 'diagnostics remain inert');
      } finally { pending.cancel(); }
    }
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); await app.close(); await rm(dir, { recursive: true, force: true }); }
});
