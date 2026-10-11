import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildDesign, checkTokenUsage, compileTokens } from '../scripts/design.ts';
import { BRAND, PALETTES } from '../src/design/generated.ts';
import { page } from '../src/page.ts';

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
