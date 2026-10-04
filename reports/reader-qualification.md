# Independent reader qualification

October 3, 2026. This workstream owns tests and diagnostics, and adds no publisher-specific extraction rules.

## Deterministic holdouts

The 20 tests in `test/reader-qualification.test.ts` exercise invented prose on a `.example` host. They cover complete sibling sections and decks, legitimate “Related”/“Share” headings, editorial correction/rating/further-information links, removal of explicit component widgets, combinations of link/code/bold/italic marks, authored line breaks, complete named entities, nested list numbering and parent continuations, quotation identity and attribution, matching metadata in conflicting JSON-LD graphs, absent/invalid metadata, separate figures with identical captions, safe embed links, malformed HTML, input/output/table caps, and docs preservation. Peer review added independent regression cases for inline media suffixes, nested quotation tails and parent list continuation identity. A live source-shaped boundary case includes styling-only biography/popular panels and player merchandise, with editorial versions of the same heading words inside the body as negative controls. A CSS-only wrapper case verifies that meaningful body context does not depend on publisher class names.

The docs control keeps an API signature, code, table, callout and related guidance. Audit diagnostics have separate negative controls and mocked 403/timeout/truncated responses; those outcomes are recorded explicitly without exposing upstream error text. No fixture depends on a publisher hostname or exact live article wording.

The original parser passed 6 of the first 13 tests; seven exposed the planned widget/structure/metadata/media gaps. The additional main-only sibling test was added after that baseline and passes the candidate extraction worker. The final candidate passes all 20 independent tests. Additional controls caught and prevented over-removal of a long editorial newsletter section that used subscription wording without utility controls.

## Live method

Run from the repository root:

```sh
node scripts/reader-audit.ts --output reports/reader-qualification-live.json
node scripts/reader-audit.ts --only holdout --limit 4 --timeout-ms 8000
```

The default corpus reads the original 20 URLs from the prior audit summary and adds NASA Science, The Guardian, Ars Technica and MDN. MDN uses docs mode. The script permits at most 32 samples, uses concurrency three, caps request time at 15 seconds (default eight), and uses `safeFetch` with the existing decompressed-byte and redirect boundaries. It extracts fresh HTML directly, bypassing article cache.

Reports contain public source URLs, header metadata, structural counts, bounded template attribute hints, heuristic quality flags, explicit blocked/failed/truncated outcomes, and `manualCompletenessVerified: false`. They contain no publisher HTML or full article text.

Whole-response tag counts include publisher chrome; a `source-figure-without-rendered-figure` or `docs-table-missing` flag can describe an unrelated component. The flag is a review lead, not proof that editorial content was lost. Conversely, an absent flag does not certify clean or complete extraction. Output hitting a cap is reported conservatively as truncated. Counts changing between requests can also reflect live source/template changes.

## Baseline observations

The guarded baseline run fetched all 24 pages with HTTP 200. None hit the reported fetch/output caps in that run. That is the observed corpus, not a guarantee of publisher access. Explicit blocked/truncated/error branches are exercised deterministically.

Before the reader changes, none of those extractions emitted figures, media or emphasis. MDN emitted 18 code blocks. The NASA response exposed both `usa-article-content` and `entry-content`, the Guardian exposed an article body wrapper, Ars exposed repeated `post-content` wrappers, and MDN exposed repeated content sections. These are broader structure patterns represented by the host-independent holdouts; they do not imply those live pages contain every unusual numbering or markup combination in the synthetic fixtures.

The baseline heuristic flags underdetect known publisher contamination from the original manual audit. Do not compare their count with its manually classified 13/20 contamination figure as if they were equivalent measurements.

## Limits and follow-up

Synthetic holdouts establish preservation and cleanup on the tested structures. The live script does not verify every source paragraph or certify the reader UI. Browser, host, responsive layout and figure-loading behavior need the UI workstream and integrated verification. No publisher-specific parser rule was required for these holdouts. Broader support should be tested with new publisher templates before accepting a growing override catalog.


## Final candidate verification

Validated the extraction changes through upstream parser commit `430f4ee`, with the shared additive contracts/entity decoder/cache changes and Sphinx compatibility assertion. The temporary validation branch contains extraction dependencies; the qualification commits contain only owned tests, fixtures, script and reports. Root integration remains the combined UI gate.

- Independent qualification: **20 passed, zero failures/skips**. These include the newly found inline-media suffix, nested-quote tail, list continuation, CSS-only panel and editorial newsletter preservation regressions.
- `npm run check`: **420 tests, 397 passed, zero failed, 23 skipped**; server/UI typechecking and design checks passed. Chrome browser tests ran. The skips are 22 unconfigured Postgres tests and one intentional file-retention contract skip covered elsewhere. This run took about 25 minutes under simultaneous browser harness contention; root is performing a bounded combined check.
- Final guarded live run: **24 HTTP 200 extractions**, zero blocked/failed/truncated outcomes in this run. Explicit blocked/truncated/error handling is separately covered by injected-response tests. No publisher body text or HTML is stored.
- Final script flags contain no `possible-publisher-ui`, `possible-leading-duplicate-title` or `possible-undecoded-entity` in this corpus. This is a heuristic result, **not** a reclassification of the original manually audited 13 contaminated articles or a completeness certificate.

The final corpus emits 153 figure records and 8 media links. Pitchfork's tour sample emits 62 explicit break spans and 20 emphasis spans. Colossal's photography sample emits 14 figures, matching the original audit's 14 figcaptions; this count alone does not certify captions, image appropriateness or rendering.

| Unseen source | Baseline → final words | Final figures/media | Review outcome |
|---|---:|---:|---|
| NASA Science | 1412 → 1347 | 8/0 | Topic-card navigation images were removed. Four resource-link thumbnails associated with editorial images remain in addition to four story images; their compact presentation is a follow-up opportunity. |
| The Guardian | 819 → 819 | 1/0 | The article hero remains; final words match baseline. Source-to-reader paragraph completeness is unverified. |
| Ars Technica | 1949 → 1954 | 7/1 | The author-mini-bio portrait was removed. Source-only br hints remain a review lead. |
| MDN | 1428 → 1428 | 0/0 | All 18 code blocks remain. The single-column specification table intentionally becomes prose; the diagnostic now checks multi-column tables before raising a missing-table flag. |

Targeted source-context rechecks confirmed removal of the previously observed Kotaku newsletter/recommendation images, IndieWire “Most Popular” panel, It's Nice That biography/recommendation panel, Bandcamp merchandise images, Ars biography portrait and NASA topic-card navigation images. Utility logo cleanup also removes the Collider card-footer brand image while preserving editorial logo-figure controls. These scoped comparisons are stronger evidence than lower word counts, but do not verify every remaining paragraph or figure.

Remaining heuristic flags concern whole-response br/emphasis/figure hints that may describe publisher chrome rather than selected story content. Stereogum still has a source-figure-without-rendered-figure hint while emitting four media links. Captions, credits, all figure choices and live author attribution have not been manually certified across all 24 pages. `manualCompletenessVerified` therefore remains false for every sample. The baseline capture precedes the single-column table diagnostic refinement, so its MDN table flag is a known benign diagnostic difference, not an extraction regression.

## Generic versus bespoke findings

No publisher-specific parser rule was added by qualification or required by the host-independent fixtures. The evidence pushed the shared parser toward coherent prose/body context, semantic component evidence and bounded optional formatting data. Live residuals exposed limits in the first implementation despite passing synthetic tests; additional independent controls then verified the fixes and caught a converse content-loss risk. This supports continued structural improvements over an expanding catalog of individual URL fixes. It does not establish a universal publisher support rate; newly encountered templates still need preservation-first review.
