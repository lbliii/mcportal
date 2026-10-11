import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminHtml } from '../src/admin.ts';
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
  const edge=await page.eval<{right:number,viewport:number}>(`({right:document.querySelector('#demo-drawer').getBoundingClientRect().right,viewport:document.documentElement.clientWidth})`);
  assert.equal(edge.right,edge.viewport,'drawer meets the layout viewport edge, excluding a classic scrollbar');
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

test('forms associate native errors, preserve drafts on failure and reject duplicate submissions', {skip:!chrome}, async()=>{
  const page=await Page.open(chrome!);
  try {
    await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
    await page.click('#demo-form-submit');
    assert.equal(await page.eval(`document.activeElement.id`),'demo-form-name');
    assert.equal(await page.eval(`document.querySelector('#demo-form-name').getAttribute('aria-invalid')`),'true');
    await page.eval(`(()=>{const n=document.querySelector('#demo-form-name');n.value='https://example.com';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await page.eval(`document.querySelector('#demo-form-name').hasAttribute('aria-invalid')`),false);
    await page.click('#demo-form-submit');
    assert.equal(await page.eval(`document.querySelector('#demo-form').getAttribute('aria-busy')`),'true');
    await page.waitFor(`!document.querySelector('#demo-form .ui-form-error').hidden`,'inline failure');
    assert.equal(await page.eval(`document.querySelector('#demo-form-name').value`),'https://example.com');
    assert.equal(await page.eval(`document.querySelector('#demo-form-submit').disabled`),false);
    await page.eval(`(()=>{const submit=uiButton({label:'Submit',type:'submit'}),form=el('form',null,submit);window.submits=0;uiForm(form,{submit,onSubmit:()=>{window.submits++;return new Promise(resolve=>window.finishSubmit=resolve)}});document.body.append(form);form.requestSubmit();form.dispatchEvent(new Event('submit',{cancelable:true}));window.testForm=form;})()`);
    assert.equal(await page.eval(`window.submits`),1);
    await page.eval(`window.finishSubmit()`);
    await page.waitFor(`!window.testForm.hasAttribute('aria-busy')`,'completed form');
    assert.equal(await page.eval(`(()=>{const input=uiControl('input'),field=uiField(input,{label:'Handle'}),submit=uiButton({label:'Claim',type:'submit'}),form=el('form',null,field.element,submit);let wrote=false;document.body.append(form);uiForm(form,{submit,validate:()=>{field.setError('Enter a handle.');input.focus();return false;},onSubmit:()=>{wrote=true;}});form.requestSubmit();return !wrote && !input.disabled && document.activeElement===input && input.getAttribute('aria-invalid')==='true';})()`),true,'custom validation focuses the field before controls lock');
    assert.deepEqual(page.problems,[]);
  } finally {await page.close();}
});

test('rich popovers preserve radio keys, allow Tab out, dismiss without stealing outside focus, and fit enlarged narrow layouts', {skip:!chrome}, async()=>{
  const page=await Page.open(chrome!,{width:360,height:800});
  try {
    await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
    await page.click('#demo-popover-trigger');
    await page.waitFor(`document.querySelector('#demo-popover').matches(':popover-open')`,'rich popover');
    await page.eval(`document.querySelector('#demo-popover input[type=radio]:checked').focus()`);
    await key(page,'ArrowRight');
    assert.equal(await page.eval(`document.querySelector('#demo-popover input[type=radio]:checked').value`),'followers');
    await key(page,'Tab');assert.equal(await page.eval(`document.activeElement.id`),'demo-popover-note');
    await key(page,'Escape');
    assert.equal(await page.eval(`document.activeElement.id`),'demo-popover-trigger');
    await page.click('#demo-popover-trigger');
    await page.eval(`document.querySelector('#demo-form-name').focus()`);
    await page.waitFor(`!document.querySelector('#demo-popover').matches(':popover-open')`,'Tab/focus leaves nonmodal content');
    assert.equal(await page.eval(`document.activeElement.id`),'demo-form-name');
    await page.eval(`document.documentElement.style.fontSize='200%';document.documentElement.dataset.theme='dark'`);
    await page.click('#demo-popover-trigger');
    await page.waitFor(`(()=>{const b=document.querySelector('#demo-popover').getBoundingClientRect();return b.left>=0 && b.right<=document.documentElement.clientWidth && b.top>=0 && b.bottom<=innerHeight})()`,'positioned enlarged popover');
    assert.equal(await page.eval(`document.querySelector('#demo-popover').scrollWidth <= document.querySelector('#demo-popover').clientWidth`),true);
    // Content resizing while open repositions the panel, without requiring another click.
    await page.eval(`document.querySelector('#demo-popover').prepend(el('p',null,'More context. '.repeat(40)))`);
    await page.waitFor(`document.querySelector('#demo-popover').getBoundingClientRect().bottom<=innerHeight`,'resized popover');
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    assert.equal(await page.eval(`getComputedStyle(document.querySelector('#demo-popover .ui-choice')).minHeight`),'44px');
    assert.deepEqual(page.problems,[]);
  } finally {await page.close();}
});

test('notices queue and deduplicate, keep errors, pause on focus, and progress distinguishes unknown work from zero', {skip:!chrome}, async()=>{
  const page=await Page.open(chrome!);
  try {
    await page.goto(`data:text/html,${encodeURIComponent(designControls())}`);
    await page.eval(`(()=>{const anchor=uiButton({id:'notice-origin',label:'Origin'});document.body.append(anchor);anchor.focus();const region=el('div',{id:'test-notices'});document.body.append(region);window.notices=uiToasts(region);notices.show('First failure','error');notices.show('First failure','error');notices.show('Second failure','error');notices.show('Third failure','error');notices.show('Queued confirmation','success');})()`);
    await page.waitFor(`document.querySelector('#test-notices').textContent.includes('Third failure')`,'three notices');
    assert.equal(await page.eval(`document.activeElement.id`),'notice-origin','arrival never moves focus');
    assert.equal(await page.eval(`document.querySelectorAll('#test-notices .ui-toast').length`),3);
    assert.equal(await page.eval(`document.querySelectorAll('#test-notices [role=alert]').length`),3);
    await page.click('#test-notices button');
    await page.waitFor(`document.querySelector('#test-notices').textContent.includes('Queued confirmation')`,'FIFO notice');
    await page.eval(`document.querySelector('#test-notices .ui-toast:last-child button').focus()`);
    await new Promise(resolve=>setTimeout(resolve,6200));
    assert.equal(await page.eval(`document.querySelectorAll('#test-notices .ui-toast').length`),3,'focus pauses confirmation; errors have no timer');
    await page.eval(`document.querySelector('#notice-origin').focus()`);
    await page.waitFor(`document.querySelectorAll('#test-notices .ui-toast').length===2`,'confirmation expires after focus leaves');
    assert.equal(await page.eval(`document.querySelectorAll('#test-notices [role=alert]').length`),2);
    await page.eval(`(()=>{const unknown=uiProgress({label:'Unknown work'}),zero=uiProgress({label:'Known work',value:0,max:10});document.body.append(unknown,zero);})()`);
    assert.equal(await page.eval(`document.querySelector('progress[aria-label="Unknown work"]').hasAttribute('value')`),false);
    assert.equal(await page.eval(`document.querySelector('progress[aria-label="Known work"]').value`),0);
    assert.deepEqual(page.problems,[]);
  } finally {await page.close();}
});

test('admin invitations use the shared form lifecycle and keep failed drafts with a reachable inline error', {skip:!chrome}, async()=>{
  const page=await Page.open(chrome!);
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.inviteCalls=0;window.fetch=async(url)=>{
      if(url==='/admin/api/state')return new Response(JSON.stringify({csrf:'fixture',me:{login:'admin',accountId:'a'},invites:[],accounts:[],audit:[],reports:[]}));
      window.inviteCalls++;return new Promise(resolve=>window.rejectInvite=()=>resolve(new Response(JSON.stringify({error_description:'Fixture invite refused'}),{status:400})));
    };`});
    await page.goto(`data:text/html,${encodeURIComponent(await adminHtml('fixture'))}`);
    await page.waitFor(`document.querySelector('#me').textContent==='signed in as @admin'`,'admin data');
    await page.eval(`document.querySelector('#inviteLogin').value='someone';document.querySelector('#inviteForm').requestSubmit();document.querySelector('#inviteForm').dispatchEvent(new Event('submit',{cancelable:true}))`);
    assert.equal(await page.eval(`window.inviteCalls`),1);
    assert.equal(await page.eval(`document.querySelector('#inviteLogin').disabled`),true);
    await page.eval(`window.rejectInvite()`);
    await page.waitFor(`document.querySelector('#inviteForm .ui-form-error').textContent==='Fixture invite refused'`,'persistent inline server error');
    assert.equal(await page.eval(`document.querySelector('#inviteLogin').value`),'someone');
    assert.equal(await page.eval(`document.querySelector('#inviteLogin').disabled`),false);
    assert.deepEqual(page.problems,[]);
  } finally {await page.close();}
});
