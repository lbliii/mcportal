/** Bounded synthetic multi-account comparison; disposable schema only. */
import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { connect, ensureSchema, pgAuthPersistence, PgCollectionStore, PgExperienceStore, type Queryable } from '../src/db.ts';
import { DocumentCollectionStore, type CollectionStore } from '../src/collections.ts';
import { DocumentExperienceStore, type ExperienceStore, emptyExperiences } from '../src/experiences.ts';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a disposable Postgres service.');
const admin = await connect(url), schema = `account_bench_${process.pid}_${Date.now()}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const db = await connect(url, { searchPath: schema });
let readBytes = 0, writeBytes = 0, calls = 0;
function measured(raw: Queryable): Queryable {
  return { async query(sql, args) {
    calls++; if (/INSERT|UPDATE/i.test(sql)) writeBytes += Buffer.byteLength(JSON.stringify(args));
    const result = await raw.query(sql, args); readBytes += Buffer.byteLength(JSON.stringify(result.rows)); return result as never;
  }, ...(raw.connect ? { connect: async () => { const c = await raw.connect!(); return { ...measured(c), release: () => c.release() }; } } : {}) };
}
async function run(mode: string, collections: CollectionStore, experiences: ExperienceStore) {
  const ids = [];
  for (let i=0; i<24; i++) {
    const owner = `${mode}-${i}`;
    ids.push({ owner, id: (await collections.change(owner, { action: 'create', title: 'Synthetic account', purpose: 'Context '.repeat(100) }))!.id });
    await experiences.replaceIf(owner, emptyExperiences(), 0);
  }
  readBytes=0; writeBytes=0; calls=0;
  const start = performance.now();
  await Promise.all(ids.map(async ({owner,id}) => {
    for (let j=0;j<4;j++) {
      await collections.change(owner, { action: 'edit', id, title: `Write ${j}` });
      await experiences.update(owner, state => ({ state, result: undefined }));
    }
  }));
  return { mode, accounts:24, writes:192, ms:Number((performance.now()-start).toFixed(2)), readBytes, writeBytes, calls };
}
try {
  await ensureSchema(db);
  const meter=measured(db);
  const baseline=await run('shared', new DocumentCollectionStore(pgAuthPersistence(meter,'benchmark-collections')), new DocumentExperienceStore(pgAuthPersistence(meter,'benchmark-experiences')));
  const candidate=await run('partitioned', new PgCollectionStore(meter), new PgExperienceStore(meter));
  const report={at:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,method:'24 synthetic accounts, 4 collection and 4 experience writes each, concurrent across accounts, pool=5. Bytes are JSON query arguments/results, not network or disk bytes. No production-capacity claim.',baseline,candidate};
  if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await db.end?.();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end?.();}
