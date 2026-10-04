# Reader improvement workstreams

Base: `origin/main` at `1d6142755b0284adc49f5d33b3c1837f8c5fdf5c`.
The local unpublished River changes are outside this work.

| Workstream | Branch | Owned implementation |
| --- | --- | --- |
| Shared contracts and integration | `codex/reader-contracts` | Optional block/span/article fields, entity decoding, reader cache version, audit and plan |
| Extraction and metadata | `codex/reader-extraction` | HTML extraction and helpers, editorial/docs distinction, metadata, figures/media, extraction fixtures |
| Reader UI and continuity | `codex/reader-ui` | Reader rendering/styles, passage selection, reading resume and handoff traversal, browser fixtures |
| Independent qualification | `codex/reader-qualification` | Unseen structural fixtures, repeatable live audit CLI, qualification report |

Workers inherit the shared contract commit but edit disjoint files. The integration branch validates their reviewed commits together. Four dependent draft PRs target `main`; publication and deployment remain separate from this implementation.

| Review | Dependency |
| --- | --- |
| [Shared contracts #53](https://github.com/lbliii/mcportal/pull/53) | First |
| [Reader UI #54](https://github.com/lbliii/mcportal/pull/54) | #53 |
| [Extraction #55](https://github.com/lbliii/mcportal/pull/55) | #53 |
| [Qualification #56](https://github.com/lbliii/mcportal/pull/56) | #53 and #55 |

Shared dependency commits appear in each main-targeted comparison until the shared PR lands. Workstream-specific edits remain disjoint. Qualification implementation excludes parser changes; its tests were validated in a separate combined branch.

## Validation status

- Twenty independent preservation controls pass, including controls that caught and prevented editorial newsletter over-removal.
- The fresh live audit extracted all 24 samples from 16 sources. Completeness remains unverified; counts and heuristic flags are diagnostics.
- Six dedicated reader Chrome checks and an actual extraction-to-renderer compatibility probe pass.
- The final combined check passed **426 tests: 403 passed, zero failures/cancellations, 23 skipped**. Server/UI typechecking and design checks passed. The full existing Chrome suite ran, including the corrected docs navigation fixture. The skips are 22 Postgres cases without `TEST_DATABASE_URL` and one intentional file-retention contract covered in the retention suite.
- Final integration exposed a docs-navigation test race: the Continue reading strip changed pointer coordinates after Back, and hidden retained DOM satisfied stale readiness checks. A delayed-response trace reproduced it; the test now awaits the visible room and settled strip, then requires a visible reader. Product behavior and progress assertions remain intact. Earlier parallel browser runs also stalled intermittently; the final gate runs serially.
- The required smoke command succeeds with an empty default room; the separate fresh-fetch corpus supplies meaningful reader network evidence.

The combined check used all three workers' final commits in `codex/reader-integration` at `bde3c58` and ran the same gates as `npm run check`, with Node test files serialized to avoid the observed browser-harness contention:

```sh
npm run typecheck
npm run design:check
node --test --test-concurrency=1 --test-timeout=60000 'test/**/*.test.ts'
```

Implementation and automated qualification are complete in the four published drafts. The original 20 URLs plus four unseen sources have fresh extraction captures. Manual completeness, all figure choices/captions/credits, and live author attribution across those samples remain review follow-ups; the live captures explicitly preserve `manualCompletenessVerified: false`.

The contract remains additive: legacy block types and plain text survive. Optional marks combine, lists carry group/item identity and start/value, quotations carry group identity, and figure/media metadata uses paragraph blocks with readable fallback text. Item identity distinguishes multiple paragraphs or media in one item from a new sibling, even in unordered lists or repeated ordered values. Dates are optional validated ISO strings. Existing saved reading fields remain compatible; UI traversal follows logical blocks after semantic grouping.

## Completion gates

- Generic extraction passes independently authored content-preservation controls, including editorial uses of words such as “share” and “related.”
- Docs retain code, tables, admonitions, and links.
- Real browser checks cover grouped content, narrow/light/dark/fullscreen views, lazy guarded images, outline actions, selection and resume.
- Integrated check gates and adapter smoke checks pass; environment skips are recorded separately.
- Repeat the original 20-article audit and test unseen publisher structures. Record blocked fetches and unresolved structural failures explicitly.
- Draft PRs target `main`; no merge, release, or deployment is implied.
