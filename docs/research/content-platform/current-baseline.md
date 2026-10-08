# Current code baseline and execution decisions

Reviewed 8 October 2026 · GitHub main at `75e8e240f9c7f157ef290efd15b5caadc4a73941`

This review supersedes **shipped-status and implementation-priority assumptions** in the original research at `75888bf`. The original documents remain historical evidence and proposals. GitHub issues are the live execution backlog; do not implement an old proposal without checking this reconciliation and current code.

## What already exists

Main includes Recall Shelf (`search_library`), private Topic Desks, comparisons, reading trails, conservative saved-passage locators, durable finite catch-up, and a background reading-watch worker. It also has six room layouts, page find, session-local reading comfort controls, personalized public Spaces/RSS, remembered share audiences, on-demand Shopify follows, and newer plugin packaging/upgrade gates. These are visible in the [reading experience explanation](../../explanation/reading-experiences.md), [changelog](../../../CHANGELOG.md), and corresponding implementation.

The backlog therefore emphasizes quality, evidence, targeted extensions and shared contracts. It does not ask for a second library, collection system, reader, token pipeline or reading-watch worker.

Existing open work also matters: [PR #60](https://github.com/lbliii/mcportal/pull/60) combines reader work from [#57](https://github.com/lbliii/mcportal/pull/57), [#58](https://github.com/lbliii/mcportal/pull/58) and [#59](https://github.com/lbliii/mcportal/pull/59); [#94](https://github.com/lbliii/mcportal/pull/94) implements a live-preview Space editor. New integration tasks reference those candidates instead of duplicating their changes. Status is time-specific; check GitHub before acting.

## Preserve, improve, refactor, redesign

| Decision | Code evidence | Product consequence |
|---|---|---|
| **Preserve** the modular monolith, direct UI actions and typed tool contracts | [tool runtime](../../../src/tools/kit.ts), [result types](../../../src/tools/results.ts), [architecture](../../explanation/architecture.md) | These support an installable, directly usable workspace without requiring a model turn for every action. |
| **Preserve** the validated token/theme system and specialized readers | [design system](../../reference/design-system.md), [reader](../../../src/ui/room/reader.js), [docs](../../../src/ui/room/docs.js) | Improve coherence and accessibility within the existing identity. No evidence justifies a wholesale UI framework or visual-system replacement. |
| **Improve** retrieval against a benchmark | [library](../../../src/library.ts), [Postgres clips](../../../src/db/clips.ts) | Search already combines saved references, clips and history. It loads bounded candidate sets and ranks in process; hosted clips additionally use full-text ranking. Evaluate exact identifiers, conceptual recall, coverage and latency before adding another search service. |
| **Improve** locators and retention semantics | [evidence](../../../src/evidence.ts), [passage return](../../../src/ui/room/experiences.js) | Current locators carry up to 300 characters plus heading/block hints and conservatively reject non-unique matches. Add revision/context support without losing that honesty or legacy compatibility. |
| **Refactor** hosted content persistence by account | [storage wiring](../../../src/storage.ts), [PG persistence](../../../src/db/auth.ts), [experiences](../../../src/experiences.ts), [collections](../../../src/collections.ts) | Collections and reading experiences each occupy a shared persistence key containing multiple accounts. Whole-key locking and serialization couple otherwise independent workloads. Per-account persistence should sit behind the existing contracts. |
| **Refactor** view lifecycle ownership | [shared closure checker](../../../scripts/check-ui.ts), [experiences navigation](../../../src/ui/room/experiences.js), [UI assembly](../../../src/mcp.ts) | Shared globals coordinate reader generations, DOM classes, scroll, focus and reading writes. Extract explicit transition contracts incrementally as archetypes grow; file length alone is not a reason to rewrite. |
| **Redesign** the model/UI result boundary | [article result](../../../src/tools/reader.ts), [result helper](../../../src/tools/kit.ts), [definition footprint](../../../scripts/footprint.ts) | A short prose response does not ensure a bounded model-visible result when the full representation also travels in structured content. Measure the actual result contract and keep rendering data available through tested host capabilities. |
| **Repair** atomic Postgres quota enforcement | [PG clip creation](../../../src/db/clips.ts), [document clip creation](../../../src/clip-stores.ts) | Concurrent creates can exceed a quota in Postgres; the corresponding document-store check/write uses a per-user mutex. This is a reproducible contract gap, not a speculative scale concern. |

## Findings and confidence

### Full structured results can defeat the intended model budget

`read_article` splits the prose into 12,000-character parts but passes the whole `article` to `ok(...)` as `structuredContent`. `CallToolResult` has no component-only `_meta` field. The existing footprint suite measures tool definitions and instructions, not complete tool-call results.

OpenAI explicitly documents both `content` and `structuredContent` as model-visible, with result `_meta` reserved for the component. Therefore the current architecture documentation's implication that full structured content is only for the room needs qualification. Actual host exposure, payload size and a compatible delivery change remain to be measured; no observed token-spend or privacy incident is claimed. [OpenAI result reference](https://developers.openai.com/plugins/reference)

### Hosted document granularity creates a concrete scaling constraint

`storage.ts` constructs `DocumentCollectionStore(pgAuthPersistence(db, 'collections'))` and `DocumentExperienceStore(pgAuthPersistence(db, 'reading-experiences'))`. The persistence layer locks a whole key and reads/rewrites its JSON value. The experiences document holds account records, uses `maxAgeMs: 0`, and the worker enumerates owners and reads account state through that contract.

The implementation provides atomic updates; this finding is about contention and work proportional to the shared document, not a demonstrated authorization leak. Benchmark per-account and aggregate workload, then migrate behind the same interfaces with restartable conversion, rollback and privacy/portability checks. Do not infer that this persistence change alone makes the whole server safe to run across multiple replicas; other in-memory limits and auth lifecycle remain deployment constraints.

### Clip quota race: reproduced

`PgClipStore.add` awaits `usage(userId)` and later issues `INSERT`, without a transaction/lock coupling the quota decision and write. A disposable socket-only Postgres instance was initialized with synthetic content and 999 clips. Two calls used the real store/query path, with a test barrier after both real usage queries completed, then both inserts were released.

| Observation | Result |
|---|---|
| Configured count limit | 1,000 |
| Initial count | 999 |
| Concurrent creates fulfilled | 2 |
| Final count | 1,001 |

The barrier forces a valid concurrent interleaving; this proves the race can occur, not how frequently it occurs in production. The disposable database was stopped after the experiment. The repair should protect count and byte limits across database connections and keep independent accounts concurrent. Retry deduplication is a separate invariant.

### Existing strength and remaining uncertainty

The current library is bounded and ownership-scoped; locators avoid guessing; reading watches use durable leases and reject stale lease results; private collections remain separate from public Spaces; file/Postgres/linked contracts and compatibility gates already exist. Those are valuable foundations.

Competitive advantage still needs task evidence: source fidelity, fast recovery of retained evidence, understandable agent scope, reliable installation, and calm navigation. Neither feature count nor introducing a vector database/framework proves those outcomes. User studies and a held-out retrieval evaluation are explicit work items.

## Execution links

- [Bound model-visible tool results independently from UI rendering data](https://github.com/lbliii/mcportal/issues/134)
- [Partition hosted collections and reading experiences by account](https://github.com/lbliii/mcportal/issues/135)
- [Make Postgres clip quota enforcement atomic under concurrent creates](https://github.com/lbliii/mcportal/issues/136)
- [Extract explicit view lifecycle contracts from shared room navigation state](https://github.com/lbliii/mcportal/issues/137)
- [Establish a held-out Recall Shelf retrieval benchmark](https://github.com/lbliii/mcportal/issues/117)
- [Record a shared content identity and retention contract](https://github.com/lbliii/mcportal/issues/119)

## Verification performed

- Inspected current code, storage wiring, relevant test contracts, changelog, contributor guidance, roadmap and open PR descriptions.
- Installed locked dependencies with `npm ci --ignore-scripts`.
- Ran `npm run check` outside the restricted execution sandbox: **523 passed, 0 failed, 26 skipped**; type checking and generated design checks passed. The initial sandboxed attempt failed on local-server/browser restrictions and is not treated as a product regression.
- Ran the focused real-Postgres quota experiment above. This is not a full Postgres regression run; the suite's environment-dependent skips remain explicitly unverified.
- Reviewed issue-form structure and local documentation links separately for this planning change.

No runtime fix, database migration, production setting change, directory submission, or existing PR merge is part of this planning delivery.
