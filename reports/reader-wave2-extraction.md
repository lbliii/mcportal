# Reader extraction wave 2

Latest-main baseline: `448f8a2`. Fresh safeFetch requests for all five room sample URLs returned HTTP 200 and did not reach the 1.5 MB fetch bound. Comparisons below run the baseline and updated extraction against identical response bytes; they bypass the room cache.

Three remaining problems were reproduced and fixed:

- Collider's CSS quiz contributes six result paragraphs despite its input controls being absent from reader output. Component names containing quiz/poll/survey now require at least two radio/checkbox/select controls before their result subtree is excluded. Text-only editorial discussions with those names remain. The rule is disabled for documentation.
- SlashFilm has a full H1 and OG headline but a shorter matching JSON-LD headline. The header keeps the existing metadata preference, and initial duplicate heading detection accepts exact OG/document-title variants after removing the declared site suffix. Prefix similarity is insufficient. Later editorial headings remain.
- Dezeen's SVG-only share links leave a stranded `Share:` heading. A sharing component is excluded only when it contains a known share endpoint, has less than 160 prose characters, and does not contain a protected body. Substantive discussions of sharing remain.

| Sample | Before blocks / words | After blocks / words | Exact difference |
| --- | --- | --- | --- |
| SlashFilm | 21 / 1214 | 20 / 1197 | Alternate initial H1 removed |
| Polygon | 45 / 1979 | 45 / 1979 | No change |
| Collider | 44 / 1171 | 38 / 525 | Six quiz result paragraphs removed |
| Colossal | 8 / 100 | 8 / 100 | No change |
| Dezeen | 40 / 765 | 39 / 764 | `Share:` heading removed |

Every retained block is byte-for-byte identical to a baseline output block, including span marks, list grouping and image metadata. Header metadata and all figure/media counts are unchanged. Collider's later “How Good Is the Bourne Trilogy?” section and film metadata card survive. SlashFilm's section headings, rating and release paragraph survive. Polygon's ten book sections survive. Colossal's four figures and two video fallbacks survive. Dezeen's nine figures, captions and photography credit survive.

Breadcrumbs/tag tails and Colossal's empty related heading were already absent on latest main. No new fix for those is claimed. Collider's film cast/facts card remains, including its streaming logos; it is not clipped using an arbitrary article-tail cutoff.

## Verification

`node --test test/reader-extraction.test.ts test/reader-qualification.test.ts test/reader-entities.test.ts test/reader-wave2-extraction.test.ts test/reader-cache.test.ts`: **51 passing**. Six dedicated checks cover these changes and preservation of substantial share/related/newsletter/quiz prose, grouped illustrated numbered paragraphs, later exact title sections, documentation code/callouts/tables, unsafe links, bounded nesting and content limits. Synthetic fixtures copy component structure but use newly authored content, not publisher article bodies.

`git diff --check`: passed. Full `tsc --noEmit` could not verify this dependency-free worktree: global TypeScript lacks ES2023/erasableSyntaxOnly support, and project packages are absent. Integration should run the repository's normal TypeScript with installed dependencies. No source/type errors were reported in changed extraction files by that attempted check.

## Limits and integration

[Machine evidence](reader-wave2-extraction.json) records fetch outcomes, input hashes, before/after counts and hashes/roles of removed blocks without storing public article bodies. Manual completeness is **unverified**: publisher HTML may differ from the browser's fully rendered page, and neither HTTP 200 nor output counts prove complete content. There were no blocked or truncated samples in this five-URL run.

Interactive panel exclusion is intentionally conservative and will miss unlabeled quizzes or templates without multiple choice controls. A deliberately interactive quiz/poll/survey component is removed from article mode even if it has long authored result prose; docs mode retains it. Sharing templates without recognized endpoint evidence remain untouched.

Root integration must bump the reader cache extraction version so already cached room articles receive the new extraction. No cache, UI, public contracts, existing shared tests, publication or deployment changes belong to this branch.
