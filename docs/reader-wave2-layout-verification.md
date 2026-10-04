# Reader wave 2 layout verification

Base: `origin/main` at `448f8a2`. Branch: `codex/reader-wave2-layout`.

The reader now uses a full-width shell with a controls row outside `#reader`, which remains the content scroll owner. Article text stays in a centered 700px column. Preview and supported expanded MCP host views use the available viewport height; inline cards keep a 640px maximum article viewport and the existing capability-gated expansion control. The reader controls have no background or panel border.

Articles, docs, clips, shares, spaces and highlights install their controls through the same shell. Docs sidebars fit the measured expanded reader content height; inline navigation uses the bounded card allowance without a content-height feedback loop. Source Back and Refresh stick below the measured universal toolbar while preserving the existing source card styling.

## Checks

- `npm run typecheck`: passed (UI cast ceiling unchanged at 49).
- `npm run design:check`: passed.
- `node --test test/reader-ui.test.ts test/ui-browser.test.ts test/ui-passage.test.ts`: 33 passed, zero failures or skips.
- `git diff --check`: passed.
- New assertions cover a 984px viewport at 1000px and 380px widths, larger text, resizing to 670px, expanded/inline mode switches, short articles, transparent full-width controls, exact saved-passage visibility, docs shell geometry and source Back/Refresh after scrolling at 380×500 with 200% root text size.
- Existing checks preserve semantic block identities, nested list/figure grouping, selection and handoff callbacks, completion policy, docs hash priority, reading progress, room restoration and browser console cleanliness.

## Visual inspection

CUA opened an isolated fixture preview on port 8790 using disposable data in `/private/tmp/mcportal-reader-layout-preview`. At a 1280×720 viewport:

| Measurement | Pixels |
| --- | ---: |
| Universal toolbar width | 1280 |
| Reader controls width | 1280 |
| Reader controls bottom | 73 |
| Reader viewport top | 73 |
| Reader viewport bottom | 720 |

The screenshot showed controls on the canvas, a centered article column, and the reader extending to the viewport bottom. Proof: `/private/tmp/mcportal-reader-layout-preview.jpg`. The synthetic fixture deliberately includes hostile instruction text as rendered article content. The temporary browser tab and preview server were closed after inspection.

## Limits

This branch does not change extraction, guarded image fetching or source card visual styling. Host expansion still depends on the advertised fullscreen capability and does not request OS/browser fullscreen. Browser verification uses synthetic fixtures; the integrated tranche should additionally inspect actual publisher articles after extraction and media changes land.


## VM harness follow-up

The full integration suite exposed four harness failures because the isolated dispatcher/navigation contexts did not load the new reader shell helpers. Both harnesses now extract the shipped `renderReader` and `setReaderControls` definitions. Error-boundary diagnostic assertions are unchanged; the stale-article test also verifies that a late result cannot replace controls or reinsert them into the content viewport.

`node --test test/ui-docs.test.ts test/ui-host-navigation.test.ts`: 12 passed, zero failures or skips. No production source changes were needed.
