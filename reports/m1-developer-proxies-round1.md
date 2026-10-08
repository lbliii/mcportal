# M1 developer agent proxies — formative round 1

Study date: 8 October 2026. Baseline commit: `75e8e240f9c7f157ef290efd15b5caadc4a73941`, plus the reader integration present in the shared working tree during this run. Production source was not changed by this study agent.

This is a **synthetic, agent-proxy study**, explicitly requested by the user. D1–D3 are three distinct developer roles emulated sequentially by one study agent. They are not recruited people, independent model samples, or a representative developer population. The persona expectations, normal workflows, questions, and wrong turns below are simulation inputs. The tool results and browser test outcomes are observations. No human usability score, elapsed-week retention result, preference prevalence, or production-host success is claimed.

Requirements read: [#110, study tasks](https://github.com/lbliii/mcportal/issues/110) and [#111, formative sessions](https://github.com/lbliii/mcportal/issues/111), together with [Reading experiences](../docs/explanation/reading-experiences.md), [Organize reading](../docs/how-to/organize-reading.md), current tool handlers, and the current UI. Both issue bodies were retrieved during this run. Their titles are respectively “Define cohort study tasks and success criteria against current main” and “Run two formative rounds of the reading-to-retrieval journey.”

## Evidence method and boundaries

| Label | What it establishes | What it does not establish |
|---|---|---|
| Executed tool fixture | Actual MCP tool dispatch, input validation, source URLs, retained text, collections, account scoping, and retrieval through fresh file-store/cache instances | That a person discovers the tool or an agent chooses it unaided |
| Executed browser fixture | Actual headless Chrome behavior in a local fixture MCP Apps host, including capability-dependent passage actions | Behavior of the production ChatGPT/Codex host or a screen reader |
| Source inspection | Current labels, source-scope rules, and event handlers read from the working tree | A completed interaction or a measured user misunderstanding |
| Agent simulation | A role's intended answer, source decision, repair decision, and interpretation of the observed contract | Human testimony, accessibility lived experience, or prevalence |

All fixture material is synthetic. The tool run used separate account IDs `D1-backend`, `D2-frontend`, and `D3-occasional`, file stores in a newly created OS temporary directory, and a finite in-memory fetch map. Unmatched URLs returned 404; there were zero real source-network requests. Eleven fetcher calls were made, including failed alternative source discovery probes. Storage was removed in a `finally` block. Browser suites used temporary Chrome profiles and fixture servers. No real accounts, participant identifiers, personal research records, or external messages were used.

The executable rehearsal was `/tmp/m1-developer-proxies.ts`; its result was captured in `/tmp/m1-developer-proxies-round1.json`. Those paths are session-local reproduction aids, not permanent research storage. The complete substantive observations and reproducible tool sequences are retained below. Generated clip IDs and handoff codes are unnecessary and are replaced with symbolic IDs here.

## Shared synthetic material

The docs source is `https://github.com/acme/widgets/tree/v1/docs`. Its fixture tree lists `docs/README.md`, `docs/install.md`, and `docs/debug.md`. The actual GitHub repository is never requested.

| Symbol | URL or exact retained content |
|---|---|
| `V1` | `https://raw.githubusercontent.com/acme/widgets/v1/docs/install.md` |
| `V2` | `https://raw.githubusercontent.com/acme/widgets/v2/docs/install.md` |
| `DEBUG` | `https://raw.githubusercontent.com/acme/widgets/v1/docs/debug.md` |
| v1 passage | `Widget v1 requires Node 20 and uses legacy_init().` |
| v2 passage | `Widget v2 requires Node 22 and uses create_widget().` |
| debugging passage | `The sentinelneedle flag exposes retry diagnostics without changing the retry policy.` |

The v1 installation page has title `Install Widget v1` and an explicit Markdown link to `V2` labeled `v2 installation`. The v2 page has title `Install Widget v2`. The debugging page's title is `Debugging`; its body, not its outline title, contains `sentinelneedle`.

## D1 — experienced backend developer, pinned documentation

**Simulated baseline:** uses a browser, a repository's versioned docs, and a notes file; checks a deployment's installed version before copying setup commands. **Task:** determine the initializer for Widget v1, keep the supporting passage, and retrieve it in a later context. The explicit v2 link is a deliberate version-check challenge.

| Action and evidence | Observable outcome | Proxy interpretation or recovery |
|---|---|---|
| `find_source({query: DOCS_V1})`, then `add_portal` with the returned docs candidate's `source` and `config` | One working candidate; `source: docs`; both `config.url` and `config.toc.url` retain `/tree/v1/docs` | Choose the explicit v1 docs source instead of inferring current/latest version |
| `open_docs({docs: DOCS_V1})`; `read_doc_page({docs: DOCS_V1,url: V1})` | Site TOC remains v1; original page URL is `https://github.com/acme/widgets/blob/v1/docs/install.md`; body contains the exact v1 passage and is fenced as untrusted source text | Answer only “Node 20 and `legacy_init()`” for the v1 setup question |
| Follow the visible v2 link by calling `read_doc_page({docs: DOCS_V1,url: V2})` | Call succeeds; returned page URL/title/body identify v2, while returned `site.toc.url` still identifies v1 | This was an **explicit cross-version detour**, not an unrequested URL substitution. The proxy notices the page title/URL conflict and does not use `create_widget()` for v1 |
| Read `V1` again, then `clip({kind:"quote",content: V1_PASSAGE,source:{kind:"article",url:V1,title:"Widget v1 setup",locator:{heading:"Widget v1 setup",block:1,text:V1_PASSAGE}}})` | Quote, URL, and locator retained; first clip adds a Clips portal | Recovery is explicit: return to v1 before retaining evidence |
| `update_collection({action:"create",title:"Widget v1 upgrade evidence",purpose:"Answer from retained source evidence only",entries:[{ref:"clip:CLIP1",title:"Widget v1 upgrade evidence"}]})` | One-entry private desk created | Desk membership points to retained evidence |
| Construct new file-store objects and an empty cache for D1; `search_library({query:"legacy_init"})`; `get_clip({id:CLIP1})`; `open_collection({id:DESK1})` | One Recall match; exact original quote, v1 source URL, and locator survive; Recall `docs` hint is the v1 folder; collection has one entry and no unavailable refs | Later-context retrieval succeeds without relying on the earlier tool response |

**Completion:** core source-to-retained-evidence journey completed in the executed fixture, with one deliberately injected cross-version detour and successful correction. Source/version identity survives storage. The remaining risk is the absence of an explicit cross-version transition notice, not loss or corruption of the source URL.

## D2 — frontend developer, keyboard-oriented workflow

**Simulated baseline:** reads API references in browser tabs using find, headings, and keyboard shortcuts, copying short excerpts into a scratch file. **Task:** find the diagnostics option from a remembered body term, ask about the selected passage, retain it in a desk, and send it to another conversation. Keyboard accessibility is a task constraint, not an assertion that the agent represents a disabled person's experience.

| Action and evidence | Observable outcome | Proxy interpretation or recovery |
|---|---|---|
| `open_docs({docs:DOCS_V1})`; `search_docs({docs:DOCS_V1,query:"sentinelneedle"})` before opening DEBUG | Zero hits. Tool text explicitly says unvisited or expired pages are searched only by their outline | Injected expectation “Search pages searches every page body” is incorrect; the tool response supports recovery |
| Browse to and read `DEBUG`; repeat the same `search_docs` call | One hit, exactly DEBUG | Cache-backed body search is confirmed, not assumed. Opening the relevant page repairs this fixture task |
| Inspect the current docs search UI (`src/ui/room/docs.js`) | Placeholder is `Search pages`; empty result text is `No titles match.` | The UI omits the useful tool explanation about unread bodies and describes only titles although symbols/cached bodies are searched. This is a source-inspected discoverability mismatch; no human confusion frequency is inferred |
| Browser fixture `passage: "Ask about this" gives the model the passage as fenced context, then posts fixed words` | Passes: selected text and source URL enter `ui/update-model-context` before the fixed `ui/message`; quoted site text is not inserted into user-voice instructions | Source-bound question transport is verified in the fixture host. The proxy's question is “Does this flag change retry policy?”; the simulated answer is “The retained passage says it does not” |
| Browser fixture at 380px: open `.reader-outline summary`, dispatch Escape | **Fails:** `.reader-outline.open` is still `true`, expected `false` at `test/reader-ui.test.ts:175` | Keyboard dismissal did not complete. This step is not counted as a pass or excused by unrelated positive results |
| `clip` exact DEBUG passage with source/locator; create `Keyboard debugging desk`; app-side `create_handoff({url:DEBUG,title:"Widget debugging",place:{kind:"docs",docs:DOCS_V1},passage:DEBUG_PASSAGE,anchor:{heading:"Debugging",block:1}})` | Clip and one-entry desk created; handoff returns instruction `Open MCPortal handoff <temporary-code>` | Explicitly retains the passage and prepares later retrieval |
| New file-store objects and empty cache; `open_handoff({code:CODE2})`; `search_library({query:"sentinelneedle"})`; `open_collection({id:DESK2})` | Handoff returns the exact passage, DEBUG page, and `{block:1,heading:"Debugging"}`; Recall returns one match; desk opens | New-context storage retrieval succeeds. This is not an actual new production-host chat |

**Completion:** evidence and handoff tasks completed; keyboard outline dismissal failed. Global accessibility completion cannot be claimed from these fixtures. Existing browser tests also passed literal find across formatting, copy fallback, focusable scrollable-table behavior, and selected-passage identity; those are bounded implementation checks, not a screen-reader audit.

## D3 — occasional agent user, debugging evidence

**Simulated baseline:** asks an agent a debugging question, bookmarks the useful page, and later searches remembered words. **Task:** retain the specific diagnostic claim, separate source evidence from agent explanation, and recover it later. Bookmark-as-full-text-storage is a deliberately injected wrong assumption.

| Action and evidence | Observable outcome | Proxy interpretation or recovery |
|---|---|---|
| Open DOCS_V1, read DEBUG, and `save_item({url:DEBUG,title:"Debugging Widget"})` | Source text is returned fenced; a bookmark is created | Initial wrong assumption: saving the link also retains the page's searchable body |
| `search_library({query:"sentinelneedle"})` | Zero matches after bookmark-only save | Task has not retained the desired evidence yet; no phantom body match appears |
| `clip` the exact debugging passage with URL and locator; create `Retry investigation` desk | A retained quote and one-entry collection are created | Recovery distinguishes keeping the passage from keeping a link |
| `update_collection({action:"orientation",id:DESK3,orientation:{text:"A claim about evidence outside this desk.",refs:["url:https://example.invalid/unknown"]}})` | Rejected with `Every orientation reference must name current collection evidence.` | Explicit source boundary prevents accepting a citation to material outside the desk |
| Repeat orientation with `refs:["clip:CLIP3"]` and text `The retained passage says sentinelneedle exposes diagnostics and does not change retry policy.` | Accepted; orientation records its refs separately from quote data | Simulated explanation is bounded to the selected evidence. Citation validation does not prove semantic entailment for arbitrary agent prose |
| Retain v1 setup as CLIP3B; `show_comparison` with CLIP3 and CLIP3B, a question contrasting initialization and diagnostics, and both refs | Two distinct source refs accepted; interpretation remains a separate orientation | Comparison contract supports source/agent separation. This tool run does not establish that every production-host model will obey the intended scope |
| New file-store objects and empty cache; search `sentinelneedle`, get CLIP3, open DESK3 | Exactly one match; exact debugging passage survives; desk opens with one evidence entry | Retrieval succeeds after explicit passage retention |

**Completion:** completed after one injected retention wrong turn and repair. Bookmark-only search behavior is by design, not a storage defect. The proxy required the difference between `save_item` and `clip` to be made explicit.

## Ranked failures and design decisions for the second round

| Rank / ID | Evidence and reproducible trigger | Effect | Recommended decision / second-round check |
|---|---|---|---|
| 1 / DEV-R1-01 | Executed Chrome failure: at 380px open reader outline, press Escape; outline remains open. `test/reader-ui.test.ts:171–175` | Keyboard escape hierarchy does not dismiss the active outline | Repair the handler; rerun the exact failing test and verify passage/outline/find Escape priorities without navigating away |
| 2 / DEV-R1-02 | Executed `search_docs` has 0 body-term hits before read and 1 after; source-inspected UI only says `No titles match.` | UI does not communicate search scope or the recovery path that the tool response provides | Explain outline/symbol/fresh-read-body scope in the UI; new proxy should find the term or accurately explain why search cannot find it yet |
| 3 / DEV-R1-03 | Explicit v2 URL succeeds under docs v1; returned page is v2 while `site.toc` stays v1 | Version-sensitive user can remain in v1 navigation while reading v2 evidence | Preserve explicit cross-version navigation if intended, but signal the boundary; or reject with a clear instruction to open that version. Never silently substitute versions. Recheck same-version paths and the explicit v2 detour |
| 4 / DEV-R1-04 | Scripted bookmark-only retention assumption; 0 Recall body hits becomes 1 after clipping | A link alone is insufficient to recover an unretained body passage by its words | Preserve the existing storage semantics; keep link versus retained-passage labels and teach this distinction in task/recovery guidance. Do not claim this is an observed human misconception |

Failures were sent to the coordinating agent before the report. Follow-up issue links should be supplied by the coordinator; this study agent did not mutate issues or PRs. Rank is local task impact, not a population estimate. DEV-R1-03 is a demonstrated transition with a simulated misunderstanding risk, not proof of an unintended fetch or a security breach.

## Executed validation ledger

| Run | Result | Scope |
|---|---|---|
| `node --test test/docs-tools.test.ts test/library.test.ts test/collections.test.ts test/reading.test.ts` | 27 passed; 0 failed; 0 skipped | Docs resolution/scope/cache, retention, collections, caller isolation, file restart |
| `node /tmp/m1-developer-proxies.ts` | Completed with all explicit assertions passing; JSON evidence recorded | Three concrete tool journeys above; cross-version acceptance and search misses are asserted observations, not silently counted as success |
| `node --test test/ui-passage.test.ts test/reader-ui.test.ts` with sandbox escalation | 17 passed; 1 failed; 0 skipped | All 7 passage/host-capability/handoff tests pass; 10 of 11 reader UI tests pass; Escape-outline failure above |
| Initial sandboxed `test/ui-passage.test.ts` attempt | Cancelled after fixture process failed to settle | Infrastructure attempt excluded from product outcome counts; escalated browser run supplies usable evidence |

The browser fixture confirms that selection alone sends no source passage, “Ask about this” shares context only on activation, a host without model-context capability offers Copy instead, and a host with context but no messaging tells the user to ask in chat. These are observed fixture outcomes, not inferred production-host compatibility.

An unrelated fixture account querying `sentinelneedle` returned zero matches. Reopening a collection after recreating stores returned no missing refs for retained entries. Source text, user retention, and agent interpretation remained separately represented in the executed tool contracts.

**Round-1 gate:** hold for DEV-R1-01 and the search-scope repair decision. Core retention/retrieval has affirmative fixture evidence; the combined keyboard journey does not yet have a complete pass. Source/version signaling needs an explicit product decision and a second-round challenge. Three proxy roles and passing tests are insufficient to establish the entire milestone's human formative gate or a one-week field result. A balanced second round must use fresh role briefs after the coordinator's fixes, with remaining host and human limitations stated again.
