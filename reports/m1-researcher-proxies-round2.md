# M1 researcher proxy study — round 2

Executed 2026-10-08 against the shared working tree after the handoff repair. This round uses **three new agent-simulated researcher personas, R4–R6**. They are not human participants or independent model samples. One delegated agent exercised all three roles. The user explicitly authorized agent proxies. Round 1 remains recorded separately in `reports/m1-researcher-proxies-round1.md`.

The confirmed round-1 defect, RP-1, is repaired in the tested article and docs flows. An unavailable source now leaves its retained passage accessible in both model output and the rendered card, and the same handoff code can retry successfully when the fixture source returns. No new blocking failure was found in the bounded scenarios below.

## Method and limits

The tool scenarios used actual MCP `handleMessage` dispatch with fresh file-store contexts in scratch storage, including argument validation and structured errors. They did not call production services. Sources were the repository article fixture and controlled docs fixtures. Persona goals, researcher statements, and interpretation text are synthetic.

A focused custom browser harness used headless Chrome at 375 × 812 pixels with a localhost fixture MCP Apps host. It exercised only the changed unavailable-handoff view and retry path; it did not repeat the broad suites already verified in round 1. It does not certify any real ChatGPT, Claude, or Codex host. All source-loss events were explicit fixture responses, not observed website outages.

Immediate reproduction artifacts:

- Tool script: `/tmp/m1-researcher-proxies-round2.mjs`
- Tool results: `/tmp/m1-researcher-proxies-round2-results.json`
- Tool scratch store: `/var/folders/wr/gk31dys95vz4qq6vsmr8pnx40000gn/T/m1-researcher-round2-t6J0ta`
- Browser script: `/tmp/m1-researcher-round2-browser.mjs`
- Browser results: `/tmp/m1-researcher-round2-browser-results.json`

These temporary files support reproduction during the current session; the substantive results are retained in this report. No production source was changed by this proxy-study agent. The repository was concurrently integrating reader changes, so this is working-tree evidence rather than released-build certification.

## R4 — archival evidence researcher

**Simulated task:** choose a source statement, retain it for discussion in another conversation, recover it after source removal, and verify that recovery does not broaden account access.

**Executed evidence and outcomes:**

1. Opened the article fixture through `read_article`. Selected the source sentence: “The PS5 doesn't hardcode Twitch's IP; it looks it up via DNS every time.”
2. Created an article handoff with that exact passage and the `DNS Trick` heading, then made the URL return HTTP 404.
3. Opened the handoff from a newly constructed file-store context. The result was not a tool error; it contained `unavailable: true`, the exact `handoff.passage`, and no fabricated `article` object.
4. The model text fenced the passage as untrusted source content and said: “Only the stored handoff above is available; do not infer the rest of the page.” This distinguishes retained evidence from a successful current fetch.
5. Restored the fixture and retried the same handoff code from another fresh context. The full article returned under its original title, “Hijacking the PS5's RTMP Stream”.
6. A different scratch account opening that same code received `not_found`.

**Browser check:** the narrow fallback card displayed the exact quotation, source-unavailable notice, source address, and **Retry live page**. Retrying while unavailable produced the “still unavailable” notice; retrying after restoration opened the source. No horizontal document overflow or browser problems were observed.

**Observable simulated outcome:** the repaired flow preserves inspectable archival evidence without claiming that the live source loaded. No human comprehension claim is made.

## R5 — methods reproducibility researcher

**Simulated task:** carry a specific documentation rule into a fresh context, recover it after access is denied, and distinguish retained evidence from a pointer that contains no quotation.

**Executed evidence and outcomes:**

1. Opened and read a controlled docs index/page. The chosen page contained the statement “Admins can invite people.” under `Roles`.
2. Created a docs handoff, then changed the docs page to HTTP 403 while leaving the index available.
3. Opening from a fresh context returned `unavailable: true` with the exact rule. No `site` or `article` object was invented.
4. Restoring the page and retrying the same code returned `page: https://docs.example.com/configure.md`.
5. Created a separate article handoff without a selected passage and made its source unavailable. The result did not fabricate a `passage` field.

**Browser check:** a docs handoff also recovered from a controlled unavailable response and successfully retried. The pointer-only fallback explicitly displayed “No passage was retained with this handoff.” Both states fit the 375-pixel viewport with no horizontal document overflow or browser problems. A retry control was present in the pointer-only state; recovery of that state was not separately exercised because article retry was already checked with a quote.

**Observable simulated outcome:** the docs path preserves retained material through loss of access, and a link-only handoff does not masquerade as a retained excerpt.

## R6 — comparative qualitative researcher

**Simulated task:** compare two different kinds of control without overgeneralizing, preserve a personal coding memo separately, and recognize when interpretation cites deleted evidence.

**Executed evidence and outcomes:**

1. Retained two quote clips: the article's DNS statement and the controlled docs rule. Retained a separate personal note: “Personal memo: network control and administrative roles are different constraints; do not equate them.”
2. Called `show_comparison` with two distinct clip references and supplied agent interpretation distinguishing network routing from administrative invitations. The result preserved two sources and two cited refs separately from its orientation text.
3. Created the private desk “Types of control” with the two evidence clips and personal memo, then saved an orientation citing only the two source clips.
4. Attempted a comparison interpretation citing `url:https://invented.example/claim`. The tool rejected it with `invalid_argument`.
5. Deleted the scratch docs quote and reopened the desk with fresh file stores. It retained all three memberships, listed the removed quote in `unavailableRefs`, and reported `orientationStale: true`.
6. The personal memo remained a `note` with `source.kind: conversation`. Searching for `DNS` from a new context returned the retained article quote.

**Observable simulated outcome:** missing evidence is explicit, its interpretation is marked stale, and the researcher's own memo remains distinct from source evidence. Citation-membership checks do not prove the interpretation is substantively correct.

## RP-1 exact-record retest

The retest reused the **original** R2 file store and handoff code `57gx2t` from round 1, with the original source returning HTTP 404 and a new cache/context. This was not only an equivalent newly created case.

| Property | Round 1 | Repaired round 2 |
|---|---|---|
| Tool error | `upstream_error` | No tool error |
| Retained quotation in result | Absent | Exact original quotation |
| Explicit unavailable state | Error only | `unavailable: true` plus limitation text |
| Invented current article | None | None |
| Retained quote accessible in card | No fallback view | Verified in focused browser harness |

**Disposition:** RP-1 is closed for the executed HTTP-failure cases. Article restoration, docs restoration, absent quotation, and account isolation also passed. Unexpected internal programming exceptions and every possible network failure mode were not exhaustively tested.

## Verification and remaining findings

- The new tool script completed **20 explicit assertions** across R4–R6 and the exact RP-1 retest.
- The focused browser script completed **three state scenarios**: article quote, docs quote, and pointer-only handoff. Both quote scenarios retried while unavailable and then recovered after source restoration. All three reported zero browser problems and no horizontal document overflow.
- RP-2 remains a low-priority documented search friction from round 1: literal conversational queries can require keyword reformulation. No search repair was part of this round, and no unsupported semantic-search guarantee is assumed.
- No new actionable blocking defect was observed in these tasks. Real-host behavior and human usability remain outside the evidence boundary; these proxy sessions cannot replace claims about real participants.

The later-day simulations for R1 and R2 are recorded separately in `reports/m1-researcher-field-simulation.md`. Their scripted choices and simulated clocks are not evidence of spontaneous adoption or an elapsed week.
