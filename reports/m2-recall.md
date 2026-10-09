# Recall retrieval evaluation

The frozen synthetic corpus reproduced a full-sentence miss and incorrect exact-version ordering. The candidate recovers the sentence through a disclosed lexical retry and places `v2` before `v20` and `v22`. It preserves all 16 held-out top-five results in each tested mode. This is engineering fixture evidence, not a human retrieval study.

## Reproduce

Run `TEST_DATABASE_URL=postgres://127.0.0.1:55438/postgres node scripts/eval-recall.ts reports/m2-recall-candidate.json`. The script uses a new temporary directory and a disposable database schema, then removes both. Without the database variable it reports only file and linked-file results. The caller must provide a disposable Postgres service.

The corpus has 10 bookmarks, 12 clips, 3 history records and one other-account clip. Forty queries cover identifiers, versions, titles, recall wording, quotations, notes, duplicates, history, absent/private content and indexed coverage. Queries were frozen before ranking changes: 24 development cases and 16 held-out cases. The disclosed M1-style full sentence and bookmark/retained-quote cases are development cases.

Corpus SHA-256: `36900acaff6b36d88f659c55785190df80e8bd7634aae2e5abca0b9dfef4bf54`. Query SHA-256: `f98897b8ed038bd75fc04ad51e550833352fb5b32d083830b4a4e1069a62b0c7`. Both reports contain the same hashes.

## Retrieval and passage return

| Mode | Baseline top five or correct absence | Candidate | Held out baseline → candidate | Retained passages baseline → candidate | Candidate p50 / p95 |
|---|---|---|---|---|---|
| files | 39/40 | 40/40 | 16/16 → 16/16 | 6/6 → 6/6 | 0.217 / 0.578 ms |
| linked-files | 39/40 | 40/40 | 16/16 → 16/16 | 6/6 → 6/6 | 0.677 / 1.815 ms |
| postgres | 39/40 | 40/40 | 16/16 → 16/16 | 6/6 → 6/6 | 0.266 / 0.873 ms |

Correct absence is included in the table but is not indexed coverage: private, merely seen and unretained article text are intentionally unavailable. Each JSON case records `indexed` independently. A source/clip hit is scored separately from passage return, which requires an authorized `get_clip` and exact retained text. Six cases assert passage content. Live-source location and availability are outside this benchmark.

### Results by query type

| Split and type | Baseline | Candidate |
|---|---|---|
| development/identifier | 3/3 | 3/3 |
| development/version | 3/3 | 3/3 |
| development/title | 2/2 | 2/2 |
| development/recall | 1/2 | 2/2 |
| development/quote | 3/3 | 3/3 |
| development/note | 3/3 | 3/3 |
| development/duplicate | 2/2 | 2/2 |
| development/absent | 3/3 | 3/3 |
| development/history | 1/1 | 1/1 |
| development/coverage | 2/2 | 2/2 |
| heldout/identifier | 2/2 | 2/2 |
| heldout/version | 2/2 | 2/2 |
| heldout/title | 2/2 | 2/2 |
| heldout/recall | 2/2 | 2/2 |
| heldout/quote | 2/2 | 2/2 |
| heldout/note | 2/2 | 2/2 |
| heldout/duplicate | 1/1 | 1/1 |
| heldout/absent | 2/2 | 2/2 |
| heldout/history | 1/1 | 1/1 |

Group top-five results are the same across all three modes; raw per-mode outcomes and timings remain in the JSON reports. Duplicate excerpts can legitimately rank differently because Postgres uses full-text relevance while files use literal matching. Both expected duplicate records remain in the top five.

## Interpretation and limits

Measured on darwin arm64, Apple M2, Node v24.9.0. Runs issue queries sequentially, with the first read cold and later reads warm. These tiny-corpus samples are latency observations, not load-test percentiles or production capacity estimates.

The prioritized failures were development case d07 and the top-one ordering for d03. No embeddings, fuzzy recall or semantic-search claim is supported. Keyword recovery applies only to recognized recall-question forms after zero literal results and discloses its effective query. Successful literal queries are unchanged. Exact-token scoring preserves identifier punctuation.

File and linked-file modes use the same on-disk corpus; linked mode adds real HTTP and account-token authorization. Postgres uses the same corpus through its native stores. The benchmark does not certify other host applications or maximum-size accounts. Targeted tests separately cover unauthorized retrieval and deterministic pagination.
