/**
 * The room in a real browser: headless Chrome loads /preview from a real server with
 * fixture data and is driven like a user would (the room, the reader, the docs
 * viewer). Any uncaught exception or console error fails the test. Skips when no
 * Chrome is installed (set CHROME_PATH to point at one).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { Fetcher } from '../src/types.ts';
import { findChrome, Page } from './browser.ts';
import { startApp, type Running } from './helpers.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';

const ARTICLE = 'https://yashgarg.dev/posts/ps5-rtmp';
const DOCS = 'https://docs.example.com';
const LLMS = `# Example Docs

> Everything about Example.

## Getting started

- [Install](${DOCS}/install.md): Set it up
- [First steps](${DOCS}/first-steps.md): Try it

## Guides

- [Deploy](${DOCS}/deploy.md): Ship it
- [API reference](${DOCS}/api/llms.txt): Every endpoint
`;
/** A nested docs index, linked from the main one. */
const API_LLMS = `# Example API

## Endpoints

- [Widgets](${DOCS}/api/widgets.md): List widgets
- [Gadgets](${DOCS}/api/gadgets.md): List gadgets
- [Errors](${DOCS}/api/errors.md): What can go wrong
`;
const PAGE = '# Install\n\nRun the installer, then sign in.\n\n## Requirements\n\nA computer.\n';

/** Fixtures for the feeds and the article, plus a small docs site. */
const fetcher: Fetcher = async (url, options) => {
  if (url === `${DOCS}/api/llms.txt`) return { status: 200, url, contentType: 'text/plain; charset=utf-8', text: API_LLMS, truncated: false };
  if (url === `${DOCS}/llms.txt`) return { status: 200, url, contentType: 'text/plain; charset=utf-8', text: LLMS, truncated: false };
  if (url.startsWith(`${DOCS}/`) && url.endsWith('.md')) return { status: 200, url, contentType: 'text/markdown; charset=utf-8', text: PAGE, truncated: false };
  return createFixtureFetcher()(url, options);
};

/** A room with every kind of portal the smoke test drives. */
function room() {
  return validateProfile({
    ...defaultProfile(),
    name: 'Smoke test',
    onboarded: true,
    saved: [{ url: ARTICLE, title: 'Hijacking the PS5', savedAt: '2026-09-01T00:00:00.000Z' }],
    columns: [
      ...defaultProfile().columns,
      { panels: [{ id: 'saved', source: 'saved', title: 'Saved', config: {} }] },
      { panels: [{ id: 'docs', source: 'docs', title: 'Example Docs', config: { url: DOCS, toc: { kind: 'llms', url: `${DOCS}/llms.txt` } } }] },
    ],
  });
}

let app: Running;
let page: Page;

before(async () => {
  if (skip) return;
  app = await startApp({ allowUnauthenticated: true }, fetcher, { store: new MemoryProfileStore({ default: room() }) });
  page = await Page.open(chrome!);
});

after(async () => {
  if (skip) return;
  await page?.close();
  await app?.close();
});

/** Load the room fresh and wait until every portal has drawn. */
async function openRoom(): Promise<void> {
  page.problems.length = 0;
  await page.goto(`${app.base}/preview`);
  await page.waitFor(`document.querySelectorAll('[data-portal]').length === 5 && !document.querySelector('.skeleton')`, 'the room to draw its five portals');
}

test('browser: the room draws every portal from real tool results', { skip }, async () => {
  await openRoom();
  const portals = await page.eval<Array<{ id: string; items: number; error: boolean }>>(`[...document.querySelectorAll('[data-portal]')].map((n) => ({ id: n.dataset.portal, items: n.querySelectorAll('.item').length, error: Boolean(n.querySelector('.error')) }))`);
  assert.deepEqual(portals.map((p) => p.id), ['hn-top', 'gh-mcp', 'simonw', 'saved', 'docs']);
  for (const p of portals) {
    assert.equal(p.error, false, `${p.id} loaded`);
    assert.ok(p.items > 0, `${p.id} has items`);
  }
  assert.equal(await page.eval(`document.getElementById('roomName').textContent`), 'Smoke test');
  assert.deepEqual(page.problems, []);
});

test('browser: an item opens in the reader, and home returns to the room', { skip }, async () => {
  await openRoom();
  await page.click('[data-portal="saved"] .item-main');
  const title = await page.waitFor<string>(`!document.getElementById('reader').hidden && document.querySelector('#reader h1')?.textContent`, 'the reader to show the article');
  assert.match(title, /PS5/);
  const paragraphs = await page.waitFor<number>(`document.querySelectorAll('#reader .body p').length`, 'the article body');
  assert.ok(paragraphs >= 3, `the article's text is shown (${paragraphs} paragraphs)`);
  await page.click('#reader [aria-label="Back to your room"]');
  await page.waitFor(`!document.getElementById('grid').hidden`, 'the room to come back');
  assert.deepEqual(page.problems, []);
});

/** The reading record for the article, once `ready` says it's there. */
async function readingWhen(ready: (r: any) => boolean): Promise<any> {
  for (let i = 0; i < 10; i++) {   // each call spends the budget the room needs too
    const r = (await tool('get_reading', { url: ARTICLE })).reading;
    if (r && ready(r)) return r;
    await new Promise((done) => setTimeout(done, 200));
  }
  return (await tool('get_reading', { url: ARTICLE })).reading;
}

/** A tool called straight over /mcp, as the model would. */
async function tool(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return (await res.json()).result.structuredContent;
}

test('browser: the reader records opening and position, resumes there, and marks read only when asked', { skip }, async () => {
  const openArticle = async () => {
    await openRoom();
    await page.click('[data-portal="saved"] .item-main');
    await page.waitFor(`document.querySelector('#reader .mark-read')`, 'the article and its Mark as read button');
    await page.eval(`document.getElementById('reader').style.maxHeight = '220px'`);   // a small window, so the fixture article scrolls
  };
  await openArticle();
  const opened = await readingWhen((r) => r.status === 'opened');
  assert.equal(opened?.status, 'opened', 'opening records it, no model involved');
  assert.equal(opened.readAt, undefined);
  await new Promise((done) => setTimeout(done, 200));   // the reader starts watching once it has recorded the open

  // Scroll halfway, then leave (Back scrolls up to itself first): the furthest point is saved on the way out.
  const scrolled = await page.eval<number>(`(() => { const r = document.getElementById('reader'); r.scrollTop = (r.scrollHeight - r.clientHeight) / 3; return r.scrollTop; })()`);
  assert.ok(scrolled > 0, 'the article is long enough to scroll');
  await new Promise((done) => setTimeout(done, 600));   // a reader pauses there
  await page.click('#reader [aria-label="Back to your room"]');
  await page.waitFor(`!document.getElementById('grid').hidden`, 'the room to come back');
  const left = await readingWhen((r) => r.anchor?.block > 0);
  assert.ok(left?.anchor?.block > 0, 'its position was saved');
  assert.ok(left.progress > 0 && left.progress < 1, `progress ${left.progress}`);
  assert.equal(left.status, 'opened', 'progress never means read');

  // Coming back picks up there.
  await openArticle();
  await page.waitFor(`document.getElementById('toast').textContent.includes('where you left off')`, 'the resume notice');
  assert.ok(await page.eval<number>(`document.getElementById('reader').scrollTop || window.scrollY`) > 0, 'scrolled to where they were');

  await page.eval(`document.querySelector('#reader .mark-read').click()`);
  await page.waitFor(`document.querySelector('#reader .mark-read').textContent === 'Read'`, 'the button to say Read');
  const read = (await tool('get_reading', { url: ARTICLE })).reading;
  assert.equal(read.status, 'read');
  assert.ok(read.readAt);
  assert.deepEqual((await tool('list_reading', {})).reading.map((r: any) => r.url), [], 'finished reading is not "in the middle of"');
  assert.deepEqual(page.problems, []);
});

test('browser: a docs portal opens the docs viewer with its contents and a page', { skip }, async () => {
  await openRoom();
  await page.click('[data-portal="docs"] .item-main');
  await page.waitFor(`document.querySelector('.docs-toc') && document.querySelectorAll('.docs-toc a').length >= 3`, 'the docs contents');
  const heading = await page.waitFor<string>(`document.querySelector('.docs-page h1, .docs-page h2')?.textContent`, 'a docs page');
  assert.match(heading, /Install|Getting started/);
  assert.deepEqual(page.problems, []);
});

test('browser: a nested docs index opens inside the viewer, and its up button goes back', { skip }, async () => {
  await openRoom();
  await page.click('[data-portal="docs"] .item-main');
  await page.waitFor(`document.querySelector('.docs-toc a.idx')`, 'the nested index link');
  await page.eval(`document.querySelector('.docs-toc a.idx').closest('details').querySelector('summary').click()`);   // open its section, as a reader would
  await page.click('.docs-toc a.idx');
  await page.waitFor(`document.querySelector('.docs-up')`, 'the nested docs, with an up button');
  assert.match(await page.eval<string>(`document.querySelector('.docs-toc').textContent`), /Widgets/);
  await page.click('.docs-up');
  await page.waitFor(`!document.querySelector('.docs-up') && /Deploy/.test(document.querySelector('.docs-toc')?.textContent ?? '')`, 'the parent docs again');
  assert.deepEqual(page.problems, []);
});
