/**
 * The room in a real browser: headless Chrome loads /preview from a real server with
 * fixture data and is driven like a user would (the room, the reader, the docs
 * viewer). Any uncaught exception or console error fails the test. Skips when no
 * Chrome is installed (set CHROME_PATH to point at one).
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DocumentExperienceStore } from '../src/experiences.ts';
import { FileClipStore } from '../src/clips.ts';
import { FileEditionStore } from '../src/editions.ts';
import { FileHandoffStore } from '../src/handoffs.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { LocalSession } from '../src/link/session.ts';
import { defaultProfile, validateProfile } from '../src/profile.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileSeenStore, seenHash } from '../src/seen.ts';
import { FileProfileStore, MemoryProfileStore } from '../src/store.ts';
import type { Fetcher } from '../src/types.ts';
import { findChrome, Page } from './browser.ts';
import { startApp, type Running } from './helpers.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';

const ARTICLE = 'https://yashgarg.dev/posts/ps5-rtmp';
const LONG_ARTICLE = 'https://example.com/sticky-reader';
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
const PAGE = `# Install\n\nRun the installer, then sign in.\n\n## Requirements\n\nA computer.\n\n[Deploy from the beginning](${DOCS}/deploy.md#step-1)\n`;
const LONG_DOC = '# Deploy\n\n' + Array.from({ length: 45 }, (_, i) => `## Step ${i + 1}\n\nFollow the deployment instructions for step ${i + 1}. This paragraph gives the page enough content to resume at a meaningful passage.\n\n`).join('');
const GITHUB_DOC = 'https://raw.githubusercontent.com/acme/manual/HEAD/docs/guides/deploy.md';

/** Fixtures for the feeds and the article, plus a small docs site. */
let passageDoc = '';
let watchedText = '# Watched docs\n\nKeep state in a file.';
const CALENDAR = 'https://venue.example.com/calendar.ics';
const eventDate = new Date(Date.now()+7*86400000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const fetcher: Fetcher = async (url, options) => {
  if (url === `${DOCS}/passage.md`) return {status:200,url,contentType:'text/markdown',text:passageDoc,truncated:false};
  if (url === 'https://api.github.com/repos/acme/manual/releases?per_page=10') return {status:200,url,contentType:'application/json',text:JSON.stringify([{id:1,tag_name:'v1.2.3',name:'Reliable persistence',html_url:'https://github.com/acme/manual/releases/tag/v1.2.3',published_at:'2026-10-01T00:00:00Z',body:'Retained reading state.'}]),truncated:false};
  if (url === `${DOCS}/watch.md`) return {status:200,url,contentType:'text/markdown',text:watchedText,truncated:false};
  if (url === CALENDAR) return {status:200,url,contentType:'text/calendar',text:['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:live-show',`DTSTART:${eventDate}`,'SUMMARY:Town Hall live show','LOCATION:Town Hall','URL:https://venue.example.com/show','END:VEVENT','END:VCALENDAR'].join('\r\n'),truncated:false};
  if (url === LONG_ARTICLE) return { status: 200, url, contentType: 'text/html', text: `<article><h1>A long read</h1>${Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i + 1}. Keep the reader controls within reach while this article scrolls. This is enough text to give the paragraph several lines on a narrow screen.</p>`).join('')}</article>`, truncated: false };
  if (url === 'https://api.github.com/repos/acme/manual/git/trees/HEAD?recursive=1') return { status: 200, url, contentType: 'application/json', text: JSON.stringify({ tree: [{ type: 'blob', path: 'docs/README.md' }, { type: 'blob', path: 'docs/guides/deploy.md' }] }), truncated: false };
  if (url === GITHUB_DOC) return { status: 200, url, contentType: 'text/markdown; charset=utf-8', text: LONG_DOC, truncated: false };
  if (url === `${DOCS}/deploy.md`) return { status: 200, url, contentType: 'text/markdown; charset=utf-8', text: LONG_DOC, truncated: false };
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
let readings: FileReadingStore;
let readingDir: string;
const experiences = new DocumentExperienceStore();
const profiles = new MemoryProfileStore({ default: room() });
let page: Page;
let cacheOffset = 0;
const browserCache = new TtlCache({now:()=>Date.now()+cacheOffset});

before(async () => {
  if (skip) return;
  readingDir = await mkdtemp(path.join(tmpdir(), 'mcportal-browser-reading-'));
  readings = new FileReadingStore(readingDir);
  app = await startApp({ allowUnauthenticated: true, limits: { perMinute: 10000, perDay: 100000, globalPerDay: 1000000 } }, fetcher, { store: profiles, cache: browserCache, experiences, seen, reading: readings, labs: [] });
  page = await Page.open(chrome!);
});

after(async () => {
  if (skip) return;
  await page?.close();
  await app?.close();
  await rm(readingDir, { recursive: true, force: true });
});

/** Load the room fresh and wait until every portal has drawn. */
async function openRoom(): Promise<void> {
  page.problems.length = 0;
  await page.goto(`${app.base}/preview`);
  await page.waitFor(`document.querySelectorAll('[data-portal]').length === 5 && !document.querySelector('.skeleton')`, 'the room to draw its five portals');
  await page.waitFor(`document.querySelector('.continue-reading')?.getAttribute('aria-busy') === 'false'`, 'recent reading to finish loading before pointer coordinates are measured');
}

/** Exercise display-mode changes through the same bridge an MCP host uses. */
async function attachHost(): Promise<string> {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, '__MCPORTAL_DEV__', { get: () => undefined, set: () => {} });
    window.addEventListener('message', async (event) => {
      const msg = event.data;
      if (!msg?.id || !msg.method) return;
      event.stopImmediatePropagation();
      let result;
      if (msg.method === 'ui/initialize') result = { hostCapabilities: { serverTools: true, updateModelContext: true }, hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } };
      else if (msg.method === 'tools/call') {
        const response = await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: msg.id, method: 'tools/call', params: msg.params }) });
        result = (await response.json()).result;
      } else result = {};
      window.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
    });` });
  return identifier;
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

test('browser: Recall opens retained pages and returns with query, filters and focus intact', { skip }, async () => {
  await openRoom();
  await page.click('#btnRecall');
  await page.waitFor(`document.querySelector('.recall-hit')`, 'Recall results');
  await page.eval(`document.querySelector('[aria-label="Search your library"]').value = 'Hijacking'; document.querySelector('[aria-label="Filter by kind"]').value = 'saved'; document.querySelector('.recall-search').requestSubmit()`);
  await page.waitFor(`document.querySelector('#recallCount').textContent.includes('1 match for')`, 'the filtered result');
  await page.click('.recall-hit .link-btn');
  await page.waitFor(`!document.querySelector('#reader').hidden && document.querySelector('#reader .body')`, 'the recalled page');
  await page.click('#readerControls .reader-top button');
  await page.waitFor(`!document.querySelector('#experiences').hidden`, 'return to Recall');
  assert.equal(await page.eval(`document.querySelector('[aria-label="Search your library"]').value`), 'Hijacking');
  assert.equal(await page.eval(`document.querySelector('[aria-label="Filter by kind"]').value`), 'saved');
  assert.equal(await page.eval(`document.activeElement.className`), 'link-btn');
  await page.click('#btnExperienceRoom');
  await page.waitFor(`!document.querySelector('#grid').hidden`, 'return to the room');
  assert.deepEqual(page.problems, []);
});

test('browser: Recall explains normalized search, match provenance and bookmark coverage', { skip }, async () => {
  await profiles.put('default', room());
  await openRoom();
  await page.click('#btnRecall');
  await page.waitFor(`document.querySelector('.recall-hit')`, 'Recall results');
  await page.eval(`document.querySelector('[aria-label="Search your library"]').value = 'Find the article about Hijacking'; document.querySelector('[aria-label="Filter by kind"]').value = 'saved'; document.querySelector('.recall-search').requestSubmit()`);
  await page.waitFor(`document.querySelector('#recallCount').textContent.includes('1 match for')`, 'normalized search');
  assert.match(await page.eval<string>(`document.querySelector('#recallCoverage').textContent`), /Search words: hijacking/);
  assert.match(await page.eval<string>(`document.querySelector('.recall-hit').textContent`), /Matched: Saved title/);
  assert.match(await page.eval<string>(`document.querySelector('#recallCoverage').textContent`), /Original page bodies are not searched/);
  await page.eval(`document.querySelector('[aria-label="Search your library"]').value = 'nonexistent platypus'; document.querySelector('.recall-search').requestSubmit()`);
  await page.waitFor(`document.querySelector('.experience-empty h2')?.textContent === 'No matching material'`, 'empty search');
  assert.match(await page.eval<string>(`document.querySelector('.experience-empty').textContent`), /Saving a link does not retain its page text/);
  // A newer UI must still render an older hosted result without search metadata.
  await page.eval(`window.recallOriginalFetch = window.fetch; window.fetch = async (...args) => {
    const response = await window.recallOriginalFetch(...args);
    if (!String(args[0]).endsWith('/mcp')) return response;
    const data = await response.clone().json();
    if (!data.result?.structuredContent?.library) return response;
    delete data.result.structuredContent.library.search;
    return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
  }; document.querySelector('[aria-label="Search your library"]').value = 'legacy'; document.querySelector('.recall-search').requestSubmit()`);
  await page.waitFor(`document.querySelector('#recallCount').textContent.includes('legacy')`, 'old result');
  assert.match(await page.eval<string>(`document.querySelector('#recallCoverage').textContent`), /Searches saved and reading metadata/);
  await page.eval(`window.fetch = window.recallOriginalFetch; delete window.recallOriginalFetch`);
  assert.deepEqual(page.problems, []);
});

test('browser: selected Recall material creates a desk, supports a trail and compares real sources on a narrow screen', { skip }, async () => {
  await profiles.update('default', profile => ({ profile: { ...profile, saved: [...profile.saved, { url: `${DOCS}/install.md`, title: 'Install Example Docs', savedAt: new Date().toISOString() }] }, result: undefined }));
  await openRoom();
  await page.click('#btnRecall');
  await page.eval(`document.querySelector('[aria-label="Filter by kind"]').value = 'saved'; document.querySelector('.recall-search').requestSubmit()`);
  await page.waitFor(`document.querySelectorAll('.recall-hit').length === 2`, 'both kept sources');
  await page.eval(`document.querySelectorAll('[data-select-ref]').forEach(button => button.click())`);
  await page.click('.selection-tray .btn');
  await page.eval(`document.querySelector('[aria-label="New desk title"]').value = 'Understanding deployment'; document.querySelector('[aria-label="New desk purpose"]').value = 'Evidence and an introduction'; document.querySelector('.collection-create').requestSubmit()`);
  await page.waitFor(`document.querySelectorAll('.desk-entry').length === 2`, 'the new desk to keep its sources');
  assert.equal(await page.eval(`document.querySelector('.experience-heading h1').textContent`), 'Understanding deployment');
  await page.eval(`[...document.querySelectorAll('.experience-heading button')].find(b => b.textContent === 'Read as a trail').click()`);
  await page.waitFor(`document.querySelector('.desk-entry .experience-kicker').textContent.includes('STEP 1')`, 'the ordered trail');
  await page.eval(`[...document.querySelectorAll('.desk-entry button')].find(b => b.textContent === 'Finish step').click()`);
  await page.waitFor(`document.querySelector('.desk-entry .experience-kicker').textContent.includes('COMPLETED')`, 'explicit step completion');
  await page.eval(`document.querySelectorAll('.desk-entry [data-select-ref]').forEach(button => button.click())`);
  await page.click('#btnCompare');
  await page.waitFor(`document.querySelectorAll('.comparison-source-body').length === 2 && !document.querySelector('.comparison-source-body').textContent.includes('Opening source…')`, 'both comparison readers');
  assert.equal(await page.eval(`document.querySelectorAll('.comparison-interpretation .agent-writing').length`), 0, 'no invented interpretation');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: false });
  try {
    assert.equal(await page.eval(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'no narrow-screen page overflow');
    await page.click('#comparisonTab1');
    assert.equal(await page.eval(`document.querySelector('#comparisonSource1').classList.contains('compact-active')`), true);
    await page.click('#comparisonSource1 .experience-row button');
    await page.waitFor(`!document.querySelector('#reader').hidden && document.querySelector('#reader .body')`, 'the compared source in the reader');
    await page.click('#readerControls .reader-top button');
    await page.waitFor(`!document.querySelector('#experiences').hidden`, 'comparison continuity');
    assert.equal(await page.eval(`document.querySelector('#comparisonSource1').classList.contains('compact-active')`), true);
  } finally { await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); }
  assert.deepEqual(page.problems, []);
});

test('browser: per-portal cards persist through refresh and a new room view without changing its source', { skip }, async () => {
  await openRoom();
  await page.eval(`const select = document.querySelector('[data-portal="hn-top"] .portal-view-select'); select.value = 'cards'; select.dispatchEvent(new Event('change'))`);
  await page.waitFor(`document.querySelector('[data-portal="hn-top"] .portal-view-cards .card')`, 'the portal card view');
  assert.equal((await profiles.get('default')).columns[0]!.panels[0]!.view, 'cards');
  await openRoom();
  assert.equal(await page.eval(`document.querySelector('[data-portal="hn-top"] .portal-view-select').value`), 'cards');
  await page.eval(`const select = document.querySelector('[data-portal="hn-top"] .portal-view-select'); select.value = 'default'; select.dispatchEvent(new Event('change'))`);
  await page.waitFor(`document.querySelector('[data-portal="hn-top"] .items .item')`, 'the default source view');
  assert.deepEqual(page.problems, []);
});

test('browser: river is visible without labs and the toolbar saves the choice', { skip }, async () => {
  await openRoom();
  try {
    assert.equal(await page.eval(`document.querySelector('[data-layout="river"]').hidden`), false);
    await chooseLayout('river');
    await page.waitFor(`document.querySelector('#grid.river .river-feed article')`, 'the river to draw');
    assert.equal(await page.eval(`document.querySelector('[data-layout="river"]').getAttribute('aria-pressed')`), 'true');
    assert.equal((await profiles.get('default')).layout, 'river');
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#grid.river .river-feed article') && !document.querySelector('.skeleton')`, 'the river to reopen');
    assert.deepEqual(page.problems, []);
  } finally {
    await profiles.put('default', room());
  }
});

/** Choose through the same named, keyboard-accessible popover as a person using the room. */
async function chooseLayout(layout: string): Promise<void> {
  await page.waitFor(`!document.getElementById('btnLayout').disabled`, 'layout settings to finish saving');
  await page.click('#btnLayout');
  await page.click(`[data-layout="${layout}"]`);
  await page.waitFor(`!document.getElementById('btnLayout').disabled`, 'the layout preference to save');
}

test('browser: all three designs reopen, adapt to narrow themes, and keep the reader and save controls', { skip }, async () => {
  await openRoom();
  try {
    for (const layout of ['catalogue', 'editorial', 'paperback']) {
      await chooseLayout(layout);
      await page.waitFor(`document.querySelector('#grid.${layout} .designed')`, `${layout} to draw`);
      assert.equal((await profiles.get('default')).layout, layout);
      assert.equal(await page.eval(`document.activeElement.id`), 'btnLayout');
      assert.equal(await page.eval(`document.querySelector('#layoutMenu').matches(':popover-open')`), false);
      await page.goto(`${app.base}/preview`);
      await page.waitFor(`document.querySelector('#grid.${layout} .designed') && !document.querySelector('.skeleton')`, `${layout} to reopen`);
      assert.deepEqual(await page.eval(`[...document.querySelectorAll('[data-portal]')].map(n => n.dataset.portal)`), ['hn-top', 'gh-mcp', 'simonw', 'saved', 'docs']);
      for (const width of [320, 754, 1280]) for (const theme of ['light', 'dark']) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await page.waitFor(`document.documentElement.dataset.theme === '${theme}'`, 'the room theme to change');
        assert.equal(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), true, `${layout} fits ${width}px in ${theme}`);
        assert.equal(await page.eval(`Boolean(document.querySelector('#grid button button, #grid button a'))`), false, 'actions stay outside the opening button');
      }
      await page.click('[data-portal="saved"] .item-main');
      await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('#reader h1')?.textContent.includes('PS5')`, 'the article to open');
      await page.click('#readerControls [aria-label="Back to your room"]');
      await page.waitFor(`!document.getElementById('grid').hidden`, 'the chosen layout to return');
      assert.equal(await page.eval(`document.querySelector('[data-portal="saved"] [data-save-url]').getAttribute('aria-pressed')`), 'true');
      assert.deepEqual(page.problems, []);
    }
  } finally {
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await profiles.put('default', room());
  }
});

test('browser: the original layouts retain opening, saving and reachable controls on narrow screens', { skip }, async () => {
  await openRoom();
  try {
    for (const layout of ['columns', 'shelves', 'river']) {
      await chooseLayout(layout);
      await page.waitFor(`document.querySelector('#grid.${layout}') && !document.querySelector('.skeleton')`, `${layout} to draw`);
      assert.equal((await profiles.get('default')).layout, layout);
      for (const width of [320, 754, 1280]) for (const theme of ['light', 'dark']) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await page.waitFor(`document.documentElement.dataset.theme === '${theme}'`, 'the theme to change');
        assert.equal(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), true, `${layout} fits ${width}px in ${theme}`);
        assert.equal(await page.eval(`Boolean(document.querySelector('#grid button button, #grid button a'))`), false);
        if (layout === 'shelves') {
          assert.equal(await page.eval(`[...document.querySelectorAll('.card')].every(card => {
            const box = card.getBoundingClientRect();
            const cover = card.querySelector('.thumb').getBoundingClientRect();
            return Math.abs(cover.top - box.top - 1) < 1 && [...card.querySelectorAll('.item-meta button')].every(button => {
              const rect = button.getBoundingClientRect();
              return rect.left >= box.left && rect.right <= box.right && rect.bottom <= box.bottom;
            });
          })`), true, 'cover strips align and actions fit inside every card');
          await page.waitFor(`document.querySelector('[data-portal="saved"] [aria-label="Scroll Saved left"]').disabled`, 'the left edge to disable its arrow');
          assert.equal(await page.eval(`document.querySelector('[data-portal="saved"] [aria-label="Scroll Saved right"]').disabled`), true, 'a single saved card has no empty scrolling action');
          assert.ok(await page.eval(`Boolean(document.querySelector('[data-portal="saved"] [aria-label="Share to your space"]'))`), 'saved stories keep their share action');
        }
      }
      const main = layout === 'shelves' ? '.card-main' : '.item-main';
      const saved = layout === 'river' ? `article:has([data-save-url="${ARTICLE}"])` : '[data-portal="saved"]';
      await page.click(`${saved} ${main}`);
      await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('#reader h1')?.textContent.includes('PS5')`, 'the article to open');
      await page.click('#readerControls [aria-label="Back to your room"]');
      await page.waitFor(`!document.getElementById('grid').hidden`, 'the chosen layout to return');
      await page.waitFor(`document.querySelector('.continue-reading')?.getAttribute('aria-busy') === 'false'`, 'reading history to settle before measuring the save button');
      await page.click(`${saved} [data-save-url="${ARTICLE}"]`);
      await page.waitFor(`!document.querySelector('#grid [data-save-url="${ARTICLE}"][aria-pressed="true"]')`, 'the save to be removed').catch(async (error) => {
        const observed = await page.eval(`JSON.stringify({readerHidden:document.getElementById('reader').hidden,toast:document.getElementById('toast').textContent,buttons:[...document.querySelectorAll('[data-save-url="${ARTICLE}"]')].map(b=>({pressed:b.getAttribute('aria-pressed'),box:b.getBoundingClientRect()}))})`);
        throw new Error(`${layout}: ${error.message}; ${observed}`);
      });
      assert.equal((await profiles.get('default')).saved.some(item => item.url === ARTICLE), false);
      await tool('save_item', { url: ARTICLE, title: 'Hijacking the PS5' });
      await page.goto(`${app.base}/preview`);
      await page.waitFor(`document.querySelector('#grid.${layout} [data-save-url="${ARTICLE}"]') && !document.querySelector('.skeleton')`, 'the chosen layout to reopen');
      assert.deepEqual(page.problems, []);
    }
  } finally {
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await profiles.put('default', room());
  }
});

test('browser: a rejected layout preference restores the previous room and keeps the chooser usable', { skip }, async () => {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const originalFetch = window.fetch;
    window.fetch = (input, options) => {
      const call = options?.body && typeof options.body === 'string' ? JSON.parse(options.body) : null;
      if (call?.params?.name === 'arrange_room') return Promise.resolve(Response.json({ jsonrpc: '2.0', id: call.id, result: { isError: true, content: [{ type: 'text', text: 'Fixture save refused' }] } }));
      return originalFetch(input, options);
    };` });
  try {
    await openRoom();
    await chooseLayout('paperback');
    assert.equal(await page.eval(`document.querySelector('#grid').classList.contains('paperback')`), false);
    assert.equal(await page.eval(`document.getElementById('btnLayout').textContent`), 'Layout: Columns');
    assert.equal((await profiles.get('default')).layout, 'columns');
    assert.match(await page.eval<string>(`document.getElementById('toast').textContent`), /Couldn't save: Fixture save refused/);
    assert.equal(await page.eval(`document.activeElement.id`), 'btnLayout');
    await page.click('#btnLayout');
    assert.equal(await page.eval(`document.querySelector('[data-layout="paperback"]').disabled`), false);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
});

test('browser: an item opens in the reader, and home returns to the room', { skip }, async () => {
  await openRoom();
  await page.click('[data-portal="saved"] .item-main');
  const title = await page.waitFor<string>(`!document.getElementById('reader').hidden && document.querySelector('#reader h1')?.textContent`, 'the reader to show the article');
  assert.match(title, /PS5/);
  const paragraphs = await page.waitFor<number>(`document.querySelectorAll('#reader .body p').length`, 'the article body');
  assert.ok(paragraphs >= 3, `the article's text is shown (${paragraphs} paragraphs)`);
  assert.ok(await page.eval(`(() => { const r = document.querySelector('#reader').getBoundingClientRect(), t = document.querySelector('.reader-top').getBoundingClientRect(), b = document.querySelector('.bar').getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 1 && t.width === b.width && t.top === Math.max(b.bottom, document.querySelector('.experience-nav').getBoundingClientRect().bottom) && r.top === t.bottom; })()`), 'preview reader fills the viewport below the two full-width action rows');
  await page.click('#readerControls [aria-label="Back to your room"]');
  await page.waitFor(`!document.getElementById('grid').hidden`, 'the room to come back');
  assert.deepEqual(page.problems, []);
});

/** The reading record for the article, once `ready` says it's there (or the last one seen, after 10 seconds). */
async function readingWhen(ready: (r: any) => boolean, url = ARTICLE): Promise<any> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const r = (await tool('get_reading', { url })).reading;
    if ((r && ready(r)) || Date.now() > deadline) return r;
    await new Promise((done) => setTimeout(done, 250));   // each call spends the budget the room needs too
  }
}

/** A tool called straight over /mcp, as the model would. */
async function tool(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return (await res.json()).result.structuredContent;
}

test('browser: reader and source controls stack below the main toolbar while scrolling, including narrow screens and larger text', { skip }, async () => {
  const host = await attachHost();
  const saved = [{ url: LONG_ARTICLE, title: 'A long read', savedAt: '2026-09-01T00:00:00.000Z' },
    ...Array.from({ length: 25 }, (_, i) => ({ url: `https://example.com/sticky-${i}`, title: `Saved ${i}`, savedAt: '2026-09-01T00:00:00.000Z' }))];
  await profiles.put('default', validateProfile({ ...room(), saved }));
  const stack = (selector: string) => page.waitFor(`(() => {
    const row = document.querySelector(${JSON.stringify(selector)}), r = row?.getBoundingClientRect();
    if (!r) return false;
    const full = document.documentElement.classList.contains('fullscreen');
    const edge = ${JSON.stringify(selector)} === '.level-head' ? document.getElementById('mainBar').getBoundingClientRect().bottom : Math.max(document.getElementById('mainBar').getBoundingClientRect().bottom, document.querySelector('.experience-nav').getBoundingClientRect().bottom);
    const buttons = [...row.querySelectorAll('button')].filter((b) => b.checkVisibility());
    const reachable = buttons.every((b) => { const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    return Math.abs(r.top - edge) < 2 && reachable;
  })()`, `${selector} to remain visible below its toolbar`).catch(async (error) => {
    const geometry = await page.eval(`JSON.stringify({ row: document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(), bar: document.getElementById('mainBar').getBoundingClientRect(), reader: document.getElementById('reader').getBoundingClientRect(), scroll: document.getElementById('reader').scrollTop, full: document.documentElement.classList.contains('fullscreen') })`);
    throw new Error(`${error.message}; ${geometry}`);
  });
  try {
    for (const width of [360, 1000]) for (const mode of ['inline', 'fullscreen']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await openRoom();
      await page.eval(`document.documentElement.style.fontSize = '200%'; window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: ${JSON.stringify(mode)} } }, '*')`);
      await page.waitFor(`document.documentElement.classList.contains('fullscreen') === ${mode === 'fullscreen'}`, 'the display mode');
      await page.click('[data-portal="saved"] .portal-title');
      await page.waitFor(`document.querySelector('.level')`, 'the source view');
      if (mode === 'inline') {
        await page.click('.level .fp-more');
        await page.click('.level .fp-more');
      }
      await page.eval(`window.scrollTo(0, 500)`);
      await stack('.level-head');
      await page.click('.level .item-main');
      await page.waitFor(`document.querySelectorAll('#reader .body p').length === 80`, 'the long article');
      await page.eval(`document.getElementById('reader').scrollTop = 500`);
      await stack('.reader-top');
      // The controls remain useful at the scrolled position, rather than just looking sticky.
      await page.click('#readerControls .reader-top [aria-label="Back to your room"]');
      await page.waitFor(`document.getElementById('reader').hidden && document.querySelector('.level')`, 'back at the source');
      await page.eval(`window.scrollTo(0, 500)`);
      await stack('.level-head');
      await page.click('.level-head [aria-label="Back to your room"]');
      await page.waitFor(`!document.querySelector('.level')`, 'back in the room');
      assert.deepEqual(page.problems, []);
    }
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: host });
    await profiles.put('default', room());
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
});

test('browser: docs anchors stay below the reader controls and contents do not overlap them', { skip }, async () => {
  const host = await attachHost();
  try {
    await openRoom();
    await page.click('[data-portal="docs"] .item-main');
    await page.waitFor(`document.querySelector('#reader .body')`, 'the docs viewer');
    // Open a long page through the viewer's existing docs navigation.
    await page.eval(`[...document.querySelectorAll('.docs-toc a')].find((n) => n.textContent === 'Deploy').click()`);
    await page.waitFor(`document.querySelectorAll('#reader .body h2').length === 45`, 'the long docs page');
    for (const mode of ['inline', 'fullscreen']) {
      await page.eval(`window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: ${JSON.stringify(mode)} } }, '*')`);
      await page.waitFor(`document.documentElement.classList.contains('fullscreen') === ${mode === 'fullscreen'}`, 'the docs display mode');
      await page.eval(`document.querySelectorAll('#reader .body h2')[20].scrollIntoView({ block: 'start' })`);
      await page.waitFor(`(() => {
        const tools = document.querySelector('.reader-top').getBoundingClientRect();
        const heading = document.querySelectorAll('#reader .body h2')[20].getBoundingClientRect();
        const contents = document.querySelector('.docs-toc').getBoundingClientRect();
        return heading.top >= tools.bottom && contents.top >= tools.bottom;
      })()`, 'the docs heading and contents to stay below the controls');
    }
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: host });
  }
});

test('browser: narrow docs keep heading navigation and Contents brings search into view without leaving the reader', { skip }, async () => {
  try {
    await openRoom();
    await page.click('[data-portal="docs"] .item-main');
    await page.waitFor(`document.querySelector('.docs-toc a[data-url="${DOCS}/deploy.md"]')`, 'docs contents');
    await page.eval(`document.querySelector('.docs-toc a[data-url="${DOCS}/deploy.md"]').click()`);
    await page.waitFor(`document.querySelectorAll('.docs-page .body h2').length === 45`, 'long docs page');
    assert.equal(await page.eval(`document.querySelector('.docs-toc a.current').getAttribute('aria-current')`), 'page');
    for (const width of [900, 360]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: false });
      await page.click('.docs-outline summary');
      await page.click('.docs-outline a:last-child');
      await page.waitFor(`document.activeElement.textContent === 'Step 45'`, 'the outline destination to receive focus');
      assert.ok(await page.eval<boolean>(`document.querySelector('.body h2:last-of-type').getBoundingClientRect().top >= document.querySelector('.reader-top').getBoundingClientRect().bottom - 1`));
    }
    await page.click('.docs-toggle');
    assert.equal(await page.eval(`document.querySelector('.docs-toggle').getAttribute('aria-expanded')`), 'true');
    assert.equal(await page.eval(`document.activeElement.className`), 'docs-search');
    assert.ok(await page.eval<boolean>(`(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom < innerHeight; })()`));
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    assert.equal(await page.eval(`document.getElementById('reader').hidden`), false);
    assert.equal(await page.eval(`document.querySelector('.docs-toggle').getAttribute('aria-expanded')`), 'false');
    assert.equal(await page.eval(`document.activeElement.className`), 'btn docs-toggle');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
});

test('browser: the reader records opening and position, resumes there, and marks read only when asked', { skip }, async () => {
  await readings.deleteAll('default');
  const openArticle = async () => {
    await openRoom();
    await page.eval(`document.getElementById('reader').style.maxHeight = '220px'`);   // set the reader window before any reading measurement
    await page.click('[data-portal="saved"] .item-main');
    await page.waitFor(`document.querySelector('#reader .mark-read:not([disabled])')`, 'the article and its ready Mark as read button');
  };
  await openArticle();
  const opened = await readingWhen((r) => r.status === 'opened');
  assert.equal(opened?.status, 'opened', 'opening records it, no model involved');
  assert.equal(opened.readAt, undefined);

  // Move to an actual passage: footer and toolbar sizes aren't part of reading progress.
  const scrolled = await page.eval<number>(`(() => { const r = document.getElementById('reader'); const blocks = document.querySelector('#reader .body').children; const target = blocks[Math.floor(blocks.length / 3)]; r.scrollTop += target.getBoundingClientRect().top - r.getBoundingClientRect().top; return r.scrollTop; })()`);
  assert.ok(scrolled > 0, 'the article is long enough to scroll');
  await page.waitFor(`Number(document.querySelector('#reader .body')?.dataset.furthest) > 0`, 'the reader to note how far it got');
  await page.click('#readerControls [aria-label="Back to your room"]');
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
  const read = await readingWhen((r) => r.status === 'read');
  assert.equal(read.status, 'read');
  assert.ok(read.readAt);
  assert.equal((await tool('list_reading', {})).reading.some((r: any) => r.url === ARTICLE), false, 'the finished article is not "in the middle of"');
  assert.deepEqual(page.problems, []);
});

test('browser: viewing all blocks keeps reading unfinished and can still advance the resume anchor in a smaller reader', { skip }, async () => {
  await tool('record_reading', { url: ARTICLE, status: 'opened', title: 'PS5', progress: 1, anchor: { block: 0 } });
  await openRoom();
  await page.eval(`document.getElementById('reader').style.maxHeight = '220px'`);
  await page.click('[data-portal="saved"] .item-main');
  await page.waitFor(`document.querySelector('#reader .mark-read:not([disabled])')`, 'ready reading');
  await page.eval(`(() => { const reader = document.getElementById('reader'); reader.scrollTop = (reader.scrollHeight - reader.clientHeight) / 2; })()`);
  await page.waitFor(`Number(document.querySelector('#reader .body').dataset.furthest) > 0`, 'the anchor to advance despite full progress');
  await page.eval(`document.querySelector('#readerControls [aria-label="Back to your room"]').click()`);
  const left = await readingWhen((reading) => reading.anchor?.block > 0);
  assert.equal(left.progress, 1);
  assert.equal(left.status, 'opened', 'only explicit completion marks the page read');
  assert.deepEqual(page.problems, []);
});

test('browser: Continue reading survives a fresh view, opens docs at its saved passage, and removes completed items', { skip }, async () => {
  const directIndex = room();
  const docs = directIndex.columns.flatMap((column) => column.panels).find((portal) => portal.id === 'docs');
  assert.ok(docs?.source === 'docs');
  docs.config.url = `${DOCS}/llms.txt`;
  await profiles.put('default', directIndex);
  const url = `${DOCS}/deploy.md`;
  await tool('record_reading', { url, title: 'Deploy', status: 'opened', anchor: { block: 20 }, progress: 0.35 });
  // Seen-only and explicitly finished pages stay out of Continue reading.
  await tool('record_reading', { url: `${DOCS}/first-steps.md`, title: 'First steps', status: 'seen' });
  await tool('record_reading', { url: ARTICLE, title: 'PS5', status: 'read' });
  await openRoom();
  await page.waitFor(`document.querySelector('.continue-item')`, 'recent unfinished reading');
  assert.match(await page.eval<string>(`document.querySelector('.continue-reading').textContent`), /Deploy.*35%/s);
  assert.equal(await page.eval<string>(`document.querySelector('.continue-source').textContent`), 'docs.example.com');
  assert.equal(await page.eval<string>(`document.querySelector('.continue-progress > span').style.width`), '35%');
  assert.doesNotMatch(await page.eval<string>(`document.querySelector('.continue-reading').textContent`), /First steps|PS5/);
  await page.click('.continue-item');
  await page.waitFor(`document.querySelector('.docs-page .mark-read:not([disabled])') && document.getElementById('toast').textContent.includes('where you left off')`, 'the docs page to resume');
  assert.match(await page.eval<string>(`document.querySelector('.docs-page .docs-crumb').textContent`), /Example Docs/);
  assert.ok(await page.eval<number>(`document.getElementById('reader').scrollTop || window.scrollY`) > 0);
  await page.eval(`document.getElementById('reader').scrollTop += 500`);
  await page.waitFor(`Number(document.querySelector('.docs-page .body').dataset.furthest) > 20`, 'new docs reading progress');
  await page.eval(`document.querySelector('#readerControls [aria-label="Back to your room"]').click()`);
  const left = await readingWhen((r) => r.anchor?.block > 20, url);
  assert.equal(left.status, 'opened', 'scrolling is not completion');
  await openRoom();
  await page.waitFor(`document.querySelector('.continue-item')`, 'unfinished docs after reopening');
  await page.click('.continue-item');
  await page.waitFor(`document.querySelector('.docs-page .mark-read:not([disabled])')`, 'reading to be ready');
  await page.eval(`document.querySelector('.docs-page .mark-read').click()`);
  await readingWhen((r) => r.status === 'read', url);
  await page.eval(`document.querySelector('#readerControls [aria-label="Back to your room"]').click()`);
  await page.waitFor(`document.querySelector('.continue-reading').hidden`, 'finished reading to leave the strip');
  assert.deepEqual(page.problems, []);
  await profiles.put('default', room());
});

test('browser: Continue reading resumes a GitHub docs page outside the portal’s current section', { skip }, async () => {
  const githubRoom = room();
  const docs = githubRoom.columns.flatMap((column) => column.panels).find((portal) => portal.id === 'docs');
  assert.ok(docs?.source === 'docs');
  docs.config = { url: 'https://github.com/acme/manual/tree/HEAD', toc: { kind: 'github', url: 'https://github.com/acme/manual/tree/HEAD/docs' }, section: 'acme/manual', limit: 12 };
  await profiles.put('default', githubRoom);
  try {
    await tool('record_reading', { url: GITHUB_DOC, title: 'Deploy', status: 'opened', anchor: { block: 20 }, progress: 0.35 });
    await openRoom();
    assert.equal(await page.eval<boolean>(`Boolean(document.querySelector('[data-portal="docs"] .error'))`), false, 'the selected GitHub docs section loads');
    assert.doesNotMatch(await page.eval<string>(`document.querySelector('[data-portal="docs"]').textContent`), /Deploy/, 'the saved page is absent from visible portal links');
    await page.waitFor(`document.querySelector('.continue-item')`, 'unfinished GitHub docs');
    await page.click('.continue-item');
    await page.waitFor(`document.querySelector('.docs-page .mark-read:not([disabled])') && document.getElementById('toast').textContent.includes('where you left off')`, 'GitHub docs to resume through the docs viewer');
    assert.equal(await page.eval<string>(`document.querySelector('.docs-page h1').textContent`), 'Deploy');
    assert.ok(await page.eval<number>(`document.getElementById('reader').scrollTop || window.scrollY`) > 0);
    assert.deepEqual(page.problems, []);
  } finally {
    await tool('record_reading', { url: GITHUB_DOC, status: 'read' });
    await profiles.put('default', room());
  }
});

test('browser: docs hash navigation takes precedence over the saved position and page changes save progress', { skip }, async () => {
  const url = `${DOCS}/deploy.md`;
  await tool('record_reading', { url, title: 'Deploy', status: 'opened', anchor: { block: 70 }, progress: 0.9 });
  await openRoom();
  await page.click('[data-portal="docs"] .item-main');
  await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('.docs-page h1')?.textContent === 'Install' && document.querySelector('.docs-page .mark-read:not([disabled])')`, 'the initial docs page');
  await page.eval(`document.querySelector('.docs-page .body a').click()`);
  await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('.docs-page h1')?.textContent === 'Deploy' && !document.querySelector('.docs-page .mark-read').disabled`, 'Deploy page');
  assert.ok(await page.eval<number>(`document.getElementById('reader').scrollTop || window.scrollY`) < 500, 'the explicit first heading takes precedence over saved block 70');
  assert.equal((await tool('get_reading', { url })).reading.anchor.block, 70, 'jumping back does not discard the furthest saved passage');
  await page.eval(`document.querySelector('#readerControls [aria-label="Back to your room"]').click()`);
  // Back refreshes the unfinished-reading strip. Wait for its new height before
  // measuring another real pointer click; retained hidden docs are not readiness.
  await page.waitFor(`document.getElementById('reader').hidden && !document.getElementById('grid').hidden && document.querySelector('.continue-reading')?.getAttribute('aria-busy') === 'false'`, 'the room and refreshed reading strip after Back');
  await tool('record_reading', { url, status: 'opened', anchor: { block: 0 }, progress: 0 });
  await page.click('[data-portal="docs"] .item-main');
  await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('.docs-page h1')?.textContent === 'Install' && document.querySelector('.docs-page .mark-read:not([disabled])')`, 'docs ready');
  await page.eval(`document.querySelector('.docs-toc a[data-url="${url}"]').click()`);
  await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('.docs-page h1')?.textContent === 'Deploy' && !document.querySelector('.docs-page .mark-read').disabled`, 'Deploy ready');
  assert.equal((await tool('get_reading', { url })).reading.progress, 0, 'the navigation fixture starts at the beginning');
  await page.eval(`document.getElementById('reader').style.maxHeight = '220px'; document.getElementById('reader').scrollTop = 800`);
  await page.waitFor(`Number(document.querySelector('.docs-page .body').dataset.furthest) > 0`, 'the docs position').catch(async (error) => {
    const details = await page.eval(`({ top: document.getElementById('reader').scrollTop, reader: document.getElementById('reader').getBoundingClientRect().toJSON(), body: document.querySelector('.docs-page .body').getBoundingClientRect().toJSON(), data: document.querySelector('.docs-page .body').dataset })`);
    throw new Error(`${error.message}: ${JSON.stringify(details)}`);
  });
  await page.eval(`document.querySelector('.docs-pager .prev').click()`);
  await page.waitFor(`document.querySelector('.docs-page h1')?.textContent === 'Install' && !document.querySelector('.docs-page .mark-read').disabled`, 'previous page');
  assert.ok((await readingWhen((r) => r.anchor?.block > 0, url)).anchor.block > 0);
  assert.deepEqual(page.problems, []);
});

test('browser: inline columns have visible paging, bounded items and no nested vertical scrolling; fullscreen keeps all items', { skip }, async () => {
  const saved = Array.from({ length: 14 }, (_, i) => ({ url: `https://example.com/item-${i}`, title: `Item ${i}`, savedAt: '2026-09-01T00:00:00.000Z' }));
  await profiles.put('default', validateProfile({ ...room(), saved }));
  // Exercise the actual bridge as an MCP host, including live mode notifications.
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, '__MCPORTAL_DEV__', { get: () => undefined, set: () => {} });
    window.addEventListener('message', async (event) => {
      const msg = event.data;
      if (!msg?.id || !msg.method) return;
      event.stopImmediatePropagation();
      let result;
      if (msg.method === 'ui/initialize') result = { hostCapabilities: { serverTools: true, updateModelContext: true }, hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } };
      else if (msg.method === 'tools/call') {
        const response = await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: msg.id, method: 'tools/call', params: msg.params }) });
        result = (await response.json()).result;
      } else result = {};
      window.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
    });` });
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 1, mobile: false });
    await openRoom();
    await page.waitFor(`document.querySelector('.lane-controls:not([hidden])')`, 'visible column navigation');
    assert.equal(await page.eval(`document.querySelectorAll('[data-portal="saved"] .items > li').length`), 5);
    const scrolling = await page.eval<string[]>(`[...document.querySelectorAll('#grid, #grid *')].filter((n) => /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1).map((n) => n.className)`);
    assert.deepEqual(scrolling, [], 'inline portals grow to their content');
    await page.click('.lane-controls [aria-label="Next column"]');
    await page.waitFor(`document.getElementById('grid').scrollLeft > 20`, 'next column');
    await page.click('.lane-page[aria-label="Column 3"]');
    await page.click('[data-portal="saved"] .portal-more');
    await page.waitFor(`document.querySelector('[data-portal-level="saved"]')`, 'more opens the portal level');
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await page.waitFor(`document.querySelector('[data-portal="saved"] .portal-more') && !document.querySelector('.level')`, 'return to bounded portal');
    await page.eval(`window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } }, '*')`);
    await page.waitFor(`document.documentElement.classList.contains('fullscreen')`, 'fullscreen');
    assert.equal(await page.eval(`document.querySelectorAll('[data-portal="saved"] .items > li').length`), 14, 'fullscreen shows the full list');
    assert.equal(await page.eval(`document.querySelector('.lane-controls')`), null);
    await page.eval(`window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'inline' } }, '*')`);
    await page.waitFor(`!document.documentElement.classList.contains('fullscreen') && document.querySelector('.lane-controls')`, 'back to inline');
    assert.equal(await page.eval(`document.querySelectorAll('[data-portal="saved"] .items > li').length`), 5);
    await profiles.put('default', validateProfile({ ...room(), layout: 'shelves', saved }));
    await openRoom();
    assert.equal(await page.eval(`getComputedStyle(document.querySelector('.shelf-row')).scrollSnapType`), 'x mandatory');
    await page.click('[data-portal="saved"] [aria-label="Scroll Saved right"]');
    await page.waitFor(`document.querySelector('[data-portal="saved"] .shelf-row').scrollLeft > 0`, 'the always-visible shelf arrow');
    assert.deepEqual(await page.eval<string[]>(`[...document.querySelectorAll('#grid, #grid *')].filter((n) => /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1).map((n) => n.className)`), [], 'shelves have no nested vertical scroller');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await profiles.put('default', room());
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
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
  assert.ok(await page.eval(`(() => { const r = document.querySelector('#reader').getBoundingClientRect(), t = document.querySelector('.reader-top').getBoundingClientRect(), b = document.querySelector('.bar').getBoundingClientRect(); return !document.querySelector('#reader .reader-top') && t.width === b.width && Math.abs(r.bottom - innerHeight) < 1 && document.querySelector('.docs-page h1').getBoundingClientRect().top >= t.bottom; })()`), 'docs share the full-width external action row and available viewport height');
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
  await page.eval(`(() => { const section = document.querySelector('.docs-toc a.idx').closest('details'); if (!section.open) section.querySelector('summary').click(); })()`);   // leave an already-open section open
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

test('browser: the river merges the room into one stream: picks, new, a divider, seen; duplicates join, runs fold, pages count units', { skip }, async () => {
  // The first two HN stories new; the agent picks the second. Saved holds a copy of the first
  // (so it joins that story) and twelve old items, which run together at the end and fold.
  await profiles.put('default', validateProfile({ ...room(), layout: 'river' }));
  const hnItems = (await tool('open_room', {})).portals.find((p: any) => p.portalId === 'hn-top').items;
  const saved = [{ url: `${hnItems[0].url}#comments`, title: 'A copy', savedAt: '2026-09-01T00:00:00.000Z' },
    ...Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/saved-${i}`, title: `Saved ${i}`, savedAt: '2026-09-01T00:00:00.000Z' }))];
  await profiles.put('default', validateProfile({ ...room(), layout: 'river', saved }));
  await seen.deleteAll('default');
  await seen.mark('default', [{ portalId: 'hn-top', itemIds: hnItems.slice(2).map((i: any) => i.id) }]);
  const [first, second] = (await tool('list_new_items', { portals: ['hn-top'] })).items;
  await tool('show_highlights', { title: 'Morning edition', picks: [{ ref: second.ref, why: 'The one you asked about.' }] });
  const units = () => page.eval<number>(`document.querySelectorAll('.river-feed > article, .river-feed > .river-fold').length`);
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#grid.river .river-feed article') && !document.querySelector('.skeleton')`, 'the river');
    assert.equal(await page.eval(`document.querySelector('.river-picks .fp-label').textContent`), 'Morning edition');
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('.river-picks .item-title')].map((n) => n.textContent)`), [`New${second.item.title}`], "the agent's pick leads, apart from the stream");
    assert.match(await page.eval<string>(`document.querySelector('.river-picks .item-why').textContent`), /The one you asked about\./);
    // New first, then the divider, then what's been seen; the pick isn't repeated.
    const feed = await page.eval<string[]>(`[...document.querySelectorAll('.river-feed > *')].map((n) => n.matches('article') ? n.querySelector('.item-title').textContent : n.className)`);
    assert.equal(feed[0], `New${first.item.title}`);
    assert.equal(feed[1], 'river-divider');
    assert.ok(!feed.some((t) => t.endsWith(second.item.title)), 'the pick is not repeated');
    assert.match(await page.eval<string>(`document.querySelector('.river-feed > article .item-from').textContent`), /also on Saved/, 'the saved copy joins the story');
    assert.equal(await page.eval(`document.querySelector('.river-feed').getAttribute('role')`), 'feed');
    assert.equal(await page.eval(`document.querySelector('.river-feed > article').getAttribute('aria-posinset')`), '2', 'numbered after the pick');
    assert.match(await page.eval<string>(`document.querySelector('.river-aside').textContent`), /Also in your room: Example Docs/, 'docs are named, not merged');
    assert.equal(await page.eval(`document.querySelectorAll('.mi.reblog').length`), 0, 'ghost mode reblogs nothing');
    // A page is ten units; the next page brings the fold, which opens in place.
    assert.equal(await units(), 10);
    assert.match(await page.eval<string>(`document.querySelector('.river-more .fp-more').textContent`), /^2 more of 2$/);
    await page.click('.river-more .fp-more');
    assert.equal(await units(), 12);
    assert.equal(await page.eval(`document.querySelector('.river-fold').textContent`), '9 more from Saved');
    assert.equal(await page.eval(`document.querySelectorAll('.river-feed [data-story^="saved"]').length`), 3, 'three of the run, then the fold');
    await page.click('.river-fold .link-btn');
    assert.equal(await page.eval(`document.querySelectorAll('.river-feed [data-story^="saved"]').length`), 12);
    assert.equal(await page.eval(`document.activeElement.closest('article')?.dataset.story`), `saved\nhttps://example.com/saved-3`, 'focus moves to the first revealed story');
    assert.equal(await page.eval(`document.querySelector('.river-end').firstChild.textContent`), "That's everything your portals fetched.");
    // j and k move between stories.
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }))`);
    assert.equal(await page.eval(`document.activeElement.closest('article')?.dataset.story`), `saved\nhttps://example.com/saved-2`);
    const scrolling = await page.eval<string[]>(`[...document.querySelectorAll('#grid, #grid *')].filter((n) => { const s = getComputedStyle(n); return (/auto|scroll/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) || (/auto|scroll/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1); }).map((n) => n.className)`);
    assert.deepEqual(scrolling, [], 'nothing scrolls inside the river');
    assert.deepEqual(page.problems, []);
  } finally {
    await profiles.put('default', room());
  }
});

test('browser: river pages end on a separator that takes focus, and a refresh waits behind the arrivals button without moving anything', { skip }, async () => {
  // Twenty-five old saved items: after the feeds' stories they run together and fold.
  const saved = Array.from({ length: 25 }, (_, i) => ({ url: `https://example.com/saved-${i}`, title: `Saved ${i}`, savedAt: new Date(Date.UTC(2026, 7, 25 - i)).toISOString() }));
  await profiles.put('default', validateProfile({ ...room(), layout: 'river', saved }));
  await seen.deleteAll('default');
  const stories = () => page.eval<string[]>(`[...document.querySelectorAll('.river-feed > article')].map((n) => n.dataset.story)`);
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#grid.river .river-feed article') && !document.querySelector('.skeleton')`, 'the river');
    // The feeds' stories, three saved and a fold: page 2 holds the last few.
    await page.click('.river-more .fp-more');
    assert.equal(await page.eval(`document.activeElement.dataset.from`), '11', 'focus goes to the new page');
    assert.match(await page.eval<string>(`document.activeElement.textContent`), /^Stories 11 to 1\d$/);
    await page.click('.river-fold .link-btn');
    await page.click('.river-more .fp-more');
    assert.equal(await page.eval(`document.activeElement.dataset.from`), '21');
    assert.equal(await page.eval(`document.activeElement.textContent`), 'Stories 21 to 30');
    assert.equal(await page.eval(`document.querySelectorAll('.river-page').length`), 2);
    // Something arrives; refreshing doesn't move a single story, it waits behind a button.
    const before = await stories();
    await tool('save_item', { url: 'https://example.com/arrived', title: 'Arrived' });
    await page.click('#btnRefresh');
    const arrived = await page.waitFor<string>(`document.querySelector('.river-arrived')?.textContent`, 'the arrivals button');
    assert.equal(arrived, '1 new story since you started');
    assert.deepEqual(await stories(), before, 'nothing on screen moved');
    await page.click('.river-arrived');
    await page.waitFor(`!document.querySelector('.river-arrived')`, 'the arrivals merged in');
    assert.ok((await stories()).includes('saved\nhttps://example.com/arrived'), 'the new story is in the river');
    // Fullscreen pages are twenty, and the next loads itself as the end nears. The river
    // shows what it showed (thirty units) when the mode changes.
    await page.eval(`document.documentElement.classList.add('fullscreen')`);
    await page.click('#btnRefresh');
    assert.equal(await page.eval(`document.querySelectorAll('.river-feed > article, .river-feed > .river-fold').length`), 30);
    const units = () => page.eval<number>(`document.querySelectorAll('.river-feed > article, .river-feed > .river-fold').length`);
    const shownBefore = await units();
    await page.eval(`window.scrollTo(0, document.body.scrollHeight)`);
    await page.waitFor(`document.querySelectorAll('.river-feed > article, .river-feed > .river-fold').length > ${shownBefore}`, 'the next page to load itself');
    await page.eval(`document.documentElement.classList.remove('fullscreen')`);
    assert.deepEqual(page.problems, []);
  } finally {
    await profiles.put('default', room());
  }
});

test("browser: in the river, follows' shares and reblogs join their stories with credit and a two-note trail; the reblog menu reblogs, undoes, and nudges to read first", { skip }, async () => {
  // The test server has no social layer: the page's open_room result gets a Following portal
  // and a signed-in identity on the way in, and share/unshare are answered in the page.
  // @ana shares HN's top story; @ben and @dee reblog @cy's post; @eve reblogged a removed
  // post; @fay's post can't be reblogged.
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.fetch;
    window.__calls = [];
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url, init) => {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      const name = body && body.params && body.params.name;
      if (url === '/mcp' && (name === 'share' || name === 'unshare')) {
        window.__calls.push({ name, args: body.params.arguments });
        return answer(name === 'share' ? { content: [], structuredContent: { share: { id: 's_mine', audience: body.params.arguments.audience } } } : { content: [], structuredContent: { removed: true } });
      }
      const res = await real(url, init);
      if (name !== 'open_room') return res;
      const json = await res.json();
      const room = json.result && json.result.structuredContent;
      const hn = room && room.portals && room.portals.find((p) => p.portalId === 'hn-top');
      if (hn) {
        const now = new Date().toISOString();
        const share = (id, extra) => ({ id, kind: 'link', canReblog: true, ...extra });
        const plain = room.portals.find((p) => p.portalId === 'gh-mcp')?.items[0];
        if (plain) { plain.summary = 'Feed source context'; plain.image = { url: 'https://img.example.com/cover.png', kind: 'thumb' }; }
        room.identity = { mode: 'hosted', handle: 'reader' };

        room.profile.columns.push({ width: 1, panels: [{ id: 'following', source: 'following', title: 'Following', config: {} }] });
        room.portals.push({ portalId: 'following', source: 'following', title: 'Following', provenance: { source: 'following', endpoint: 'shares from people you follow', fetchedAt: now, cached: false, ttlSeconds: 0 }, items: [
          { id: 's_ana', title: hn.items[0].title, url: hn.items[0].url, summary: 'Read the comments.', meta: ['@ana', 'link'], publishedAt: now, share: share('s_ana') },
          { id: 's_ben', title: 'A post by cy', url: 'https://example.com/cy', summary: 'Ben agrees.', meta: ['@ben', 'reblogged @cy', 'link'], publishedAt: now, share: share('s_ben', { description: 'Source context for cy', reblog: { root: 's_cy', by: 'cy', note: "Cy's own words." }, reblogs: 3 }) },
          { id: 's_dee', title: 'A post by cy', url: 'https://example.com/cy', meta: ['@dee', 'reblogged @cy', 'link'], publishedAt: now, share: share('s_dee', { reblog: { root: 's_cy', by: 'cy', note: "Cy's own words." }, reblogs: 3 }) },
          { id: 's_eve', title: 'Gone now', url: 'https://example.com/gone', summary: 'Still worth it.', meta: ['@eve', 'reblogged a removed post', 'link'], publishedAt: now, share: share('s_eve', { reblog: { root: 's_x', removed: 'removed' } }) },
          { id: 's_fay', title: 'Just for fay', url: 'https://example.com/fay', meta: ['@fay', 'link'], publishedAt: now, share: share('s_fay', { canReblog: false }) },
        ] });
      }
      return new Response(JSON.stringify(json), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
  })();` });
  await profiles.put('default', validateProfile({ ...room(), layout: 'river' }));
  const initial = await tool('open_room', {});
  const hnTitle = initial.portals.find((p: any) => p.portalId === 'hn-top').items[0].title;
  const existing = initial.portals.find((p: any) => p.portalId === 'gh-mcp').items[0];
  await profiles.put('default', validateProfile({ ...initial.profile, saved: [...initial.profile.saved, { url: existing.url, title: 'My chosen bookmark title' }] }));
  /** The story with this title. */
  const find = (title: string) => `[...document.querySelectorAll('.river-feed > article')].find((n) => n.querySelector('.item-title').textContent.endsWith(${JSON.stringify(title)}))`;
  const read = (title: string) => page.eval<{ context: string | null; trail: string[]; removed: string | null; from: string; reblog: { label: string; disabled: boolean } | null } | null>(`(() => {
    const node = ${find(title)};
    const b = node && node.querySelector('.mi.reblog');
    return node ? { context: node.querySelector('.story-context')?.textContent ?? null, trail: [...node.querySelectorAll('.story-note')].map((n) => n.textContent), removed: node.querySelector('.story-removed')?.textContent ?? null,
      from: node.querySelector('.item-from').textContent, reblog: b ? { label: b.getAttribute('aria-label'), disabled: b.disabled } : null } : null;
  })()`);
  const menu = () => page.eval<string[]>(`[...document.querySelectorAll('.reblog-menu > [role="menuitem"], .reblog-submit-row > [role="menuitem"]')].map((n) => n.textContent)`);
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#grid.river .river-feed article') && !document.querySelector('.skeleton')`, 'the river');
    const shared = await read(hnTitle);
    assert.equal(shared?.context, '@ana shared', "the share joins HN's story");
    assert.deepEqual(shared?.trail, ['@anaRead the comments.']);
    assert.doesNotMatch(shared?.from ?? '', /Following/);
    const cy = await read('A post by cy');
    assert.equal(cy?.context, '@ben and @dee reblogged @cy', 'two reblogs of one post are one card');
    assert.deepEqual(cy?.trail, ["@cyCy's own words.", '@benBen agrees.'], "the original's note, then a reblog's: two voices");
    assert.equal(cy?.reblog?.label, 'Reblog (3 reblogs)', 'the count pools on the original');
    assert.equal(await page.eval(`${find('A post by cy')}.querySelector('.item-summary').textContent`), 'Source context for cy');
    assert.equal((await read('Gone now'))?.removed, 'The original post was removed.');
    assert.deepEqual((await read('Just for fay'))?.reblog, { label: "You can't reblog this post", disabled: true });

    // The menu: Reblog and Reblog with a note, plus a nudge to read it first.
    await page.eval(`${find('A post by cy')}.querySelector('.mi.reblog').click()`);
    assert.deepEqual(await menu(), ['Reblog', 'Reblog with a note']);
    assert.equal(await page.eval(`document.querySelector('.reblog-menu input:checked').value`), 'everyone', 'quick reblog defaults to Public');
    assert.match(await page.eval<string>(`document.querySelector('.reblog-menu .audience-help').textContent`), /Visible on your Space/);
    assert.equal(await page.eval(`document.activeElement.textContent`), 'Reblog', 'focus moves into the menu');
    await page.waitFor(`document.querySelector('.reblog-nudge')`, 'the read-it-first nudge');
    assert.match(await page.eval<string>(`document.querySelector('.reblog-nudge').textContent`), /You haven't read this yet\. Read it first\?/);
    await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await page.eval(`document.querySelector('.reblog-menu')`), null);
    assert.equal(await page.eval(`document.activeElement.classList.contains('reblog')`), true, 'Escape returns focus to the button');
    await page.eval(`${find('A post by cy')}.querySelector('.mi.reblog').click()`);
    await page.eval(`[...document.querySelectorAll('.reblog-menu [role="menuitem"]')].find((n) => n.textContent === 'Reblog').click()`);
    await page.waitFor(`${find('A post by cy')}.querySelector('.mi.reblog').classList.contains('on')`, 'the reblog to land');
    assert.equal((await read('A post by cy'))?.reblog?.label, 'Undo reblog (4 reblogs)');
    const reblogCall = await page.eval<any>(`window.__calls.at(-1)`);
    assert.match(reblogCall.args.requestKey, /^[\w-]{8,100}$/);
    const {requestKey: _reblogKey, ...reblogArgs} = reblogCall.args;
    assert.deepEqual({name: reblogCall.name, args: reblogArgs}, { name: 'share', args: { reblogOf: 's_ben', audience: 'everyone' } }, "it reblogs the post behind the story with its visible audience");
    assert.match(await page.eval<string>(`document.getElementById('toast').textContent`), /Sent through the portal!/);
    await page.eval(`${find('A post by cy')}.querySelector('.mi.reblog').click()`);
    assert.deepEqual(await menu(), ['Undo reblog']);
    await page.eval(`document.querySelector('.reblog-menu [role="menuitem"]').click()`);
    await page.waitFor(`!${find('A post by cy')}.querySelector('.mi.reblog').classList.contains('on')`, 'the undo');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'unshare', args: { id: 's_mine' } });
    assert.equal((await read('A post by cy'))?.reblog?.label, 'Reblog (3 reblogs)');

    // A story no one has posted: reblogging with a note saves it first, then opens the composer.
    const plain = await page.eval<string>(`[...document.querySelectorAll('.river-feed > article')].find((n) => n.dataset.story.startsWith('gh-mcp')).querySelector('.item-title').textContent`);
    await page.eval(`[...document.querySelectorAll('.river-feed > article')].find((n) => n.dataset.story.startsWith('gh-mcp')).querySelector('.mi.reblog').click()`);
    await page.eval(`document.querySelector('.reblog-menu input[value="followers"]').click()`);
    assert.equal(await page.eval(`document.querySelector('.reblog-menu input:checked').value`), 'followers');
    await page.eval(`[...document.querySelectorAll('.reblog-menu [role="menuitem"]')].find((n) => n.textContent === 'Reblog with a note').click()`);
    await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('#reader .composer')`, 'the composer');
    assert.match(await page.eval<string>(`document.querySelector('#reader .composer').textContent`), new RegExp(`Reblog “${plain.replace(/^New/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}” to your space`));
    const saved = (await tool('open_room', {})).profile.saved;
    assert.ok(saved.length > 1, 'saved first');
    const preview = saved.find((s: any) => s.description === 'Feed source context');
    assert.ok(preview, 'the feed description survives reblogging');
    assert.deepEqual(preview.image, { url: 'https://img.example.com/cover.png', kind: 'thumb' });
    assert.equal(preview.title, 'My chosen bookmark title', 'adding the preview preserves a chosen bookmark title');
    assert.equal(preview.note, undefined, 'source descriptions are not personal notes');
    assert.equal(await page.eval(`document.querySelector('.composer input:checked').value`), 'followers', 'the menu choice carries into the note composer');
    assert.match(await page.eval<string>(`document.querySelector('.composer .audience-help').textContent`), /Hidden from your public Space/);
    await page.click('.composer .row > button');
    await page.waitFor(`document.querySelector('.composer [role="status"]')`, 'the followers reblog');
    assert.equal(await page.eval(`window.__calls.at(-1).args.audience`), 'followers');
    assert.match(await page.eval<string>(`document.querySelector('.composer').textContent`), /Reblogged · Followers only/);
    await page.click('#readerControls .reader-top button');
    await page.eval(`${find('A post by cy')}.querySelector('.mi.reblog').click()`);
    assert.equal(await page.eval(`document.querySelector('.reblog-menu input:checked').value`), 'followers', 'future quick reblogs remember the choice');
    await page.eval(`[...document.querySelectorAll('.reblog-menu [role="menuitem"]')].find((n) => n.textContent === 'Reblog').click()`);
    await page.waitFor(`${find('A post by cy')}.querySelector('.mi.reblog').classList.contains('on')`, 'the followers quick reblog');
    assert.equal(await page.eval(`window.__calls.at(-1).args.audience`), 'followers');
    // No labs at all: the river is offered, and in columns every feed row has a reblog button too.
    assert.equal(await page.eval(`document.querySelector('[data-layout="river"]').hidden`), false);
    await page.eval(`document.querySelector('[data-layout="columns"]').click()`);
    await page.waitFor(`!document.querySelector('#grid.river') && document.querySelector('#grid .item .mi.reblog')`, 'reblog in columns');
    assert.ok(await page.eval<number>(`[...document.querySelectorAll('#grid .item')].filter((n) => n.querySelector('.mi.reblog')).length`) > 5);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await profiles.put('default', room());
  }
});

test('browser: every handle is a door: @names open their space and come back to where you were; a share offers to follow its author', { skip }, async () => {
  // As in the river test, the page gets a Following portal on the way in, and the social
  // tools are answered in the page.
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.fetch;
    window.__calls = [];
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
    const now = new Date().toISOString();
    window.fetch = async (url, init) => {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      const name = body && body.params && body.params.name;
      const args = body && body.params && body.params.arguments;
      if (url === '/mcp' && ['open_space', 'get_share', 'relationship'].includes(name)) {
        window.__calls.push({ name, args });
        if (name === 'open_space') return answer({ content: [], structuredContent: { space: { handle: args.handle, displayName: args.handle.toUpperCase(), mine: false, followers: 2, following: false,
          posts: Array.from({ length: 8 }, (_, i) => ({ id: 's_preview_' + i, kind: 'link', title: 'Preview story ' + i, description: 'Source preview ' + i, image: { url: 'https://img.example.com/space-' + i + '.png', kind: 'thumb' }, note: 'Personal note ' + i, audience: 'everyone', createdAt: now, author: { handle: args.handle }, mine: false, reblogCount: 0, canReblog: true })),
          sources: [], createdAt: now, updatedAt: now } } });
        if (name === 'relationship') return answer({ content: [], structuredContent: { handle: args.handle, layoutChanged: false } });
        if (args.id === 's_ben') return answer({ content: [], structuredContent: { share: { id: 's_ben', kind: 'link', title: 'A post by cy', url: 'https://example.com/cy', audience: 'everyone', createdAt: now,
          author: { handle: 'ben' }, mine: false, reblogCount: 1, canReblog: true, reblogOf: { root: 's_cy' }, original: { id: 's_cy', author: { handle: 'cy' }, note: "Cy's own words." }, canFollow: ['cy'] } } });
        return answer({ content: [], structuredContent: { share: { id: 's_fay', kind: 'clip', title: 'Just for fay', clip: { kind: 'quote', data: { kind: 'quote', text: 'Cats are liquid.' } }, note: 'Worth a look.', audience: 'everyone', createdAt: now,
          author: { handle: 'fay' }, mine: false, reblogCount: 0, canReblog: true, canFollow: ['fay'] } } });
      }
      const res = await real(url, init);
      if (name !== 'open_room') return res;
      const json = await res.json();
      const room = json.result && json.result.structuredContent;
      if (room && room.portals) {
        room.identity = { mode: 'hosted', handle: 'reader' };
        room.profile.columns.push({ width: 1, panels: [{ id: 'following', source: 'following', title: 'Following', config: {} }] });
        room.portals.push({ portalId: 'following', source: 'following', title: 'Following', provenance: { source: 'following', endpoint: 'shares from people you follow', fetchedAt: now, cached: false, ttlSeconds: 0 }, items: [
          { id: 's_ben', title: 'A post by cy', url: 'https://example.com/cy', meta: ['@ben', 'reblogged @cy', 'link'], publishedAt: now, share: { id: 's_ben', kind: 'link', canReblog: true, reblog: { root: 's_cy', by: 'cy', note: "Cy's own words." } } },
          { id: 's_fay', title: 'Just for fay', meta: ['@fay', 'quote'], publishedAt: now, share: { id: 's_fay', kind: 'clip', canReblog: true } },
        ] });
      }
      return new Response(JSON.stringify(json), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
  })();` });
  await profiles.put('default', validateProfile({ ...room(), layout: 'river' }));
  const find = (title: string) => `[...document.querySelectorAll('.river-feed > article')].find((n) => n.querySelector('.item-title').textContent.endsWith(${JSON.stringify(title)}))`;
  const spaceOpen = (handle: string) => page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('#reader .space-head h1')?.textContent === ${JSON.stringify(handle.toUpperCase())}`, `@${handle}'s space`);
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#grid.river .river-feed article') && !document.querySelector('.skeleton')`, 'the river');
    assert.deepEqual(await page.eval(`[...${find('A post by cy')}.querySelectorAll('.story-context .handle, .story-note .handle')].map((n) => n.textContent)`), ['@ben', '@cy', '@cy'],
      'the context row and the trail name people as buttons');

    // From the river: the original's author, then back to the river.
    await page.eval(`${find('A post by cy')}.querySelector('.story-context .handle:last-child').click()`);
    await spaceOpen('cy');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'open_space', args: { handle: 'cy' } });
    await page.waitFor(`document.querySelector('#reader .space-link-image')?.naturalWidth > 0`, 'the first Space preview image');
    assert.equal(await page.eval(`document.querySelector('#reader .space-description').textContent`), 'Source preview 0');
    assert.equal(await page.eval(`document.querySelector('#reader .post .pn').textContent`), 'Personal note 0');
    await page.eval(`document.querySelector('#reader [data-post-id="s_preview_7"]').scrollIntoView()`);
    await page.waitFor(`document.querySelector('#reader [data-post-id="s_preview_7"] .space-link-image')?.naturalWidth > 0`, 'Space previews beyond the first image batch');
    await page.eval(`document.querySelector('#readerControls .reader-top button').click()`);
    await page.waitFor(`document.getElementById('reader').hidden && !document.getElementById('grid').hidden`, 'back to the river');

    // A shared clip opens as a share: its author is a door, and Follow is right there.
    await page.eval(`${find('Just for fay')}.querySelector('.item-main').click()`);
    await page.waitFor(`document.querySelector('#reader .share-actions .btn.follow')`, 'the share with Follow');
    assert.equal(await page.eval(`document.querySelector('#reader .byline').textContent.split(' · ')[0]`), '@fay shared a quote');
    await page.eval(`document.querySelector('#reader .share-actions .btn.follow').click()`);
    await page.waitFor(`document.querySelector('#reader .btn.follow').getAttribute('aria-pressed') === 'true'`, 'the follow');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'relationship', args: { handle: 'fay', action: 'follow' } });
    assert.equal(await page.eval(`document.querySelector('#reader .btn.follow').textContent`), 'Following @fay');

    // From the share to the space and back to the very same share, as it was.
    await page.eval(`document.querySelector('#reader .byline .handle').click()`);
    await spaceOpen('fay');
    await page.eval(`document.querySelector('#readerControls .reader-top button').click()`);
    await page.waitFor(`document.querySelector('#reader h1')?.textContent === 'Just for fay'`, 'back to the share');
    assert.equal(await page.eval(`document.querySelector('#reader .btn.follow').textContent`), 'Following @fay', 'the share comes back as you left it');
    assert.equal(await page.eval(`document.getElementById('reader').classList.contains('space')`), false);

    // A shared link opens in the reader, which still says who passed it on, with Follow for the original's author.
    await page.eval(`document.querySelector('#readerControls .reader-top button').click()`);
    await page.waitFor(`document.getElementById('reader').hidden`, 'back to the river');
    await page.eval(`${find('A post by cy')}.querySelector('.item-main').click()`);
    await page.waitFor(`document.querySelector('#reader .shared-by .btn.follow')`, 'the reader with who shared it');
    assert.equal(await page.eval(`document.querySelector('#reader .shared-by .byline').textContent`), "@ben reblogged @cy's link");
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('#reader .shared-by .story-note')].map((n) => n.textContent)`), ["@cyCy's own words."]);
    assert.equal(await page.eval(`document.querySelector('#reader .shared-by .btn.follow').textContent`), 'Follow @cy');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'get_share', args: { id: 's_ben' } });

    // A Following portal's rows name their people as buttons too.
    await page.eval(`document.querySelector('#readerControls .reader-top button').click()`);
    await page.eval(`document.querySelector('[data-layout="columns"]').click()`);
    await page.waitFor(`!document.querySelector('#grid.river') && document.querySelector('#grid .item .item-meta .handle')`, 'handles in Following rows');
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('#grid .item .item-meta .handle')].map((n) => n.textContent)`), ['@ben', '@cy', '@fay']);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await profiles.put('default', room());
  }
});

test('browser: a standalone clip loads the saved audience before sharing, retries failures, and wraps on narrow screens', { skip }, async () => {
  await profiles.put('default', validateProfile({ ...room(), shareAudience: 'followers' }));
  const host = await attachHost();
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.fetch;
    window.__shares = [];
    let failPreference = true;
    window.fetch = async (url, init) => {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      const name = body?.params?.name;
      let result;
      if (url === '/mcp' && name === 'account_settings' && failPreference) {
        failPreference = false;
        result = { isError: true, content: [{ type: 'text', text: 'Preference temporarily unavailable' }] };
      } else if (url === '/mcp' && name === 'share') {
        window.__shares.push(body.params.arguments);
        result = { content: [], structuredContent: { share: { id: 's_clip', audience: body.params.arguments.audience } } };
      }
      return result ? new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { status: 200, headers: { 'content-type': 'application/json' } }) : real(url, init);
    };
  })();` });
  try {
    page.problems.length = 0;
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${app.base}/preview`);
    await page.eval(`window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { clip: {
      id: 'c_test', title: 'A standalone clip', kind: 'quote', tags: [], source: { kind: 'conversation' }, createdAt: new Date().toISOString(), data: { kind: 'quote', text: 'Keep this thought.' }
    } } } }, '*')`);
    await page.waitFor(`document.querySelector('#reader h1')?.textContent === 'A standalone clip'`, 'the standalone clip card');
    await page.eval(`[...document.querySelectorAll('#reader button')].find((b) => b.textContent.includes('Share to your space')).click()`);
    await page.waitFor(`document.querySelector('.audience-help button')`, 'the preference retry');
    assert.equal(await page.eval(`document.querySelector('.composer .row > button').disabled`), true, 'failure blocks submission rather than guessing Public');
    assert.equal(await page.eval(`window.__shares.length`), 0);
    await page.click('.audience-help button');
    await page.waitFor(`document.querySelector('.composer input:checked')?.value === 'followers' && !document.querySelector('.composer .row > button').disabled`, 'the saved audience after retry');
    assert.match(await page.eval<string>(`document.querySelector('.audience-help').textContent`), /Hidden from your public Space/);
    await page.eval(`document.documentElement.style.fontSize = '200%'`);
    assert.equal(await page.eval(`(() => { const box = document.querySelector('.composer').getBoundingClientRect(); return [...document.querySelectorAll('.composer .row button, .composer label')].every((n) => { const r = n.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right; }); })()`), true, 'controls fit at 360px with enlarged text');
    await page.click('.composer input[value="everyone"]');
    assert.match(await page.eval<string>(`document.querySelector('.audience-help').textContent`), /Visible on your Space/);
    await page.click('.composer .row > button');
    await page.waitFor(`document.querySelector('.composer [role="status"]')`, 'the public clip share');
    const shares = await page.eval<any[]>(`window.__shares`);
    assert.equal(shares.length, 1);
    assert.match(shares[0].requestKey, /^[\w-]{8,100}$/);
    const {requestKey: _shareKey, ...shareArgs} = shares[0];
    assert.deepEqual(shareArgs, { clipId: 'c_test', note: '', audience: 'everyone' });
    assert.match(await page.eval<string>(`document.querySelector('.composer').textContent`), /Shared · Public/);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: host });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
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
    await page.click('#readerControls .reader-top [aria-label="Back to your room"]');
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


test('browser: a local first run offers signing in from the welcome screen, and reports there', { skip }, async () => {
  // A local MCPortal in ghost mode whose hosted server can't be reached: the welcome
  // screen's sign-in must show what happened even though the account menu is hidden there.
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mcportal-welcome-'));
  const local = { store: new FileProfileStore(dataDir), clips: new FileClipStore(dataDir), reading: new FileReadingStore(dataDir), seen: new FileSeenStore(dataDir), handoffs: new FileHandoffStore(dataDir), editions: new FileEditionStore(dataDir) };
  const session = new LocalSession({ dataDir, localUser: 'default', local, base: { fetcher, cache: new TtlCache() }, hostedUrl: 'http://127.0.0.1:9', fetch: async () => { throw new TypeError('fetch failed'); } });
  const ghost = await startApp({ allowUnauthenticated: true, dataDir }, fetcher, { ...local, session });
  try {
    page.problems.length = 0;
    await page.goto(`${ghost.base}/preview`);
    const signIn = `[...document.querySelectorAll('.welcome-actions button')].find((b) => b.textContent.startsWith('Already have a portal?'))`;
    await page.waitFor(signIn, 'the sign-in option on the welcome screen');
    await page.eval(`${signIn}.click()`);
    const report = await page.waitFor<string>(`(() => { const n = document.querySelector('.welcome-actions + .building'); return n && !n.hidden && /signing in/i.test(n.textContent) && n.textContent; })()`, 'the sign-in report under the actions');
    assert.match(report, /Couldn't start signing in/);
    assert.deepEqual(page.problems, []);
  } finally {
    // Leave the fixture before closing it: the live preview may still have a request open.
    await page.goto('about:blank');
    ghost.server.closeAllConnections();
    await ghost.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});


test('browser: finite catch-up resumes a captured set, ends explicitly and preserves reading state on a narrow screen', { skip }, async () => {
  await openRoom(); await page.click('#btnCatchup');
  await page.waitFor(`document.querySelector('.catchup-start')`, 'catch-up choices');
  await page.eval(`document.querySelector('.catchup-start select').value='3'; document.querySelectorAll('.catchup-start input[type=checkbox]').forEach(c=>c.checked=c.value==='hn-top'); document.querySelector('.catchup-start').requestSubmit()`);
  await page.waitFor(`document.querySelector('.catchup-story') || document.querySelector('.catchup-end')`, 'captured catch-up session');
  const session=(await experiences.get('default')).state.catchup!;
  assert.ok(session.stories.length<=3);
  await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
  try {
    assert.equal(await page.eval(`document.documentElement.scrollWidth<=window.innerWidth`),true);
    if (!session.finishedAt) {
      await page.goto(`${app.base}/preview`); await page.click('#btnCatchup');
      await page.waitFor(`document.querySelector('.catchup-story')`,'resumed story');
      assert.equal((await experiences.get('default')).state.catchup!.id,session.id);
      const reading=await readings.list('default');
      await page.click('.catchup-finish');await page.waitFor(`document.querySelector('.catchup-end')`,'finite end');
      assert.deepEqual(await readings.list('default'),reading,'finish is not article completion');
    }
  } finally {await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});}
  assert.deepEqual(page.problems,[]);
});

test('browser: Changes keeps dated evidence and Upcoming renders real calendar dates, saves events and supports narrow screens', { skip }, async () => {
  await openRoom(); await page.click('#btnChanges');
  await page.waitFor(`document.querySelector('.watch-setup')`, 'watch setup');
  await page.eval(`document.querySelector('[aria-label="Watch title"]').value='Persistence notes'; document.querySelector('[aria-label="Watch address"]').value='${DOCS}/watch.md'; document.querySelector('.watch-setup').requestSubmit()`);
  await page.waitFor(`document.querySelector('.watch-card h3')?.textContent==='Persistence notes'`, 'kept watch');
  const watch=(await experiences.get('default')).state.watches.find(w=>w.title==='Persistence notes')!;
  await page.click('.watch-card .btn');await page.waitFor(`document.querySelector('.watch-card').textContent.includes('Last successful check')`,'baseline check');
  watchedText='# Watched docs\n\nKeep state in a database.';
  await experiences.update('default',state=>{state.watches.find(w=>w.id===watch.id)!.lastAttempt=new Date(Date.now()-61000).toISOString();return {state,result:undefined};});
  await page.click('.watch-card .btn');await page.waitFor(`document.querySelector('.change-card details')`,'actual change evidence');
  await page.click('.change-card summary');
  assert.match(await page.eval<string>(`document.querySelector('.change-diff').textContent`),/file.*database|database.*file/s);
  await page.click('#btnUpcoming');await page.waitFor(`document.querySelector('.watch-setup')`,'calendar setup');
  await page.eval(`document.querySelector('[aria-label="Watch title"]').value='Town Hall'; document.querySelector('[aria-label="Watch address"]').value='${CALENDAR}'; document.querySelector('.watch-setup').requestSubmit()`);
  await page.waitFor(`document.querySelector('.watch-card h3')?.textContent==='Town Hall'`, 'calendar watch');
  await page.click('.watch-card .btn');await page.waitFor(`document.querySelector('.event-card')`, 'dated event');
  assert.match(await page.eval<string>(`document.querySelector('.event-card').textContent`),/Town Hall live show.*UTC/s);
  await page.click('.event-card [data-save-url]');await page.waitFor(`document.querySelector('.event-card [data-save-url]').getAttribute('aria-pressed')==='true'`,'saved event');
  assert.ok((await profiles.get('default')).saved.find(s=>s.url==='https://venue.example.com/show')!.event);
  await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
  try {assert.equal(await page.eval(`document.documentElement.scrollWidth<=window.innerWidth`),true);} finally {await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});}
  await tool('remove_saved',{url:'https://venue.example.com/show'});
  const all=(await experiences.get('default')).state.watches;for(const w of all) await tool('watch_reading',{action:'delete',id:w.id});
  assert.deepEqual(page.problems,[]);
});

test('browser: agent comparison output validates refs, renders separately and keeps existing pane positions', { skip }, async () => {
  await profiles.put('default',room());const host=await attachHost();
  try {
    const data=await tool('show_comparison',{question:'How is deployment described?',sources:[{ref:`url:${DOCS}/install.md`,title:'Install',docs:DOCS},{ref:`url:${DOCS}/deploy.md`,title:'Deploy',docs:DOCS}],interpretation:{text:'Agreements: both provide steps. Differences: deployment has more stages. Open questions: runtime guarantees.',refs:[`url:${DOCS}/install.md`,`url:${DOCS}/deploy.md`]}});
    await page.goto(`${app.base}/preview`);await page.waitFor(`document.querySelector('[data-portal]')`,'the host room');
    await page.eval(`window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(data)}}},'*')`);
    await page.waitFor(`document.querySelector('.comparison-interpretation .agent-writing')`,'explicit interpretation');
    await page.waitFor(`document.querySelector('#comparisonSource1 .comparison-source-body h2')`,'the longer source');
    await page.eval(`document.querySelector('#comparisonSource1 .comparison-source-body').scrollTop=200`);
    const position=await page.eval<number>(`document.querySelector('#comparisonSource1 .comparison-source-body').scrollTop`);
    await page.eval(`window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(data)}}},'*')`);
    assert.equal(await page.eval(`document.querySelector('#comparisonSource1 .comparison-source-body').scrollTop`),position);
    assert.deepEqual(page.problems,[]);
  } finally {await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:host});}
});


test('browser: kept passage follows moved text, declines duplicates and changed text, and keeps the original quote', {skip}, async()=>{
  const quote='This unique kept passage survives a move.';
  const source=`${DOCS}/passage.md`;
  const kept=await tool('clip',{kind:'quote',title:'Durable locator example',content:quote,source:{kind:'article',url:source,title:'Passage source',locator:{block:1,text:quote}}});
  try {
    for (const mode of ['moved','duplicate','changed']) {
      cacheOffset += 25*3600000;
      passageDoc='# Passage source\n\n'+Array.from({length:30},(_,i)=>`Paragraph ${i}. Supporting prose with enough text to scroll down to the kept material.\n\n`).join('')+(mode==='changed'?'This passage has changed.':quote)+(mode==='duplicate'?'\n\n'+quote:'');
      await profiles.put('default',room());await openRoom();await page.click('#btnRecall');
      await page.eval(`document.querySelector('[aria-label="Search your library"]').value='Durable locator example';document.querySelector('.recall-search').requestSubmit()`);
      await page.waitFor(`document.querySelector('.recall-hit')?.textContent.includes('Durable locator example')`,'the retained quote');
      await page.click('.recall-hit .recall-title');
      await page.waitFor(`document.querySelector('#recallPreview .btn')`,'the quote preview');
      await page.eval(`[...document.querySelectorAll('#recallPreview button')].find(b=>b.textContent==='Read kept material').click()`);
      await page.waitFor(`document.querySelector('#reader .body')?.textContent.includes(${JSON.stringify(quote)})`,'the original retained quote');
      assert.equal(await page.eval(`document.querySelector('#readerControls button')?.getAttribute('aria-label')`),'Back to your reading experience');
      assert.equal(await page.eval(`document.querySelector('#reader .row button')?.getAttribute('aria-label')`),null,'sharing keeps its own accessible name');
      await page.click('#readerControls button');
      await page.waitFor(`!document.querySelector('#experiences').hidden`,'return to the kept quote preview');
      await page.eval(`[...document.querySelectorAll('#recallPreview button')].find(b=>b.textContent==='Return to passage').click()`);
      await page.waitFor(`!document.querySelector('#reader').hidden && document.querySelector('#reader .body')`,'the passage reader');
      if (mode==='moved') {
        await page.waitFor(`window.scrollY>500 || document.querySelector('#reader').scrollTop>500`,'unique text relocated beyond obsolete block');
        assert.equal(await page.eval(`Boolean(document.querySelector('#reader .handoff-note'))`),false);
      } else {
        await page.waitFor(`document.querySelector('#reader .handoff-note')?.textContent.includes(${JSON.stringify(mode === 'duplicate' ? 'occurs more than once' : 'could not be located')})`,'honest unresolved passage');
      }
      const stored=await tool('get_clip',{id:kept.clip.id});assert.equal(stored.clip.data.text,quote);
      assert.deepEqual(page.problems,[]);
    }
  } finally {await tool('delete_clip',{id:kept.clip.id});await profiles.put('default',room());}
});

test('browser: quote, gallery and release presentations use retained content and fit a narrow room', {skip}, async()=>{
  const quote=await tool('clip',{kind:'quote',title:'A retained principle',content:'Keep the evidence in view.'});
  const image=await tool('clip',{kind:'image',title:'A visual note',content:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#567568"/></svg>'});
  const profile=room();profile.columns.push({width:1,panels:[{id:'kept-clips',source:'clips',title:'Kept clips',view:'quotes',config:{limit:10}},{id:'releases',source:'github',title:'Manual releases',view:'changelog',config:{mode:'releases',repo:'acme/manual',limit:10}}]});
  try {
    await profiles.put('default',profile);await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('[data-portal="kept-clips"] .portal-view-quotes .clip-quote')`,'a quote with its full retained text');
    assert.equal(await page.eval(`document.querySelectorAll('[data-portal="kept-clips"] .portal-clip-card').length`),1);
    await page.waitFor(`document.querySelector('[data-portal="releases"] .release-entry h3')?.textContent==='v1.2.3'`,'a versioned release entry');
    await page.eval(`const s=document.querySelector('[data-portal="kept-clips"] .portal-view-select');s.value='gallery';s.dispatchEvent(new Event('change'))`);
    await page.waitFor(`document.querySelector('[data-portal="kept-clips"] .portal-view-gallery img')?.getAttribute('alt')==='A visual note'`,'the kept visual with accessible title');
    await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
    assert.equal(await page.eval(`document.documentElement.scrollWidth<=window.innerWidth`),true,'portal views fit the narrow room');
    assert.deepEqual(page.problems,[]);
  } finally {await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await tool('delete_clip',{id:quote.clip.id});await tool('delete_clip',{id:image.clip.id});await profiles.put('default',room());}
});


test('browser: a comparison with a removed source remains accessible for repair', {skip}, async()=>{
  await profiles.put('default',room());
  const {collection}=await tool('update_collection',{action:'create',kind:'comparison',title:'Repairable comparison',entries:[{ref:`url:${DOCS}/install.md`,title:'Install'},{ref:`url:${DOCS}/deploy.md`,title:'Deploy'}]});
  try {
    await tool('update_collection',{action:'remove',id:collection.id,refs:[`url:${DOCS}/deploy.md`]});
    await openRoom();await page.click('#btnCollections');
    await page.waitFor(`[...document.querySelectorAll('.collection-card')].some(c=>c.textContent.includes('Repairable comparison'))`,'the kept comparison');
    await page.eval(`[...document.querySelectorAll('.collection-card')].find(c=>c.textContent.includes('Repairable comparison')).querySelector('button').click()`);
    await page.waitFor(`document.querySelector('.desk-kept .watch-warning')?.textContent.includes('needs another source')`,'an actionable incomplete comparison');
    assert.equal(await page.eval(`document.querySelectorAll('.desk-entry').length`),1);assert.deepEqual(page.problems,[]);
  } finally {await tool('update_collection',{action:'delete',id:collection.id});}
});


test('browser: reading navigation uses labelled custom icons and fits all destinations at 320px', {skip}, async()=>{
  const profile=room();profile.saved.push({url:`${DOCS}/install.md`,title:'Install Example Docs',savedAt:new Date().toISOString()});
  await profiles.put('default',profile);
  await openRoom();
  const buttons=await page.eval<Array<{label:string;title:string;path:string;hidden:boolean}>>(`[...document.querySelectorAll('.experience-nav button')].map(b=>({label:b.getAttribute('aria-label'),title:b.title,path:b.querySelector('svg path')?.getAttribute('d'),hidden:getComputedStyle(b.querySelector('.experience-nav-label')).display==='none'}))`);
  assert.deepEqual(buttons.map(b=>b.label),['Room','Recall','Topic desks','Compare','Catch-up','Changes','Upcoming']);
  assert.ok(buttons.every(b=>b.title===b.label && b.path && !b.hidden));
  await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
  try {
    const geometry=await page.eval<{fits:boolean;labelsHidden:boolean;targets:boolean}>(`(()=>{const nav=document.querySelector('.experience-nav'),buttons=[...nav.querySelectorAll('button')];return {fits:nav.scrollWidth<=nav.clientWidth && document.documentElement.scrollWidth<=innerWidth,labelsHidden:buttons.every(b=>getComputedStyle(b.querySelector('.experience-nav-label')).display==='none'),targets:buttons.every(b=>b.getBoundingClientRect().width>=44 && b.getBoundingClientRect().height>=44)}})()`);
    assert.deepEqual(geometry,{fits:true,labelsHidden:true,targets:true});
    await page.click('#btnRecall');await page.waitFor(`document.querySelector('.recall-hit')`,'Recall through its icon');
    assert.equal(await page.eval(`document.querySelector('#btnRecall').getAttribute('aria-current')`),'page');
    assert.equal(await page.eval(`getComputedStyle(document.querySelector('#btnRecall')).backgroundColor`),'rgba(0, 0, 0, 0)');
    assert.equal(await page.eval(`getComputedStyle(document.querySelector('#btnRecall'),'::before').width`),'24px');
    assert.equal(await page.eval(`document.querySelector('#btnRecall').matches(':focus-visible')`),false,'pointer selection has no keyboard focus ring');
    await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    await page.eval(`document.querySelector('#btnChanges').focus()`);
    assert.equal(await page.eval(`document.activeElement.id`),'btnChanges');await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await page.waitFor(`document.querySelector('.experience-heading h1')?.textContent==='Changes'`,'keyboard navigation through a compact icon');
    assert.equal(await page.eval(`document.querySelector('#btnChanges').getAttribute('aria-current')`),'page');
    assert.equal(await page.eval(`document.querySelector('#btnChanges').matches(':focus-visible')`),true,'keyboard navigation retains its focus ring');
    assert.deepEqual(page.problems,[]);
  } finally {await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});}
  // Selection changes must update the accessible count without replacing the icon.
  await page.click('#btnRecall');await page.waitFor(`document.querySelectorAll('[data-select-ref]').length>=2`,'selectable evidence');
  await page.eval(`[...document.querySelectorAll('[data-select-ref]')].slice(0,2).forEach(b=>b.click())`);
  assert.equal(await page.eval(`document.querySelector('#btnCompare').getAttribute('aria-label')`),'Compare (2)');
  assert.equal(await page.eval(`document.querySelector('#btnCompare').dataset.count`),'2');
  assert.equal(await page.eval(`Boolean(document.querySelector('#btnCompare svg path'))`),true);
});

test('browser: Space links: the room offers a follow of whoever brought you, says who joined through yours, and your space copies its link', { skip }, async () => {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.fetch;
    window.__calls = [];
    window.__intros = { offer: ['ana'], joined: ['ben'] };
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
    const now = new Date().toISOString();
    window.fetch = async (url, init) => {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      const name = body && body.params && body.params.name;
      const args = body && body.params && body.params.arguments;
      if (url === '/mcp' && (name === 'relationship' || name === 'open_space' || name === 'set_public_profile')) {
        window.__calls.push({ name, args });
        if (name === 'relationship') return answer({ content: [], structuredContent: { handle: args.handle, layoutChanged: false } });
        if (name === 'set_public_profile') return answer({ content: [], structuredContent: { profile: { handle: 'reader', ...(args.listed ? { listed: true } : {}), createdAt: now, updatedAt: now } } });
        return answer({ content: [], structuredContent: { space: { handle: 'reader', mine: true, followers: 0, following: false, posts: [], sources: [], link: 'https://mcportal.example/@reader', createdAt: now, updatedAt: now } } });
      }
      const res = await real(url, init);
      if (name !== 'open_room') return res;
      const json = await res.json();
      const room = json.result && json.result.structuredContent;
      if (room && room.portals) {
        room.identity = { mode: 'hosted', handle: 'reader' };
        if (window.__intros) { room.intros = window.__intros; window.__intros = undefined; }   // said once
      }
      return new Response(JSON.stringify(json), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
  })();` });
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#intros') && !document.querySelector('.skeleton')`, 'the intro strip');
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('#intros .intro')].map((n) => n.textContent)`),
      ["You came in through @ana's Space link.Follow @anaNot now", '@ben joined MCPortal through your Space link.']);
    await page.eval(`document.querySelector('#intros .btn.follow').click()`);
    await page.waitFor(`document.querySelector('#intros .btn.follow').getAttribute('aria-pressed') === 'true'`, 'the follow');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'relationship', args: { handle: 'ana', action: 'follow' } });
    await page.eval(`document.querySelector('#intros .link-btn').click()`);
    assert.equal(await page.eval(`document.querySelectorAll('#intros .intro').length`), 1, 'Not now puts that one away');

    // Opening something hides the strip; the room brings it back.
    await page.eval(`document.querySelector('#intros .handle').click()`);
    await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('#reader .space-head')`, 'a space');
    assert.equal(await page.eval(`getComputedStyle(document.getElementById('intros')).display`), 'none');
    assert.ok(await page.eval(`document.querySelector('#reader .space-printshop').textContent.includes('Copy link to your space')`), 'your own space offers its link');
    // Your space says whether you're findable, and switches it.
    await page.eval(`[...document.querySelectorAll('#reader .space-printshop .btn')].find((b) => b.textContent === 'Unlisted: list me').click()`);
    await page.waitFor(`[...document.querySelectorAll('#reader .space-printshop .btn')].some((b) => b.textContent.startsWith('Listed:'))`, 'listed');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'set_public_profile', args: { listed: true } });
    await page.eval(`[...document.querySelectorAll('#reader .space-printshop .btn')].find((b) => b.textContent.includes('Copy link')).click()`);
    await page.waitFor(`/mcportal\\.example\\/@reader|Copied your Space link/.test(document.getElementById('toast').textContent)`, 'the link copied or shown');
    await page.eval(`document.querySelector('#readerControls .reader-top button').click()`);
    await page.waitFor(`document.getElementById('reader').hidden`, 'back to the room');
    assert.notEqual(await page.eval(`getComputedStyle(document.getElementById('intros')).display`), 'none');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
});

test('browser: the People portal: suggested people with the agent\'s reason, Follow, Not for me, and their Space on click; never in the river', { skip }, async () => {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.fetch;
    window.__calls = [];
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
    const now = new Date().toISOString();
    window.fetch = async (url, init) => {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      const name = body && body.params && body.params.name;
      const args = body && body.params && body.params.arguments;
      if (url === '/mcp' && ['relationship', 'pass_person', 'open_space'].includes(name)) {
        window.__calls.push({ name, args });
        if (name === 'relationship') return answer({ content: [], structuredContent: { handle: args.handle, layoutChanged: false } });
        if (name === 'pass_person') return answer({ content: [], structuredContent: { profile: {} } });
        return answer({ content: [], structuredContent: { space: { handle: args.handle, displayName: args.handle.toUpperCase(), mine: false, followers: 3, following: false, posts: [], sources: [], createdAt: now, updatedAt: now } } });
      }
      const res = await real(url, init);
      if (name !== 'open_room') return res;
      const json = await res.json();
      const room = json.result && json.result.structuredContent;
      if (room && room.portals) {
        room.identity = { mode: 'hosted', handle: 'reader' };
        room.profile.columns.push({ width: 1, panels: [{ id: 'people', source: 'people', title: 'People', config: {} }] });
        room.portals.push({ portalId: 'people', source: 'people', title: 'People', provenance: { source: 'people', endpoint: "your agent's suggestions", fetchedAt: now, cached: false, ttlSeconds: 0 }, items: [
          { id: 'person:ana', title: '@ana', summary: 'Posts mostly about cat behavior research.', meta: ['Cat Physics Quarterly', '3 followers'], publishedAt: now, person: { handle: 'ana', following: false } },
          { id: 'person:ben', title: 'Ben (@ben)', summary: 'Plays World of Warcraft: raid guides and lore.', meta: ['12 followers'], publishedAt: now, person: { handle: 'ben', following: false } },
        ] });
      }
      return new Response(JSON.stringify(json), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
  })();` });
  const people = `[...document.querySelectorAll('#grid .item')].filter((n) => n.querySelector('.person-act'))`;
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`${people}.length === 2 && !document.querySelector('.skeleton')`, 'the People portal');
    assert.deepEqual(await page.eval(`${people}.map((n) => [n.querySelector('.item-title').textContent, n.querySelector('.item-summary').textContent, [...n.querySelectorAll('.person-act')].map((b) => b.textContent)])`), [
      ['@ana', 'Posts mostly about cat behavior research.', ['Follow', 'Not for me']],
      ['Ben (@ben)', 'Plays World of Warcraft: raid guides and lore.', ['Follow', 'Not for me']]]);
    assert.equal(await page.eval(`${people}.some((n) => n.querySelector('.mi.save, .mi.reblog'))`), false, 'nothing to save or reblog');

    await page.eval(`${people}[0].querySelector('.person-act.follow').click()`);
    await page.waitFor(`${people}[0].querySelector('.person-act.follow').textContent === 'Following'`, 'the follow');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'relationship', args: { handle: 'ana', action: 'follow' } });

    await page.eval(`[...${people}[1].querySelectorAll('.person-act')].find((b) => b.textContent === 'Not for me').click()`);
    await page.waitFor(`${people}.length === 1`, 'ben passed on');
    assert.deepEqual(await page.eval(`window.__calls.at(-1)`), { name: 'pass_person', args: { handle: 'ben' } });

    await page.eval(`${people}[0].querySelector('.item-main').click()`);
    await page.waitFor(`!document.getElementById('reader').hidden && document.querySelector('#reader .space-head h1')?.textContent === 'ANA'`, "ana's space");
    await page.eval(`document.querySelector('#readerControls .reader-top button').click()`);
    await page.waitFor(`document.getElementById('reader').hidden`, 'back to the room');

    await page.eval(`document.querySelector('[data-layout="river"]').click()`);
    await page.waitFor(`document.querySelector('#grid.river .river-feed article')`, 'the river');
    assert.equal(await page.eval(`document.querySelectorAll('#grid.river .person-act').length`), 0, 'people stay out of the river');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await profiles.put('default', room());
  }
});

test('browser: the Lobby in the river: a stranger\'s post says "not followed", and a story someone you don\'t follow also shared says so, once', { skip }, async () => {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.fetch;
    window.fetch = async (url, init) => {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      const name = body && body.params && body.params.name;
      const res = await real(url, init);
      if (name !== 'open_room') return res;
      const json = await res.json();
      const room = json.result && json.result.structuredContent;
      const hn = room && room.portals && room.portals.find((p) => p.portalId === 'hn-top');
      if (hn) {
        const now = new Date().toISOString();
        room.identity = { mode: 'hosted', handle: 'reader' };
        room.profile.columns.push({ width: 1, panels: [{ id: 'lobby', source: 'lobby', title: 'Lobby', config: {} }] });
        room.portals.push({ portalId: 'lobby', source: 'lobby', title: 'Lobby', provenance: { source: 'lobby', endpoint: 'posts shared with everyone by listed people', fetchedAt: now, cached: false, ttlSeconds: 0 }, items: [
          { id: 's_zoe', title: hn.items[0].title, url: hn.items[0].url, summary: 'Worth the read.', meta: ['@zoe', 'link', 'not followed'], publishedAt: now, share: { id: 's_zoe', kind: 'link', canReblog: true } },
        ] });
        room.alsoShared = hn.items.filter((i) => i.url).map((i) => ({ url: i.url, handle: 'yan' }));   // every HN story, the first one included
      }
      return new Response(JSON.stringify(json), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
  })();` });
  await profiles.put('default', validateProfile({ ...room(), layout: 'river' }));
  const titles = (await tool('open_room', {})).portals.find((p: any) => p.portalId === 'hn-top').items.slice(0, 1).map((i: any) => i.title);
  const context = (title: string) => page.eval<string | null>(`[...document.querySelectorAll('.river-feed > article')].find((n) => n.querySelector('.item-title').textContent.endsWith(${JSON.stringify(title)}))?.querySelector('.story-context')?.textContent ?? null`);
  try {
    page.problems.length = 0;
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('#grid.river .river-feed article') && !document.querySelector('.skeleton')`, 'the river');
    assert.equal(await context(titles[0]), '@zoe shared · not followed', "the Lobby's share joins HN's story; its sharer wins over also-shared");
    const contexts = await page.eval<string[]>(`[...document.querySelectorAll('.river-feed > article .story-context')].map((n) => n.textContent)`);
    assert.ok(contexts.includes('also shared by @yan'), `another HN story names who else shared it (${contexts.join(' | ')})`);
    assert.equal(contexts.filter((c) => c.includes('@zoe')).length, 1, 'one name per story: zoe, not yan, on the first');
    assert.deepEqual([...new Set(await page.eval<string[]>(`[...document.querySelectorAll('.river-feed .story-context .handle')].map((b) => b.textContent)`))].sort(), ['@yan', '@zoe'], 'both are doors');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await profiles.put('default', room());
  }
});

test('browser: docs find searches current content and reading comfort follows page navigation with reset and Escape', { skip }, async () => {
  const host = await attachHost();
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 600, deviceScaleFactor: 1, mobile: false });
    await openRoom();
    await page.click('[data-portal="docs"] .item-main');
    await page.waitFor(`document.querySelector('#reader .body')`, 'the docs viewer');
    await page.eval(`[...document.querySelectorAll('.docs-toc a')].find(n => n.textContent === 'Deploy').click()`);
    await page.waitFor(`document.querySelectorAll('#reader .body h2').length === 45`, 'the long docs page');
    await page.click('.reader-find-toggle');
    await page.eval(`(() => { const input = document.querySelector('.reader-find-input'); input.value = 'Step 45'; input.dispatchEvent(new Event('input')); })()`);
    assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), '1 of 2');
    assert.ok(await page.eval<boolean>(`document.querySelector('.reader-find-hit.current').getBoundingClientRect().top >= document.querySelector('.reader-top').getBoundingClientRect().bottom`));
    assert.equal(await page.eval(`document.querySelector('.docs-search').value`), '', 'page find leaves the docs index search alone');
    await page.click('[aria-label="Next match"]');
    await page.click('.reader-comfort-toggle');
    assert.equal(await page.eval(`document.querySelectorAll('.reader-find-hit').length`), 0);
    await page.waitFor(`(() => { const r = document.querySelector('.reader-top').getBoundingClientRect(); return r.top >= document.querySelector('.bar').getBoundingClientRect().bottom - 1 && document.querySelector('#readerComfort').hidden === false; })()`, 'reader controls to remain reachable after reflow in a short host frame');
    const before = await page.eval<number>(`parseFloat(getComputedStyle(document.querySelector('.body')).fontSize)`);
    await page.eval(`(() => { const s = document.querySelector('[aria-label="Reading text size"]'); s.value = 'larger'; s.dispatchEvent(new Event('change')); const m = document.querySelector('[aria-label="Reading line width"]'); m.value = 'focused'; m.dispatchEvent(new Event('change')); })()`);
    await page.waitFor(`parseFloat(getComputedStyle(document.querySelector('.body')).fontSize) > ${before}`, 'larger reading type');
    assert.equal(await page.eval(`document.querySelector('.body').style.getPropertyValue('--mp-reader-measure')`), '60ch');
    assert.ok(await page.eval<boolean>(`document.documentElement.scrollWidth <= innerWidth`));
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    assert.equal(await page.eval(`document.getElementById('reader').hidden`), false);
    assert.equal(await page.eval(`document.activeElement.className`), 'btn reader-comfort-toggle');
    await page.eval(`[...document.querySelectorAll('.docs-toc a')].find(n => n.textContent === 'Install').click()`);
    await page.waitFor(`document.querySelector('.docs-page h1')?.textContent === 'Install'`, 'the next docs page');
    assert.ok(await page.eval<boolean>(`parseFloat(getComputedStyle(document.querySelector('.body')).fontSize) > ${before}`), 'reading settings follow navigation in the same open view');
    await page.click('.reader-comfort-toggle');
    await page.eval(`[...document.querySelectorAll('#readerComfort button')].find(n => n.textContent === 'Reset').click()`);
    assert.equal(await page.eval(`parseFloat(getComputedStyle(document.querySelector('.body')).fontSize)`), before);
    assert.equal(await page.eval(`document.querySelector('[aria-label="Reading line width"]').value`), 'comfortable');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: host });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
});


test('browser: source Back and Refresh remain below the universal controls after narrow large-text scrolling', { skip }, async () => {
  const saved = Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/source-scroll-${i}`, title: `Source story ${i}`, savedAt: '2026-09-01T00:00:00.000Z' }));
  await profiles.put('default', validateProfile({ ...room(), saved }));
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 500, deviceScaleFactor: 1, mobile: false });
    await openRoom();
    await page.eval(`document.documentElement.style.fontSize = '200%'`);
    await page.click('[data-portal="saved"] .portal-title');
    await page.waitFor(`document.querySelector('.level')`, 'source view');
    await page.eval(`window.scrollTo(0, 400)`);
    await page.waitFor(`scrollY > 0`, 'source content scroll');
    await page.waitFor(`(() => { const head = document.querySelector('.level-head'), back = head.querySelector('button').getBoundingClientRect(); return head.contains(document.elementFromPoint(back.left + back.width / 2, back.top + back.height / 2)); })()`, 'source transition completes with clickable actions');
    const sourceActions = await page.eval<{ top: number; barBottom: number; hit: boolean; scroll: number; offset: string }>(`(() => { const head = document.querySelector('.level-head'), h = head.getBoundingClientRect(), b = document.querySelector('.bar').getBoundingClientRect(), back = head.querySelector('button').getBoundingClientRect(); return { top: h.top, barBottom: b.bottom, hit: head.contains(document.elementFromPoint(back.left + back.width / 2, back.top + back.height / 2)), scroll: scrollY, offset: getComputedStyle(head).top }; })()`);
    assert.ok(Math.abs(sourceActions.top - sourceActions.barBottom) < 1 && sourceActions.hit, `source actions remain below universal row: ${JSON.stringify(sourceActions)}`);
    await page.click('.level-head [aria-label="Refresh Saved"]');
    await page.waitFor(`document.querySelectorAll('.level .item-main').length === 10`, 'source refresh completes');
    await page.eval(`window.scrollTo(0, 400)`);
    await page.click('.level-head [aria-label="Back to your room"]');
    await page.waitFor(`!document.querySelector('.level')`, 'source Back returns to the room after scrolling');
    assert.deepEqual(page.problems, []);
  } finally {
    await profiles.put('default', room());
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
});

test('browser: source previews ignore older replies, edits and mode changes and fit narrow views', { skip }, async () => {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__scans = [];
    const realFetch = window.fetch;
    window.fetch = (url, init) => {
      const call = init?.body && JSON.parse(init.body);
      if (call?.params?.name === 'find_source') return new Promise(resolve => {
        window.__scans.push((title, fail = false) => resolve(Response.json({ jsonrpc:'2.0', id:call.id, result: fail
          ? { isError:true, content:[{type:'text',text:'Fixture offline'}] }
          : {content:[], structuredContent:{candidates:[{source:'rss',config:{url:'https://example.com/feed.xml'},title,preview:[]}]}} })));
      });
      return realFetch(url, init);
    };` });
  const scan = async (value: string) => page.eval(`(() => { const input=document.getElementById('addInput'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input')); document.getElementById('addForm').requestSubmit(); })()`);
  try {
    await openRoom(); await page.click('#btnAdd');
    await scan('old'); await scan('new');
    await page.waitFor(`window.__scans.length===2`, 'both source scans');
    await page.eval(`window.__scans[1]('New result')`);
    await page.waitFor(`document.getElementById('addResults').textContent.includes('New result')`, 'latest result');
    await page.eval(`window.__scans[0]('Old result', true)`);
    assert.match(await page.eval<string>(`document.getElementById('addResults').textContent`), /New result/);
    assert.doesNotMatch(await page.eval<string>(`document.getElementById('addHint').textContent`), /offline/);
    await scan('edited'); await page.waitFor(`window.__scans.length===3`, 'third scan');
    await page.eval(`document.getElementById('addInput').value='different'; document.getElementById('addInput').dispatchEvent(new Event('input')); window.__scans[2]('Stale edit')`);
    await page.eval(`new Promise(requestAnimationFrame)`);
    assert.equal(await page.eval(`document.getElementById('addResults').textContent`), '');
    await scan('switch'); await page.waitFor(`window.__scans.length===4`, 'fourth scan');
    await page.click('#addStore'); await page.eval(`window.__scans[3]('Stale mode')`);
    await page.eval(`new Promise(requestAnimationFrame)`);
    assert.equal(await page.eval(`document.getElementById('addResults').textContent`), '');
    await page.click('#addFeed'); await scan('');
    assert.match(await page.eval<string>(`document.getElementById('addHint').textContent`), /Enter a site/);
    await scan('long'); await page.waitFor(`window.__scans.length===5`, 'long result scan');
    await page.eval(`window.__scans[4]('Long source title '.repeat(50))`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.eval(`document.documentElement.style.fontSize='200%'`);
    await page.waitFor(`document.querySelector('.cand-title')`, 'long source title');
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth`));
    await page.eval(`document.querySelector('.cand button').focus()`);
    await page.send('Input.dispatchKeyEvent', {type:'rawKeyDown', key:'Escape', code:'Escape'});
    assert.equal(await page.eval(`document.activeElement.id`), 'btnAdd');
    assert.equal(await page.eval(`document.getElementById('addSheet').hidden`), true);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
});

test('browser: import reports persist partial success and retry without losing completed subscriptions', { skip }, async () => {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__imports = 0; window.__refreshFail = false;
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      const call = init?.body && JSON.parse(init.body), name=call?.params?.name;
      if(name==='import_opml') {
        window.__imports++; window.__refreshFail=true;
        return Response.json({jsonrpc:'2.0',id:call.id,result:{content:[],structuredContent:{profile:{},total:2,
          imported:1, added:[{url:'https://example.com/kept',title:window.__imports===1?'Already kept':'Recovered'}],
          alreadyPresent:window.__imports===1?0:1,deferred:[],failed:window.__imports===1?[{url:'https://example.com/offline',title:'Offline source',error:'Fixture offline'}]:[]}}});
      }
      if(name==='open_room' && window.__refreshFail) { window.__refreshFail=false; return Response.json({jsonrpc:'2.0',id:call.id,result:{isError:true,content:[{type:'text',text:'Refresh offline'}]}}); }
      return realFetch(url,init);
    };` });
  try {
    await openRoom(); await page.click('#btnAdd');
    await page.eval(`(() => {const f=document.getElementById('opmlFile'), data=new DataTransfer();data.items.add(new File(['<opml/>'],'feeds.opml',{type:'text/xml'}));f.files=data.files;f.dispatchEvent(new Event('change'));})()`);
    await page.waitFor(`document.getElementById('importReport').textContent.includes('Offline source')`, 'partial report despite failed room refresh');
    assert.equal(await page.eval(`document.activeElement.tagName`), 'H2');
    assert.match(await page.eval<string>(`document.getElementById('importReport').textContent`), /Already kept.*Needs repair.*Fixture offline/);
    await page.eval(`[...document.querySelectorAll('#importReport button')].find(b=>b.textContent==='Retry remaining subscriptions').click()`);
    await page.waitFor(`document.getElementById('importReport').textContent.includes('Recovered')`, 'retry report');
    assert.match(await page.eval<string>(`document.getElementById('importReport').textContent`), /1 added; 1 already present; 0 failed/);
    assert.equal(await page.eval(`window.__imports`), 2);
    await page.eval(`[...document.querySelectorAll('#importReport button')].find(b=>b.textContent==='Refresh room').click()`);
    await page.waitFor(`document.getElementById('toast').textContent==='Room refreshed'`, 'non-writing refresh');
    assert.equal(await page.eval(`window.__imports`), 2);
    assert.deepEqual(page.problems, []);
  } finally { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
});

test('browser: Recall preview selection keeps keyboard focus and reader return restores the same result', { skip }, async () => {
  await openRoom(); await page.click('#btnRecall');
  await page.waitFor(`document.querySelectorAll('.recall-title').length>=2`, 'library results');
  const title = await page.eval<string>(`document.querySelectorAll('.recall-title')[1].textContent`);
  await page.eval(`document.querySelectorAll('.recall-title')[1].focus()`);
  await page.send('Input.dispatchKeyEvent', {type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await page.send('Input.dispatchKeyEvent', {type:'char',text:'\r',key:'Enter'});
  assert.equal(await page.eval(`document.activeElement.textContent`), title);
  assert.equal(await page.eval(`document.activeElement.className`), 'recall-title');
  assert.deepEqual(page.problems, []);
});
