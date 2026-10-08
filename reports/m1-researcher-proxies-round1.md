# M1 researcher proxy study — round 1

Date: 2026-10-08. Three **agent-simulated researcher personas**, authorized by the user's instruction to emulate participants as user proxies. These are synthetic task evaluations, not recruited participants, human interviews, observed human behavior, independent model samples, or evidence of product-market fit. One delegated agent exercised all three persona roles. No real research records or personal data were used.

The round found one confirmed recovery defect: a new-chat handoff stops at an unavailable source and withholds the already retained passage. Retained clips, private desks, source/agent separation, and changed-passage recovery otherwise passed the bounded scenarios below. A smaller novice-search friction remains: literal conversational searches need keyword reformulation.

## Method and evidence boundaries

Read `docs/explanation/reading-experiences.md` and `docs/how-to/organize-reading.md`, then inspected the library, collection, comparison, clip, reader, handoff, and passage implementations. Exercised real tool handlers against fresh file stores in scratch storage. A second context constructed from new store objects represented a new conversation; this was **not** an actual host conversation, linked device, deployed server, or authenticated production account.

The primary reading source was the repository's `test/fixtures/article.html`, exposed by the fixture fetcher as `https://yashgarg.dev/posts/ps5-rtmp`. A second, explicitly synthetic HTML source at `https://study-fixture.example/reproduction` stated that its network blocks custom DNS. Its content tested comparison behavior; it is not independent real-world evidence about the primary article. No live source was fetched.

Observed results came from executed handler calls and existing browser tests. Persona goals and interpretations are simulations. No satisfaction ratings, completion times, or success percentages are asserted as human measurements. Browser tests used headless Chrome against the local preview or a fixture MCP Apps host; they do not certify Codex, ChatGPT, or Claude host behavior.

Round-1 reproduction artifacts, outside the repository:

- Script: `/tmp/m1-researcher-proxies-round1.mjs`
- Raw results: `/tmp/m1-researcher-proxies-round1-results.json`
- Scratch store for this execution: `/var/folders/wr/gk31dys95vz4qq6vsmr8pnx40000gn/T/m1-researcher-round1-RaENr9`

These temporary paths support immediate reproduction during this work session; they are not durable deliverables. The scenarios and decisive outputs are recorded below. Only this report was added to the repository by this agent. The shared working tree was concurrently integrating reader changes, so this is a working-tree evaluation rather than a released-build certification.

## R1 — literature synthesis researcher

**Simulated objective:** assemble evidence about platform and network constraints, retain the precise supporting passage, keep personal caveats separate, and return to the synthesis in a later conversation.

**Executed sequence:**

1. `read_article` opened the fixture article, titled “Hijacking the PS5's RTMP Stream”. `save_item` retained a bookmark with the note “Evidence for platform constraints”.
2. `clip` retained the source sentence verbatim: “The PS5 doesn't hardcode Twitch's IP; it looks it up via DNS every time.” The source included its URL, the `DNS Trick` heading, and a text locator. A separate note clip recorded a simulated researcher hypothesis about network policy, explicitly labeled as an inference.
3. `update_collection` created the private desk “Streaming platform evidence” with the quote, primary-page reference, and personal note: three entries.
4. An orientation citing `url:https://unknown.example/invented` was rejected with `invalid_argument`: “Every orientation reference must name current collection evidence.” An orientation citing the retained clip succeeded.
5. An unrelated scratch account could not open the desk: `not_found`, “This collection is unavailable.”
6. New file-store/context objects opened the same desk, returned all three entries, reported `orientationStale: false`, and found the quote through `search_library({query:'DNS',kind:'quote'})`. `get_clip` returned the exact original quote and preserved its locator.

**Observable outcome:** the simulated synthesis task completed with persistent evidence, distinct personal and agent writing, citation membership validation, and caller isolation. The browser comparison test separately verified visible agent writing and preservation of source-pane reading positions. Neither the schema nor this proxy validates whether an agent's interpretation is substantively true; the researcher must still assess the cited source.

**Proxy interpretation:** keeping a passage and a separately labeled caveat is a credible basis for a bounded literature note. This does not establish that the interface is understandable to an untrained human researcher.

## R2 — investigative source-verification researcher

**Simulated objective:** examine a claim against a second source, distinguish evidence from interpretation, move a selected passage to a new conversation, then recover when the original disappears.

**Executed sequence:**

1. `read_article` opened the primary fixture and the controlled reproduction fixture. The simulated second source's limitations remained explicit in the supplied interpretation.
2. `show_comparison` accepted two distinct source refs and a separately supplied interpretation with both refs. Its result contained two source entries and an orientation object. This tool made zero fetches, as its contract is to render supplied interpretation. Browser verification demonstrated the rendered interpretation occupies its own labeled section and updating it preserves pane position.
3. `create_handoff` retained the primary URL, title, exact DNS passage, heading, and block hint. A fresh context's `open_handoff` successfully returned that same passage.
4. The fixture for the primary URL was changed to HTTP 404. Another fresh context's `open_handoff` returned only `upstream_error`, “Could not open https://yashgarg.dev/posts/ps5-rtmp: Page responded 404”. It returned no handoff or retained passage in structured content or model text.
5. Direct inspection of the handoff store confirmed that the exact passage was still retained. The failure is retrieval presentation, not disappearance from storage.

**Observable outcome:** source comparison and normal new-context retrieval completed; unavailable-source recovery through a handoff failed. This is RP-1 below. The test intentionally cleared the in-memory article cache by constructing a fresh context, so a cached page could not hide the defect.

**Proxy interpretation:** the inaccessible retained quotation prevents the investigator from discussing the saved evidence precisely when the live source is unavailable. A useful recovery should show the retained quote with its provenance and an explicit source-unavailable notice.

## R3 — mixed-methods researcher unfamiliar with product names

**Simulated objective:** use ordinary research concepts—saved material, source notes, quotations—without depending on knowing “Recall Shelf” or “Topic Desk”; locate evidence later and identify what survives removal.

This is an informed walkthrough after reading the requested documentation, not a blind discovery study. The persona's unfamiliarity is a task lens, not a claim of independent human learning.

**Executed sequence:**

1. `save_item` retained the primary page as “Streaming constraint article”. `clip` retained the DNS passage with the title “Streaming constraint passage” and a text locator.
2. `search_library({query:'DNS'})` returned one retained quote. A literal `search_library({query:'find what I saved about DNS'})` returned zero results. Reformulating to the keyword recovered the result. This is bounded lexical behavior, not an agent-language understanding test.
3. `update_collection` created “My source notes” from the clip reference.
4. After the source fixture became unavailable, `read_article` returned an error while `get_clip` still returned the exact retained passage.
5. Deleting the scratch quote and reopening the collection left one unavailable reference in membership instead of silently hiding the missing evidence.
6. Browser checks independently exercised a moved passage, duplicated passage, and changed passage. Unique moved text was found despite the obsolete block; duplicate/changed text produced the unresolved-passage notice; the retained quote remained unchanged.

**Observable outcome:** the evidence could be recovered without the original page, and source removal was represented honestly. Literal conversational search needed reformulation. The docs provide plain-language requests, but this proxy does not prove navigation labels are discoverable without assistance.

**Proxy interpretation:** the distinction between a saved page and a retained quote is necessary for reliable research use. The reading guide states that saved links are fetched again and that searches use retained material; this distinction should remain visible during onboarding and search recovery.

## Ranked findings and reproduction

### RP-1 — P1: unavailable source hides a retained handoff passage

**Type:** confirmed product failure; R2; reproducible through actual handlers.

**Trigger:** create an article handoff with a selected passage while its source is available; make that URL return 404; open the handoff in a fresh context with the same caller and handoff store.

**Expected:** the new conversation can inspect the retained passage and provenance, with a clear warning that the live source could not be reopened. It should not imply a current successful fetch.

**Observed:** `open_handoff` returns the reader's error before building handoff text or structured content. The selected passage remains in storage but is absent from the response. Normal handoffs and retained quote clips work.

**Code evidence at observation:** `src/tools/handoffs.ts`, particularly the early return after `readPage` around line 66; the retained quote is added only afterward around lines 69–77. The thrown-error path also returns before exposing the retained material.

**Suggested repair:** return a fallback handoff view/model result containing the retained quote and source metadata alongside the source error, without presenting an invented article. Add a regression case for a handoff with a passage whose page becomes unavailable. Preserve per-account and expiry behavior. Recheck both article and docs handoffs.

### RP-2 — P3: conversational wording in literal library search produces a false empty result

**Type:** reproducible usability friction; R3; not a violated semantic-search guarantee.

**Trigger:** retain the DNS quotation under a source-oriented title, then search literally for `find what I saved about DNS`.

**Observed:** zero matches, versus one for `DNS`. Current matching requires every query word to occur across retained metadata/text. An agent can convert the user's request to keywords, but directly pasting conversational wording into the search box is less forgiving.

**Suggested treatment:** consider a concise keyword-search hint or empty-state example before changing search semantics. The current empty state already suggests shorter phrases; a human novice study would be needed to judge whether more help is warranted. This finding should not block a milestone by itself.

### Investigated, not promoted to a defect

`comparison()` supplies a current `updatedAt` when caller fetch dates are omitted despite doing no fetch itself. The actual comparison UI fetches source bodies and generates its own displayed fetched/retained metadata. The tool-level timestamp alone therefore did **not** establish that the UI falsely represented a fetch, and this round does not rank it as a confirmed user-facing failure.

The guide says reopening “highlights” a unique retained passage. The inspected locator implementation scrolls to the matching block and shows a toast; the passing browser test verifies relocation, not a text highlight. This wording/behavior detail should be checked if literal highlighting is an acceptance requirement, but was not counted as a task failure here.

## Executed verification

| Execution | Result | Scope |
|---|---|---|
| Custom three-persona handler script | Completed all three sequences; RP-1 reproduced | Fresh scratch file stores, fixture source mutation, reconstructed conversation contexts |
| `node --test test/collections.test.ts test/library.test.ts test/handoffs.test.ts` | 11 passed, 0 failed, 0 skipped | Persistence, caller isolation, evidence refs, imports, Recall and normal handoffs |
| Selected `test/ui-browser.test.ts` cases | 5 passed, 0 failed, 0 skipped | Recall return state; desk/trail/narrow comparison; separate agent output and pane position; changed passage; missing-source repair |
| Selected `test/ui-passage.test.ts` cases | 6 passed, 0 failed, 0 skipped | Passage context/quote controls, capability fallbacks, handoff creation and display |

Exact successful browser commands:

```sh
node --test --test-name-pattern='Recall opens|selected Recall|agent comparison output|kept passage follows|comparison with a removed' test/ui-browser.test.ts
node --test --test-name-pattern='passage:|handoff:' test/ui-passage.test.ts
```

The initial sandboxed browser attempts could not complete: the preview suite hit a Node native asynchronous-context assertion and the passage suite hung/cancelled. Trying the bundled Node runtime did not remove that limitation. The same targeted checks then passed with permission to start the local fixture server and Chrome outside the sandbox. Those initial failures are recorded as execution-environment limitations, not product defects.

## Round-2 handoff

Round 2 should use three additional researcher proxy roles after fixes, retaining a balanced researcher/developer split across the wider study. Re-run RP-1 with article HTTP 404 and docs failure, confirm the source error remains explicit and the retained quotation is accessible, then perform a fresh comparison/desk/retrieval task. Preserve these round-1 observations instead of rewriting them as post-fix successes.

This round does not complete a real one-week trial and does not establish human usability. It supplies bounded, reproducible agent-proxy evidence for the user-authorized simulated milestone.
