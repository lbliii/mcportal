# Reader second wave workstreams

Started October 4, 2026. Base: `origin/main` at `448f8a2` (the first reader tranche is already merged). This wave addresses the reader viewport and toolbar observations and remaining extraction/media defects. Every branch targets `main`; publishing a draft does not merge or deploy it.

## Work allocation

| Workstream | Branch | Owned files and deliverables |
| --- | --- | --- |
| Layout and navigation | `codex/reader-wave2-layout` | Reader shell, full available height in preview and expanded hosts, full-width secondary controls on the page canvas without tint or panel border, centered article measure; room UI and browser/reader UI checks except the shared media pipeline in room.js |
| Extraction follow-ups | `codex/reader-wave2-extraction` | Reader parser/helpers, dedicated regression and preservation fixtures, fresh five-source extraction report |
| Media reliability | `codex/reader-wave2-media` | Guarded thumbnails and room.js picture pipeline, bounded retries and cache, detached-node cleanup, scroller-aware lazy loading, dedicated tests/report |
| Integration and review | `codex/reader-wave2-integration` | Combined review, parser cache version, this charter and final validation/report; resolve shared boundaries before integrating |

Each worker has its own managed worktree. Existing reader-contracts/extraction/UI/qualification branches and the primary local main checkout are preserved.

## Acceptance criteria

1. A long article fills the available preview/expanded viewport below the universal and reader controls. Its column retains a readable width; the controls span the app width. The reader row has no separate tinted panel or border. Text cannot move behind its icons.
2. Inline cards remain bounded and adapt to the host's supported expansion modes. Filling an app viewport does not force operating-system or browser fullscreen. No unsupported host expansion is implied.
3. Reader-in-room, standalone article, docs, source view, clips and social cards retain their actions and route home. Narrow layouts, increased text size and changing display modes preserve usable controls, selection, heading navigation and reading resume.
4. Fresh extraction checks distinguish issues already fixed in the first tranche from current defects. Remove remaining interactive quiz output, metadata-title duplication and orphan share headings with preservation controls for real editorial content and docs structure.
5. Images continue to use guarded server fetches and data URIs. Lazy loading follows the active scroll region; stale nodes do not queue abandoned work, failures get bounded recovery, and memory/request caps remain explicit. Alt text, captions, credits and source links survive unavailable media.
6. Focused checks pass in each branch; combined type/design and the serialized test suite pass or accurately record environment skips. Manually inspect wide/narrow preview and an MCP bridge harness; the preview alone is not host certification.

## Review sequence

Review the disjoint worker commits independently, then combine on the integration branch and validate interactions. Draft PRs target `main`. The integration comparison is the candidate for combined review; individual draft slices remain useful for ownership and history. Do not auto-merge or deploy as part of swarm setup.

## Status

Workers are implementing. Latest-main baseline type and design checks passed. Fresh parser checks reproduced three remaining defects: Collider input-backed quiz outputs, a SlashFilm title variant, and a Dezeen orphan Share heading. Most earlier breadcrumb/tag cleanup observations no longer reproduce on current main. Media review found permanent UI null caching, retained detached image nodes, stale queued work and outer-viewport lazy-loading margins.
