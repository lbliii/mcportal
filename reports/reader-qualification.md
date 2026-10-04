# Independent reader qualification

October 3, 2026. This workstream owns tests and diagnostics, and adds no publisher-specific extraction rules.

## Deterministic holdouts

The 14 tests in `test/reader-qualification.test.ts` exercise invented prose on a `.example` host. They cover complete sibling sections and decks, legitimate “Related”/“Share” headings, editorial correction/rating/further-information links, removal of explicit component widgets, combinations of link/code/bold/italic marks, authored line breaks, complete named entities, nested list numbering and parent continuations, quotation identity and attribution, matching metadata in conflicting JSON-LD graphs, absent/invalid metadata, separate figures with identical captions, safe embed links, malformed HTML, input/output/table caps, and docs preservation.

The docs control keeps an API signature, code, table, callout and related guidance. Audit diagnostics have separate negative controls and mocked 403/timeout/truncated responses; those outcomes are recorded explicitly without exposing upstream error text. No fixture depends on a publisher hostname or exact live article wording.

The original parser passed 6 of the first 13 tests; seven exposed the planned widget/structure/metadata/media gaps. The additional main-only sibling test was added after that baseline and passes the candidate extraction worker. Candidate and integrated checks are recorded below when complete.

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
