/** Maintenance migration/rollback. Stop all app and worker writers before running. */
import {connect,ensureSchema,migrateAccountDocuments,restoreLegacyAccountDocuments} from '../src/db.ts';
const [action,acknowledgement]=process.argv.slice(2);
if (!['migrate','rollback'].includes(action ?? '') || acknowledgement!=='--writers-stopped' || !process.env.DATABASE_URL) {
  throw new Error('Usage: DATABASE_URL=… node scripts/account-documents.ts migrate|rollback --writers-stopped');
}
const db=await connect(process.env.DATABASE_URL);
try {
  await ensureSchema(db);
  if(action==='migrate')await migrateAccountDocuments(db);else await restoreLegacyAccountDocuments(db);
  console.log(`${action} complete. No account content printed.`);
} finally {await db.end?.();}
