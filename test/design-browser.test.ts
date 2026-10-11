import assert from 'node:assert/strict';
import { test } from 'node:test';
import { designControls } from '../scripts/design-controls.ts';
import { findChrome, Page } from './browser.ts';

const chrome = findChrome();

test('shared controls preserve compact geometry, live aliases, growing text and coarse-pointer targets', { skip: !chrome && 'no Chrome found' }, async () => {
  const page = await Page.open(chrome!, { width: 800, height: 900 });
  try {
    await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
    await page.waitFor(`document.querySelector('#measurements')?.textContent.includes('Field:')`, 'the live primitive catalogue');
    const heights = () => page.eval<number[]>(`[...document.querySelectorAll('[data-measure]')].map(n=>n.getBoundingClientRect().height)`);
    assert.deepEqual(await heights(), [28, 28, 28, 24, 28, 24, 32]);
    assert.equal(await page.eval(`document.querySelector('[data-measure=Button]').getBoundingClientRect().width === document.querySelector('[data-measure=Primary]').getBoundingClientRect().width`), true, 'emphasis preserves width as well as height');
    await page.eval(`document.documentElement.style.setProperty('--mp-space-12', '18px')`);
    assert.equal(await page.eval(`getComputedStyle(document.body).paddingTop`), '18px', 'semantic spacing follows its primitive alias');
    await page.eval(`document.documentElement.style.removeProperty('--mp-space-12')`);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    assert.ok((await heights()).every(height => height >= 44), 'real coarse-pointer preference enlarges every shared control');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    assert.deepEqual(await heights(), [28, 28, 28, 24, 28, 24, 32]);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await page.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; document.documentElement.style.fontSize='200%'`);
      const large = await heights();
      assert.ok(large[0]! > 28 && large[6]! > 32, 'text controls grow instead of clipping');
      assert.equal(large[0], large[1], 'primary emphasis does not enlarge the button');
      assert.equal(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), true, 'catalogue wraps at narrow large-text widths');
    }
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});
