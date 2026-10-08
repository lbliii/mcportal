# M1 developer agent proxies — formative round 2

Study date: 8 October 2026. This round evaluated the shared working tree after the coordinator's repairs to reader outline Escape, documentation search feedback, actual GitHub version labeling, native passage selection, and unavailable-source handoffs. It follows [developer round 1](m1-developer-proxies-round1.md).

**Evidence status:** D4–D6 are three new synthetic developer role briefs, emulated sequentially by the same study agent. They are not new human participants or independent model samples. Role expectations and interpretations are simulated; the browser messages, tool outputs, file-store persistence, and process boundaries below were actually executed. There is no population-level usability, screen-reader, or production-host claim.

## Procedure

The scratch runner `/tmp/m1-developer-round2-browser.ts` used a local MCP Apps fixture host that records every app-to-host message and forwards tool calls to the actual MCP dispatcher. Synthetic Markdown came from `/tmp/m1-r2-lib.ts` through a finite in-memory fetch map. Unknown URLs returned 404; the outage condition returned 503. No real source network, accounts, or participant records were used.

Each proxy had a separate file-backed profile, clips, collections, history, and handoff store under a temporary directory. Each used a new browser document. After the browser closed, three separate Node processes reopened the same file records with new stores and empty caches, searched from the role's remembered term, retrieved the matching quote, listed collections, and opened the desk. Temporary records were removed after the run. `/tmp/m1-developer-round2-browser.jsonl` is a session-local result log; the substantive evidence is reproduced here.

Native Enter opened the passage chooser, and native Escape closed it and restored focus to `Choose passage`. The runner selected its target option programmatically and dispatched `change`, then activated Ask and Clip through the DOM. Thus this is actual UI/control/transport evidence with partial native keyboard input, not a claim that every action was performed without scripted selection or that a human discovered the controls unprompted.

Synthetic source constants:

- Docs index: `https://github.com/acme/widgets/tree/v1/docs`.
- V1: `https://raw.githubusercontent.com/acme/widgets/v1/docs/install.md`.
- V2: `https://raw.githubusercontent.com/acme/widgets/v2/docs/install.md`.
- DEBUG: `https://raw.githubusercontent.com/acme/widgets/v1/docs/debug.md`.
- Setup passage: `Widget v1 requires Node 20 and uses legacy_init().`
- Debugging passage: `The sentinelneedle flag exposes retry diagnostics without changing the retry policy.`

## D4 — migration engineer checking a pinned release

**New simulated brief:** a migration engineer inherits a service pinned to Widget v1. Their baseline is repository docs plus release notes in browser tabs. They must identify the correct initializer, distinguish a link into v2, and keep auditable evidence. Both installation pages deliberately have the identical title `Install Widget`, so the title alone cannot solve the version task.

| Action | Executed observation | Simulated understanding / result |
|---|---|---|
| Open the v1 docs, choose Install Widget in the contents | Crumb is `acme/widgets › acme/widgets › Version: v1` | Correctly treats the page as v1 despite the generic title |
| Follow the page's explicit `v2 installation` link | Same page title; crumb changes to `acme/widgets › Version: v2` | Recognizes an explicit version transition and does not substitute v2's `create_widget()` for v1's initializer |
| Return to the v1 contents entry | Correct v1 source is active | Recovery follows the intended pinned source |
| Open Choose passage with Enter; choose the `legacy_init` passage; activate Ask | Preview and emitted `ui/update-model-context` text both equal the exact setup passage; payload URL is V1; heading is `Required runtime` | Answers the simulated source-bound question “Which initializer does v1 use?” only from the selected passage |
| Clip quote, then create `D4-migration evidence desk` from that clip ref | Quote persisted and collection created | Keeps evidence separately from the agent's answer |
| Escape | Chooser closes; focus returns to `Choose passage`; no browser error observed | Repaired dismissal completes |
| New process, query `legacy_init`, get found clip, list/open desk | One match, exact setup passage, V1 URL, one collection entry, zero source fetches | Fresh-context evidence retrieval completes |

**Result:** all assigned steps completed. DEV-R1-03's version-understanding challenge is repaired for the tested GitHub ref path. Explicit cross-version navigation remains permitted; the page's actual ref is now visible.

## D5 — frontend maintainer using keyboard entry points

**New simulated brief:** a frontend maintainer remembers a diagnostic option's body term but not its page title. Their baseline is browser find and a local scratchpad. They must understand search coverage, inspect the exact selected passage, and keep it without precision text selection.

| Action | Executed observation | Simulated understanding / result |
|---|---|---|
| Search docs for `sentinelneedle` before opening DEBUG | Visible empty-state text is `No matches in page titles, symbols or previously opened text. Open a page to search its text, or try different keywords.` | Correctly concludes that zero hits do not establish absence from unread page bodies |
| Clear search, open the Debugging contents entry, search the same term | Exactly one link result after the page is read | Uses the stated recovery path; cached-body scope is demonstrated |
| Enter opens Choose passage; choose the diagnostics passage | The chooser previews exact authored text and visibly says `Only this passage is used` | Predicts the selected passage, rather than the whole desk, will be shared |
| Ask about this | Host log contains exactly the preview, DEBUG URL, and `Diagnostics` heading | Simulated answer to “Does the flag change retry policy?” remains “The selected passage says it does not” |
| Clip quote; create desk; Escape | Exact quote retained; desk created; chooser closes and focus returns to its summary | Completes retention and dismissal |
| Separate retrieval process, query `sentinelneedle` | One matching quote; exact retained text and DEBUG URL; one desk entry; zero source fetches | New-context retrieval completes |

**Result:** all assigned steps completed. DEV-R1-02's misleading empty search feedback is repaired in the actual rendered UI. The existing repaired outline-Escape test also passes. This does not replace assistive-technology validation.

## D6 — operations developer resuming during an outage

**New simulated brief:** an operations developer occasionally uses an agent for incident context. Their baseline is a bookmark plus incident notes. They receive a prepared handoff but the source is down, so they must distinguish retained evidence from live source content and recover when connectivity returns.

| Action | Executed observation | Simulated understanding / result |
|---|---|---|
| Open a stored DEBUG handoff while all fixture requests return 503 | Reader displays the exact retained debugging passage and the visible warning `The live page is unavailable. This is the passage retained when you sent the handoff.` | Restricts the simulated answer to the retained passage; does not invent the rest of the inaccessible page |
| Make the fixture source available, activate Retry live page | Docs reopen at DEBUG, the correct original URL | Successful recovery preserves source identity |
| Open Choose passage; Ask about this | Preview and model-context payload match the exact diagnostics passage and DEBUG URL | Scope remains explicit after recovery |
| Clip quote; create `D6-ops evidence desk`; Escape | Quote and desk persist; focus returns to Choose passage | Makes durable retention explicit instead of assuming the bookmark contains the full page |
| Separate retrieval process, query `sentinelneedle` | One matching quote; exact text/source; one desk entry; zero source fetches | Retained evidence remains usable without requesting the live page |

**Result:** all assigned steps completed. The unavailable-source handoff fallback and Retry path were both exercised in the browser, not only inspected in source.

## Round comparison and remaining limits

| Round-1 item | Round-2 disposition | Evidence strength |
|---|---|---|
| DEV-R1-01: Escape did not close outline | Repaired; exact reader-UI test passes; chooser also closes and restores focus in all three custom journeys | Executed browser checks |
| DEV-R1-02: search empty text concealed search coverage | Repaired; rendered explanation accurately names titles, symbols, and previously opened text; opening DEBUG yields the previously missing hit | Executed browser + actual tools |
| DEV-R1-03: v2 page remained inside v1 navigation without visible version cue | Repaired for tested GitHub refs by showing the actual page ref; identical page titles cannot mask the transition | Executed browser boundary challenge |
| DEV-R1-04: bookmark mistaken for searchable retained body | Storage semantics unchanged; new roles deliberately use Clip quote and verify it later | Scripted correct use + executed persistence; no claim of spontaneous learning |
| Retained handoff when source is unavailable | Stored quote remains visible with a limit statement; Retry restores the source | Executed browser + tool tests |

No new actionable product failure was observed in these bounded round-2 paths. The first post-fix suite run had 25 passes and one timeout in the new chooser test: its harness watched the tool-call log for a host-context message, but only tool calls were recorded there. The coordinator repaired host-message instrumentation; the independent fixture host recorded the correct message throughout. This was a test-harness fault, not an observed failure to send passage context. Two scratch-run setup errors (JavaScript Event constructor syntax and an overly broad status selector) were corrected before the final custom run and are excluded from product outcomes.

The final custom run produced nine substantive evidence records: three passage/scope/retention checks, one version transition, one search-scope recovery, one outage recovery, and three separate-process retrievals. All assertions passed. Retrieval processes had distinct PIDs `45466`, `45471`, and `45477`; each returned one quote, one-entry desk, and zero fetch calls. These process IDs document isolation, not participant identifiers.

Repository validation command: `node --test test/reader-ui.test.ts test/ui-passage.test.ts test/handoffs.test.ts` with temporary Chrome profiles and sandbox escalation. Final result: **26 passed, 0 failed, 0 skipped**. The repaired chooser test now passes alongside the repaired outline test; the coordinator's final aggregate check supplies release-wide verification.

**Developer proxy gate:** pass for the assigned synthetic round-2 tasks and the repaired failures above. Combined D1–D6 covers six developer role briefs across two rounds; those are six emulated roles, not six independent people. Production host behavior, screen-reader experience, unaided discovery, semantic correctness of arbitrary model answers, and real-world adoption remain outside this evidence. See [developer field simulation](m1-developer-field-simulation.md) for the separately labeled logical day 2/day 7 replay.
