import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {connect,ensureSchema,PgWatchStore,importWatchFiles} from '../src/db.ts';
import {FileWatchStore,newStoreWatch,WATCH_LIMITS} from '../src/watches.ts';
import {defaultProfile} from '../src/profile.ts';
const URL=process.env.TEST_DATABASE_URL;
test('Postgres watch parity: cross-pool deduplication/quota, isolation, file import and deletion',{skip:!URL&&'TEST_DATABASE_URL unset'},async()=>{
  const schema=`mcportal_watch_${process.pid}_${Date.now()}`,admin=await connect(URL!),dir=await mkdtemp(path.join(tmpdir(),'mcportal-watch-db-'));
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db=await connect(URL!,{searchPath:schema}),otherDb=await connect(URL!,{searchPath:schema});
  try {
    await ensureSchema(db);const one=new PgWatchStore(db),two=new PgWatchStore(otherDb);
    const watch=newStoreWatch({origin:'https://shop.example.com',name:'Store',products:[],partial:false,pages:1},{});
    assert.equal((await Promise.all([one.import('alice',[watch]),two.import('alice',[watch])])).reduce((a,b)=>a+b),1);
    const races=await Promise.allSettled(Array.from({length:WATCH_LIMITS.watches},(_,i)=>(i%2?one:two).import('alice',[{...watch,id:'watch-'+i,identity:{provider:'shopify',origin:`https://shop-${i}.example.com`}}])));
    assert.equal(races.filter(r=>r.status==='rejected').length,1);assert.equal((await one.list('alice')).length,20);
    await one.import('bob',[watch]);await one.deleteAll('alice');assert.equal((await two.list('alice')).length,0);assert.equal((await two.list('bob')).length,1);
    await db.query('INSERT INTO mcportal_profiles(user_id,data) VALUES($1,$2)',['from-file',JSON.stringify(defaultProfile())]);
    await new FileWatchStore(dir).import('from-file',[watch]);
    assert.equal(await importWatchFiles(db,dir),1);assert.equal(await importWatchFiles(db,dir),0);assert.equal((await one.list('from-file')).length,1);
  }finally{await db.end?.();await otherDb.end?.();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end?.();await rm(dir,{recursive:true,force:true});}
});
