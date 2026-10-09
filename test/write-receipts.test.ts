import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FileClipStore,buildClip} from '../src/clips.ts';
import {safeFileId} from '../src/lib/files.ts';
import {newReceipt,writeRequest,RECEIPT_LIMIT} from '../src/write-receipts.ts';

test('file clip receipts survive restart, accept the old file shape and serialize separate instances',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'mcportal-receipt-'));
  try {
    const make=()=>buildClip({kind:'quote',text:'Restart evidence'});
    const legacy=make();
    await mkdir(path.join(dir,'clips'));
    await writeFile(path.join(dir,'clips',safeFileId('owner')+'.json'),JSON.stringify({version:1,clips:[legacy]}));
    const one=new FileClipStore(dir),two=new FileClipStore(dir);
    assert.equal((await one.get('owner',legacy.id))!.data.kind,'quote');
    const created=await one.add('owner',make(),'restart-key');
    const restarted=new FileClipStore(dir);
    assert.equal((await restarted.add('owner',make(),'restart-key')).id,created.id);
    const concurrent=await Promise.all([one,two,restarted].map(store=>store.add('owner',make(),'concurrent-key')));
    assert.equal(new Set(concurrent.map(c=>c.id)).size,1);
    assert.equal((await one.usage('owner')).count,3);
    await restarted.delete('owner',created.id);
    await assert.rejects(new FileClipStore(dir).add('owner',make(),'restart-key'),{code:'failed_precondition'});
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('receipt capacity fails before a new action and stores only hashes',()=>{
  const request=writeRequest('private-key','private payload')!;
  assert.equal(JSON.stringify(request).includes('private'),false);
  const receipt=newReceipt(request,'id',[]);
  assert.throws(()=>newReceipt(request,'next',Array(RECEIPT_LIMIT).fill(receipt)),{code:'limit_exceeded'});
});
