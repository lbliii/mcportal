import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildDesign, checkTokenUsage, compileTokens, checkComponentBoundaries, checkLegacyControls, validateComponents, validateInventory } from '../scripts/design.ts';
import { BRAND, PALETTES } from '../src/design/generated.ts';
import { page } from '../src/page.ts';
import { roomHtml, UI_INCLUDES } from '../src/mcp.ts';

test('committed design outputs are deterministic and current', async()=>{
 const first=await buildDesign();assert.deepEqual(first,await buildDesign());
 for(const [file,content] of Object.entries(first)) assert.equal(await readFile(new URL(`../${file}`,import.meta.url),'utf8'),content,file);
 assert.equal(BRAND.ink,'#1F2A36');assert.deepEqual(Object.keys(PALETTES.light).sort(),Object.keys(PALETTES.dark).sort());
 assert.ok(page('Sign in','<button>Continue</button>').includes('--mp-control-touch'));
});

test('token compiler validates references, emitted names, types and opaque CSS-safe values',()=>{
 const n=($value:unknown)=>({$type:'number',$value});
 assert.throws(()=>compileTokens({a:n('{missing}')}),/Missing token alias/);
 assert.throws(()=>compileTokens({a:n('{b}'),b:n('{a}')}),/cycle/);
 assert.throws(()=>compileTokens({a:n('{b}'),b:{$type:'string',$value:'ok'}}),/type mismatch/);
 assert.throws(()=>compileTokens({fooBar:n(1),'foo-bar':n(2)}),/Duplicate emitted/);
 assert.throws(()=>compileTokens({a:{$type:'string',$value:'</style>'}}),/Invalid string/);
 assert.throws(()=>compileTokens({a:{$type:'dimension',$value:{value:-1,unit:'px'}}}),/Invalid dimension/);
 assert.throws(()=>compileTokens({a:{$type:'color',$value:{colorSpace:'srgb',components:[1,0,0],alpha:.5}}}),/Invalid opaque/);
 assert.throws(()=>compileTokens({light:{a:n(1)},dark:{b:n(2)}}),/same roles/);
 assert.equal(compileTokens({a:n(2),b:n('{a}')}).values.b,'2');
});

test('common aliases remain live in CSS while palette consumers receive resolved values',()=>{
 const dimension=($value:unknown)=>({$type:'dimension',$value});
 const output=compileTokens({space:{base:dimension({value:8,unit:'px'})},panel:{padding:dimension('{space.base}')}});
 assert.equal(output.values['panel.padding'],'8px');
 assert.ok(output.css.includes('--mp-panel-padding: var(--mp-space-base);'));
});

test('token usage rejects undefined static references, including references with fallbacks',()=>{
 const source={'tokens.css':':root { --mp-control-height: 28px; }','control.css':'.button { height:var(--mp-control-height); }'};
 assert.doesNotThrow(()=>checkTokenUsage(source));
 assert.throws(()=>checkTokenUsage({...source,'typo.css':'.button { height:var(--mp-control-heigth, 28px); }'}),/typo.css:1: undefined --mp-control-heigth/);
 assert.doesNotThrow(()=>checkTokenUsage({'runtime.js':"node.style.setProperty('--mp-runtime-size', '24px')",'control.css':'.button { height:var(--mp-runtime-size); }'}));
});

test('component modules ship unchanged in the room and declare complete supported contracts',async()=>{
 const registry=JSON.parse(await readFile(new URL('../design/components.json',import.meta.url),'utf8'));
 validateComponents(registry);
 const html=await roomHtml();
 for(const file of registry.scripts) {
   assert.ok(UI_INCLUDES.includes(file), `${file} in the production include list`);
   assert.ok(html.includes((await readFile(new URL(`../src/ui/${file}`,import.meta.url),'utf8')).trim()),`${file} ships unchanged`);
 }
 assert.throws(()=>validateComponents({...registry,components:{button:{status:'stable',factory:'uiButton'}}}),/Incomplete component/);
 assert.throws(()=>validateComponents({...registry,components:{...registry.components,button:{...registry.components.button,variants:['primary','primary']}}}),/Invalid component options/);
});

test('component boundary and legacy-control checks prevent new product coupling and raw action drift',()=>{
 assert.throws(()=>checkComponentBoundaries({'button.js':'function save() { callTool("save"); }'}),/product identifier callTool/);
 assert.throws(()=>checkComponentBoundaries({'button.js':'function save() { return state.saved; }'}),/product identifier state/);
 assert.doesNotThrow(()=>checkComponentBoundaries({'button.js':'function toggle(options) { return options.state; }'}));
 assert.throws(()=>checkLegacyControls({'room/new.js':"el('button', {class:'btn'}, 'Save')"},{}),/raw buttons exceed/);
 assert.throws(()=>checkLegacyControls({'room/new.js':"el('input', {type:'search'})"},{}),/use shared uiControl/);
 assert.throws(()=>checkLegacyControls({'room.html':'<button>Save</button>'},{}),/raw buttons exceed/);
 assert.doesNotThrow(()=>checkLegacyControls({'room/new.js':"uiButton({label:'Save'})"},{}));
 assert.doesNotThrow(()=>checkLegacyControls({'room/old.js':"el('button', null, 'Story title')"},{'room/old.js':{maximum:1,reason:'Specialized content-opening target.'}}));
 assert.throws(()=>checkLegacyControls({'room/old.js':"el('button', {class:'link-btn'}, 'Catch up')"},{'room/old.js':{maximum:1,reason:'Old action'}}),/retired link-btn/);
});

test('coverage inventory requires definitions, variants, states, interaction rules and real implementation evidence',async()=>{
 const registry=JSON.parse(await readFile(new URL('../design/components.json',import.meta.url),'utf8'));
 const inventory=JSON.parse(await readFile(new URL('../design/inventory.json',import.meta.url),'utf8'));
 const files=new Set<string>(inventory.flatMap((item:{sources:string[]})=>item.sources));
 assert.doesNotThrow(()=>validateInventory(inventory,registry,files));
 assert.throws(()=>validateInventory(inventory.map((item:object,index:number)=>index?item:{...item,keyboard:''}),registry,files),/Incomplete design inventory/);
 assert.throws(()=>validateInventory(inventory,registry,new Set()),/Missing inventory source/);
 assert.throws(()=>validateInventory(inventory,{...registry,components:{...registry.components,undocumented:{}}},files),/Component missing from design inventory/);
 assert.equal((await roomHtml()).includes('const UI_INVENTORY'),false,'review documentation does not increase the production room payload');
});
