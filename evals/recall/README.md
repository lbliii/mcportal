# Recall retrieval benchmark

9 October 2026 · Issues [#117](https://github.com/lbliii/mcportal/issues/117) and [#118](https://github.com/lbliii/mcportal/issues/118)

Recall now removes explicit search-request prefixes and surrounding title quotes, preserves identifier/version boundaries, and explains effective search words, matching fields and coverage. The same changes run through local stores and the account-owned hosted `library.search` API. Public `search_clips` query semantics are unchanged. No embeddings, new service, schema migration or runtime dependency is introduced.

## Corpus and evaluation method

The [corpus](corpus.ts) is synthetic: 13 saved links, 126 clips (including 110 newer distractors), three reading records, and another account's private saved link and clip. Saved/history duplicates merge by canonical URL; query selectors remain distinct. There are 40 queries: 28 development and 12 validation, including 32 positive queries and eight deliberate negatives. Expected authorized results and indexed coverage are recorded separately. Two long clips exercise matches past the preview and text beyond the existing 40,000-character index boundary.

The corpus was frozen before runtime changes. Both baseline splits were run against main `716620b15516c50365613c05f4e5259451984bf5`; only development results were inspected while tuning. Candidate code was hashed before inspecting validation results. The [freeze manifest](results/validation-freeze.sha256) records those files. All runs used corpus SHA-256 `6d6fc7e08839bae5bda77bfefad76a5355c4d3b90880b73eaf6ad8426125a82b`.

The validation split was authored by the same implementer and held out from tuning, not supplied by independent people. It shares a corpus and query categories with development. This is a small regression evaluation, not human usability evidence or an estimate of population search quality. Queries d02/d03 reconstruct the previously observed M1 full-sentence/keyword failure pattern; they are disclosed development examples, not participant quotations. The validation split is now disclosed and should become regression material; future tuning needs fresh held-out queries.

The frozen implementation and recorded results belong to commit `0bd1532` (PR #142). Subsequent M2 work adds retry receipts to the same clip-store files without retuning Recall. Verify the implementation freeze at that commit; use the benchmark and regression tests for the combined candidate. The historical timings below are not measurements of later changes.

Four paths execute the real search implementation: files, Postgres, linked HTTP backed by files, and linked HTTP backed by Postgres. Linked runs use the actual StateClient, authentication and account-bound library API. They do not simulate external network latency or an agent host.

Metrics:

- **Retrieval@5:** at least one authorized expected ref appears in the first five results. This is a query success measure, not precision@5 or exhaustive recall.
- **Negative correctness:** a deliberately absent, private or unindexed query returns no results. Separate forbidden refs detect wrong identifiers/versions even when the right result is also present.
- **Source@5:** the targeted passage result and its persisted clip both retain the expected source URL.
- **Passage@5:** that result retains the expected locator text and it resolves uniquely within the declared source fixture. This checks the retrieval/locator contract, not browser scrolling. Real browser tests separately exercise source opening, moved/repeated/changed passages, retained quotes, return state and focus.
- **Latency:** five sequential runs per query after warmup, taking the median. Summary p95 is the 95th percentile of those per-query medians. Seeding and passage verification are excluded. The full test suite ran concurrently during candidate measurement; timings are descriptive, not a performance comparison under controlled load.

## Results

All four backends had the same outcome counts:

| Metric | Baseline | Candidate |
|---|---:|---:|
| Development retrieval@5 | 18/22 | 21/22 |
| Validation retrieval@5 | 8/10 | 9/10 |
| Development negatives | 6/6 | 6/6 |
| Validation negatives | 2/2 | 2/2 |
| Wrong identifier/version refs (development) | 5 | 0 |
| Wrong identifier/version refs (validation) | 0 | 0 |
| Source@5, each split | 2/2 | 2/2 |
| Passage@5, each split | 2/2 | 2/2 |

Retrieval@5 by query type (again identical outcome counts across backends):

| Type | Development before → after | Validation before → after |
|---|---|---|
| Identifier | 2/2 → 2/2 | 1/1 → 1/1 |
| Version | 2/2 → 2/2 | 2/2 → 2/2 |
| Title | 2/3 → 3/3 | 1/1 → 1/1 |
| Vague/conversational recall | 2/5 → 4/5 | 0/2 → 1/2 |
| Quote / retained text | 4/4 → 4/4 | 2/2 → 2/2 |
| Note | 3/3 → 3/3 | 1/1 → 1/1 |
| Duplicate / URL selector | 3/3 → 3/3 | 1/1 → 1/1 |
| Coverage negatives | 6/6 → 6/6 | 2/2 → 2/2 |

Latency, median / p95 milliseconds, on Apple M2, macOS arm64, Node v24.9.0 and disposable PostgreSQL 14.17 (UTF-8, C locale):

| Backend | Development baseline | Development candidate | Validation baseline | Validation candidate |
|---|---:|---:|---:|---:|
| Files | 0.509 / 0.562 | 0.540 / 0.804 | 0.519 / 0.625 | 0.546 / 0.850 |
| Postgres | 0.238 / 0.296 | 0.268 / 0.528 | 0.250 / 0.285 | 0.262 / 0.640 |
| Linked files | 0.884 / 1.267 | 0.932 / 1.256 | 1.015 / 1.495 | 0.966 / 1.623 |
| Linked Postgres | 0.542 / 0.637 | 0.617 / 0.855 | 0.595 / 0.712 | 0.682 / 1.063 |

These are bounded, warm, local measurements, not capacity or production latency claims. Complete per-query refs, category summaries, coverage labels and timings are in [baseline.json](results/baseline.json) and [candidate.json](results/candidate.json).

## Failures and limits

The remaining development miss d27 asks to “recover the database after a catastrophe”; the validation miss v12 asks how to prevent old workers publishing late answers. Their expected material describes recovery and expired leases using different words. The candidate continues to miss both, and was not tuned after inspecting v12. The UI explains keyword scope and recommends words from the source. These two synthetic examples alone do not justify a semantic-search service.

Conversational normalization recognizes explicit English request prefixes, not arbitrary natural language. Surrounding quotes remove wrapper punctuation; they do not introduce an exact-phrase operator. Ranking still uses the existing lexical weights, with distinct clip-note/preview/source-title evidence. Postgres retains its existing English stemming; files retain literal word matching. An unseen index contribution is labeled “Indexed clip text or metadata,” since a Postgres inflection can match metadata rather than a source passage.

Original page bodies are never fetched by search. Saved pointers and history carry metadata, not preserved source text. Long retained clips keep the existing bounded search index. Coverage and negative tests deliberately preserve these distinctions. The corpus is too small to establish behavior at maximum account quotas, broad multilingual recall, source outages or all punctuation/collation combinations. Browser passage cases supply additional navigation evidence, but do not certify every external host.

## Reproduce

```sh
# File-backed development cases, no database required.
npm run eval:recall -- --backend files --output /tmp/recall-development.json --quiet

# All four backends; requires an explicitly supplied disposable test database.
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres \
  npm run eval:recall -- --backend all --output /tmp/recall-development.json --quiet
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres \
  npm run eval:recall -- --backend all --split validation --output /tmp/recall-validation.json --quiet

# Corpus and frozen candidate implementation identity (at commit 0bd1532).
shasum -a 256 -c evals/recall/results/validation-freeze.sha256

# Required regression gate, including database contracts and real Chrome.
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres npm run check
```

Every benchmark creates and drops its own Postgres schema and temporary file store. It never accesses the user's room, fetches external sources, or silently skips a requested database backend. To regenerate the baseline, use the recorded main commit in a separate checkout, copy only `evals/recall/corpus.ts`, `evals/recall/run.ts` and `scripts/eval-recall.ts` from this change, install its locked dependencies, and run the script directly with `node scripts/eval-recall.ts`.

## Validation

`npm run check` with the isolated database: **609 tests, 608 passed, one expected file-retention skip, zero failures**; server/UI type checks and generated design checks passed. Focused storage/privacy/linked tests also passed. Real Chrome covered normalized search, provenance, empty-result coverage, older hosted results without the optional field, source/passage opening, moved/ambiguous/changed quotations and keyboard return focus. Desktop 1280px and narrow 380px screenshots of the shipped UI were inspected; neither had horizontal overflow or browser errors.
