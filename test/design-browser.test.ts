import assert from 'node:assert/strict';
import { test } from 'node:test';
import { designControls } from '../scripts/design-controls.ts';
import { findChrome, Page } from './browser.ts';

const chrome = findChrome();

async function key(page: Page, key: string): Promise<void> {
  for (const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:({Escape:27,Tab:9,ArrowDown:40,ArrowUp:38,Home:36,End:35} as Record<string,number>)[key] || key.toUpperCase().charCodeAt(0)});
}

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

test('component contracts enforce names and variants, associate field errors and keep busy actions stable', {skip:!chrome}, async()=>{
  const page=await Page.open(chrome!);
  try {
    await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
    await page.waitFor(`document.querySelector('#measurements')?.textContent.includes('Field:')`,'catalogue');
    assert.deepEqual(await page.eval(`[
      ()=>uiButton({label:' '}), ()=>uiButton({label:'Save',emphasis:'large'}),
      ()=>iconButton('plus','',()=>{}), ()=>iconButton('unknown','Unknown',()=>{}),
      ()=>uiFeedback({kind:'warning',message:'Unknown variant'})
    ].map(run=>{try{run();return false}catch{return true}})`),[true,true,true,true,true]);
    assert.deepEqual(await page.eval(`(()=>{
      const button=uiButton({label:'Save'});document.body.append(button);
      const width=button.getBoundingClientRect().width;
      uiBusy(button,true);uiBusy(button,true);
      const busy=button.disabled && button.getAttribute('aria-busy')==='true' && width===button.getBoundingClientRect().width && button.textContent==='Save';
      uiBusy(button,false);const reset=!button.disabled && !button.hasAttribute('aria-busy');
      button.disabled=true;uiBusy(button,true);uiBusy(button,false);const preserved=button.disabled;button.remove();return [busy,reset,preserved];
    })()`),[true,true,true]);
    await page.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Show error').click()`);
    assert.equal(await page.eval(`(()=>{const input=document.querySelector('#demo-source');return input.labels[0].textContent==='Source' && input.getAttribute('aria-invalid')==='true' && input.getAttribute('aria-describedby')==='demo-source-hint demo-source-error' && !document.querySelector('#demo-source-error').hidden})()`),true);
    await page.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Clear error').click()`);
    assert.equal(await page.eval(`document.querySelector('#demo-source').getAttribute('aria-describedby')`),'demo-source-hint');
    assert.equal(await page.eval(`document.querySelector('#demo-source').hasAttribute('aria-invalid')`),false);
    assert.equal(await page.eval(`!!document.querySelector('button button,button a,[data-ui=card] a button')`),false);
    assert.deepEqual(page.problems,[]);
  } finally {await page.close();}
});

test('production overlays support keyboard, disabled items, focus return and direct touch activation', {skip:!chrome}, async()=>{
  const page=await Page.open(chrome!,{width:360,height:800});
  try {
    await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
    await page.click('#demo-menu-trigger');
    await page.waitFor(`document.activeElement.textContent==='Collections'`,'first menu action');
    await key(page,'ArrowDown'); assert.equal(await page.eval(`document.activeElement.textContent`),'Page updates');
    await key(page,'End'); assert.equal(await page.eval(`document.activeElement.textContent`),'Events');
    await key(page,'Home'); assert.equal(await page.eval(`document.activeElement.textContent`),'Collections');
    await key(page,'p'); assert.equal(await page.eval(`document.activeElement.textContent`),'Page updates');
    await key(page,'Escape');
    await page.waitFor(`document.activeElement.id==='demo-menu-trigger' && !document.querySelector('#demo-menu').matches(':popover-open')`,'menu focus return');
    await key(page,'ArrowUp'); await page.waitFor(`document.activeElement.textContent==='Events'`,'last item from ArrowUp');
    await key(page,'Tab'); await page.waitFor(`!document.querySelector('#demo-menu').matches(':popover-open')`,'Tab leaves menu');
    await page.click('#demo-dialog-trigger');
    await page.waitFor(`document.activeElement.getAttribute('aria-label')==='Close settings'`,'dialog initial focus');
    for(let i=0;i<4;i++) {await key(page,'Tab'); assert.equal(await page.eval(`!!document.activeElement.closest('#demo-dialog')`),true,'native modal contains keyboard focus');}
    await page.waitFor(`document.querySelector('#controlTooltip').matches(':popover-open')`,'immediate focus hint');
    await key(page,'Escape'); assert.equal(await page.eval(`document.querySelector('#demo-dialog').open`),true,'first Escape dismisses the hint');
    await key(page,'Escape'); await page.waitFor(`!document.querySelector('#demo-dialog').open && document.activeElement.id==='demo-dialog-trigger'`,'dialog focus return');
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    const point=await page.eval<{x:number,y:number}>(`(()=>{const n=document.querySelector('#demo-menu-trigger');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitFor(`document.querySelector('#demo-menu').matches(':popover-open')`,'touch menu');
    assert.equal(await page.eval(`(()=>{const box=document.querySelector('#demo-menu').getBoundingClientRect();return box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight})()`),true,'menu stays inside narrow viewport');
    assert.deepEqual(page.problems,[]);
  } finally {await page.close();}
});
