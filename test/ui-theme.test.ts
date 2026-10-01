import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { roomHtml } from '../src/mcp.ts';

type Palette = Record<string, string>;
type Theme = { resolve: (mode: string, vars?: Palette) => Palette; contrast: (a: string, b: string) => number; create: (root: unknown, opts: unknown) => { update: (ctx: unknown) => Palette; destroy: () => void }; HOST: Palette };
const source = (await Promise.all(['palettes.js', 'theme.js'].map(f => readFile(new URL(`../src/ui/design/${f}`, import.meta.url), 'utf8')))).join('\n');
const house: Record<string, Palette> = vm.runInNewContext(`${source}; MP_PALETTES`);
const theme: Theme = vm.runInNewContext(`${source}; MCPortalTheme`);
function readable(p: Palette) {
  const surfaces = Object.keys(p).filter(k => k.startsWith('surface-'));
  const text = ['text-primary','text-secondary','text-placeholder','text-link', ...Object.keys(p).filter(k => /^(source|status)-/.test(k))];
  for (const role of text) for (const bg of surfaces) assert.ok(theme.contrast(p[role]!,p[bg]!) >= 4.5, `${role} / ${bg}: ${p[role]} / ${p[bg]}`);
  for (const role of ['border-control','focus-ring','border-selected']) for (const bg of surfaces) assert.ok(theme.contrast(p[role]!,p[bg]!) >= 3, `${role} / ${bg}`);
  for (const role of ['primary','danger']) assert.ok(theme.contrast(p[`action-${role}`]!,p[`action-on-${role}`]!) >= 4.5, role);
}
function host() {
  const properties = new Map<string,string>();
  const root = { dataset: {} as Palette, style: { setProperty: (k:string,v:string)=>properties.set(k,v), removeProperty: (k:string)=>properties.delete(k) } };
  let listener = () => {};
  const media = { matches: false, addEventListener: (_:string, fn:()=>void)=>{listener=fn;}, removeEventListener: ()=>{listener=()=>{};} };
  const controller = theme.create(root,{ matchMedia: ()=>media, resolveColor: ()=>null });
  return { controller, properties, root, system: (dark:boolean)=>{media.matches=dark;listener();} };
}

test('functional palettes remain readable for house, partial and hostile host colours',()=>{
  for(const mode of ['light','dark']) {
    readable(theme.resolve(mode));
    for(const background of ['#000','#fff','#888','#FA00BB','#00FF00','#123456','#F2E6CF','rgb(10, 20, 30)']) {
      readable(theme.resolve(mode,{'--color-background-primary':background}));
      readable(theme.resolve(mode,{'--color-background-primary':background,'--color-background-secondary':'#999','--color-text-primary':background,'--color-text-secondary':'#777','--color-text-info':'#ddd','--color-border-primary':'#aaa'}));
    }
    for(const invalid of ['transparent','rgba(1,2,3,.5)','#ffffff00','not a color','var(--mp-text-primary)','url(https://example.com)','red; color:black','initial']) {
      readable(theme.resolve(mode,{'--color-background-primary':invalid,'--color-text-primary':invalid}));
    }
  }
});

test('finite host mapping rejects namespace collisions, cycles and unsafe font/geometry values',()=>{
  const p=theme.resolve('light',{'--mp-surface-canvas':'#000','--lane-h':'0px','--color-background-primary':'var(--color-background-secondary)','--color-background-secondary':'var(--color-background-primary)','--font-sans':'url(https://example.com)','--font-mono':'x; color:red','--border-radius-lg':'999px'});
  assert.equal(p['surface-canvas'],'#FFFFFF'); assert.equal(p['font-ui'],undefined); assert.equal(p['radius-card'],undefined); readable(p);
  const aliases=theme.resolve('dark',{'--color-background-primary':'#161616','--color-background-secondary':'var(--color-background-primary)','--font-sans':'system-ui','--border-radius-lg':'12px'});
  assert.equal(aliases['surface-inset'],'#161616'); assert.equal(aliases['font-ui'],'system-ui');assert.equal(aliases['radius-card'],'12px');readable(aliases);
});

test('theme lifecycle clears stale colours, preserves partial context and explicitly resets overrides',()=>{
  const {controller,properties,root,system}=host();
  controller.update({theme:'light',styles:{variables:{'--color-background-primary':'#F2E6CF','--font-sans':'Arial','--border-radius-lg':'12px'}}});
  controller.update({displayMode:'fullscreen'});assert.equal(properties.get('--mp-surface-canvas'),'#F2E6CF');
  controller.update({theme:'dark'});assert.equal(root.dataset.theme,'dark');assert.equal(properties.get('--mp-surface-canvas'),'#161616');assert.equal(properties.get('--mp-font-ui'),'Arial');
  controller.update({styles:{variables:{'--font-sans':null,'--border-radius-lg':'','--color-text-primary':'transparent'}}});assert.equal(properties.has('--mp-font-ui'),false);assert.equal(properties.has('--mp-radius-card'),false);assert.equal(properties.get('--mp-text-primary'),'#ECECEA');
  system(false);assert.equal(root.dataset.theme,'dark');controller.destroy();
});

test('system preference is followed until a host selects a scheme',()=>{
  const {controller,root,system}=host();assert.equal(root.dataset.theme,'light');system(true);assert.equal(root.dataset.theme,'dark');
  controller.update({theme:'light'});system(true);assert.equal(root.dataset.theme,'light');
});

test('shipped host handler applies themes while preserving display-mode negotiation',async()=>{
  const html=await roomHtml();
  const handler=html.match(/  function applyHostContext\(ctx\) \{[\s\S]*?\n  \}/)?.[0];assert.ok(handler);
  const {controller,root}=host(), expand={hidden:false}, modes:string[]=[];
  const apply=vm.runInNewContext(`${handler};applyHostContext`,{theme:controller,$:()=>expand,canFullscreen:true,setDisplayMode:(v:string)=>modes.push(v)});
  apply({theme:'dark',displayMode:'inline',availableDisplayModes:['inline']});assert.equal(root.dataset.theme,'dark');assert.equal(expand.hidden,true);assert.deepEqual(modes,['inline']);
});


test('static web and auth palettes meet the same functional contracts',()=>{
 for(const p of Object.values(house)) {
  readable(p);
  for(const fg of ['web-text','web-secondary','web-link'])for(const bg of ['web-canvas','web-card']) assert.ok(theme.contrast(p[fg]!,p[bg]!)>=4.5,`${fg}/${bg}`);
 }
});

test('browser colours cannot reuse a previous canvas fill when CSS and canvas support differ',()=>{
 let fill='#000000';
 const canvas={get fillStyle(){return fill;},set fillStyle(v:string){if(v!=='unsupported()')fill=v==='navy'?'#000080':v;},clearRect(){},fillRect(){},getImageData(){const rgb=fill.match(/[\da-f]{2}/gi)!.map(v=>parseInt(v,16));return {data:[...rgb,255]};}};
 const browserTheme:Theme=vm.runInNewContext(`${source};MCPortalTheme`,{CSS:{supports:()=>true}});
 const properties=new Map<string,string>();
 const root={dataset:{},ownerDocument:{createElement:()=>({getContext:()=>canvas})},style:{setProperty:(k:string,v:string)=>properties.set(k,v),removeProperty:(k:string)=>properties.delete(k)}};
 const controller=browserTheme.create(root,{matchMedia:()=>({matches:false})});
 controller.update({styles:{variables:{'--color-background-primary':'navy'}}});assert.equal(properties.get('--mp-surface-canvas'),'#000080');
 controller.update({styles:{variables:{'--color-background-primary':'unsupported()'}}});assert.equal(properties.get('--mp-surface-canvas'),'#FFFFFF');
});
