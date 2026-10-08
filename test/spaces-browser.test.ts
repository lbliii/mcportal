import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { Accounts, makeBootstrap, memoryPersistence } from '../src/accounts.ts';
import { PublicProfiles } from '../src/public-profiles.ts';
import { DocumentSocialStore, Social } from '../src/social.ts';
import { findChrome, Page } from './browser.ts';
import { startApp } from './helpers.ts';

const chrome = findChrome();
test('Spaces in a browser: owner side panel, pins, native host modes, narrow/dark/forced colors and script-free web formats', { skip: !chrome && 'Chrome unavailable' }, async () => {
  const accounts = new Accounts(memoryPersistence(), makeBootstrap([], [], true));
  const admitted = await accounts.admit({ githubId: 101, login: 'Alice' }); assert.ok(admitted.ok);
  const id = admitted.account.id;
  const profiles = new PublicProfiles(memoryPersistence());
  const social = new Social({ store: new DocumentSocialStore(), profiles, accountCreatedAt: () => Date.parse('2026-10-06T12:00Z') });
  await profiles.set(id, { handle: 'alice', spaceTitle: 'Signals from another shore', bio: 'Essays, drawings, and things found along the way.', ink: 'atomic', motif: 'orbits', frequency: ['art', 'far horizons'], travelers: ['bob'], sources: [{ title: 'The quiet web', source: 'rss', config: { url: 'https://example.com/feed' } }] });
  await profiles.set('b', { handle: 'bob', listed: true, ink: 'pulp', motif: 'portal' });
  const posts = [];
  for (const title of ['A notebook from the future', 'The shape of a good question', 'Small islands in the web']) posts.push(await social.share(id, { kind: 'link', title, url: 'https://example.com/story', note: 'A small signal worth passing along.', audience: 'everyone' }));
  const { accountId: _id, travelers: _travelers, ...pub } = (await profiles.get(id))!;
  const space = { ...pub, ...await social.spaceDetails(id, id), mine: true, followers: 3, following: false, posts, sources: pub.sources, link: 'https://mcportal.example/@alice' };
  const app = await startApp({ github: { clientId: 'client', clientSecret: 'secret' }, staticUser: id, allowUnauthenticated: true }, undefined, { accounts, publicProfiles: profiles, social });
  const page = await Page.open(chrome!);
  const capture = async (name: string) => {
    if (!process.env.SPACES_CAPTURE_DIR) return;
    await mkdir(process.env.SPACES_CAPTURE_DIR, { recursive: true });
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(process.env.SPACES_CAPTURE_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  };
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(window, '__MCPORTAL_DEV__', { get: () => undefined, set: () => {} });
      window.addEventListener('message', async (event) => {
        const msg = event.data;
        if (!msg?.id || !msg.method) return;
        event.stopImmediatePropagation();
        let result = {};
        window.__writes ||= [];
        if (msg.method === 'tools/call') {
          const name = msg.params.name;
          if (name === 'set_public_profile') window.__writes.push(msg.params.arguments);
          if ((name === 'set_public_profile' && window.__failWrite) || (name === 'open_space' && window.__failRead)) {
            window.__failWrite = window.__failRead = false;
            window.postMessage({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'Temporary fixture failure' }] } }, '*'); return;
          }
        }
        if (msg.method === 'ui/initialize') {
          result = { hostCapabilities: { serverTools: true }, hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } };
          setTimeout(() => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { space: ${JSON.stringify(space)} } } }, '*'), 50);
        } else if (msg.method === 'tools/call') {
          const response = await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: msg.id, method: 'tools/call', params: msg.params }) });
          result = (await response.json()).result;
        }
        window.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
      });` });
    await page.goto(`${app.base}/preview`);
    await page.waitFor(`document.querySelector('.space-owner-view')`, 'the owner controls');
    assert.equal(await page.eval(`document.getElementById('spaceCustomization').hidden`), true);
    await page.click('.space-customize-toggle');
    await page.waitFor(`!document.getElementById('spaceCustomization').hidden`, 'the side panel');
    for (const format of ['paperback', 'magazine', 'patch']) {
      await page.click(`[data-space-format-choice="${format}"]`);
      await page.waitFor(`document.querySelector('.space-owner-status').textContent === 'Saved' && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'the completed save');
      await page.waitFor(`document.querySelector('[data-space-format="${format}"]')`, `the saved ${format}`);
      assert.equal((await profiles.get(id))?.format, format);
      for (const [width, mode] of [[480, 'inline'], [1280, 'fullscreen']] as const) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        for (const theme of ['light', 'dark']) {
          await page.eval(`window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: '${mode}', theme: '${theme}' } }, '*')`);
          await page.waitFor(`document.documentElement.dataset.theme === '${theme}'`, 'the host theme');
          assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth + 1`), `${format} fits ${width}/${theme}`);
          assert.ok(await page.eval(`document.querySelector('.space-sheet h1').getBoundingClientRect().width > 0`));
          const fill = await page.eval<string>(`getComputedStyle(document.querySelector('.space-sheet .art .ap')).fill`);
          assert.notEqual(fill, 'rgb(0, 0, 0)', 'the cover paper always resolves to its ink palette');
          assert.ok(await page.eval(`document.querySelector('.space-head .who').getBoundingClientRect().width > 40`), 'the call sign does not inherit the compact account button');
          assert.equal(await page.eval(`(() => { const ids = [...document.querySelectorAll('.space-sheet [id]')].map(n => n.id); return ids.length === new Set(ids).size; })()`), true, 'SVG patterns and section IDs are unique');
          if (width === 480) assert.equal(await page.eval(`getComputedStyle(document.querySelector('.space-columns')).gridTemplateColumns.split(' ').length`), 1, 'narrow cards stack by container width');
          await capture(`native-${format}-${width}-${theme}`);
        }
      }
    }
    // A page refresh must not replace the editor, draft fields, disclosures or focus.
    await page.click('#space-tab-content');
    await page.eval(`document.querySelector('[aria-label="Space title"]').value = 'Draft for later'; document.querySelector('.space-owner-stamps').open = true`);
    await page.click('#space-tab-appearance');
    await page.eval(`document.querySelector('[aria-label="pulp palette"]').focus(); document.querySelector('[aria-label="pulp palette"]').click()`);
    await page.waitFor(`document.querySelector('.space-owner-status').textContent === 'Saved' && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'appearance save');
    assert.equal(await page.eval(`document.activeElement.getAttribute('aria-label')`), 'pulp palette');
    assert.equal(await page.eval(`document.querySelector('[aria-label="Space title"]').value`), 'Draft for later');
    assert.equal(await page.eval(`document.querySelector('.space-owner-stamps').open`), true);
    await page.click('[data-space-post]');
    await page.waitFor(`document.querySelector('[aria-label="Back to the space"]')`, 'the opened post');
    await page.click('[aria-label="Back to the space"]');
    assert.equal(await page.eval(`document.getElementById('spaceCustomization').hidden`), false);
    assert.equal(await page.eval(`document.querySelector('[aria-label="Space title"]').value`), 'Draft for later');
    // Rejected changes revert their controls and can be retried in place.
    await page.click('#space-tab-visibility');
    await page.eval(`window.__failWrite = true; document.querySelector('[aria-label="Include me in discovery"]').click()`);
    await page.waitFor(`document.querySelector('.save-error') && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'a rejected save');
    assert.equal(await page.eval(`document.querySelector('[aria-label="Include me in discovery"]').checked`), false);
    await page.click('.space-owner-retry');
    await page.waitFor(`document.querySelector('.space-owner-status').textContent === 'Saved' && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'the retry');
    assert.equal((await profiles.get(id))?.listed, true);
    await page.click('[aria-label="Include me in discovery"]');
    await page.waitFor(`document.querySelector('.space-owner-status').textContent === 'Saved' && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'discovery cleared');
    assert.equal(await page.eval(`document.querySelector('[aria-label="Include me in discovery"]').checked`), false);
    await page.click('[aria-label="Public Space"]');
    await page.waitFor(`document.querySelector('.space-owner-status').textContent === 'Saved' && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'private Space');
    assert.equal(await page.eval(`document.querySelector('[aria-label="Public Space"]').checked`), false);
    await page.click('[aria-label="Public Space"]');
    await page.waitFor(`document.querySelector('.space-owner-status').textContent === 'Saved' && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'public Space restored');
    assert.equal(await page.eval(`document.querySelector('[aria-label="Public Space"]').checked`), true);
    // If only the read fails, retry must not repeat a successful randomization.
    await page.click('#space-tab-appearance');
    await page.eval(`window.__failRead = true; [...document.querySelectorAll('#space-settings-appearance button')].find(n => n.textContent.includes('Shuffle composition')).click()`);
    await page.waitFor(`document.querySelector('.save-error') && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'failed preview refresh');
    const writes = await page.eval<number>(`window.__writes.length`);
    const committedSeed = (await profiles.get(id))!.cover!.seed;
    await page.click('.space-owner-retry');
    await page.waitFor(`document.querySelector('.space-owner-status').textContent === 'Saved' && !document.getElementById('spaceCustomization').hasAttribute('aria-busy')`, 'refresh retry');
    assert.equal(await page.eval(`window.__writes.length`), writes);
    assert.equal((await profiles.get(id))!.cover!.seed, committedSeed);
    // Roving tabs and Escape preserve a predictable keyboard return path.
    await page.eval(`document.getElementById('space-tab-appearance').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`);
    assert.equal(await page.eval(`document.activeElement.id`), 'space-tab-content');
    await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert.equal(await page.eval(`document.getElementById('spaceCustomization').hidden`), true);
    assert.equal(await page.eval(`document.activeElement.classList.contains('space-customize-toggle')`), true);
    await page.click('.space-customize-toggle');
    await page.click('#space-tab-appearance');
    await page.click('[data-space-pin]');
    await page.waitFor(`document.querySelector('.space-pinned')`, 'the saved pinned post');
    assert.ok((await profiles.get(id))?.pinnedShareId);
    await page.click('.space-tabs a[href="#space-travelers"]');
    assert.equal(await page.eval(`document.getElementById('space-travelers').hidden`), false);
    assert.equal(await page.eval(`document.getElementById('space-posts').hidden`), true);
    const seed = (await profiles.get(id))!.cover!.seed;
    await page.eval(`[...document.querySelectorAll('#space-settings-appearance button')].find(n => n.textContent.includes('Shuffle composition')).click()`);
    await page.waitFor(`document.getElementById('space-posts') && !document.getElementById('space-posts').hidden`, 'rerender after re-roll');
    assert.notEqual((await profiles.get(id))!.cover!.seed, seed);
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    assert.equal(await page.eval(`getComputedStyle(document.querySelector('.space-avatar')).display`), 'none');
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    assert.deepEqual(page.problems, []);
    // The public route uses the actual server renderer, with all scripts absent.
    for (const format of ['paperback', 'magazine', 'patch']) {
      await profiles.set(id, { format });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 1000, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${app.base}/@alice`);
      assert.equal(await page.eval(`document.querySelectorAll('script').length`), 0);
      assert.equal(await page.eval(`document.querySelectorAll('.space-owner-view').length`), 0, 'the public page has no customization controls');
      assert.equal(await page.eval(`document.querySelector('.space-sheet').dataset.spaceFormat`), format);
      assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth + 1`), `public ${format} fits narrow width`);
      assert.equal(await page.eval(`document.querySelector('.space-sheet .follow').getAttribute('href')`), '/@alice/signin');
      assert.ok(await page.eval(`document.querySelector('link[rel="alternate"]').href.endsWith('/@alice/feed')`));
      await capture(`public-${format}`);
    }
  } finally { await page.close(); await app.close(); }
});
