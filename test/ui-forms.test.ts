/**
 * The server-rendered forms (the OAuth consent screen, the account page) submitted by a
 * real browser. Their POSTs are checked for a same-origin Origin header, and what a
 * browser sends there depends on the page's Referrer-Policy (under no-referrer, a form
 * POST says `Origin: null`), which hand-written requests in the other tests can't show.
 * Skips when no Chrome is installed (set CHROME_PATH to point at one).
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer as netServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/http.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { silentLogger } from '../src/lib/log.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { Fetcher } from '../src/types.ts';
import { findChrome, Page } from './browser.ts';
import { pkce, raw } from './helpers.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';

/** Fixtures, plus a fake GitHub that knows one user. */
const fakeGithub: Fetcher = async (url, options) => {
  const reply = (body: unknown) => ({ status: 200, url, contentType: 'application/json', text: JSON.stringify(body), truncated: false });
  if (url === 'https://github.com/login/oauth/access_token') return reply({ access_token: 'gho_lawrence', token_type: 'bearer' });
  if (url === 'https://api.github.com/user') return reply({ id: 42, login: 'lawrence' });
  return createFixtureFetcher()(url, options);
};

const freePort = () => new Promise<number>((resolve) => {
  const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => resolve(port)); });
});

test('browser forms: approving on the consent screen and signing out of the account page go through', { skip }, async () => {
  // The public URL has to be the address the browser uses, as it is in production.
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mcportal-forms-'));
  const app = createApp({
    host: '127.0.0.1', port, publicUrl: base, staticUser: 'default', github: { clientId: 'gh-client', clientSecret: 'gh-secret' },
    allowedGithubUsers: [], allowedHosts: ['127.0.0.1', 'localhost'], allowedOrigins: [], allowUnauthenticated: false, trustProxy: false, dataDir,
  }, { store: new MemoryProfileStore(), fetcher: fakeGithub, cache: new TtlCache(), log: silentLogger });
  // What the server answered each request, and where it sent the browser.
  const answers: Array<{ method: string; path: string; status: number; location?: string }> = [];
  app.prependListener('request', (req, res) => {
    const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => typeof res;
    res.writeHead = ((status: number, ...rest: unknown[]) => {
      const headers = rest.find((r) => typeof r === 'object' && r !== null) as Record<string, string> | undefined;
      answers.push({ method: req.method ?? 'GET', path: (req.url ?? '').split('?')[0]!, status, ...(headers?.location ? { location: headers.location } : {}) });
      return writeHead(status, ...rest);
    }) as typeof res.writeHead;
  });
  await new Promise<void>((resolve) => app.listen(port, '127.0.0.1', resolve));
  // GitHub itself is never reached: the browser's trip there fails, and the test plays GitHub's redirect back.
  const page = await Page.open(chrome as string, undefined, ['--host-resolver-rules=MAP github.com ~NOTFOUND']);
  const lastAnswer = (p: string, method = 'POST') => [...answers].reverse().find((a) => a.path === p && a.method === method);
  const answered = async (p: string, method = 'POST') => {
    for (let i = 0; i < 50 && !lastAnswer(p, method); i++) await new Promise((r) => setTimeout(r, 100));
    return lastAnswer(p, method);
  };
  try {
    // The consent screen: "Continue with GitHub" is a form POST from the page.
    const reg = await raw(port, { method: 'POST', path: '/oauth/register', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['http://127.0.0.1:1/callback'] }) });
    const clientId = JSON.parse(reg.body).client_id;
    const authorize = new URL('/oauth/authorize', base);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'http://127.0.0.1:1/callback', code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 's', resource: `${base}/mcp` }).toString();
    await page.goto(authorize.href);
    await page.waitFor(`document.querySelector('button[value="approve"]')`, 'the consent screen');
    await page.click('button[value="approve"]');
    const approved = await answered('/oauth/authorize');
    assert.equal(approved?.status, 302, 'approving is not refused as cross-site');
    assert.match(approved?.location ?? '', /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    // GitHub sends the browser back; that finishes the app's sign-in and creates the account.
    await page.goto(`${base}/oauth/callback?code=gh-code&state=${new URL(approved!.location!).searchParams.get('state')}`);
    assert.match((await answered('/oauth/callback', 'GET'))?.location ?? '', /^http:\/\/127\.0\.0\.1:1\/callback\?code=/, 'back to the app with a code');

    // The account page: sign in (the test plays GitHub's redirect back), then sign out with its form.
    await page.goto(`${base}/account/login`);
    const toGithub = await answered('/account/login', 'GET');
    const ghState = new URL(toGithub?.location ?? 'https://invalid/').searchParams.get('state');
    assert.ok(ghState, 'the sign-in went to GitHub with a state');
    await page.goto(`${base}/oauth/callback?code=gh-code&state=${ghState}`);
    await page.waitFor(`document.body.textContent.includes('Signed in as')`, 'the account page');
    await page.click('form[action="/account/logout"] button');
    assert.equal((await answered('/account/logout'))?.status, 302, 'signing out is not refused as cross-site');
    await page.waitFor(`document.body.innerText.includes('Sign in with GitHub')`, 'signed out');
    assert.deepEqual(page.problems.filter((p) => !/github\.com|ERR_NAME_NOT_RESOLVED/.test(p.text)), []);
  } finally {
    await page.close();
    await new Promise<void>((r) => app.close(() => r()));
    await rm(dataDir, { recursive: true, force: true });
  }
});
