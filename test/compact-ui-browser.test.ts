import assert from 'node:assert/strict';
import {test} from 'node:test';
import {designExperience,designExperienceTool,experienceViews} from '../scripts/design-experiences.ts';
import {findChrome,Page} from './browser.ts';
import {startApp} from './helpers.ts';
const chrome=findChrome();

test('optional tasks retain compact chrome and usable fields across narrow widths, enlarged text and touch', {skip:!chrome},async()=>{
 const app=await startApp({allowUnauthenticated:true});
 const page=await Page.open(chrome!,{width:1000,height:900});
 const fixtures=Object.fromEntries(experienceViews.map(view=>[view,designExperience(view)]));
 const responses=Object.fromEntries(['search_library','open_collection','catch_up','watch_reading'].map(name=>[name,designExperienceTool(name)]));
 try {
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`
   Object.defineProperty(window,'__MCPORTAL_DEV__',{get:()=>undefined,set:()=>{}});
   const fixtures=${JSON.stringify(fixtures)},responses=${JSON.stringify(responses)};
   window.addEventListener('message',event=>{
    const msg=event.data;
    if(msg.method==='ui/notifications/initialized'){
     window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:fixtures[new URL(location.href).searchParams.get('view')]}},'*');return;
    }
    if(!msg?.id||!msg.method)return;
    event.stopImmediatePropagation();
    let result={};
    if(msg.method==='ui/initialize')result={hostCapabilities:{serverTools:true},hostContext:{theme:'light',displayMode:'inline'}};
    if(msg.method==='tools/call'){
     const name=msg.params.name;
     const data=responses[name]||(name==='read_article'?{article:{url:msg.params.arguments.url,title:'A source',wordCount:10,blocks:[{type:'p',text:'Source evidence stays readable inside compact application chrome.'}],provenance:{endpoint:msg.params.arguments.url,fetchedAt:'2026-10-10T12:00:00Z',cached:false}}}:{});
     result={content:[],structuredContent:data};
    }
    window.postMessage({jsonrpc:'2.0',id:msg.id,result},'*');
   });`});
  for(const view of experienceViews){
   await page.goto(`${app.base}/preview?view=${view}`);
   await page.waitFor(`document.querySelector('#experiences:not([hidden]) ${view==='library'?'.recall-hit':'.ui-screen-header'}')` ,'optional task '+view).catch(async error=>{throw new Error(error.message+' '+JSON.stringify(await page.eval(`({url:location.href,body:document.body.innerText.slice(0,1800)})`))+' '+JSON.stringify(page.problems));});
   if(view==='changes'||view==='events')await page.click('.watch-add summary');
   if(view==='collections')await page.click('.collection-setup summary');
   await page.eval(`document.head.append(Object.assign(document.createElement('style'),{id:'densityScrollbars'}))`);
   for(const width of [360,760,1000])for(const scale of [1,2])for(const reservedScrollbars of [false,true]){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await page.eval(`document.documentElement.style.fontSize='${scale*100}%';document.documentElement.dataset.theme='${scale===1?'light':'dark'}';document.querySelector('#densityScrollbars').textContent=${JSON.stringify(reservedScrollbars?'::-webkit-scrollbar {width:15px;height:15px} .experiences {scrollbar-gutter:stable}':'')}`);
    // Allow ResizeObserver (comparison tabs) and layout to settle.
    await page.eval(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const failures=await page.eval<string[]>(`(()=>{
     const fail=[],scope=document.querySelector('#experiences'),visible=n=>n.getClientRects().length&&!n.closest('[hidden]');
     if(scope.scrollWidth>scope.clientWidth+1)fail.push('horizontal task overflow');
     for(const h of scope.querySelectorAll('.ui-screen-header h1'))if(parseFloat(getComputedStyle(h).fontSize)>${18*scale+.1})fail.push('oversized heading');
     for(const button of scope.querySelectorAll('button'))if(visible(button)&&getComputedStyle(button).textDecorationLine.includes('underline'))fail.push('underlined action');
     // Use the task viewport after scrollbar gutters, keeping the same 60px inset budget.
     const minimumFieldWidth=Math.min(${200*scale},scope.clientWidth-60);
     for(const input of scope.querySelectorAll('.ui-search-row input,.watch-setup input:not([type=checkbox])'))if(visible(input)&&input.getBoundingClientRect().width<minimumFieldWidth)fail.push('squeezed field: '+input.getBoundingClientRect().width+'px; minimum '+minimumFieldWidth+'px');
     for(const split of scope.querySelectorAll('.ui-split')){
      const [main,aside]=split.children;
      if(${width}===360&&aside.getBoundingClientRect().top<main.getBoundingClientRect().bottom-1)fail.push('supporting pane failed to stack');
     }
     for(const row of scope.querySelectorAll('.ui-result-row')){
      if(row.querySelectorAll('button').length!==2)fail.push('duplicate row actions');
      if(getComputedStyle(row.querySelector('.ui-result-title')).boxShadow!=='none')fail.push('extra title selection underline');
      if(${width}>=760&&${scale}===1&&row.getBoundingClientRect().height>140)fail.push('oversized result row');
     }
     return fail;
    })()`);
    assert.deepEqual(failures,[],`${view} at ${width}px/${scale*100}%${reservedScrollbars?' with reserved scrollbars':''}`);
   }
   await page.eval(`document.querySelector('#densityScrollbars').remove()`);
   await page.send('Emulation.setTouchEmulationEnabled',{enabled:true});
   await page.eval(`document.documentElement.style.fontSize='100%'`);
   assert.equal(await page.eval(`(()=>{const fields=[...document.querySelectorAll('#experiences input.field[type=checkbox]')].filter(n=>n.getClientRects().length);return fields.every(n=>n.offsetWidth<=16&&n.closest('label')?.offsetHeight>=44)})()`),true,view+' checkbox glyph/target separation');
   await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  }
  assert.deepEqual(page.problems,[]);
 }finally{await page.close();await app.close();}
});
