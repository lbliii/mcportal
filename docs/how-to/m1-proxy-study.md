# Core content loop proxy study

Evaluate whether an agent-using developer or researcher can choose a source, understand the scope sent to an agent, retain evidence, and retrieve it in another context. This protocol implements milestone M1, issues #110–#112, against main `75e8e24` and the current integration branch. The user explicitly replaced participant sessions and the one-week human field trial with agent user proxies on October 8, 2026.

Proxy results establish executed behavior and reveal plausible misunderstandings. They do not measure human comprehension, task times, satisfaction, adoption, or spontaneous use. Logical day 2 and day 7 sessions are simulations with fresh contexts and retained stores, not a week of observation. Product claims must retain that distinction.

## Cohorts and rounds

The original recruitment plan calls for six developers and six researchers who already use agents, split into two balanced rounds of three from each cohort. The approved substitute keeps that balance with twelve explicit personas across two rounds. Three independent agent roles cover developer proxies, researcher proxies, and accessibility review. They share one model family and knowledge of the product, which limits independence and makes failures more informative than success rates.

Round one developer perspectives cover versioned backend docs, frontend keyboard workflows, and occasional debugging. Researcher perspectives cover synthesis, source verification, and unfamiliar terminology. Round two uses three further personas per cohort and repeats repaired failure cases. Record each role's prior workflow and vocabulary assumptions; do not invent quotes, emotions, or observed human wrong turns. Injected mistakes must be labeled scripted.

If a later human study is commissioned, recruit by actual role and agent use, with accessible participation, optional assistive technology and breaks. Obtain informed consent before recording, permit withdrawal and skipping sensitive tasks, compensate consistently, and agree a private storage location and deletion schedule before collection. No recruitment, participant contact or human recording was performed for this proxy study.

## Tasks and evidence

| Task | Developer scenario | Researcher scenario | Observable completion |
| --- | --- | --- | --- |
| Choose a source | Locate a versioned manual and distinguish its ref from a linked newer version | Choose a public article and compare it with another source | The URL, version where relevant, and coverage limits are stated correctly |
| Ask about a passage | Explain one command or constraint | Ask about one evidence claim | The supplied context contains only the selected, attributed passage; user-message text never speaks publisher instructions |
| Keep evidence | Clip the command explanation and add it to a private desk | Keep quotations separately from a personal interpretation | Exact retained text, attribution and citations survive; invalid citations fail visibly |
| Return in a new context | Reopen stores/cache or process and retrieve by evidence keywords | Retrieve an earlier quote and comparison | The same account recovers material; another account does not |
| Recover | Take a source offline, change a passage, retry a partial import | Remove a source or create an ambiguous passage match | Retained evidence remains readable; missing/ambiguous location is explicit; retries preserve completed work |
| Accessible route | Navigate, choose passage and return by keyboard | Use Recall preview, read, and return to filters | Destination and return focus are useful; pending/errors are exposed; narrow reflow remains usable |

Use synthetic fixtures and scratch accounts. Keep source text separate from interpretation and tool output separate from proxy inference. For each scenario record the action sequence, exact observable result, fixture or test, assistance/scripted intervention, recovery, and outcome. Retain full URLs only for public/synthetic examples; exclude credentials, personal accounts and private source text from repository reports. No raw human research belongs in this repository.

## Gates and repair decisions

Hypotheses: Recall can recover kept evidence; Topic Desks clarify private grouping; explicit passage actions prevent source-scope confusion; retries preserve trust. These are hypotheses, not established user outcomes.

Targets: each persona completes the bounded loop or explains a concrete blocker; no unresolved critical data loss, wrong-account disclosure, misleading source scope, or inaccessible core action. Stop a scenario when it risks real data or reaches a repeatable blocker. Repair critical findings before round two, then rerun the original reproduction and a related scenario. A positive description is not task completion. Do not convert twelve scripted personas into a population success percentage.

Rank failures by impact and reproduction evidence. Link fixes and follow-up issues from the milestone evidence report. Lower-severity discovery friction can remain only with an explicit decision, such as literal keyword search guidance rather than implying semantic retrieval.

## Later retrieval simulation

Use four original proxies, two per cohort, after formative repairs. Record fresh-process or fresh-store retrieval at logical day 2 and day 7. Include a prompted retrieval and a scripted choice between MCPortal and the persona's baseline notes/bookmarks workflow. The latter can explore why an alternative would be chosen; it is not observed voluntary adoption. Test unavailable sources, privacy, durable clips, and handoff expiration separately. A handoff expires after seven days and is not an archival substitute for a clip.

Recommend continue, refine or narrow based on the observed contract failures and their repairs. A human field trial remains necessary before claims about recurring value, genuine preference, or retention.

## Rehearsal and records

The fixture rehearsal uses the shipped MCP handlers, file-store round trips, the actual room in headless Chrome, and a fixture MCP host with controlled capabilities. Initial reports distinguish source inspection from execution. The repair round reruns the same failures against this branch. Use the browser runtime and test names in each report to reproduce the evidence.

- [Developer round one](../../reports/m1-developer-proxies-round1.md) and [round two](../../reports/m1-developer-proxies-round2.md)
- [Researcher round one](../../reports/m1-researcher-proxies-round1.md) and [round two](../../reports/m1-researcher-proxies-round2.md)
- [Developer later retrieval](../../reports/m1-developer-field-simulation.md) and [researcher later retrieval](../../reports/m1-researcher-field-simulation.md)
- [Accessibility proxy audit](../../reports/m1-accessibility-proxy.md)

Actual agent-host behavior and spoken screen-reader output are distinct qualification checks. Browser fixtures and accessibility-tree inspection do not certify either.
