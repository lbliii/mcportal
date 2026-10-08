# Reader wave 2: media reliability

Base: `origin/main` at `448f8a2`. Branch: `codex/reader-wave2-media`.

Main already supplies article figures, captions, alternate text, reserved aspect ratios, source links, and safe lazy thumbnails. This change fixes reliability in the shared image pipeline rather than adding another media renderer.

## Changes

- Reader figures use an IntersectionObserver rooted in `#reader`, so its 200px prefetch margin applies inside the article scroller. A child-list MutationObserver rebinds figures after synchronous insertion and releases detached observations and pending nodes during navigation. Image source/class changes do not trigger that observer.
- The queue retains nodes rather than only URLs, deduplicates each request, and serializes batches of at most 24 URLs. Completed requests only update the nodes that requested them and are still attached with the same URL.
- Failures are not permanently memoized in the browser. A still-visible node gets at most one automatic retry after 2 seconds. Leaving the viewport suppresses that retry; exhausted observations are released. A later article opening can try again. The server continues to cache permanent failures while leaving timeouts, 429s, and 5xx uncached.
- Successful raster data URIs are retained in a browser cache bounded to 64 entries and 8 million characters. Publisher URLs, SVG data URIs, and oversized host results cannot become browser image sources.
- The thumbnail fetcher explicitly rejects truncated and over-cap binary results, preserving the existing fallback to a smaller rendition. Byte, timeout, type, address/redirect, concurrency, and CSP protections stay in place.

No reader markup or layout changes were made. Alternate text, captions, credits, dimensions, and source-link fallback remain the reader renderer's existing behavior.

## Validation

- `node --test test/reader-wave2-media.test.ts test/reader-wave2-media-ui.test.ts`: 9 deterministic tests pass. These execute the real picture fragment with controlled DOM insertion/removal, visibility, promises, and timers, and the real thumbnail fetcher with controlled binary responses.
- `npm run typecheck`: pass, including strict browser checking at the existing 49-cast ceiling.
- `node --test test/core.test.ts test/reader-ui.test.ts`: 41 existing tests pass, including the real browser reader media regression (safe sources, lazy requests, no layout movement, alternate text, source links) and existing server safeguards.
- `git diff --check`: pass.

## Limits and integration

`#reader` must remain the article scroller; this was confirmed with the layout agent. No new hook or shared tool/type contract is required. The pipeline does not abort a server request already in flight; it discards detached-node effects and cleans up queued work. A persistent failure receives two attempts per node and requires a later opening for another attempt. The existing 350KB fetch cap and 480px resize fallback remain; this tranche does not claim higher-resolution art-quality renditions.

Combined layout/extraction/media preview validation and publication belong to the root agent. This worker does not push, create a PR, merge main, or deploy.
