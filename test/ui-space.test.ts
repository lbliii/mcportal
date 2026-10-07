/** The owner controls as real keyboard/mouse interactions, with an isolated MCP host. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findChrome, Page } from './browser.ts';
import { startApp } from './helpers.ts';

const chrome = findChrome();
test('Space browser: preview before enabling, independent visibility, pin/order/hide, and visitor controls on a narrow screen', { skip: !chrome && 'no Chrome installed' }, async () => {
  const app = await startApp({ allowUnauthenticated: true });
  const page = await Page.open(chrome!, { width: 390, height: 844 });
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(window, '__MCPORTAL_DEV__', { get: () => undefined, set: () => {} });
      window.__calls = [];
      const sources = ['Alpha', 'Beta', 'Gamma'].map((title) => ({ title, source: 'rss', config: { url: 'https://example.com/' + title, limit: 10 }, key: 'source:' + title, pinned: false }));
      const people = [{ key: 'person:bob', handle: 'bob', pinned: false }];
      window.__space = { handle: 'alice', mine: true, followers: 0, following: false, posts: [], sources: [], people: [], sectionPreview: { sources, people } };
      function draw() {
        for (const [section, flag, pref] of [['sources', 'showSources', 'sourceCuration'], ['people', 'showPeople', 'peopleCuration']]) {
          const all = section === 'sources' ? sources : people;
          const c = window.__space[pref] || { pinned: [], order: [], hidden: [] };
          const rank = (key, list) => list.includes(key) ? list.indexOf(key) : list.length;
          const entries = all.map((entry) => ({ ...entry, pinned: c.pinned.includes(entry.key) })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank(a.key, a.pinned ? c.pinned : c.order) - rank(b.key, b.pinned ? c.pinned : c.order));
          window.__space.sectionPreview[section] = entries;
          window.__space[section] = window.__space[flag] ? entries.filter((entry) => !c.hidden.includes(entry.key)) : [];
        }
      }
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.method === 'ui/notifications/initialized') {
          window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { space: window.__space } } }, '*'); return;
        }
        if (!msg.id || !msg.method) return;
        event.stopImmediatePropagation();
        let result = {};
        if (msg.method === 'ui/initialize') result = { hostCapabilities: { serverTools: true }, hostContext: {} };
        if (msg.method === 'tools/call') {
          window.__calls.push(msg.params);
          if (msg.params.name === 'set_public_profile') { Object.assign(window.__space, msg.params.arguments); draw(); }
          result = { structuredContent: msg.params.name === 'open_space' ? { space: window.__space } : { profile: window.__space } };
        }
        window.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
      });` });
    await page.goto(`${app.base}/preview`);
    const sourceToggle = '[aria-label="Show sources I follow on my Space"]';
    const peopleToggle = '[aria-label="Show people I follow on my Space"]';
    await page.waitFor(`document.querySelector(${JSON.stringify(sourceToggle)})`, 'owner settings');
    await page.click(sourceToggle);
    await page.waitFor(`!document.querySelector('.space-section-preview').hidden`, 'the source preview');
    assert.match(await page.eval<string>(`document.querySelector('.space-section-preview').textContent`), /Alpha.*Beta.*Gamma/);
    assert.deepEqual(await page.eval(`window.__calls`), [], 'checkbox alone does not publish');
    await page.click('.space-section-preview .btn:last-child');
    assert.deepEqual(await page.eval(`window.__calls`), [], 'Cancel does not publish');
    await page.click(sourceToggle);
    await page.click('.space-section-preview .btn');
    await page.waitFor(`document.querySelector('.space-section-settings .byline').textContent.includes('Updates automatically')`, 'enabled sources');
    assert.deepEqual(await page.eval(`window.__calls[0]`), { name: 'set_public_profile', arguments: { showSources: true } });
    assert.equal(await page.eval(`document.querySelector(${JSON.stringify(peopleToggle)}).checked`), false, 'sections enable independently');
    await page.click('.space-curation summary');
    await page.click('[aria-label="Pin Gamma"]');
    await page.waitFor(`document.querySelector('.sources .st').textContent.startsWith('Gamma')`, 'pinned source first');
    assert.equal(await page.eval(`document.activeElement.getAttribute('aria-label')`), 'Unpin Gamma', 'focus follows the pin action');
    await page.click('[aria-label="Hide Alpha"]');
    await page.waitFor(`!document.querySelector('.sources').textContent.includes('Alpha')`, 'source hidden from public list');
    await page.click('[aria-label="Show Alpha"]');
    await page.waitFor(`document.querySelector('.sources').textContent.includes('Alpha')`, 'source restored');
    await page.click('[aria-label="Move Beta up"]');
    await page.waitFor(`window.__space.sourceCuration.order[0] === 'source:Beta'`, 'source reordered');
    assert.deepEqual(await page.eval(`Array.from(document.querySelectorAll('.sources .st > div:first-child')).map((n) => n.textContent)`), ['GammaPinned', 'Beta', 'Alpha']);
    await page.click(peopleToggle);
    await page.click('.space-section-settings:has([aria-label="Show people I follow on my Space"]) .space-section-preview .btn');
    await page.waitFor(`window.__space.showPeople === true && document.querySelector('.sources .link-btn')`, 'Fellow travelers');
    await page.click(sourceToggle);
    await page.waitFor(`window.__space.showSources === false && !document.querySelector('.sources .st')`, 'sources disabled');
    assert.equal(await page.eval(`window.__space.showPeople`), true, 'hiding sources does not hide people');
    assert.deepEqual(await page.eval(`window.__space.sourceCuration.pinned`), ['source:Gamma'], 'visibility keeps curation');
    assert.equal(await page.eval(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'controls fit a narrow screen');
    await page.eval(`window.__space.mine = false; delete window.__space.sectionPreview; window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { space: window.__space } } }, '*')`);
    await page.waitFor(`!document.querySelector('.space-section-settings')`, 'visitor view');
    assert.equal(await page.eval(`document.querySelector('.space-curation')`), null);
    assert.match(await page.eval<string>(`document.getElementById('reader').textContent`), /Fellow travelers.*@bob/);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); await app.close(); }
});
