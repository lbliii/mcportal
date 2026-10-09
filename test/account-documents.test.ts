import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { connect, ensureSchema, pgAuthPersistence, PgCollectionStore, PgExperienceStore, migrateAccountDocuments, restoreLegacyAccountDocuments, type Queryable } from '../src/db.ts';
import { DocumentCollectionStore } from '../src/collections.ts';
import { DocumentExperienceStore, emptyExperiences } from '../src/experiences.ts';
import { transaction } from '../src/db/schema.ts';
import { accountDocumentPersistence } from '../src/db/account-documents.ts';

const url = process.env.TEST_DATABASE_URL;
const skip = !url && 'set TEST_DATABASE_URL to run Postgres tests';
const schema = `account_docs_${process.pid}_${Date.now()}`;
let db: Queryable, admin: Queryable;
before(async () => { if (!url) return; admin = await connect(url); await admin.query(`CREATE SCHEMA ${schema}`); db = await connect(url, { searchPath: schema }); await ensureSchema(db); });
after(async () => { if (!url) return; await db.end?.(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end?.(); });

test('account documents: atomic migration, restart, revisions, leases and reconstruction rollback', { skip }, async () => {
  const oldCollections = new DocumentCollectionStore(pgAuthPersistence(db, 'collections'));
  const oldExperiences = new DocumentExperienceStore(pgAuthPersistence(db, 'reading-experiences'));
  const a = (await oldCollections.change('alice', { action: 'create', title: 'Alice evidence', entries: [{ ref: 'url:https://example.com/v2?x=1', title: 'Version 2', locator: { text: 'Quoted text', digest: 'a'.repeat(64) } }] }))!;
  const b = (await oldCollections.change('bob', { action: 'create', title: 'Bob evidence' }))!;
  await oldExperiences.replaceIf('alice', emptyExperiences(), 0);
  await oldExperiences.replaceIf('bob', emptyExperiences(), 0);
  await migrateAccountDocuments(db);
  await migrateAccountDocuments(db);
  const collections = new PgCollectionStore(db), experiences = new PgExperienceStore(db);
  assert.deepEqual(await collections.get('alice', a.id), a);
  assert.equal(await collections.get('bob', a.id), undefined);
  assert.equal((await experiences.get('alice')).rev, 1);
  await assert.rejects(experiences.replaceIf('alice', emptyExperiences(), 0), { code: 'conflict' });
  await assert.rejects(oldCollections.change('alice', { action: 'edit', id: a.id, title: 'Stale writer' }));
  await collections.change('alice', { action: 'edit', id: a.id, title: 'After migration' });
  await experiences.update('alice', state => ({ state, result: undefined }));
  assert.equal((await new PgExperienceStore(db).get('alice')).rev, 2);
  await collections.deleteAll('bob'); await experiences.deleteAll('bob');
  assert.deepEqual(await experiences.owners(), ['alice']);
  await restoreLegacyAccountDocuments(db);
  assert.equal((await new DocumentCollectionStore(pgAuthPersistence(db, 'collections')).get('alice', a.id))!.title, 'After migration');
  assert.equal(await new DocumentCollectionStore(pgAuthPersistence(db, 'collections')).get('bob', b.id), undefined, 'rollback must not resurrect deleted content');
  assert.equal((await new DocumentExperienceStore(pgAuthPersistence(db, 'reading-experiences')).get('alice')).rev, 2);
  await migrateAccountDocuments(db);
  assert.equal((await new PgCollectionStore(db).get('alice', a.id))!.title, 'After migration');
});

test('account documents: an account lock does not block another account and same-account changes survive', { skip }, async () => {
  const a = new PgCollectionStore(db), b = new PgCollectionStore(db);
  const one = (await a.change('concurrent-a', { action: 'create', title: 'One' }))!;
  const two = (await b.change('concurrent-b', { action: 'create', title: 'Two' }))!;
  let release!: () => void, locked!: () => void;
  const ready = new Promise<void>(r => { locked = r; });
  const gate = new Promise<void>(r => { release = r; });
  const holding = transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['account-document','collections','concurrent-a'])]);
    locked(); await gate;
  });
  await ready;
  try {
    await Promise.race([
      b.change('concurrent-b', { action: 'edit', id: two.id, title: 'Independent' }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('unrelated account blocked')), 2000); timer.unref(); }),
    ]);
  } finally { release(); await holding; }
  await Promise.all([a,b].map((store, i) => store.change('concurrent-a', { action: 'add', id: one.id, entries: [{ ref: `url:https://example.com/${i}`, title: String(i) }] })));
  assert.equal((await a.get('concurrent-a', one.id))!.entries.length, 2);
  await assert.rejects(accountDocumentPersistence(db, 'collections', 'concurrent-a').write(JSON.stringify({ collections: [{ owner: 'concurrent-b', data: two }] })), { code: 'forbidden' });
});

test('account documents: unreadable legacy content aborts without a marker or partial partition', { skip }, async () => {
  await restoreLegacyAccountDocuments(db);
  const before = await pgAuthPersistence(db, 'collections').read();
  await pgAuthPersistence(db, 'reading-experiences').write(JSON.stringify({ records: 'corrupt' }));
  await assert.rejects(migrateAccountDocuments(db));
  assert.equal(await pgAuthPersistence(db, 'collections').read(), before);
  assert.equal((await db.query('SELECT * FROM mcportal_account_documents')).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM mcportal_meta WHERE key='account-documents-v1'")).rows.length, 0);
  await pgAuthPersistence(db, 'reading-experiences').write(JSON.stringify({ records: [] }));
  await migrateAccountDocuments(db);
});

test('partitioned hosted documents: linked devices, leases, retention, portable preferences and deletion', {skip},async()=>{
  const {Accounts,makeBootstrap}=await import('../src/accounts.ts');
  const {AuthStore}=await import('../src/auth/store.ts');
  const {memoryPersistence}=await import('../src/lib/document.ts');
  const {startApp}=await import('./helpers.ts');
  const {StateClient}=await import('../src/link/client.ts');
  const {linkedStores}=await import('../src/link/stores.ts');
  const {PgProfileStore}=await import('../src/db.ts');
  const {watchAction,checkWatch}=await import('../src/reading-watches.ts');
  const {TtlCache}=await import('../src/lib/cache.ts');
  const {buildExport,parseExport,importExport}=await import('../src/portability.ts');
  const owner='github-889', other='github-890', now=Date.now();
  const store=new PgProfileStore(db),collections=new PgCollectionStore(db),experiences=new PgExperienceStore(db);
  const authPersistence=memoryPersistence(),auth=new AuthStore(authPersistence);
  const fetcher=async(url:string)=>({url,status:200,contentType:'text/markdown',text:'# Watched page\n\nA retained baseline.',truncated:false});
  const app=await startApp({github:{clientId:'test',clientSecret:'test'}},fetcher,{store,collections,experiences,authPersistence,accounts:new Accounts(memoryPersistence(),makeBootstrap([],[]))});
  try {
    const token=await auth.issueTokens({userId:owner,githubId:889,login:'fixture'},'mcpc_test','http://localhost/mcp','mcportal');
    const device=()=>linkedStores(new StateClient({server:app.base,auth:{token:async()=>token.access_token,refresh:async()=>undefined}}),owner);
    const a=device(),b=device();
    const c=(await a.collections.change(owner,{action:'create',title:'Linked evidence',entries:[{ref:'url:https://example.com/v2',title:'Version 2',locator:{text:'Retained text',prefix:'Before ',suffix:' after',digest:'b'.repeat(64)}}]}))!;
    assert.deepEqual(await b.collections.get(owner,c.id),c);
    assert.equal(await collections.get(other,c.id),undefined);
    await store.update(owner,profile=>({profile:{...profile,readerComfort:{size:'larger',measure:'focused'}},result:undefined}));
    const context={store,collections,experiences,userId:owner,cache:new TtlCache(),fetcher};
    const id=(await watchAction({action:'add',kind:'page',url:'https://example.com/watched.md'},context,now)).watches[0]!.id;
    const checks=await Promise.all([experiences,new PgExperienceStore(db)].map(experiences=>checkWatch(id,{...context,experiences},now)));
    assert.equal(checks.filter(Boolean).length,1,'only one worker acquired the lease');
    assert.ok((await b.experiences.get(owner)).state.watches[0]!.baseline);
    const version=await a.experiences.get(owner);
    await experiences.update(owner,state=>({state,result:undefined}));
    await assert.rejects(b.experiences.replaceIf(owner,version.state,version.rev),{code:'conflict'});
    const exported=parseExport((await buildExport('mcportal',owner,context)).body.toString());
    await importExport(exported,other,{store,collections,experiences});
    assert.equal((await collections.list(other))[0]!.entries[0]!.locator!.digest,'b'.repeat(64));
    assert.deepEqual((await store.get(other)).readerComfort,{size:'larger',measure:'focused'});
    assert.equal((await experiences.get(other)).state.watches[0]!.paused,true,'imported watches pause');
    assert.equal((await experiences.get(other)).state.watches[0]!.lease,undefined,'leases are not portable');
    await experiences.update(owner,state=>({state:{...state,inbox:[{id:'old-finding',watchId:id,kind:'availability',title:'Old check',at:new Date(now).toISOString(),dedup:'expired-finding',read:false}]},result:undefined}));
    assert.equal(await experiences.purgeExpired(now+31*86400000),1);
    await collections.deleteAll(owner);await experiences.deleteAll(owner);
    assert.deepEqual(await b.collections.list(owner),[]);
    assert.equal((await b.experiences.get(owner)).state.watches.length,0);
    assert.equal((await db.query('SELECT * FROM mcportal_account_documents WHERE user_id=$1',[owner])).rows.length,0);
    assert.equal((await collections.list(other)).length,1,'other account survives');
  } finally {await app.close();}
});

test('partitioned reads reject corruption and foreign ownership instead of appearing empty', {skip},async()=>{
  await db.query('INSERT INTO mcportal_account_documents(kind,user_id,data) VALUES ($1,$2,$3)', ['collections','corrupted',JSON.stringify({collections:'bad'})]);
  await assert.rejects(new PgCollectionStore(db).list('corrupted'));
  await new PgCollectionStore(db).deleteAll('corrupted');
  assert.equal((await db.query('SELECT * FROM mcportal_account_documents WHERE user_id=$1',['corrupted'])).rows.length,0,'account deletion can remove corrupt content');
});
