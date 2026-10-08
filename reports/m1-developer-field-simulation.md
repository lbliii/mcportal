# M1 developer field simulation — logical day 2 and day 7

Run date: 8 October 2026. This is the user-authorized **agent-proxy substitute** for elapsed field use. It is not a one-week trial, an observation of real participants, a retention-rate study, or evidence of spontaneous adoption.

The two original developer role briefs are D1, the experienced backend developer using pinned docs, and D3, the occasional agent user retaining debugging evidence. Their original round-1 fixture directory had already been deleted. This replay therefore **reconstructs their synthetic starting material** under fresh isolated accounts, then preserves that replay state across logical days. It does not pretend to reuse the deleted round-1 record files.

## Design and boundaries

`/tmp/m1-developer-field.ts` orchestrated six distinct Node processes: setup for both roles, then one fresh process per role on logical day 2 and logical day 7. Each process constructed new file-store objects and an empty cache. The shared state consisted only of the replay's temporary files. Each retrieval discovered clip and collection IDs through search/list tools; no transcript or in-memory object from the preceding process was provided.

Logical day 1 maps to fixture handoff time `2026-10-08T14:00:00Z`; day 2 maps to one day later and day 7 to six days later. Only the handoff store's injectable clock advances. Clip and collection timestamps remain the actual execution-time timestamps; the study does not falsify those records or advance the operating-system clock. Day-1 handoffs expire at fixture time `2026-10-15T14:00:00Z`, so they are still valid at logical day 7. No elapsed days passed during this execution.

All source content was synthetic, with a finite in-memory fetcher and no real source network. Stored state was removed in a `finally` block after the six successful processes. `/tmp/m1-developer-field-results.jsonl` is the session-local execution log. The evidence needed for review is retained below.

## Starting records

| Role | Exact retained passage | Source | Private collection |
|---|---|---|---|
| D1 — pinned version setup | `Widget v1 requires Node 20 and uses legacy_init().` | `https://raw.githubusercontent.com/acme/widgets/v1/docs/install.md` | `V1 migration desk` |
| D3 — diagnostic investigation | `The sentinelneedle flag exposes retry diagnostics without changing the retry policy.` | `https://raw.githubusercontent.com/acme/widgets/v1/docs/debug.md` | `Retry investigation` |

The setup processes opened versioned docs, read the source, stored a quote with URL/locator, created a one-entry desk referencing that quote, and created a docs handoff containing the passage and anchor. No full article snapshot was claimed.

## Prompting and return-choice classification

| Checkpoint | Return setup | Classification |
|---|---|---|
| D1, day 2 | Explicit instruction to retrieve the retained initializer evidence and reopen its desk | Prompted retrieval |
| D3, day 2 | Explicit instruction to retrieve the retained diagnostics statement and reopen its desk | Prompted retrieval |
| D1, day 7 | Scenario offers notes, browser docs, or Recall for a recurring migration question; the replay script selects Recall | **Scripted choice** among alternatives; not actual spontaneous use |
| D3, day 7 | Explicit instruction to recover the stored debugging evidence while its source is unavailable | Prompted outage retrieval |

“Scripted choice” records the branch specified by the simulation. It is neither an unsolicited return by a human nor an independent behavioral decision measured by this test. The one scripted-choice checkpoint and three prompted checkpoints must not be collapsed into four spontaneous returns.

## Executed reuse observations

Each reuse sequence called `search_library` with the remembered term, `get_clip` for the returned ID, `open_collection` without an ID to discover collections, and `open_collection` for the returned desk ID. It then called `open_handoff` without a code to recover the stored handoff. D1 day 7 additionally read the changed live docs page.

| Role / logical day | Search and retained retrieval | Handoff or live-source outcome | Failure / recovery |
|---|---|---|---|
| D1 / 2 | `legacy_init` returns exactly one match; exact setup text and v1 URL retained; one desk entry, no unavailable refs | Handoff carries the original passage; live source opens | No failure injected; all assertions pass |
| D3 / 2 | `sentinelneedle` returns exactly one match; exact debugging text and DEBUG URL retained; one desk entry, no unavailable refs | Handoff carries the original passage; live source opens | No failure injected; all assertions pass |
| D1 / 7 | Same exact quote and v1 URL retrieved; one desk entry; no source fetch needed to retrieve retained material | Current fixture page now says `Widget v1 patched guidance now requires Node 22; archived initializer legacy_init remains for migration.` Original retained quote still says Node 20 | Source change is injected. The replay confirms old evidence and newly fetched content remain distinct; the proxy must identify the quote as historical before applying current guidance |
| D3 / 7 | Same exact debugging quote and URL retrieved; one desk entry; no source fetch needed for retained material | All live fetches return 503. `open_handoff` succeeds with `unavailable: true`, original passage, and `Only the stored handoff above is available; do not infer the rest of the page.` | Source outage is injected. The retained passage is usable; the rest of the live page remains unavailable and is not counted as recovered |

All four retained-retrieval checkpoints completed with **zero fetcher calls before opening the handoff**. Live handoff/page work made two fixture fetches in each available-source checkpoint, and one failed fetch in the unavailable-source checkpoint. These numbers establish what the executed code requested, not a measured human time saving.

Execution process IDs were distinct: day-1 setup `44644` and `44645`; day-2 reuse `44646` and `44647`; day-7 reuse `44648` and `44649`. Each process exited successfully. These are ephemeral local process identifiers, not participant data.

## Value, decision, and limits

The executed value is concrete: retained evidence can be found by its words and reopened with provenance and collection membership after process restart, without loading the source. Source mutation does not rewrite the stored quote, and a source outage does not erase a handoff's retained passage. The simulation also exposes a necessary interpretation boundary: an older quote is evidence of what was retained, not proof of current documentation requirements.

**Synthetic field gate:** pass for four prompted/scripted reuse checkpoints across two original developer role briefs, including changed-source and unavailable-source conditions. No new product failure was observed in these checks. There is no claim that either role developed a habit, preferred MCPortal to its usual workflow, returned unaided, or saved a measured amount of time.

The baseline workflows are persona assumptions, not measured comparisons. The replay does not test real network unreliability, multi-device synchronization, production-host context continuity, assistive technology, handoff expiration beyond the configured seven-day limit, or actual wall-clock aging. A real field study would still be needed to establish adoption or week-long human retention; under the user's proxy instruction, this report supplies explicitly bounded simulation evidence instead.
