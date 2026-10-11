import assert from 'node:assert/strict';
import { test } from 'node:test';
import { designControls } from '../scripts/design-controls.ts';
import { findChrome, Page } from './browser.ts';

const chrome = findChrome();

async function key(page: Page, key: string): Promise<void> {
  for (const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent',{type,key,...(type==='keyDown' && key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{}),code:key===' '?'Space':key,windowsVirtualKeyCode:({Escape:27,Tab:9,ArrowDown:40,ArrowUp:38,ArrowLeft:37,ArrowRight:39,Home:36,End:35,Enter:13,' ':32} as Record<string,number>)[key] || key.toUpperCase().charCodeAt(0)});
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

test('tabs expose one panel, skip disabled choices, activate manually and preserve focused reading across responsive overview', {skip:!chrome}, async()=>{
 const page=await Page.open(chrome!,{width:800,height:900});
 try {
  await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
  await page.click('#demoTab0');
  await key(page,'ArrowRight');
  assert.equal(await page.eval(`document.activeElement.id`),'demoTab2','disabled tab is skipped');
  assert.equal(await page.eval(`document.querySelector('#demoTab0').getAttribute('aria-selected')`),'true','arrow movement does not switch content');
  await key(page,'Enter');
  assert.deepEqual(await page.eval(`['demoPanel0','demoPanel2'].map(id=>document.getElementById(id).hidden)`),[true,false]);
  await key(page,'Home');assert.equal(await page.eval(`document.activeElement.id`),'demoTab0');
  await key(page,' ');await key(page,'Tab');
  assert.equal(await page.eval(`document.activeElement.id`),'demoPanel0','Tab moves from the selected tab into its panel');
  await page.eval(`(()=>{const first=el('div',null,'First source'),second=el('div',null,el('button',{id:'focused-source'},'Read source'));const demo=uiTabs({id:'responsive',label:'Responsive sources',overviewAbove:500,items:[{label:'First',panel:first},{label:'Second',panel:second}]});document.body.append(demo.element);})()`);
  await page.waitFor(`document.querySelector('#responsiveTab0').closest('[data-ui=tabs]').dataset.overview==='true'`,'wide overview');
  assert.deepEqual(await page.eval(`['responsivePanel0','responsivePanel1'].map(id=>[document.getElementById(id).hidden,document.getElementById(id).getAttribute('role')])`),[[false,'region'],[false,'region']]);
  await page.click('#focused-source');
  await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
  await page.waitFor(`document.querySelector('#responsiveTab1').getAttribute('aria-selected')==='true'`,'focused source retained on narrowing');
  assert.equal(await page.eval(`document.activeElement.id`),'focused-source');
  assert.equal(await page.eval(`document.querySelector('#responsivePanel0').hidden`),true);
  assert.deepEqual(page.problems,[]);
 } finally {await page.close();}
});

test('pills, native accordions, quiet actions and document links keep distinct interaction and visual contracts', {skip:!chrome}, async()=>{
 const page=await Page.open(chrome!);
 try {
  await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
  const before=await page.eval(`(()=>{const chip=document.querySelector('[data-ui=chip]');return [chip.offsetWidth,chip.offsetHeight,chip.textContent]})()`);
  await page.click('[data-ui=chip]');
  assert.deepEqual(await page.eval(`(()=>{const chip=document.querySelector('[data-ui=chip]');return [chip.offsetWidth,chip.offsetHeight,chip.textContent]})()`),before,'checkmark reserves space and label stays constant');
  assert.equal(await page.eval(`document.querySelector('[data-ui=chip]').getAttribute('aria-pressed')`),'true');
  assert.equal(await page.eval(`[...document.querySelectorAll('[data-ui=badge]')].every(n=>n.tabIndex===-1 && n.tagName==='SPAN')`),true);
  await page.click('details[name=demo-accordion] summary');
  assert.equal(await page.eval(`document.querySelector('details[name=demo-accordion]').open`),true);
  await page.eval(`document.querySelectorAll('details[name=demo-accordion] summary')[1].focus()`);
  await key(page,' ');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('details[name=demo-accordion]')].map(n=>n.open)`),[false,true]);
  assert.deepEqual(await page.eval(`['.btn.quiet','.ui-nav-link','.ui-document a'].map(selector=>getComputedStyle(document.querySelector(selector)).textDecorationLine)`),['none','none','underline']);
  const quiet=await page.eval<{x:number,y:number}>(`(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent==='Quiet');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...quiet});
  assert.notEqual(await page.eval(`getComputedStyle([...document.querySelectorAll('button')].find(n=>n.textContent==='Quiet')).backgroundColor`),'rgba(0, 0, 0, 0)','quiet has visible hover feedback');
  await page.click('#demo-drawer-trigger');
  await page.waitFor(`document.querySelector('#demo-drawer').open`,'drawer');
  assert.equal(await page.eval(`document.querySelector('#demo-drawer').getBoundingClientRect().right===innerWidth`),true);
  await page.eval(`document.querySelector('#demo-drawer input').focus()`);await key(page,'Escape');
  await page.waitFor(`!document.querySelector('#demo-drawer').open && document.activeElement.id==='demo-drawer-trigger'`,'drawer focus return');
  assert.deepEqual(page.problems,[]);
 } finally {await page.close();}
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
