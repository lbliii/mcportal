# Move hosted reading documents to account rows

Collections and reading experiences now use `mcportal_account_documents`, with one row per `(kind, user_id)`. Local files and public store methods keep their existing shapes. PostgreSQL startup runs the migration after file imports and before serving requests.

Stop every web process and reading worker before deploying this change. Do not use a rolling deployment across this storage boundary. Take a database backup under your normal retention policy, then run the candidate against a restored copy first.

For an explicit maintenance migration, with `DATABASE_URL` already set:

```sh
node scripts/account-documents.ts migrate --writers-stopped
```

The command validates both legacy documents, owner IDs, collection entries, experience state and revisions in one transaction. It partitions the existing `collections` and `reading-experiences` keys, then writes the `account-documents-v1` completion marker. Malformed input or conflicting unmarked rows aborts the entire transaction. It does not substitute an empty document after a failure. Rerunning after success is a no-op.

Legacy keys receive invalid sentinels. An old process attempting to write them fails visibly, preventing a silent fork of the account's data. The new stores validate reads as well as writes and reject a row containing a different owner.

After migration, start the new processes and check collection reads, watch state, and a linked client. Existing watch leases and revisions are preserved. Only the account being edited is locked and rewritten. The primary key serves account lookups; the worker still enumerates owner IDs and applies existing due-work and retention rules. No speculative due-work index was added.

## Rollback

Stop **all** writers again. Run this command from the candidate checkout, before restarting the old binary:

```sh
node scripts/account-documents.ts rollback --writers-stopped
```

Rollback validates the current account rows and reconstructs the two legacy documents, including edits and deletions made after migration. It then removes the partition rows and completion marker in the same transaction. It deliberately does not restore a historical content copy that could resurrect deleted accounts. A subsequent migration is supported. Keep the additive SQL tables and schema version; do not drop unrelated schema objects.

This is a maintenance operation: the flag records the operator's precondition, not automatic detection of every running process. Deploying the candidate again will migrate on startup. A restored backup contains private data and remains subject to normal deletion and backup-retention policies.

## Evidence and limits

`test/account-documents.test.ts` covers real PostgreSQL migration, restart, rollback after edits/deletion, corruption, independent account locks, authenticated linked clients, revisions, watch leases, retention, portability and deletion. `test/db.test.ts` uses the partitioned stores for normal collection and watch operations.

Reproduce the bounded write comparison with:

```sh
TEST_DATABASE_URL=postgres://127.0.0.1:55438/postgres node scripts/benchmark-account-documents.ts
```

The [recorded benchmark](../../reports/m2-account-documents.json) used 24 synthetic accounts, 192 writes and a pool of five connections on an Apple M2 with Node 24.9. Shared documents took 95.46 ms and transferred about 2.57 MB of JSON query results and 2.68 MB of JSON arguments. Account rows took 23.96 ms and about 120 KB/123 KB respectively. Both used 960 SQL calls. These figures measure one small local run, not production throughput, disk I/O or capacity. The lock test independently verifies that holding one account's lock does not block another account's write.
