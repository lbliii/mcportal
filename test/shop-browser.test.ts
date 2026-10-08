import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TtlCache} from '../src/lib/cache.ts';
import {MemoryWatchStore} from '../src/watches.ts';
import {MemoryProfileStore} from '../src/store.ts';
import {defaultProfile,validateProfile} from '../src/profile.ts';
import {createFixtureFetcher} from '../src/lib/fixture-fetch.ts';
import {findChrome,Page} from './browser.ts';
import {startApp} from './helpers.ts';
import {SHOP,shopFetcher} from './fixtures/shopify.ts';
const chrome=findChrome();
test('Shop browser: scope preview → confirm → gallery → save → pause/resume → remove, with narrow/dark layouts', {skip:!chrome&&'Chrome unavailable'},async()=>{
  let now=Date.now();
  const {state,fetcher}=shopFetcher(),store=new MemoryProfileStore({default:validateProfile({...defaultProfile(),onboarded:true})}),watchStore=new MemoryWatchStore();
  const app=await startApp({allowUnauthenticated:true},async(url,options)=>url.startsWith(SHOP)?fetcher(url,options):createFixtureFetcher()(url,options),{store,watchStore,now:()=>now,cache:new TtlCache({now:()=>now})});
  const page=await Page.open(chrome!);
  try {
    await page.goto(app.base+'/preview');await page.waitFor(`document.querySelector('#btnAdd')&&!document.querySelector('#mainBar').hidden && document.querySelector('.continue-reading')?.getAttribute('aria-busy')==='false' && !document.querySelector('.skeleton')`,'room hydration ready before measuring click coordinates');
    await page.click('#btnAdd');await page.click('#addStore');
    await page.eval(`document.querySelector('#addInput').value=${JSON.stringify(SHOP)};document.querySelector('#storeCollection').value='clothing';document.querySelector('#addForm').requestSubmit()`);
    await page.waitFor(`document.querySelector('.shop-preview > .btn')`,'store preview');
    assert.equal((await watchStore.list('default')).length,0,'preview has no writes');
    assert.match(await page.eval<string>(`document.querySelector('#addHint').textContent`),/Collection: clothing/);
    await page.click('.shop-preview > .btn');await page.waitFor(`document.querySelector('[data-portal="shop"] .shop-card')`,'gallery');
    assert.equal((await watchStore.list('default'))[0]?.scope.collection,'clothing');
    assert.equal(await page.eval(`document.querySelector('#grid button button')`),null);
    assert.match(await page.eval<string>(`document.querySelector('.shop-card').textContent`),/120.00 USD/);
    await page.click('[data-portal="shop"] .shop-save');await page.waitFor(`document.querySelector('[data-portal="shop"] .shop-save[aria-pressed="true"]')`,'saved product');
    await page.waitFor(`document.querySelector('#toast').textContent.startsWith('Saved!')`,'save response settled');
    assert.equal((await store.get('default')).saved[0]?.url,SHOP+'/products/product-1');
    await page.click('.shop-manage summary');await page.click('.shop-manage button');await page.waitFor(`document.querySelector('.shop-manage summary').textContent.includes('paused')`,'paused follow');
    assert.equal(await page.eval(`document.querySelectorAll('.shop-card').length`),0);
    await page.click('.shop-manage summary');await page.click('.shop-manage button');await page.waitFor(`document.querySelector('.shop-card')`,'resumed follow');
    for(const layout of ['catalogue','editorial','paperback','shelves','river','columns']) {
      await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      await page.click('#btnLayout');await page.click(`[data-layout="${layout}"]`);await page.waitFor(`document.querySelector('[data-layout="${layout}"]').getAttribute('aria-pressed')==='true'`,'layout chosen');await page.waitFor(`!document.querySelector('#btnLayout').disabled`,'layout saved');
      await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:false});
      await page.eval(`document.documentElement.dataset.theme='dark'`);
      assert.equal(await page.eval(`document.documentElement.scrollWidth<=innerWidth`),true,layout+' fits narrow view');
      assert.equal(await page.eval(`document.querySelector('#grid button button')`),null,layout+' controls stay separate');
    }
    await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    state.failed=true;now+=61_000;await page.click('[data-portal="shop"] button[aria-label="Refresh Shop"]');
    await page.waitFor(`document.querySelector('.shop-manage .error')`,'refresh error');assert.ok(await page.eval(`Boolean(document.querySelector('.shop-card'))`),'stale products remain');
    await page.click('.shop-manage summary');await page.click('.shop-manage button:last-child');await page.waitFor(`!document.querySelector('.shop-manage')`,'removed follow');
    assert.equal((await watchStore.list('default')).length,0);assert.equal((await store.get('default')).saved.length,1,'saved product survives removal');
    assert.deepEqual(page.problems,[]);
  } finally {await page.close();await app.close();}
});
