import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { Article } from '../src/types.ts';
import { after, before, test } from 'node:test';
import type { Handoff } from '../src/handoffs.ts';
import type { ReadingState } from '../src/reading.ts';
import { findChrome, Page } from './browser.ts';
import { article, continuationArticle, mediaListArticle } from './fixtures/reader-ui/article.ts';
import { startApp, type Running } from './helpers.ts';

const chrome = findChrome();
const skip = !chrome && 'no Chrome found (set CHROME_PATH)';
let app: Running;
let page: Page;
before(async () => { if (skip) return; app = await startApp({ allowUnauthenticated: true }); page = await Page.open(chrome!); });
after(async () => { if (skip) return; await page.close(); await app.close(); });

/** Use the real MCP bridge with rich synthetic tool results, without involving the parser. */
async function open(options: { reading?: Partial<ReadingState>; handoff?: Partial<Handoff>; width?: number; article?: Article } = {}): Promise<void> {
  page.problems.length = 0;
  await page.send('Emulation.setDeviceMetricsOverride', { width: options.width || 1000, height: 850, deviceScaleFactor: 1, mobile: false });
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, '__MCPORTAL_DEV__', { get: () => undefined, set: () => {} });
    window.__calls = []; window.__imageBatches = []; window.__reading = ${JSON.stringify(options.reading || null)};
    let release; const imageGate = new Promise(resolve => release = resolve); window.__releaseImages = () => release();
    window.addEventListener('message', async event => {
      const msg = event.data;
      if (msg.method === 'ui/notifications/initialized') {
        window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { article: ${JSON.stringify(options.article || article)}, saved: false, handoff: ${JSON.stringify(options.handoff || null)} } } }, '*');
        return;
      }
      if (!msg?.id || !msg.method) return;
      event.stopImmediatePropagation();
      let result = {};
      if (msg.method === 'ui/initialize') result = { hostCapabilities: { serverTools: true, updateModelContext: true, openLinks: true }, hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } };
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        window.__calls.push({ name, args });
        let data = {};
        if (name === 'get_reading') data = { reading: window.__reading };
        if (name === 'list_reading') data = { reading: [] };
        if (name === 'get_thumbnails') {
          window.__imageBatches.push(args.urls);
          await imageGate;
          data = { images: Object.fromEntries(args.urls.map(url => [url, url.endsWith('/coast.png') ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6N0AAAAASUVORK5CYII=' : null])) };
        }
        if (name === 'create_handoff') data = { prompt: 'Open handoff TESTCODE' };
        result = { content: [], structuredContent: data };
      }
      window.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
    });` });
  await page.goto(`${app.base}/preview`);
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await page.waitFor(`document.querySelector('.mark-read:not([disabled])')`, 'the reader and history to become ready');
}

test('reader UI: semantic groups, composable marks, metadata and outline survive rich tool results', { skip }, async () => {
  await open({ width: 380 });
  assert.equal(await page.eval(`document.querySelectorAll('.body > ol').length`), 2);
  assert.equal(await page.eval(`document.querySelector('.body > ol').start`), 4);
  assert.equal(await page.eval(`document.querySelectorAll('.body > ol')[1].start`), 2);
  assert.equal(await page.eval(`document.querySelector('.body > ol > li:nth-child(2)').value`), 9);
  assert.equal(await page.eval(`document.querySelectorAll('.body > ol > li > ul > li').length`), 2);
  assert.equal(await page.eval(`document.querySelectorAll('.body > blockquote').length`), 2);
  assert.equal(await page.eval(`document.querySelector('.body > blockquote').children.length`), 2);
  assert.equal(await page.eval(`document.querySelectorAll('.body [data-reader-block]').length`), article.blocks.length);
  assert.equal(await page.eval(`document.querySelector('.body strong em code').textContent`), 'Emphasized linked code');
  assert.equal(await page.eval(`document.querySelectorAll('.body br').length`), 1);
  assert.equal(await page.eval(`document.querySelector('a[href^="javascript:"]')`), null);
  assert.equal(await page.eval(`document.querySelector('.reader-image img').alt`), 'Coastal cliffs');
  const meta = await page.eval<string>(`document.querySelector('.article-meta').textContent`);
  assert.match(meta, /Sam Author/); assert.match(meta, /reader.example.com/); assert.match(meta, /Sep 28, 2026/); assert.match(meta, /Updated Sep 30, 2026/);
  assert.equal(await page.eval(`document.querySelectorAll('.listening-links a').length`), 2);
  assert.equal(await page.eval(`document.querySelectorAll('.reader-outline a').length`), 3);
  assert.deepEqual(await page.eval(`Array.from(document.querySelectorAll('.body h2')).map(n => n.dataset.anchor)`), ['preparation', 'repeated', 'repeated-2']);
  if (process.env.READER_UI_SCREENSHOTS) {
    await page.eval(`window.__releaseImages()`);
    await page.waitFor(`document.querySelector('.reader-image img.on')?.naturalWidth > 0`, 'screenshot image to decode');
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${process.env.READER_UI_SCREENSHOTS}/reader-narrow.png`, Buffer.from(shot.data, 'base64'));
  }
  await page.click('.reader-outline summary');
  await page.click('.reader-outline a:last-child');
  await page.waitFor(`document.activeElement.textContent === 'Closing notes'`, 'outline navigation to focus its heading');
  const toolbar = await page.eval<{ top: number; reader: number; visible: boolean }>(`(() => { const n = document.querySelector('.reader-top'); const r = n.getBoundingClientRect(); const top = document.getElementById('reader').getBoundingClientRect().top; return { top: r.top, reader: top, visible: r.bottom > 0 && r.top < innerHeight }; })()`);
  assert.ok(toolbar.visible && Math.abs(toolbar.top - toolbar.reader) <= 20, `reader actions remain at the scroll viewport edge: ${JSON.stringify(toolbar)}`);
  assert.ok(await page.eval<boolean>(`document.documentElement.scrollWidth <= innerWidth`), 'narrow reader fits the viewport');
  await page.eval(`window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen', theme: 'dark' } }, '*')`);
  await page.waitFor(`document.documentElement.classList.contains('fullscreen')`, 'fullscreen reader');
  await page.eval(`document.querySelector('.body h2:last-of-type').scrollIntoView({ block: 'start' })`);
  assert.ok(await page.eval<boolean>(`(() => { const n = document.querySelector('.reader-top'); const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 15, r.top + r.height / 2); return r.top >= document.querySelector('.bar').getBoundingClientRect().bottom - 1 && hit && n.contains(hit); })()`), 'fullscreen actions remain visible below the room bar');
  if (process.env.READER_UI_SCREENSHOTS) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${process.env.READER_UI_SCREENSHOTS}/reader-dark-fullscreen.png`, Buffer.from(shot.data, 'base64'));
  }
  assert.deepEqual(page.problems, []);
});

test('reader UI: figures load lazily through bounded tool batches without moving content, failed media keeps source links', { skip }, async () => {
  await open();
  await page.waitFor(`window.__imageBatches.length === 1`, 'first near-visible figure request');
  assert.deepEqual(await page.eval(`window.__imageBatches`), [['https://images.example.com/coast.png']]);
  const before = await page.eval<number>(`document.querySelector('[data-reader-block="2"]').getBoundingClientRect().top`);
  assert.equal(await page.eval(`document.querySelector('.reader-image img').getAttribute('src')`), null);
  await page.eval(`window.__releaseImages()`);
  await page.waitFor(`document.querySelector('.reader-image img.on')?.naturalWidth > 0`, 'guarded data URI to decode');
  assert.equal(await page.eval(`document.querySelector('[data-reader-block="2"]').getBoundingClientRect().top`), before, 'image decoding reserves the same layout height');
  assert.equal(await page.eval(`document.querySelectorAll('iframe, video, audio').length`), 0);
  assert.ok(await page.eval<boolean>(`[...document.images].every(n => !n.src || n.src.startsWith('data:'))`), 'reader images never directly fetch a publisher URL');
  await page.eval(`document.querySelector('.body figure:last-of-type').scrollIntoView({ block: 'start' })`);
  await page.waitFor(`window.__imageBatches.length === 2`, 'distant figure to be requested on approach');
  assert.ok(await page.eval<boolean>(`window.__imageBatches.every(batch => batch.length <= 24)`));
  assert.equal(await page.eval(`document.querySelector('.body figure:last-of-type a').href`), 'https://images.example.com/unavailable.png');
  assert.equal(await page.eval(`document.querySelector('.reader-media a').href`), 'https://example.com/coastal-film');
  assert.doesNotMatch(await page.eval<string>(`document.querySelector('.prov').textContent`), /Text only/);
  assert.deepEqual(page.problems, []);
});

test('reader UI: nested selection handoff preserves logical position; passage and heading identity beat stale offsets', { skip }, async () => {
  await open();
  await page.eval(`(() => { const n = document.querySelector('[data-reader-block="4"]'); const range = document.createRange(); range.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(range); })()`);
  await page.waitFor(`document.querySelector('.passage-bar')`, 'nested list selection actions');
  await page.click('.passage-bar button:nth-child(3)');
  const call = await page.waitFor<{ args: { anchor: { block: number; heading: string }; passage: string } }>(`window.__calls.find(c => c.name === 'create_handoff')`, 'the selected passage handoff');
  assert.equal(call.args.anchor.block, 4); assert.equal(call.args.anchor.heading, 'preparation'); assert.equal(call.args.passage, article.blocks[4]!.text);
  await open({ handoff: { url: article.url, anchor: { block: 999, heading: 'Closing notes' }, passage: article.blocks[4]!.text } });
  await page.click('.handoff-note button');
  await page.waitFor(`Math.abs(document.querySelector('[data-reader-block="4"]').getBoundingClientRect().top - document.querySelector('#reader').getBoundingClientRect().top) < 100`, 'handoff passage match in the nested item');
  await open({ reading: { status: 'opened', anchor: { block: 20, heading: 'preparation' }, progress: 0.5 } });
  await page.waitFor(`Math.abs(document.querySelector('[data-reader-block="20"]').getBoundingClientRect().top - document.querySelector('#reader').getBoundingClientRect().top) < 100`, 'exact resume within the same identified section');
  await open({ reading: { status: 'opened', anchor: { block: 20, heading: 'Closing notes' }, progress: 0.85 } });
  await page.waitFor(`Math.abs(document.querySelector('.body h2:last-of-type').getBoundingClientRect().top - document.querySelector('#reader').getBoundingClientRect().top) < 100`, 'heading wins when the numeric block falls outside its section');
  await open({ reading: { status: 'opened', anchor: { block: 999, heading: 'Closing notes' }, progress: 0.85 } });
  await page.waitFor(`document.querySelector('#reader').scrollTop > 0`, 'saved heading resume');
  assert.equal(await page.eval(`window.__calls.some(c => c.name === 'record_reading' && c.args.status === 'read')`), false);
  await open({ reading: { status: 'opened', anchor: { block: 999 }, progress: 0.85 } });
  assert.ok(await page.eval<number>(`document.querySelector('#reader').scrollTop`) > 0, 'legacy out-of-range indexes clamp to existing content');
  assert.deepEqual(page.problems, []);
});

test('reader UI: short articles suppress the outline and invalid dates do not enter the header', { skip }, async () => {
  await open({ article: { ...article, wordCount: 100, publishedAt: 'invalid', updatedAt: 'invalid', blocks: [{ type: 'h', text: 'Preparation', level: 2 }, ...article.blocks.slice(1, 13)] } });
  assert.equal(await page.eval(`document.querySelectorAll('.article-meta time').length`), 0);
  assert.equal(await page.eval(`document.querySelector('.reader-outline')`), null);
  assert.equal(await page.eval(`document.querySelector('.body h2').dataset.anchor`), 'section-preparation');
  assert.deepEqual(page.problems, []);
});

test('reader UI: every code example copies exact text and clipboard denial selects a usable fallback', { skip }, async () => {
  const text = 'echo "hello"\n  preserve indentation\n';
  await open({ width: 360, article: { ...article, blocks: [
    { type: 'pre', text },
    { type: 'pre', text: 'second example', lang: 'shell', label: 'a-very-long-file-name-that-must-fit-on-a-small-screen.sh' },
    { type: 'table', text: '', columns: ['Option', 'Description'], rows: [['long-option-'.repeat(30), 'A wide table.']] },
  ] } });
  await page.eval(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } })`);
  await page.click('.body .code .copy');
  await page.waitFor(`window.__copied !== undefined`, 'code copy');
  assert.equal(await page.eval(`window.__copied`), text);
  await page.eval(`navigator.clipboard.writeText = async () => { throw new Error('clipboard denied'); }`);
  await page.click('.body .code .copy');
  await page.waitFor(`getSelection().rangeCount && getSelection().getRangeAt(0).toString() === ${JSON.stringify(text)}`, 'the full source range to be selected after clipboard rejection');
  assert.match(await page.eval<string>(`document.getElementById('toast').textContent`), /Text selected/);
  await page.eval(`document.querySelector('.table-wrap').focus()`);
  assert.equal(await page.eval(`document.activeElement.getAttribute('aria-label')`), 'Scrollable table');
  assert.ok(await page.eval<boolean>(`[...document.querySelectorAll('th')].every(n => n.scope === 'col')`));
  assert.ok(await page.eval<boolean>(`document.documentElement.scrollWidth <= innerWidth`), 'code labels and wide tables stay inside the narrow reader');
  assert.deepEqual(page.problems, []);
});

test('reader UI: Escape dismisses passage and outline before leaving, headings scale with text preferences', { skip }, async () => {
  await open({ width: 380 });
  await page.click('.reader-outline summary');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await page.eval(`document.querySelector('.reader-outline').open`), false);
  assert.equal(await page.eval(`document.getElementById('reader').hidden`), false);
  await page.eval(`(() => { const p = document.querySelector('.body p'); const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await page.waitFor(`document.querySelector('.passage-bar')`, 'selected passage controls');
  assert.ok(await page.eval<boolean>(`(() => { const r = document.querySelector('.passage-bar').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`));
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await page.eval(`document.querySelector('.passage-bar')`), null);
  assert.equal(await page.eval(`document.getElementById('reader').hidden`), false);
  await page.eval(`document.documentElement.style.fontSize = '200%'`);
  assert.ok(await page.eval<boolean>(`parseFloat(getComputedStyle(document.querySelector('.reader h1')).fontSize) > parseFloat(getComputedStyle(document.querySelector('.body p')).fontSize)`));
  assert.ok(await page.eval<boolean>(`parseFloat(getComputedStyle(document.querySelector('.body h2')).fontSize) > parseFloat(getComputedStyle(document.querySelector('.body p')).fontSize)`));
  assert.ok(await page.eval<boolean>(`document.documentElement.scrollWidth <= innerWidth`));
  assert.deepEqual(page.problems, []);
});

test('reader UI: multi-paragraph list items and nested parent tails retain order, grouping and passage identity', { skip }, async () => {
  await open({ article: continuationArticle });
  assert.equal(await page.eval(`document.querySelectorAll('.body > ol').length`), 2, 'a parent continuation does not split the numbered group');
  assert.equal(await page.eval(`document.querySelectorAll('.body > ol:first-of-type > li').length`), 2, 'continuation paragraphs do not add numbered items');
  assert.equal(await page.eval(`document.querySelectorAll('.body > ul').length`), 0, 'the child list stays inside its parent item');
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ol > li').children).map(n => n.dataset.readerBlock || n.tagName)`), ['1', '2', 'UL', '5'], 'parent tail follows its nested list inside the same item');
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ol > li > ul > li').children).map(n => n.dataset.readerBlock)`), ['3', '4']);
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ol > li:nth-child(2)').children).map(n => n.dataset.readerBlock)`), ['6', '7']);
  assert.deepEqual(await page.eval(`Array.from(document.querySelectorAll('.body [data-reader-block]')).map(n => Number(n.dataset.readerBlock))`), continuationArticle.blocks.map((_, i) => i), 'logical traversal retains source order through semantic groups');
  assert.equal(await page.eval(`document.querySelector('[data-reader-block="10"]').parentElement.className`), 'body', 'unmatched metadata cannot attach prose to an unrelated item');
  await page.eval(`(() => { const n = document.querySelector('[data-reader-block="4"]'); const range = document.createRange(); range.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(range); })()`);
  await page.waitFor(`document.querySelector('.passage-bar')`, 'the nested continuation selection actions');
  await page.click('.passage-bar button:nth-child(3)');
  const call = await page.waitFor<{ args: { anchor: { block: number; heading: string }; passage: string } }>(`window.__calls.find(c => c.name === 'create_handoff')`, 'nested continuation handoff');
  assert.equal(call.args.anchor.block, 4); assert.equal(call.args.anchor.heading, 'continuations');
  assert.equal(call.args.passage, continuationArticle.blocks[4]!.text);
  assert.deepEqual(page.problems, []);
});

test('reader UI: media-first items retain list identity without placeholders or merging sibling values', { skip }, async () => {
  await open({ article: mediaListArticle });
  assert.equal(await page.eval(`document.querySelectorAll('.body > ol').length`), 1);
  assert.equal(await page.eval(`document.querySelectorAll('.body > ol > li').length`), 3);
  assert.deepEqual(await page.eval(`Array.from(document.querySelectorAll('.body > ol > li')).map(n => n.value)`), [3, 3, 4], 'distinct identities preserve intentional repeated numbering');
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ol > li').children).map(n => [n.tagName, n.dataset.readerBlock])`), [['FIGURE', '1'], ['P', '2']], 'first image and resumed text share one item with no empty placeholder');
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ol > li:nth-child(2)').children).map(n => n.dataset.readerBlock)`), ['3', '4']);
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ol > li:nth-child(3)').children).map(n => n.dataset.readerBlock)`), ['5', '6']);
  assert.equal(await page.eval(`document.querySelectorAll('.body > ul > li').length`), 4, 'unordered media-first siblings remain separate items');
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ul > li:nth-child(2)').children).map(n => n.dataset.readerBlock)`), ['9', '10']);
  assert.deepEqual(await page.eval(`Array.from(document.querySelector('.body > ul > li:nth-child(3)').children).map(n => n.dataset.readerBlock)`), ['11'], 'a figure-only item still has its semantic list marker');
  assert.deepEqual(await page.eval(`Array.from(document.querySelectorAll('.body [data-reader-block]')).map(n => Number(n.dataset.readerBlock))`), mediaListArticle.blocks.map((_, i) => i), 'every actual source block keeps its order and identity');
  assert.equal(await page.eval(`document.querySelector('[data-reader-block="14"]').parentElement.className`), 'body');
  assert.deepEqual(page.problems, []);
});

test('reader UI: page find matches literal text across formatting without changing authored content or passage identity', { skip }, async () => {
  const blocks: Article['blocks'] = [
    { type: 'p', text: 'Literal [a+b] and Mixed formatting.', spans: [{ text: 'Literal [a+b] and ' }, { text: 'Mixed ', strong: true }, { text: 'formatting.', em: true }] },
    { type: 'pre', text: '[a+b] in code' },
    { type: 'table', text: '', columns: ['Option', 'Description'], rows: [['one', 'two']] },
    ...Array.from({ length: 30 }, (_, i) => ({ type: 'p' as const, text: `Paragraph ${i}: enough content to scroll through the current page.` })),
    { type: 'p', text: 'Last [a+b] match.' },
  ];
  await open({ width: 360, article: { ...article, title: 'Finding things', blocks } });
  const before = await page.eval(`document.querySelector('.body').textContent`);
  await page.click('.reader-find-toggle');
  assert.equal(await page.eval(`document.activeElement.getAttribute('aria-label')`), 'Find in this page');
  const search = async (query: string) => page.eval(`(() => { const input = document.querySelector('.reader-find-input'); input.value = ${JSON.stringify(query)}; input.dispatchEvent(new Event('input')); })()`);
  await search('[a+b]');
  assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), '1 of 3');
  await page.click('[aria-label="Previous match"]');
  assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), '3 of 3');
  assert.ok(await page.eval<boolean>(`(() => { const match = document.querySelector('.reader-find-hit.current').getBoundingClientRect(); const top = document.querySelector('.reader-top').getBoundingClientRect(); return match.top >= top.bottom && match.bottom <= innerHeight; })()`), 'the active match stays below the expanded controls');
  await search('mixed formatting');
  assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), '1 of 1');
  assert.equal(await page.eval(`document.querySelectorAll('.reader-find-hit.current').length`), 2, 'one match spans strong and emphasis');
  assert.equal(await page.eval(`document.querySelector('.body strong').textContent`), 'Mixed ');
  await search('Copy');
  assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), 'No matches', 'code controls are not authored text');
  await search('OptionDescription');
  assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), 'No matches', 'table cell boundaries do not create fake phrases');
  await search('[a+b]');
  await page.eval(`document.querySelector('.reader-find-input').focus()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), '2 of 3');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 8 });
  assert.equal(await page.eval(`document.querySelector('.reader-find-count').textContent`), '1 of 3');
  assert.equal(await page.eval(`document.querySelector('.body').textContent`), before);
  assert.deepEqual(await page.eval(`Array.from(document.querySelectorAll('.body [data-reader-block]')).map(n => Number(n.dataset.readerBlock))`), blocks.map((_, i) => i));
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await page.eval(`document.querySelectorAll('.reader-find-hit').length`), 0);
  assert.equal(await page.eval(`document.querySelector('.body').textContent`), before);
  assert.equal(await page.eval(`document.activeElement.className`), 'btn reader-find-toggle');
  assert.equal(await page.eval(`document.getElementById('reader').hidden`), false);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', modifiers: 2 });
  assert.equal(await page.eval(`document.getElementById('readerFind').hidden`), false, 'Ctrl+F opens page find within the reader');
  assert.ok(await page.eval<boolean>(`document.documentElement.scrollWidth <= innerWidth`));
  assert.equal(await page.eval(`window.__calls.some(c => JSON.stringify(c).includes('[a+b]'))`), false, 'find queries remain local');
  assert.deepEqual(page.problems, []);
});
