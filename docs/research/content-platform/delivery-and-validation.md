# Delivery and validation plan

> Historical assessment at `75888bf`. Read the [current code reconciliation](current-baseline.md) before using this as an implementation backlog. Several proposed features subsequently landed on main.

Proposal · 8 October 2026

## First milestone: complete the evidence loop

Deliver one coherent path across the room, documentation/article reader, host agent, clips, and library retrieval. Reuse existing reading continuity and passage actions. The new proof is that the **same attributable source passage remains usable across those transitions and a later conversation**.

This milestone should answer two questions: can the shared architecture support different archetypes without fragmenting the experience, and does the embedded workspace improve the cohort's real workflow enough to earn repeat use?

## Work sequence and acceptance gates

These are incremental work packages, not calendar promises. Effort is relative and should be re-estimated after the first host and identity decisions. “Owner” denotes a responsibility to assign, not an already assigned person.

| Package | Work and existing foundation | Dependencies / effort | Exit evidence | Owner |
|---|---|---|---|---|
| 0. Reconcile and prototype | Reconcile shipped state against older plans; settle Save's retention promise; prototype inline entry, expanded reading, scope, and retrieval-result states using current tokens | None; small | One reviewable end-to-end walkthrough plus failure states; actual-host surface decisions recorded | Product + design + host engineer |
| 1. Preserve identity and passages | Add reference aliases and revision-aware locators to existing reading/clip contracts; surface persistence errors; add retry-safe creation receipts | Package 0 contracts; medium | Quote survives reopen; changed/repeated text has honest resolution; old clips still open; file/Postgres parity | Core engineer |
| 2. Retrieve and reuse | Unified retained-library read/search projection, explicit history scope, matched passages, original-versus-note results; retain generated notes with source relations | Reference contract from 1; medium | Developer and researcher vertical journeys work across a new conversation on the same account | Core + UI engineer |
| 3. Validate the experience | Participant sessions, host teardown/fallback checks, accessibility tasks, retrieval benchmark, migration/export/deletion checks | Prototype starts in 0; final gate after 2; medium | Meets the gates below, or a scoped repair decision with evidence | Research/design + QA + engineering |
| 4. Broaden archetypes | Improve docs version/symbol UX, collection views, and selected media/source types based on observed demand; refine existing share/Space behavior | Validated core contract; medium per chosen slice | New archetype inherits save/locate/search/action behavior and passes the same lifecycle tests | Product + relevant renderer owner |
| 5. Collect proactively | Durable ingestion worker, coverage, watches, finite inbox; notification adapters only after inbox works | Stable content identity, durable history, operations evidence; large | Restart/retry does not duplicate items; gaps are visible; watches can be paused/deleted | Backend + operations |

Critical path: **surface and retention contract → stable reference/locator → retrieval loop → user and host validation**. Visual refinements and interview recruitment can proceed while the contracts are implemented. Do not schedule a service split or storage rewrite as a prerequisite.

This refines the earlier [delivery roadmap](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/plans/delivery-roadmap.md): several foundation and continuity items already exist. Work estimates must count the missing behavior, not reimplement completed features. Existing social functionality remains part of the platform; additional social ranking is not necessary to prove the first lifecycle.

## Concrete first implementation backlog

| Priority | Deliverable | Acceptance criterion |
|---|---|---|
| P0 | Shared content and locator schema with legacy adapters | A feed appearance, saved link, reading record, and quote resolve consistently; versioned URLs and distinct private scopes remain separate |
| P0 | Quote save receipt and source return | Exact current target reopens; a removed/changed target shows retained text and an honest fallback; retry creates one quote |
| P0 | One authorized Library query surface | Searches retained links and clips together; optional history scope is visible; direct UI and agent receive the same authorized matches |
| P0 | Host surface/action contract | Compact entry and supported expanded view work; capability absence/refusal produces an immediate usable alternative |
| P0 | Context and authorship communication | Participant can identify what was sent to the agent and distinguish source wording from generated explanation |
| P1 | Clear primary action labels and keyboard passage route | Save, source, ask, and clip can be discovered and completed without icon guessing or pointer-only selection |
| P1 | Lightweight collection membership and related results | One item can belong to two collections without duplicate reading state; removing membership does not delete the source or clip |
| P1 | Documentation version and symbol retrieval | Relevant version stays attached through search, quote, and agent context; exact identifiers remain retrievable |
| Later | Full retained copies, advanced PDF/media, proactive collection | Each has an explicit preservation/rendering/coverage promise and passes the inherited lifecycle contracts |

P0 means required for the milestone, not a production incident severity. Refine priorities after package 0; no runtime change is part of this research delivery.

## Participant research

Recruit 12 people for formative work: six developers and six researchers who already use agents. Include people with an established reading/notes workflow, more than one agent host across the sample, and participants who use keyboard navigation or assistive technology. These are purposive qualitative samples; proportions must not be reported as population prevalence.

Begin with a short contextual interview grounded in the last real task: where the person found material, how they used their agent, what they retained, and whether they retrieved it later. Avoid asking whether they like the abstract idea of a unified platform.

Run two rounds of six task sessions, balanced across the cohorts, with revisions between rounds. Use equivalent prepared sources and optional participant-owned material with permission. Compare against each person's normal workflow; for controlled task comparisons, vary order and use equivalent tasks to reduce practice effects. Do not claim statistical superiority from this sample.

| Task | Prompt to participant | Observe |
|---|---|---|
| Orientation | Find a useful update and establish what it is based on | First source choice, interpretation of recommendation reason, navigation recovery |
| Documentation | Determine the behavior of a named API in a specified version | Wrong-version use, symbol search, code handling, source verification |
| Evidence retention | Keep the exact support for a claim and add your own interpretation | Save-versus-clip understanding, attribution, source/note distinction |
| Agent handoff | Ask about the chosen evidence using your agent | Awareness of scope, duplicate context, unsupported-host recovery |
| Return | In a new conversation, recover the evidence from a vague remembered phrase | Retrieval success, passage accuracy, need to recall titles or app-specific commands |
| Sharing comprehension | Prepare a contribution for another person | Audience comprehension, unexpected private content, attribution understanding |

Measure completion without moderator assistance, time on task, wrong turns, recovery, and participants' explanation of what happened. Use a simple post-task ease question and a confidence question whose reasons are discussed. Do not treat confidence as evidence of correctness.

After repair, invite four to six willing participants into a one-week field trial. Ask for brief event-based diary entries when they actually return to retained material, lose context, or choose their old workflow. The trial assesses recurring value and friction; it is too small to establish long-term retention.

## Proposed gates and benchmarks

Targets below are initial product gates, not externally validated industry benchmarks or results already achieved. Establish a baseline, record deviations, and revise targets deliberately rather than quietly changing them to fit results.

### User gates

- In the second formative round, at least five of six participants complete the main source → quote → later retrieval path without moderator help, with successful examples from both cohorts.
- No observed critical misunderstanding about publication audience, the source of a quotation, or what context was sent remains unresolved at release.
- Each participant can recover from an unavailable source or unsupported host action without a dead end. Record all failures; a single happy-path success does not establish this gate.
- Field participants demonstrate actual return-to-evidence events, not only praise for the interface. If repeat use depends on researcher reminders, revisit the value proposition before expanding scope.

### Technical and retrieval gates

Build a small evaluation set before tuning ranking: approximately 40 queries spanning exact title, code symbol, version, conceptual paraphrase, partial remembered quote, personal note, duplicate appearance, and deliberately absent content. Keep a held-out portion. Each query has authorized expected results and target locations, including negative permission cases.

Initial retrieval target: the intended available item appears in the top five for at least 85% of answerable held-out queries. Report results by query type and corpus coverage; do not inflate recall by excluding difficult queries after evaluation. Track whether the first useful hit returns to the correct source location separately from ranking.

Add at least 20 deterministic lifecycle scenarios: duplicate arrival, intentional version difference, private/public overlap, source revision, repeated quote, deletion, partial extraction, retry after timeout, concurrent reading updates, export/reimport where supported, and revoked access. Require zero cross-account disclosures, zero duplicate publications from retries, and zero false “exact” matches in these cases. Expand cases when defects reveal a missing category.

Set initial warm-library search and usable-result targets after measuring the current build on a declared device and corpus. A reasonable starting budget to evaluate is a p95 under one second for warm search over 1,000 retained references; this is a proposed budget, not an assertion about current scale or performance. Measure upstream fetch/extraction latency separately and show useful partial state while waiting. Preserve current payload bounds until measurement justifies changes.

### Host and accessibility gates

Use the existing [host checklist](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/host-compatibility.md) as the record of tested host/version/date. For each host claimed as supported, verify inline/expanded behavior, source links, direct tool calls, context preparation, message sending, denied capabilities, teardown, restoration, and return navigation. Terminal tools get their own text-path check. Local preview results never substitute for this evidence.

Run the repository's required checks when implementation changes land, including `npm run check` and relevant design/host checks described in [CONTRIBUTING](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/CONTRIBUTING.md) and the [design system](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/design-system.md). Add meaningful tests for identity, permissions, resolution, persistence, and recovery. Avoid a new test for every reversible copy or spacing adjustment.

Validate the core task with keyboard and a screen reader in a supported browser/host combination, text resizing and reflow, reduced motion, and forced colors where available. Record untested combinations explicitly. Publication and data migration also require the relevant operations checks.

## Success measures and privacy

The principal value measure is **successful reuse of retained evidence**: a person reopens a previously retained source/quote and uses it in reading, a note, or an agent task. Instrument only what is necessary to observe the loop, with a disclosed opt-in policy where appropriate. Raw quotes, search queries, private URLs, and conversation text are not needed in routine analytics.

| Measure | Definition | Interpretation limit |
|---|---|---|
| First useful session | Source opened and one useful action completed, with source understanding checked in study | An event count alone cannot prove usefulness |
| Retained-evidence retrieval | Previously saved/quoted item successfully reopened from search or collection | Denominator is retrieval attempts; include failures |
| Passage resolution quality | Exact, relocated, ambiguous, unavailable outcomes, checked against source fixtures | A high automated match rate can hide false matches |
| Cross-conversation continuity | Successful resume/retrieval on same authorized account after reopening | Do not infer automatic local-to-hosted synchronization |
| Failure recovery | Failed action followed by successful retry or an understood alternative | Silently abandoned actions must remain visible in analysis |
| Return value | Voluntary sessions on later days that include evidence reuse | Small pilot data is directional, not a retention forecast |

Count fewer clicks only when the participant reaches the correct evidence. Session length, feed consumption, and generated-answer volume should not become the primary optimization targets.

## Decision log and conditions for changing direction

| Proposal | Reason | Revisit when |
|---|---|---|
| Shared references with specialized renderers | Supports breadth while preserving continuity | An archetype cannot fit without losing essential behavior; extend the contract explicitly |
| Compact inline entry plus expanded workspace | Respects host interaction constraints | Verified host guidance/capabilities change |
| Read projection before store migration | Makes the experience coherent at lower implementation risk | Measured limits or consistency requirements demand a dedicated store |
| Lexical and exact retrieval before embeddings | Developer identifiers and source traceability need dependable baselines | Held-out evaluation shows conceptual misses that hybrid retrieval improves |
| Deliberate publishing over inferred sharing | Personal retention and publication carry different expectations | Research changes the interaction, never the requirement for clear audience and intent |
| Developer/researcher cohort first | High-frequency source and agent workflows test the proposed core | A cohort consistently lacks recurring need or another audience shows stronger observed value |

The next decision should be made against the end-to-end prototype and baseline measurements. Broadening the platform becomes easier once a new archetype can inherit demonstrated lifecycle behavior instead of introducing another isolated workflow.
