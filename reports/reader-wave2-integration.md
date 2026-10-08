# Reader wave 2 integration verification

Base: origin/main 448f8a2. Candidate branch: codex/reader-wave2-integration.

Three isolated workstreams implement the reader viewport/control feedback and remaining extraction/media defects. Draft slices target main: [layout #57](https://github.com/lbliii/mcportal/pull/57), [extraction #58](https://github.com/lbliii/mcportal/pull/58), and [media #59](https://github.com/lbliii/mcportal/pull/59). This integration candidate combines their final code, regression harness fixes and reports, plus a reader:v3 cache key with a test proving v2 and legacy extractions are ignored.

## Actual publisher preview

An isolated localhost preview uses a copy of the morning room in /tmp/mcportal-reader-wave2-data. It does not edit the user's primary profile. CUA opened Polygon's long hard sci-fi article and measured:

| Viewport | Universal width | Reader controls width | Reader bottom | Empty band below reader |
| --- | ---: | ---: | ---: | ---: |
| 1280×720 | 1280 | 1280 | 720 | 0 |
| 897×984 | 897 | 897 | 984 | 0 |
| 375×812 | 375 | 375 | 812 | 0 |

The controls have a transparent computed background and a 0px bottom border. Their bottom equals the article viewport top. Page scroll remains zero; the reader is the article scroll owner and no horizontal overflow appears. Deep scrolling loads a later figure while the controls stay visible. Back shows the unfinished item at 42%; Continue reading restores the saved passage (scrollTop 3477 in the narrow viewport). The temporary viewport override was reset and the preview left at the article's opening.

Screenshot at 897×984: /Users/lb/.codex/visualizations/2026/10/04/01a106f8-a520-78b3-91f8-190443bf8ecd/reader-wave2.jpg. Preview: http://localhost:8788/preview.

## Component evidence

- docs/reader-wave2-layout-verification.md: real-browser MCP bridge checks, viewport/mode changes, enlarged text, docs/passage/resume/source navigation, and synthetic visual geometry.
- reports/reader-wave2-extraction.md and .json: fresh same-response comparisons for five publishers. Collider loses only six quiz paragraphs, SlashFilm only its duplicate metadata headline, Dezeen only its orphan Share heading. Polygon and Colossal outputs remain identical. Retained blocks and media metadata match baseline.
- reports/reader-wave2-media.md: scroller-root observers, bounded recovery/batches/cache, detached and stale-node cleanup, safe raster sources, truncated/oversized fetch guards.

## Combined checks

**445 tests: 422 passed, zero failures, 23 skipped.** The full suite ran with `node --test --test-concurrency=1 --test-timeout=60000 'test/**/*.test.ts'`. Browser suites ran with Chrome. Twenty-two skips require TEST_DATABASE_URL; the remaining file-store purge contract is covered by the separate retention test. Typecheck, design output check and git diff check pass. In-process smoke passes against an empty default room; it is a server wiring check, not live publisher coverage. Actual publisher preview and the extraction comparisons above supply the network evidence.

## Limits

Postgres checks require TEST_DATABASE_URL; no database was provisioned for this reader tranche. The file-store purge contract is intentionally covered by the separate file-age retention test. Media retains the existing 350KB cap and 480px smaller-rendition fallback. Host expansion depends on advertised MCP capabilities; bridge harness testing and standalone preview do not certify every production host. Manual universal article completeness remains unverified. No merge or deployment was performed.
