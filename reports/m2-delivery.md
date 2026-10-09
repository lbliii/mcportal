# M2 delivery evidence

9 October 2026. This candidate builds on main `d0d71a7`, including the independently merged Recall evaluation/ranking work (#142) and atomic clip quotas (#141). It implements the remaining evidence and platform changes. **M2 is not ready to close:** #134 still requires an actual candidate-host transcript and component check. Legacy result mode remains the default.

## Task coverage

| Task | Delivery and evidence | Status |
|---|---|---|
| #117 Retrieval benchmark | [40-query evaluation](../evals/recall/README.md), frozen development/validation splits, files/Postgres/linked paths, source and passage checks | Merged in #142 |
| #118 Recall ranking | Conversational prefixes, quoted titles, identifier/version boundaries and visible coverage; two disclosed lexical misses remain | Merged in #142; preserved here |
| #119 Identity | [26 reviewed scenarios](../docs/explanation/content-identity.md) distinguish saved pointers, retained material, interpretation, publication and temporary handoffs without adding a store | Implemented |
| #120 Locators | Optional bounded surrounding text, digest and revision; conservative exact/relocated/ambiguous/unavailable resolution; legacy and retained-source fallback coverage | Implemented |
| #121 Retry safety | [Seven-day receipts](../docs/explanation/retry-safety.md), atomic with clip/share creation; concurrent replay, conflict, deletion, expiry and lost-response tests | Implemented |
| #122 Reader preferences | [Account scope and defaults](../docs/explanation/reading-experiences.md#reading-comfort), queued saves, reset and older-writer preservation; file/Postgres/linked/fresh-card checks | Implemented |
| #134 Result budget | [Typed opt-in boundary](../docs/reference/result-payloads.md), seven-case payload benchmark, full component data, attributed pagination and missing-metadata fallback | Actual host check pending |
| #135 Account partitioning | Existing store contracts over account rows; validated atomic migration, restart and rollback after edits/deletion; independent-lock and linked checks | Implemented |
| #136 Clip quotas | Count and bytes remain atomic across independent Postgres connections, including size-changing edits | Merged in #141; preserved here |
| #137 Navigation | [Shared view lifecycle](../docs/explanation/view-lifecycle.md), explicit ownership and return state, stale-result cancellation through Back and teardown | Implemented |

Epic #105 has candidate evidence for its remaining children; it should close only with accepted delivery. Epic #109 and M2 remain open until the actual-host gap is resolved. Neither simulated hosts nor issue counts replace that evidence.

## Validation

Environment: Apple M2, macOS arm64, Node v24.9.0, disposable PostgreSQL on loopback and installed headless Chrome. Data and sources are synthetic fixtures, with authenticated in-process linked clients where stated. No production data was migrated or published.

The final merged `TEST_DATABASE_URL=postgres://127.0.0.1:55438/postgres npm run check` passed: **636 tests, 635 passed, one expected file-retention skip, zero failures**. Strict server/UI type checks (47 UI casts), generated design checks and tool schema/footprint checks passed. An earlier merged run had a docs Find pointer timeout; it did not reproduce in the isolated case, the complete 45-test browser sequence or the final full gate. No test was removed or weakened to bypass it.

The first Linux CI run exposed an existing bookmark test racing the optimistic button update against the stored profile. The test now waits for the durable removal before its unchanged persistence assertion; the targeted three-layout browser case passes locally. This adjustment changes test synchronization only. CI omits Postgres because its workflow does not set `TEST_DATABASE_URL`; the local gate above includes it.

Key suites: `test/account-documents.test.ts`, `test/store-contract.test.ts`, `test/db.test.ts`, `test/privacy-db.test.ts`, `test/linked.test.ts`, `test/evidence.test.ts`, `test/result-payload.test.ts`, `test/write-receipts.test.ts`, `test/ui-browser.test.ts` and `test/ui-passage.test.ts`. Existing portability, account-deletion and source trust tests run in the same gate.

Browser assertions cover native passage choice and Escape focus, retained quotes during source outages, moved/repeated/changed passages, Recall query/filter/selection return, reading writes and saved positions, delayed responses after Back/teardown, preference reopening/reset, 360–380px narrow layouts, 200% text sizing and theme compatibility. The visible changes add saved-preference status and precise passage fallback wording to the existing reader controls; the content viewport and room layouts retain their existing contracts. These tests use a simulated MCP Apps bridge, not a certified Codex/ChatGPT host.

## Measurements

The inherited [Recall report](../evals/recall/README.md) gives per-query outcomes and limitations. Across all four paths, development retrieval@5 improved from 18/22 to 21/22 and validation from 8/10 to 9/10. All eight negative cases pass; source/passage cases remain 2/2 in each split. These are synthetic regression results, not human-use or population estimates. The disclosed validation cases were not retuned here.

The [account-document benchmark](m2-account-documents.json) compares 192 writes across 24 accounts with a pool of five. Shared documents used 106.42 ms and about 2.57 MB/2.68 MB of JSON query results/arguments; partitioned rows used 28.98 ms and about 120 KB/123 KB. Both made 960 SQL calls. This bounded local run does not measure production capacity, network traffic or disk I/O. Independent-lock tests establish the concurrency invariant separately.

The [result benchmark](m2-result-payloads.json) measures complete model-visible serialized fields under the explicit component contract. Seven cases range from 446 to 12,573 bytes against a 32,768-byte ceiling. The long docs result changes from 420,578 to 10,864 bytes, with its complete representation retained for the component. Full wire bytes are reported separately; no token or network-cost reduction is inferred from hiding component metadata.

## Compatibility and rollout

- All new public inputs are optional. Legacy result shapes remain the default; app-only preference tools stay out of the model tool list. No version was bumped manually.
- Locator context and reader settings are additive. Old locators still resolve conservatively. Older profile writers preserve omitted comfort settings. Export version 3 includes the profile settings and locators; temporary receipts are not exported.
- File stores remain single-writer-process storage. Retry keys are account/operation scoped, capped at 2,000 live receipts and replayable for seven days. Expired records are pruned on subsequent keyed writes; account deletion removes all receipts.
- Hosted collection/experience migration requires **all web and worker writers stopped**. Follow the [migration/rollback procedure](../docs/how-to/migrate-account-documents.md), including a backup restored to staging. Rollback reconstructs current data, so it does not resurrect deleted accounts from a historical content copy.
- The [actual-host probe and procedure](m2-host-check.md) are ready. Candidate raw stdio and simulated component tests pass, but neither proves that an actual host excludes `_meta` from model context and delivers it to the card. Do not enable `component-v1` broadly until the named host/version is verified.

`npm run planning:check` found M3 and M4 both prepared, meeting the target of two milestones ahead. No planning deficit or open request required dispatch.
