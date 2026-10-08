# M1 researcher field simulation

Executed 2026-10-08. This is a **logical-day simulation for two earlier researcher proxies**, R1 and R2, under the user's authorization to emulate participants as agents. No week elapsed. No human participant returned voluntarily. The choices, reminder, source outage, and prior-workflow baseline below were scripted.

Both proxies recovered their original source quotation at logical days 2 and 7 after fresh processes reconstructed the original file stores. R1 retained its three-entry desk and orientation; R2 used the repaired unavailable-source handoff. A synthetic manual-note fallback recovered the same quotation, so this simulation does not establish superiority, speed, satisfaction, habit formation, or adoption.

## Design and clock

The simulation reused the actual scratch records produced by round 1, not freshly seeded replacements:

- R1 account: `R1-literature`; original desk “Streaming platform evidence”, collection `col_cb2edd5ce46e41579046c988`, three memberships.
- R2 account: `R2-investigative`; original handoff `57gx2t`, created `2026-10-08T13:19:44.000Z`, expiring `2026-10-15T13:19:44.000Z`.
- Scratch store: `/var/folders/wr/gk31dys95vz4qq6vsmr8pnx40000gn/T/m1-researcher-round1-RaENr9`.

Each persona/day invocation launched a separate Node process and instantiated new profile, clip, collection, reading, handoff, and cache objects. The handoff store's supported `now` callback supplied the explicit logical clock. The operating-system clock was not changed. Clips and collections have no age-based expiry involved in these reads, so their day labels represent scheduled retrieval scenarios rather than an artificial passage of wall time. Wall-clock response timestamps are not used as measurements.

| Logical label | Injected handoff clock, UTC | Offset from creation | Separate processes |
|---|---|---|---|
| Day 2 | 2026-10-09 13:19:44 | +1 day | R1: 43962; R2: 43963 |
| Day 7 | 2026-10-14 13:19:44 | +6 days | R1: 43964; R2: 43967 |
| Extra expiry boundary, day 8 | 2026-10-15 13:19:44 | Exactly +7 days | R2: 43960 |

Day 7 is the seventh numbered day, six days after day 1. The extra boundary check tests the actual seven-day handoff expiry and prevents presenting a day-7 result as indefinite retention.

Every live source request in the field scenarios returned a controlled HTTP 404. No network request reached the real site. The retained passage was the original article-fixture quotation: “The PS5 doesn't hardcode Twitch's IP; it looks it up via DNS every time.”

## R1 — researcher-prompted return

The scripted research prompt was: “Return to the earlier three-entry synthesis desk. Recover the exact source quote and distinguish personal caveat from agent orientation.” This models a prompted return, not an unprompted desire to reuse the product.

At each logical day, the actual tool route was `open_collection` without an id → `open_collection` with the located id → `search_library` for `DNS` quotes → `get_clip` → `read_article` for the source.

| Observable result | Day 2 | Day 7 |
|---|---|---|
| Original desk recovered | Yes | Yes |
| Entry memberships | 3 | 3 |
| Exact retained quote | Yes | Yes |
| Locator preserved | `DNS Trick`, block 5, exact text | Same |
| Saved agent orientation present | Yes | Yes |
| `orientationStale` | `false` | `false` |
| Live source accessible | No, controlled 404 | No, controlled 404 |
| Manual-note fallback exact quote | Yes | Yes |

The orientation was not marked stale because its cited retained clip still existed unchanged. This flag does not assert that the external live page was fetched or remained available. The separate article request explicitly failed.

**Bounded interpretation:** the persisted desk retains grouping and source-reference context across process restarts. Both the product and the manual excerpt recover the quotation. This is a persistence observation, not a human preference or efficiency result.

## R2 — scripted voluntary-choice scenario

The proxy was given a scripted choice between using the existing handoff and opening a saved URL/manual excerpt. The predetermined rule was: **use the existing valid handoff to inspect the sent quote; if its seven-day retention has expired, use the manual excerpt**.

“Voluntary-choice scenario” describes the simulated task design only. The route was chosen by a script, not by spontaneous human behavior, an unsolicited participant return, or an independent measure of user preference.

| Observable result | Day 2 | Day 7 | Exact expiry boundary |
|---|---|---|---|
| Selected route under the rule | MCPortal handoff | MCPortal handoff | Manual excerpt |
| Original code used | `57gx2t` | `57gx2t` | `57gx2t` attempted |
| Handoff result | `unavailable: true`, exact quote | Same | `not_found`, says handoffs last 7 days |
| Live article fabricated | No | No | No |
| Final exact quote accessible | Yes | Yes | Yes, via manual excerpt |
| Manual-note fallback exact quote | Yes | Yes | Yes |

At days 2 and 7 the model output explicitly limited itself to the retained handoff and did not infer the unavailable source's remaining content. At exactly seven days the temporary handoff expired as documented, and the scripted fallback succeeded. Durable research evidence should therefore be retained as a clip or in a collection if it needs to outlast a temporary handoff. This boundary is expected behavior, not a newly introduced failure.

## Prior-workflow fallback comparison

The baseline modeled **a saved source URL plus a manually copied verbatim excerpt and heading**. It was deliberately not a bookmarks-only baseline that would inevitably fail when the URL disappeared. Synthetic baseline memo files were seeded at the first field invocation from the same source quotation and read again in later fresh processes. They model pre-existing research notes; they are not evidence of these fictional personas' actual past habits.

The baseline retained the exact quote and source URL at every checkpoint. It did not contain the MCPortal collection memberships or stored agent orientation because those were not part of the defined baseline. That structural difference follows from the scenario definitions; it is not an empirical advantage measured in users. The comparison did not measure time, effort, error rates, emotional response, or likelihood of continued use.

The evidence supports a narrow result: MCPortal recovered the same quotation as a careful manually copied note, while also returning its own stored grouping/interpretation metadata where applicable. No claim that users would abandon existing notes is justified.

## Reproduction and exact artifacts

Script: `/tmp/m1-researcher-field-simulation.mjs`.

```sh
node /tmp/m1-researcher-field-simulation.mjs R1 2
node /tmp/m1-researcher-field-simulation.mjs R2 2
node /tmp/m1-researcher-field-simulation.mjs R1 7
node /tmp/m1-researcher-field-simulation.mjs R2 7
node /tmp/m1-researcher-field-simulation.mjs R2 8
```

The five invocations completed successfully and wrote `/tmp/m1-field-r1-day2.json`, `/tmp/m1-field-r2-day2.json`, `/tmp/m1-field-r1-day7.json`, `/tmp/m1-field-r2-day7.json`, and `/tmp/m1-field-r2-day8.json`. Baseline memos are `/tmp/m1-r1-prior-workflow-memo.json` and `/tmp/m1-r2-prior-workflow-memo.json`. These paths are temporary reproduction artifacts; this report preserves the results.

No broad suite was rerun for the field simulation. Assertions covered exact quotation retrieval, original desk size, live-page failure, explicit handoff fallback, and documented expiry. These scenarios found no additional actionable blocker. Low-priority literal-search friction from round 1 remains documented separately.

This is two researcher proxies' contribution to the wider simulated field study, not evidence that an actual one-week trial with four to six humans occurred. Any milestone completion decision must retain the explicit substitution of agent proxies for humans and logical clock advancement for elapsed field time.
