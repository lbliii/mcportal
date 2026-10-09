/** Account-sized documents behind the existing stores; no cross-account content lock. */
import { DocumentCollectionStore, importedCollection, type CollectionStore, type CollectionChange } from '../collections.ts';
import { DocumentExperienceStore, validateExperiences, type ExperienceStore, type ExperienceState } from '../experiences.ts';
import { AppError } from '../lib/errors.ts';
import { type DocumentPersistence } from '../lib/document.ts';
import { transaction, type Queryable } from './schema.ts';

type Kind = 'collections' | 'reading-experiences';
const KINDS: Kind[] = ['collections', 'reading-experiences'];
const MARKER = 'account-documents-v1';
const invalid = () => new AppError('internal', 'Unreadable legacy account documents; migration has not changed stored data.');

/** Validate and partition without dropping unknown owners, duplicate records or revisions. */
export function partitionAccountDocument(kind: Kind, raw: unknown): Map<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const doc = raw as Record<string, unknown>, field = kind === 'collections' ? 'collections' : 'records';
  if (Object.keys(doc).some(k => k !== field) || (doc[field] !== undefined && !Array.isArray(doc[field]))) throw invalid();
  const partitions = new Map<string, { [key: string]: unknown[] }>();
  const ids = new Set<string>();
  for (const value of (doc[field] ?? []) as unknown[]) {
    if (!value || typeof value !== 'object') throw invalid();
    const record = value as { owner: string; data: unknown; state: unknown; rev: number };
    if (typeof record.owner !== 'string' || !record.owner.trim() || record.owner.length > 200) throw invalid();
    let valid: unknown;
    if (kind === 'collections') {
      const data = importedCollection(record.data);
      const key = JSON.stringify([record.owner, data.id]);
      if (ids.has(key)) throw invalid();
      ids.add(key); valid = { owner: record.owner, data };
    } else {
      if (ids.has(record.owner) || !Number.isSafeInteger(record.rev) || record.rev < 0) throw invalid();
      ids.add(record.owner); valid = { owner: record.owner, rev: record.rev, state: validateExperiences(record.state) };
    }
    const partition = partitions.get(record.owner) ?? { [field]: [] };
    partition[field]!.push(valid); partitions.set(record.owner, partition);
  }
  return partitions;
}

/** Atomic, restartable migration. Old binaries see a deliberately invalid sentinel, never empty data.
 * Deploy with writers stopped; rollback reconstructs legacy keys from current account rows.
 */
export async function migrateAccountDocuments(db: Queryable): Promise<void> {
  await transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MARKER]);
    if ((await tx.query('SELECT value FROM mcportal_meta WHERE key = $1', [MARKER])).rows.length) return;
    for (const kind of KINDS) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kv:${kind}`]);
      const { rows } = await tx.query<{ value: unknown }>('SELECT value FROM mcportal_kv WHERE key = $1', [kind]);
      const partitions = partitionAccountDocument(kind, rows[0]?.value ?? {});
      for (const [owner, doc] of partitions) {
        // An unmarked preexisting row is a conflict, not permission to overwrite data.
        await tx.query('INSERT INTO mcportal_account_documents (kind, user_id, data) VALUES ($1,$2,$3::jsonb)', [kind, owner, JSON.stringify(doc)]);
      }
      const sentinel = kind === 'collections' ? { collections: 'migrated-to-account-documents-v1' } : { records: 'migrated-to-account-documents-v1' };
      await tx.query('INSERT INTO mcportal_kv (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [kind, JSON.stringify(sentinel)]);
    }
    await tx.query('INSERT INTO mcportal_meta (key,value) VALUES ($1,$2)', [MARKER, 'complete']);
  });
}

/** Maintenance-only rollback after all app/worker writers are stopped. Includes post-migration changes. */
export async function restoreLegacyAccountDocuments(db: Queryable): Promise<void> {
  await transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MARKER]);
    if (!(await tx.query('SELECT value FROM mcportal_meta WHERE key=$1', [MARKER])).rows.length) return;
    for (const kind of KINDS) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kv:${kind}`]);
      const field = kind === 'collections' ? 'collections' : 'records';
      const { rows } = await tx.query<{ user_id: string; data: Record<string, unknown[]> }>('SELECT user_id,data FROM mcportal_account_documents WHERE kind=$1 ORDER BY user_id', [kind]);
      const values = rows.flatMap(row => {
        const validated = partitionAccountDocument(kind, row.data);
        if ([...validated.keys()].some(owner => owner !== row.user_id)) throw invalid();
        return row.data[field] ?? [];
      });
      await tx.query('UPDATE mcportal_kv SET value=$2::jsonb, updated_at=now() WHERE key=$1', [kind, JSON.stringify({ [field]: values })]);
    }
    await tx.query('DELETE FROM mcportal_account_documents');
    await tx.query('DELETE FROM mcportal_meta WHERE key=$1', [MARKER]);
  });
}

export function accountDocumentPersistence(db: Queryable, kind: Kind, userId: string): DocumentPersistence {
  const read = async (tx: Queryable) => {
    const { rows } = await tx.query<{ data: unknown }>('SELECT data FROM mcportal_account_documents WHERE kind=$1 AND user_id=$2', [kind, userId]);
    if (!rows.length) return undefined;
    const partitions = partitionAccountDocument(kind, rows[0]!.data);
    if ([...partitions.keys()].some(owner => owner !== userId)) throw new AppError('internal', 'Account document owner mismatch; stored data was not changed.');
    return JSON.stringify(rows[0]!.data);
  };
  const save = async (tx: Queryable, json: string) => {
    const partitions = partitionAccountDocument(kind, JSON.parse(json));
    if ([...partitions.keys()].some(owner => owner !== userId)) throw new AppError('forbidden', 'An account document cannot contain another owner.');
    if (!partitions.size) { await tx.query('DELETE FROM mcportal_account_documents WHERE kind=$1 AND user_id=$2', [kind, userId]); return; }
    await tx.query('INSERT INTO mcportal_account_documents (kind,user_id,data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (kind,user_id) DO UPDATE SET data=EXCLUDED.data', [kind, userId, json]);
  };
  const transact: NonNullable<DocumentPersistence['transact']> = change => transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['account-document', kind, userId])]);
    const { json, result } = change(await read(tx));
    if (json !== undefined) await save(tx, json);
    return result;
  });
  return { read: () => read(db), write: json => transact(() => ({ json, result: undefined })), transact };
}

/** Account deletion must also remove an unreadable row; it never needs to decode private content. */
async function deleteAccountDocument(db: Queryable, kind: Kind, owner: string): Promise<void> {
  await transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['account-document',kind,owner])]);
    await tx.query('DELETE FROM mcportal_account_documents WHERE kind=$1 AND user_id=$2',[kind,owner]);
  });
}

export class PgCollectionStore implements CollectionStore {
  private db: Queryable;
  constructor(db: Queryable) { this.db = db; }
  private store(owner: string) { return new DocumentCollectionStore(accountDocumentPersistence(this.db, 'collections', owner)); }
  list(owner: string) { return this.store(owner).list(owner); }
  get(owner: string, id: string) { return this.store(owner).get(owner, id); }
  change(owner: string, input: CollectionChange) { return this.store(owner).change(owner, input); }
  import(owner: string, raw: unknown[]) { return this.store(owner).import(owner, raw); }
  deleteAll(owner: string) { return deleteAccountDocument(this.db, 'collections', owner); }
}
export class PgExperienceStore implements ExperienceStore {
  private db: Queryable;
  constructor(db: Queryable) { this.db = db; }
  private store(owner: string) { return new DocumentExperienceStore(accountDocumentPersistence(this.db, 'reading-experiences', owner)); }
  async owners() { return (await this.db.query<{ user_id: string }>("SELECT user_id FROM mcportal_account_documents WHERE kind='reading-experiences' ORDER BY user_id")).rows.map(row => row.user_id); }
  async purgeExpired(now = Date.now()) { let removed = 0; for (const owner of await this.owners()) removed += await this.store(owner).purgeExpired(now); return removed; }
  get(owner: string) { return this.store(owner).get(owner); }
  update<R>(owner: string, change: (state: ExperienceState) => { state?: ExperienceState; result: R }) { return this.store(owner).update(owner, change); }
  replaceIf(owner: string, state: ExperienceState, rev: number) { return this.store(owner).replaceIf(owner, state, rev); }
  import(owner: string, raw: unknown) { return this.store(owner).import(owner, raw); }
  deleteAll(owner: string) { return deleteAccountDocument(this.db, 'reading-experiences', owner); }
}
