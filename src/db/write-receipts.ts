import { writeRequest, replayReceipt, newReceipt, type WriteReceipt } from '../write-receipts.ts';
import type { Queryable } from './schema.ts';
/** Caller holds its account/operation write lock and runs create in the same transaction. */
export async function pgWriteReceipt<T>(db: Queryable, owner: string, operation: string, key: string | undefined, payload: unknown, get: (id: string) => Promise<T>, create: () => Promise<{ id: string; result: T }>): Promise<T> {
  const request = writeRequest(key, payload);
  if (!request) return (await create()).result;
  await db.query('DELETE FROM mcportal_write_receipts WHERE user_id=$1 AND operation=$2 AND expires_at <= $3', [owner, operation, Date.now()]);
  const { rows } = await db.query<{ data: WriteReceipt }>('SELECT data FROM mcportal_write_receipts WHERE user_id=$1 AND operation=$2', [owner, operation]);
  const receipts = rows.map(r => r.data), prior = replayReceipt(receipts, request);
  if (prior) return get(prior);
  // Check the receipt cap before creating; a failure rolls back both writes.
  const receipt = newReceipt(request, '', receipts);
  const created = await create(); receipt.id = created.id;
  await db.query('INSERT INTO mcportal_write_receipts (user_id,operation,key,data,expires_at) VALUES ($1,$2,$3,$4::jsonb,$5)', [owner, operation, receipt.key, JSON.stringify(receipt), receipt.expiresAt]);
  return created.result;
}
