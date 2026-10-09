import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resultFixtures} from '../scripts/benchmark-result-payloads.ts';
import {componentResult,modelResultBytes,MODEL_RESULT_BYTES,COMPONENT_KEY,RESULT_PAGE_TOOLS} from '../src/tools/result-payload.ts';
import {handleMessage} from '../src/mcp.ts';
import {TtlCache} from '../src/lib/cache.ts';

test('result budget includes all content and structuredContent; every representative card retains its full data',async()=>{
  const {ctx,fixtures}=await resultFixtures();
  assert.equal(fixtures.length,7);
  for(const {name,result,bounded} of fixtures){
    assert.ok(modelResultBytes(bounded)<=MODEL_RESULT_BYTES,name);
    assert.deepEqual(bounded._meta![COMPONENT_KEY],result.structuredContent,`${name}: no component data lost`);
    assert.match(bounded.content[0]!.text,/<untrusted-content/);
  }
  const error=await componentResult({isError:true,content:[{type:'text',text:'unbounded'.repeat(10000)}]},'synthetic',ctx);
  assert.ok(error.isError && modelResultBytes(error)<=MODEL_RESULT_BYTES);
  assert.ok(modelResultBytes(fixtures.find(f=>f.name==='article')!.result)>MODEL_RESULT_BYTES);
  const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_clip',arguments:fixtures.find(f=>f.name==='clip')!.args}};
  const legacy=await handleMessage(request,ctx);
  assert.ok((legacy!.result as any).structuredContent.clip,'old clients retain their contract');
  const bounded=await handleMessage(request,{...ctx,resultMode:'component-v1'});
  assert.ok((bounded!.result as any)._meta[COMPONENT_KEY].clip);
  assert.equal((bounded!.result as any).structuredContent.clip,undefined,'full quote is not copied into model-visible structuredContent');
});

test('paginated text is attributed, Unicode-safe, bounded, account-scoped and expires',async()=>{
  const {ctx}=await resultFixtures();
  let now=1;
  ctx.cache=new TtlCache({now:()=>now});
  const text='https://example.com/source\n'+('日本語🙂\\"\n'.repeat(5000));
  const result=await componentResult({content:[{type:'text',text}],structuredContent:{body:text}},'synthetic',ctx);
  const view=result.structuredContent!.resultView as {handle:string;parts:number};
  assert.ok(view.parts>1);
  const tool=RESULT_PAGE_TOOLS[0]!;
  let previous='';
  for(let part=1;part<=view.parts;part++){
    const page=await tool.handler({handle:view.handle,part},ctx);
    assert.ok(modelResultBytes(page)<=MODEL_RESULT_BYTES);
    assert.match(page.content[0]!.text,/https:\/\/example.com\/source/);
    assert.doesNotMatch(page.content[0]!.text,/\uFFFD/);
    assert.notEqual(page.content[0]!.text,previous);previous=page.content[0]!.text;
  }
  await assert.rejects(tool.handler({handle:view.handle,part:1},{...ctx,userId:'other'}),{code:'not_found'});
  await assert.rejects(tool.handler({handle:view.handle,part:view.parts+1},ctx),{code:'invalid_argument'});
  now+=600001;
  await assert.rejects(tool.handler({handle:view.handle,part:1},ctx),{code:'not_found'});
});
