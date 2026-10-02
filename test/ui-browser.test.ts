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
import { FileSeenStore, seenHash } from '../src/seen.ts';
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
const seen = new FileSeenStore(null);
const profiles = new MemoryProfileStore({ default: room() });
let page: Page;

before(async () => {
  if (skip) return;
  app = await startApp({ allowUnauthenticated: true }, fetcher, { store: profiles, seen });
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

/** The reading record for the article, once `ready` says it's there (or the last one seen, after 10 seconds). */
async function readingWhen(ready: (r: any) => boolean): Promise<any> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const r = (await tool('get_reading', { url: ARTICLE })).reading;
    if ((r && ready(r)) || Date.now() > deadline) return r;
    await new Promise((done) => setTimeout(done, 250));   // each call spends the budget the room needs too
  }
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

  // Scroll a third of the way, then leave (Back scrolls up to itself first): the furthest point is saved on the way out.
  const scrolled = await page.eval<number>(`(() => { const r = document.getElementById('reader'); r.scrollTop = (r.scrollHeight - r.clientHeight) / 3; return r.scrollTop; })()`);
  assert.ok(scrolled > 0, 'the article is long enough to scroll');
  await page.waitFor(`Number(document.querySelector('#reader .body')?.dataset.furthest) > 0`, 'the reader to note how far it got');   // a reader pauses there
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

test('browser: new items are marked, and the ones on screen are recorded as seen', { skip }, async () => {
  const ids: string[] = (await tool('open_room', {})).portals.find((p: any) => p.portalId === 'hn-top').items.map((i: any) => i.id);
  // As if the first two arrived since the last visit.
  await seen.deleteAll('default');
  await seen.mark('default', [{ portalId: 'hn-top', itemIds: ids.slice(2) }]);
  await openRoom();
  assert.equal(await page.eval(`document.querySelectorAll('[data-portal="hn-top"] .new-mark').length`), 2);
  assert.match(await page.eval<string>(`document.querySelector('[data-portal="hn-top"] .portal-count').textContent`), /· 2 new$/);
  assert.equal(await page.eval(`document.querySelectorAll('[data-portal="gh-mcp"] .new-mark').length`), 0);
  // On screen for a second, then sent in the next batch (every 10 seconds).
  let set = new Set<string>();
  for (let i = 0; i < 30 && !set.has(seenHash(ids[0]!)); i++) {
    await new Promise((done) => setTimeout(done, 500));
    set = (await seen.get('default', ['hn-top'])).get('hn-top') ?? new Set();
  }
  assert.ok(set.has(seenHash(ids[0]!)) && set.has(seenHash(ids[1]!)), 'both new items were recorded');
  assert.equal(await page.eval(`document.querySelectorAll('[data-portal="hn-top"] .new-mark').length`), 2, 'the marks stay for this visit');
  assert.deepEqual(page.problems, []);
});

test('browser: a docs portal opens the docs viewer with its contents and a page', { skip }, async () => {
  await openRoom();
  await page.click('[data-portal="docs"] .item-main');
  await page.waitFor(`document.querySelector('.docs-toc') && document.querySelectorAll('.docs-toc a').length >= 3`, 'the docs contents');
  const heading = await page.waitFor<string>(`document.querySelector('.docs-page h1, .docs-page h2')?.textContent`, 'a docs page');
  assert.match(heading, /Install|Getting started/);
  // Selecting text on a docs page offers the passage bar (no host here, so Clip and Copy).
  await page.waitFor(`document.querySelector('.docs-page [data-passage-url] p')`, 'the page text');
  await page.eval(`(() => { const p = document.querySelector('.docs-page [data-passage-url] p'); const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  const bar = await page.waitFor<string[]>(`document.querySelector('.passage-bar') && [...document.querySelectorAll('.passage-bar button')].map((b) => b.textContent)`, 'the passage bar');
  assert.deepEqual(bar, ['Clip quote', 'Send to new chat', 'Copy quote']);
  assert.match(await page.eval<string>(`document.querySelector('.docs-page [data-passage-url]').dataset.passageHint`), /read_doc_page with that url and portalId "docs"/);
  await page.eval(`getSelection().removeAllRanges()`);
  await page.waitFor(`!document.querySelector('.passage-bar')`, 'the bar to go when the selection does');
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

test('browser: the front page leads with the picks, pages each portal, and nothing in it scrolls', { skip }, async () => {
  // Twelve saved items, so the Saved block has pages; the first two HN items new.
  const saved = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/saved-${i}`, title: `Saved ${i}`, savedAt: '2026-09-01T00:00:00.000Z' }));
  await profiles.put('default', validateProfile({ ...room(), layout: 'frontpage', saved }));
  const hn = (await tool('open_room', {})).portals.find((p: any) => p.portalId === 'hn-top').items.map((i: any) => i.id);
  await seen.deleteAll('default');
  await seen.mark('default', [{ portalId: 'hn-top', itemIds: hn.slice(2) }]);
  const [first, second] = (await tool('list_new_items', { portals: ['hn-top'] })).items;
  await tool('show_highlights', { title: 'Morning edition', picks: [{ ref: second.ref, why: 'The one you asked about.' }, { ref: first.ref, why: 'Also good.' }] });
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#grid.frontpage .fp-block') && !document.querySelector('.skeleton')`, 'the front page');
    assert.equal(await page.eval(`document.querySelector('.fp-title').textContent`), 'Morning edition');
    assert.match(await page.eval<string>(`document.querySelector('.fp-kicker').textContent`), /· 2 new$/);
    assert.equal(await page.eval(`document.querySelector('.item.lead .item-title').textContent`), `New${second.item.title}`, "the agent's first pick leads");
    assert.match(await page.eval<string>(`document.querySelector('.item.lead .item-why').textContent`), /The one you asked about\./);
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('.fp-picks .item-title')].map((n) => n.textContent)`), [`New${first.item.title}`]);
    // Picked stories aren't repeated in their portal's block.
    const hnRows = await page.eval<string[]>(`[...document.querySelectorAll('[data-portal="hn-top"] .item-title')].map((n) => n.textContent)`);
    assert.ok(!hnRows.some((t) => t.endsWith(first.item.title) || t.endsWith(second.item.title)), 'picks are not repeated');
    assert.equal(await page.eval(`document.getElementById('frontEnd').textContent`), "You're caught up.", 'both new stories are on the page');
    // The Saved block shows three, then five more a click, then the rest.
    const rows = () => page.eval<number>(`document.querySelectorAll('[data-portal="saved"] li').length`);
    const more = () => page.eval<string>(`(() => { const b = document.querySelector('[data-portal="saved"] .fp-more'); return b.hidden ? '' : b.textContent; })()`);
    assert.equal(await rows(), 3);
    assert.equal(await more(), '5 more of 9');
    await page.click('[data-portal="saved"] .fp-more');
    assert.equal(await rows(), 8);
    assert.equal(await more(), '4 more of 4');
    await page.click('[data-portal="saved"] .fp-more');
    assert.equal(await rows(), 12);
    assert.equal(await more(), '', 'no more to show');
    const scrolling = await page.eval<string[]>(`[...document.querySelectorAll('#grid, #grid *')].filter((n) => { const s = getComputedStyle(n); return (/auto|scroll/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) || (/auto|scroll/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1); }).map((n) => n.className)`);
    assert.deepEqual(scrolling, [], 'nothing scrolls inside the front page');
    assert.deepEqual(page.problems, []);
  } finally {
    await profiles.put('default', room());
  }
});

test('browser: a portal opens to fill the room; the reader returns to it, and Escape steps back out', { skip }, async () => {
  const saved = Array.from({ length: 14 }, (_, i) => ({ url: `https://example.com/saved-${i}`, title: `Saved ${i}`, savedAt: '2026-09-01T00:00:00.000Z' }));
  await profiles.put('default', validateProfile({ ...room(), saved: [{ url: ARTICLE, title: 'Hijacking the PS5', savedAt: '2026-09-01T00:00:00.000Z' }, ...saved] }));
  const escape = () => page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  try {
    await openRoom();
    await page.eval(`document.getElementById('grid').scrollLeft = 120`);
    const lane = await page.eval<number>(`document.getElementById('grid').scrollLeft`);
    await page.eval(`document.querySelector('[data-portal="saved"]').dataset.marker = 'the same node'`);
    await page.click('[data-portal="saved"] .portal-title');
    await page.waitFor(`document.querySelector('#grid.portal-level [data-portal-level="saved"]')`, 'the Saved portal level');
    assert.equal(await page.eval(`document.querySelector('.level-title').textContent`), 'Saved');
    assert.equal(await page.eval(`document.activeElement.className`), 'level-title', 'focus moves to the portal');
    assert.equal(await page.eval(`document.querySelectorAll('.level li').length`), 10, 'ten at first, inline');
    await page.click('.level .fp-more');
    assert.equal(await page.eval(`document.querySelectorAll('.level li').length`), 15);
    // The reader opens over the portal and comes back to it.
    await page.click('.level .item-main');
    await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('#reader h1')`, 'the reader');
    await page.click('#reader .reader-top .ib');
    await page.waitFor(`document.getElementById('reader').hidden && document.querySelector('.level')`, 'back at the portal');
    assert.equal(await page.eval(`document.querySelectorAll('.level li').length`), 15, 'still showing what it showed');
    await escape();
    await page.waitFor(`!document.querySelector('.level') && document.querySelector('[data-portal="saved"]')`, 'back in the room');
    assert.equal(await page.eval(`document.querySelector('[data-portal="saved"]').dataset.marker`), 'the same node', "the room's own nodes come back, not a redraw");
    assert.equal(await page.eval<number>(`document.getElementById('grid').scrollLeft`), lane, 'the lane is where it was');
    assert.equal(await page.eval(`document.activeElement.className`), 'portal-title', 'focus returns to the portal title');
    await escape();
    assert.ok(await page.eval(`document.querySelector('[data-portal="saved"]')`), 'Escape in the room does nothing');
    assert.deepEqual(page.problems, []);
  } finally {
    await profiles.put('default', room());
  }
});
