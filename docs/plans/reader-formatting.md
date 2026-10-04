# Plan: improve article formatting in reader view

**Status:** implementation in progress, October 3, 2026. Three disjoint workstreams target `main`; qualification and final integration are pending.

**Evidence:** [20-article audit](../../reports/Reader%20view%20formatting%20audit.md), covering 12 sources on MCPortal 0.7.0 at `9868338`.

## Outcome

An article opens with one headline and a compact metadata row, followed by its actual editorial content. Authored emphasis, line breaks, lists, figures, captions, and useful media links survive casting into the portal. Long articles remain easy to navigate, select passages from, and resume.

Deliver five reviewable changes in dependency order. Phases 1–3 form the first release candidate: clean, structured text. Phases 4–5 add visual content and navigation. Each phase includes its own evidence and regression coverage; publication and deployment are separate actions.

## Scope and constraints

- Preserve the existing reading width, paragraph rhythm, room layouts, and explicit Mark as read behavior.
- Keep `read_article` URL-based. Extend result data with optional fields and readable fallbacks; do not casually rename tools or require new arguments.
- Continue guarded fetching, bounded parsing, text-node rendering, and fenced model-facing source text.
- Account-specific feed metadata must stay outside the shared upstream article cache.
- The HTML extractor and block renderer also serve docs and clips. Editorial body selection must not trim legitimate documentation, code, tables, callouts, or API signatures.
- No publisher scripts, automatic audio/video playback, paywall bypass, new subscriptions, or user-room reconfiguration are needed.

## Phase 1 — select the story body

**Deliverable:** remove publisher components while retaining editorial paragraphs, headings, corrections, ratings, and credits.

- [ ] Add small, sanitized fixtures representing the audit's structural failures. Use invented text and recognizable paragraph markers rather than checked-in full publisher articles. Include clean-body controls and docs controls.
- [ ] Track bounded container identity and ancestry during tokenization. Distinguish the primary story from other article-tagged components rather than combining every block in the preferred zone.
- [ ] Score plausible content containers using semantic hints, prose/link density, and coherent paragraph runs. Preserve decks and valid sibling sections when a story spans more than one wrapper; avoid selecting only its longest subsection.
- [ ] Exclude author biographies, subscription/consent components, breadcrumbs/tags, recommendation lists, and empty utility headings using their container context. Add narrowly scoped publisher rules only for demonstrated unresolved cases.
- [ ] Extract any header metadata needed later before excluding its container. Preserve useful editorial corrections, ratings, captions/credits, and further-information links.
- [ ] Add an explicit editorial/docs extraction distinction at the shared extractor boundary if needed. Keep docs' broader content selection and limits intact.
- [ ] Compute word count from retained editorial text. Check cache freshness/versioning when changing extracted output so validation is not using old results.

**Acceptance:** the 13 known contaminated samples lose the identified publisher UI; the seven clean-body controls retain their editorial content. Both IndieWire leads begin with prose, Collider no longer leads with a biography, and Kotaku/It's Nice That no longer append recommendation components. Manual source comparison confirms the story's beginning and ending and checks intervening paragraphs. A shorter extraction alone is not evidence of success.

**Files:** `src/adapters/reader.ts`, `src/adapters/docs/pages.ts`, `src/sources.ts`, `test/adapters.test.ts`, `test/docs.test.ts`, and representative reader fixtures.

## Phase 2 — preserve authored structure

**Deliverable:** restore emphasis, explicit line breaks, and list semantics without turning ordinary prose into guessed sections.

- [ ] Track nested bold and italic marks in the HTML extractor. Render combinations with links and code rather than choosing a single exclusive mark.
- [ ] Add optional structured line-break information to spans. Preserve the safe plain-text fallback and distinguish authored breaks from ordinary source whitespace.
- [ ] Supply ordered status, depth, list identity, start values, and explicit item values. Render accessible semantic lists, including nested and separately numbered groups.
- [ ] Preserve a multi-paragraph quotation as one coherent quote component with attribution where supported; avoid merging unrelated neighboring quotes.
- [ ] Complete named-entity decoding using a bounded implementation; retain existing handling of numeric entities and hostile input limits.
- [ ] Update passage/reading traversal together with any list grouping so logical block identification remains consistent.

**Acceptance:** Pitchfork tour dates appear on separate lines and retain the new-date emphasis. All ten Dezeen building labels remain emphasized. RPS contributor names remain distinguishable. Nested ordered-list, mixed-mark, and quote fixtures preserve semantics; the visible accented-letter entity is decoded. Links, tables, code, and docs callouts continue working.

**Files:** `src/types.ts`, `src/lib/text.ts`, `src/lib/markdown.ts` where shared contracts require it, `src/adapters/reader.ts`, `src/ui/room/reader.js`, `src/ui/room/passage.js`, `src/ui/room/reading.js`, and corresponding parser/browser tests.

## Phase 3 — consolidate headlines and metadata

**Deliverable:** one title, one reliable metadata row, and no duplicated metadata in the body.

- [ ] Normalize punctuation and whitespace for leading-title comparison. Remove only recognized publisher suffixes; preserve legitimate repeated section titles deeper in a story.
- [ ] Resolve headline, credited authors, publication/update dates, and site from bounded, validated article metadata and recognized header markup. Handle structured-data arrays/graphs and multiple authors; do not trust an arbitrary unrelated schema object.
- [ ] Add optional publication/update metadata to the Article contract and render valid dates consistently. Fall back to the source host when the site name is absent.
- [ ] Remove redundant body metadata only after it has been correctly represented in the header.
- [ ] If feed fallback is still needed, use only the matching account's item data after upstream-cache lookup, with clear provenance. Standalone cards must remain useful without a room item; never invent a missing author.
- [ ] Recompute reading-time display from cleaned editorial text and exclude widget/caption scaffolding from its estimate.

**Acceptance:** the three observed duplicate headlines disappear. The seven missing-author cases are rechecked against available source metadata and matching feed credits; recovered credits appear once, with uncertain attribution left absent. Long titles, multiple authors, invalid dates, missing metadata, and conflicting structured objects are covered. Headers agree between room readers and standalone cards.

**Files:** `src/adapters/reader.ts`, `src/types.ts`, `src/tools/reader.ts`, `src/tools/results.ts` if its contract requires changes, `src/ui/room/reader.js`, `src/ui/room/room.css`, and focused metadata tests.

## Phase 4 — restore figures and provide media links

**Deliverable:** image-led articles communicate their visual subject, and omitted audio/video has a usable destination.

- [ ] Define bounded optional figure/media metadata: URL, alt text, caption, credit, dimensions when known, and media kind. Prefer existing block types with plain-text/link fallback where practical; verify compatibility before introducing new variants.
- [ ] Extract figures, lazy-image attributes, appropriate srcset candidates, and trusted embed destinations from the selected story body. Preserve their original order and editorial association.
- [ ] Deduplicate repeated gallery renditions by media identity within their component. Remove filename-like carousel scaffolding, while retaining deliberate repeated text and distinct works with identical captions.
- [ ] Initially reuse the existing guarded `get_thumbnails` data-URI path where adequate. Verify whether its 480px renditions and 350KB cap meet reader quality before adding a separate image profile; keep any expansion bounded and explicit.
- [ ] Lazy-load near-visible figures in bounded batches using existing fetch concurrency limits. Reserve image space so late loads do not move a selected passage or the resume point.
- [ ] Keep captions/credits attached to their figure; include labeled source links for unavailable images and audio/video. Avoid loading publisher iframe scripts.
- [ ] Replace the currently unconditional text-only provenance sentence with wording that accurately describes the rendered view.

**Acceptance:** Colossal photography and the sampled design/architecture articles retain useful figure context and credits. Collider's duplicated five-item gallery becomes one set. Stereogum supplies a labeled footage link. Failed, oversized, blocked, or malformed images leave a readable article and an original-source fallback. Tests verify request bounds, lazy loading, and stable reading position.

**Files:** `src/adapters/reader.ts`, `src/types.ts`, `src/thumbnails.ts`, `src/tools/reader.ts`, `src/ui/room/reader.js`, `src/ui/room/room.css`, and image/browser fixtures.

## Phase 5 — navigation and presentation polish

**Deliverable:** long articles and roundups remain easy to scan inside the portal.

- [ ] Keep Back/Open original and the existing reader actions available while the internal reader region scrolls. Validate stacking and focus in embedded and fullscreen views.
- [ ] Reuse the docs outline approach where practical. Show a compact, collapsible article outline only for sufficiently long content with useful headings; keep narrow layouts unobstructed.
- [ ] Generate deterministic, unique heading anchors when the source provides none. Outline navigation must work without changing the external source URL.
- [ ] Distinguish decks, captions, credits, and media/link groups from normal prose. Only style a deck when extraction identifies one reliably.
- [ ] Group repeated listening destinations into compact wrapping links without dropping labels or destinations or changing their editorial order.
- [ ] Verify keyboard navigation, visible focus, light/dark themes, long-title wrapping, narrow host widths, and reduced-motion behavior.

**Acceptance:** controls remain usable deep in a long article; outline links land on the intended heading; all Pitchfork listening destinations remain accessible. Existing content width and paragraph rhythm are retained unless a measured layout defect requires a change.

**Files:** `src/ui/room/reader.js`, `src/ui/room/docs.js` only for reusable outline behavior, `src/ui/room/room.css`, and `test/ui-browser.test.ts`.

## Reading continuity is a requirement in every phase

Reading history, passage selection, and handoffs currently depend on `.body` children and block indexes. Cleanup, semantic list grouping, and media insertion can shift those indexes.

Keep logical content-block traversal explicit and shared by the renderer, reading tracker, and passage/handoff code. Record and prefer existing heading information where it reliably identifies the passage; verify selected-passage matching before falling back to numeric position. Clamp obsolete indexes safely. Historical records containing only a block number cannot be restored exactly after arbitrary content changes: treat that as a best-effort limitation and document it, rather than promising a migration that the stored data cannot support.

Cover re-opening an article, selecting text in a nested list, transferring a selected passage, and loading delayed images. Reopening must not mark an article read or silently erase the furthest recorded progress. If durable new anchor fields are required, scope the change across storage, linked clients, exports, and result contracts before implementing it.

## Validation and release gates

1. Each phase has deterministic structural fixtures for its actual regressions and negative controls for content that must survive. Add malformed HTML, repeated text, multi-container articles, and shared-docs cases where the phase changes their handling.
2. Run relevant adapter, markdown, docs, reading, handoff, and browser checks for changed behavior. Run `npm run check` before opening each PR. Run live `npm run smoke` for adapter/fetch changes. Regenerate design outputs when shared design tokens or generated controls change.
3. Revisit the 20 audit URLs for the text milestone and again for figures/navigation. Record source changes and blocked fetches separately from reader regressions. Compare editorial content, not just counts or screenshots.
4. Exercise reader-in-room, standalone reader card, docs HTML fallback, and fullscreen mode. Capture before/after evidence at controlled narrow and wide widths and both themes. Verify at least one actual MCP host before claiming host behavior; local preview is not host certification.
5. Extend the sample with a code/table-heavy page, a nested-list article, missing metadata, and an ordinary blocked-fetch outcome. These were outside the first audit.
6. Report the observed contamination, duplicate-title, attribution, structure, and media outcomes against the recorded baseline. Target zero of the identified widgets and duplicate headlines in the checked corpus, with no confirmed editorial-content loss. Do not equate that result with universal publisher support.
7. Review compatibility for optional fields and any new block variants. Keep older-client readable fallbacks; use the repository release/version workflow for an actual contract change. Clear or version affected caches as needed. Release/deploy only after combined verification; a draft plan or PR does not mark a phase shipped.

## First implementation slice

Start with Phase 1 and its source-shaped fixtures: IndieWire consent components, Collider biography/gallery wrappers, Kotaku recommendation articles, and It's Nice That metadata/recommendation sections. Use the clean Polygon/Bandcamp cases and docs fixtures as preservation controls. Keep figures as identifiable editorial placeholders during selection so Phase 4 can restore them without rebuilding the body-selection logic.

Move to inline structure once the selected body is reliable. This gives the first release a concrete benefit across the existing room and provides a stable foundation for richer article presentation.
