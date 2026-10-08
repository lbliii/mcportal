# M1 core content loop: integration and evidence

Date: October 8, 2026. Baseline: main `75e8e240f9c7f157ef290efd15b5caadc4a73941` (v0.11.0). Candidate branch: `codex/m1-core-content-loop`, incorporating reader integration `c9184c992d05c9e90a1d2b4b7a96a5d5b941066a` and the repairs described below.

The engineering and authorized proxy-study work is ready for review. **M1 is not yet fully certified:** actual-host validation in #114 remains open. On October 8 the user explicitly requested skipping VoiceOver testing; spoken screen-reader output remains unverified and is not claimed. The remaining #115 native non-default passage-choice check passed in Chrome Guest with VoiceOver off; #115 is ready under that explicit testing skip. Do not close #104 or the milestone on the strength of fixtures, accessibility-tree inspection, or the successful connected text result.

The user explicitly requested agent user proxies in place of recruiting participants and running an elapsed one-week trial. Twelve role briefs (six developers, six researchers) were exercised in two balanced rounds; four original roles returned in logical day 2/day 7 simulations. Those are synthetic scenarios run by three study agents, not twelve humans or independent model samples. Actual tool results, browser behavior, and fresh-process storage reads are distinguished from scripted choices and simulated interpretations in each report. No spontaneous adoption, human preference, time saving, screen-reader speech, or product-market-fit claim follows.

## Backlog disposition

| Issue | Candidate outcome | Closure condition |
| --- | --- | --- |
| [#110 protocol](https://github.com/lbliii/mcportal/issues/110) | [Protocol](../docs/how-to/m1-proxy-study.md), fixture rehearsal, cohort balance, baseline, consent/privacy boundaries and repair gates recorded | Ready under the user-authorized proxy substitution |
| [#111 formative rounds](https://github.com/lbliii/mcportal/issues/111) | Both cohorts completed two rounds; failures ranked below, repaired and retested | Ready under the same substitution |
| [#112 field use](https://github.com/lbliii/mcportal/issues/112) | Four returning roles; eight logical day 2/day 7 retrieval checkpoints; explicit prompted/scripted distinctions and a seven-day expiry boundary | Ready only as the authorized simulation, not an elapsed human trial |
| [#113 reader integration](https://github.com/lbliii/mcportal/issues/113) | Combined candidate reconciled with current tabs, Recall, find, comfort and navigation; PR disposition below | Merge this candidate once; retire overlapping PRs as part of that integration |
| [#114 actual hosts](https://github.com/lbliii/mcportal/issues/114) | Fixture fallbacks and navigation pass; the public deployment rendered in Codex; isolated candidate tools now work in two chats | **Open:** candidate UI flow, consent, teardown and new-chat handoff chain unverified |
| [#115 accessibility](https://github.com/lbliii/mcportal/issues/115) | Four reproduced keyboard blockers fixed; native keyboard including non-default passage choice, reflow, forced colors, reduced motion and AX checks recorded | Ready with this candidate under the user's explicit VoiceOver testing skip; no spoken-output or full-conformance claim |
| [#116 source recovery](https://github.com/lbliii/mcportal/issues/116) | Latest-request previews, partial import details, safe retry and refresh recovery implemented and tested | Ready with this candidate |
| [#103 validation epic](https://github.com/lbliii/mcportal/issues/103) | Bounded proxy evidence and decision recorded | Close with #110–#112 only while retaining the explicit simulation scope |
| [#104 reading epic](https://github.com/lbliii/mcportal/issues/104) | Engineering fixes complete in candidate; #115 ready under the explicit testing skip | Keep open until #114 is validated and this candidate is integrated |

## Reader PR integration

Use the combined branch once. The component work is already combined in #60; merging the component branches separately would duplicate work. This candidate merges the combined branch's history into current main and resolves conflicts in reader/docs/social rendering, media lifecycle, CSS and browser tests. Historical wave-2 reports brought along from October 4 describe their original branch, not current-host evidence.

| Existing PR | Reviewed head | Disposition |
| --- | --- | --- |
| [#60 combined](https://github.com/lbliii/mcportal/pull/60) | `c9184c9` | Incorporated here; supersede with this current-main integration |
| [#57 layout](https://github.com/lbliii/mcportal/pull/57) | `add1076` | Included through #60; no separate merge |
| [#58 extraction](https://github.com/lbliii/mcportal/pull/58) | `d5fa9f8` | Included through #60; no separate merge |
| [#59 media](https://github.com/lbliii/mcportal/pull/59) | `39e9584` | Included through #60; no separate merge |

All four old PRs remain open while this candidate is reviewed. Close them as superseded only when this integration is accepted. Extraction removes duplicate metadata/widgets while retaining authored content; media requests and cache bytes are bounded, failures can retry, and detached readers cannot receive old media writes. Reader controls sit outside the content scroll area and retain current reading tabs, find, comfort, source outline, docs navigation and passage restoration.

## Ranked findings and repairs

Priority expresses the impact of a reproduced failure in the bounded task, not its prevalence among users.

| Priority / evidence | Reproduction and consequence | Decision and follow-up |
| --- | --- | --- |
| P1 / researcher RP-1 | Open a valid handoff while its source returns 404/503: the stored quote was lost behind a fetch error | Preserve the fenced quote, disclose unavailable live content, and offer retry; tool and browser recovery pass. #111 / #104 |
| P1 / accessibility A1 | A keyboard user could read prose but had no passage action without precision selection | Add native Choose passage with exact text/source preview, Ask, Clip, Handoff and Copy. Default and non-default keyboard clipping pass, including the native Chrome popup. VoiceOver explicitly skipped. #115 |
| P1 / A3–A4 | Recall preview redraw or reader navigation left focus on BODY | Restore the selected Recall title; focus the reader H1; preserve return control/query/filter. Fixed and browser-verified. #115 |
| P2 / A2, DEV-R1-01 | Escape searched the old reader location after controls moved, leaving the outline open | Search the external controls; Escape closes the outline/chooser and restores its summary focus. #113 / #115 |
| P2 / DEV-R1-02 | Docs search feedback implied narrower coverage than title/symbol/already-opened body search | State actual coverage and an opening-page recovery path. Round-two exact term becomes findable after opening its page. #111 |
| P2 / DEV-R1-03 | An explicit v1→v2 docs link changed the source inside a v1 outline with identical titles | Show the actual GitHub page ref in the crumb; round two verifies v1→v2→v1 source identity. #111 |
| P2 / #116 fixtures | An older source scan or preview could overwrite a newer query/mode; partial imports obscured what succeeded | Generation checks invalidate stale responses. Import reports list added/failed/deferred/existing subscriptions; atomic URL dedupe protects retries/concurrency. Refresh can recover display without importing again. #116 |
| P3 / RP-2 | A full-sentence literal Recall query failed; a distinctive keyword recovered the quote | Keep documented keyword semantics. Do not imply semantic search or create an unsupported redesign task from a scripted query. Reconsider only with repeated real-task evidence. #111 |
| P3 / DEV-R1-04 | A simulated user expected a bookmark to retain searchable page text | Keep bookmark/clip semantics explicit in protocol and task guidance; tested roles deliberately clip evidence. No fabricated discovery or learning claim. #111 |

The final review also removed a stale selector that could relabel a clip's Share button as Back after the toolbar move, and prevents a late unavailable-handoff retry from reopening a view after navigation away.

## Study evidence and decision

- Developers: [round 1](m1-developer-proxies-round1.md), [round 2](m1-developer-proxies-round2.md), [later retrieval simulation](m1-developer-field-simulation.md).
- Researchers: [round 1](m1-researcher-proxies-round1.md), [round 2](m1-researcher-proxies-round2.md), [later retrieval simulation](m1-researcher-field-simulation.md).
- Accessibility: [proxy audit and retest](m1-accessibility-proxy.md).

All assigned second-round paths completed without a newly reproduced blocker. Versioned source choice, explicit passage scope, clipping, desk membership, source outage recovery and fresh-process retrieval were executed. Wrong-account handoffs remain denied. Retained quotes survive source changes and can be retrieved without fetching live sources. Temporary handoffs expire at seven days; durable clips have a different purpose. The developer replay reconstructed the original role scenarios after their scratch data was deleted; the researcher replay reused its original scratch records. Neither is misrepresented as elapsed field observation.

**Decision: continue with refinement of the current developer/researcher cohort.** The evidence supports engineering feasibility and specific repairs, not a broader audience or an adoption claim. A careful manual-note baseline also recovered the quotation during an outage. MCPortal returned its stored grouping and provenance, but this simulation measured no advantage in human effort, preference or frequency of use. Resolve host and assistive-technology gaps before a general reliability claim.

## Validation

Environment: macOS; Node 24.9.0; Chrome 141 in the repository's local fixture harness. Browser execution needed sandbox escalation to open local servers and launch Chrome. The fixture's host capabilities are controlled test inputs, not measurements of a production host.

The final `npm run check` passed: **576 tests, 550 passed, 0 failed, 26 skipped** (25 optional Postgres cases and one file-purge contract covered separately by retention tests). Type checks and generated design checks passed. The added handoff-retry and extended Recall-accessibility regressions passed. A storefront fixture timeout passed in isolation; its readiness condition now waits for room hydration before measuring click coordinates, and the final full suite passed with that correction. Storage modules were not changed. `npm run design` and `npm run design:check` passed with no generated drift. `npm run smoke` passed all five live adapter probes (HN, GitHub, RSS, reader and releases). `node scripts/screenshots.ts chat-reader chat-docs` refreshed the two affected public-source illustrations; both were visually inspected and their explanatory text remains consistent with the source.

Coverage includes 320/360-pixel layouts with 200% root text, wide and expanded frames, toolbar/content scroll ownership, docs internal links/outline, literal find and comfort, source/media failures, passage fencing, context-only/message-only fallbacks, denied links and clipboard, reading return position, retained quote relocation and ambiguity, stale source requests, import partition/concurrency, and unavailable-handoff retry. Root text enlargement is not OS magnification or a claim about every browser zoom mode.

## Actual-host evidence and remaining checklist

On October 8, the connected public MCPortal `read_article` tool returned the RFC 8259 information page (final URL `https://www.rfc-editor.org/info/rfc8259/`, 4,020 words). After the user expanded its card, the supported MCP Apps browser exposed the actual Codex reader. Its title, source, content and fullscreen control rendered. The controls' DOM parent was `#reader`, and “Choose passage” was absent. These observed build markers differ from the candidate, whose controls live in `#readerControls` and include the passage chooser. This is public-deployment render evidence, not certification of the candidate.

The initial lack of an expanded MCP App tab was resolved by the user's expansion. Native Codex inspection remained denied; that boundary was not bypassed. Installed app metadata identifies `com.openai.codex`, version `26.1002.52244`, build `13536`. This is installed-version evidence, not a captured `ui/initialize` host-info response. Raw host capabilities have not been captured.

A separate local STDIO connection, `mcportal-m1`, now runs the candidate checkout with an isolated temporary data directory and local test identity. A direct startup/resource preflight at `7198db611efd9c18b6a86dee3ae4acb789c2fc7d` confirmed successful initialization and the candidate's passage chooser and external reader-control markers. The user restarted MCP connections. A fresh validation chat exposed 36 candidate tools and successfully called `read_article` for the same RFC page (21 blocks, 4,020 words). The original chat then acquired those tools too and repeated the read successfully. These are two real chat/tool invocations, not yet a cross-chat handoff or UI-continuity result.

The candidate's live `open_docs` call for this repository's main-branch docs returned six sections and 34 pages with source URLs and an untrusted-content boundary. An intentionally missing `open_handoff` code returned a useful error explaining the seven-day lifetime and the reader's recovery action. These establish useful text-only results and errors. The candidate card still needs expansion before its controls, source selection, agent context, consent and teardown/reopen behavior can be inspected. The temporary `mcportal-m1` registration should be removed after validation; its test data are separate from the user's normal room.

| Environment | Evidence from this run | Status |
| --- | --- | --- |
| Local Chrome fixture MCP host | UI/render, declared capability combinations, source-scope payloads, denied-action fallbacks, display changes and persistence fixtures | Automated coverage only |
| Codex with public MCPortal | Public article text/structured result and expanded reader DOM/layout | Older UI; not candidate certification |
| Codex with local `mcportal-m1` | Candidate article calls in two chats, live docs outline and recoverable missing-handoff error; isolated test state | Candidate UI and end-to-end flow unverified |
| Claude desktop, Claude web/mobile, Claude Code, ChatGPT | No current candidate walkthrough | Untested for this candidate |
| Screen reader | Browser AX semantics and native keyboard paths | Spoken output untested |

Complete the [compatibility checklist](../docs/reference/host-compatibility.md#certifying-a-host) on each intended host at a known candidate revision, recording app version, capabilities, source scope, context/message fallbacks, denials, inline/expanded behavior, teardown/reopen, same-account new-chat recovery and useful text-only output. The #115 native non-default passage-choice follow-up passed on candidate `21720da`; its sequence and retained-content screenshot are in the [accessibility report](m1-accessibility-proxy.md#native-keyboard-popup-follow-up). The user explicitly skipped VoiceOver testing after a temporary attempt; no spoken-output result is claimed. Any future screen-reader certification would need an actual walkthrough of passage choice, pending/success/error announcements, Recall and return focus.
