# Recover an uncertain clip or share save

A client can lose the response after a save commits. Clip and share creation accept an optional `requestKey` so retrying that action can return its original stored result. The UI keeps one key for the same pending payload until it receives confirmation. It says that a save is uncertain after a transport error and lets the user retry it.

Keys contain 8–100 letters, digits, underscores or hyphens. They are scoped to the authenticated account and operation (`clip` or `share`), hashed at rest, and compared against a hash of the normalized payload. Creation and the receipt commit atomically. Concurrent attempts with the same key and payload produce one object. Reusing a live key for different content returns `conflict`.

Receipts are valid for seven days, with a cap of 2,000 live receipts per account and operation. After expiry the same key means a new action; clients must not promise indefinite deduplication. Expired records are removed on subsequent writes, so cold storage can retain expired hashes until the next write or account deletion. Receipts contain hashes, object IDs and expiry times, not retained source content or authentication credentials.

Deleting an individual clip or share keeps its receipt as a tombstone until expiry. A retry then returns `failed_precondition` instead of resurrecting the object. Account deletion removes receipts too. Export/import does not transfer request receipts: importing data into another account is a separate action. Callers that omit `requestKey` keep the existing creation semantics. Old binaries do not understand receipts; a downgrade or mixed-version file writer can discard them, so drain pending writes before downgrading.

The server applies current authorization and share visibility rules before replay. A retry can therefore be refused after a source was removed, a sharing rule changed, or access was revoked. A receipt never grants new access or authorizes publication. Retrying a reblog uses the same operation scope and payload checks as sharing a saved link or clip.

PostgreSQL serializes account writes in a transaction. File clips use the existing atomic file replacement and a process-wide lock keyed by file path. File-backed operation remains a single-writer-process deployment; separate processes writing the same data directory are not a distributed lock. Linked devices use the hosted transaction boundary.

Evidence includes store contracts across memory/files/PostgreSQL, concurrent retries, discarded committed responses, payload mismatch, deletion tombstones, account deletion, and authenticated linked HTTP tests that drop a response after commit. Browser tests exercise uncertain-save wording, retained keys and exactly one clip after retry.
