# Reader view formatting audit
Date: October 3, 2026  
Baseline: MCPortal 0.7.0, checkout `9868338`

## Result
Clicked through **20 live articles from 12 sources** in the room's reader view. All 20 returned article content. The largest improvements should come from selecting the actual article body and preserving its structure. The existing reading width, paragraph spacing, section-heading treatment, and link styling are a useful foundation.

**13 of 20 samples** included publisher UI, taxonomy, author biography, related stories, or orphaned widget headings in the body. **3** repeated the article title. **7** omitted the author from the reader metadata even though the room's feed entry named one. These are manual classifications of this sample, not an estimate of all supported sites.

## Method and limits
The connector's inline room was unavailable to browser automation. Used the current checkout's real UI at a loopback preview with a separate scratch copy of the room, and clicked actual feed article buttons. Opened articles inside the room, not as standalone reader cards. Switched only the scratch room to columns to reach every source. Inspected rendered article blocks and representative screenshots at the browser's existing viewport sizes; this was not a controlled responsive-breakpoint test.

Compared publisher originals for Pitchfork's tour announcement, Dezeen's brutalist roundup, and Colossal's photography awards. Ran small extractor probes for emphasis, line breaks, title matching, and nested/ordered lists. No application behavior was changed. Live source HTML can change; this is not an exhaustiveness or article-completeness guarantee. No paywall, blocked-fetch, table, code-heavy, or technical-document sample was exercised. YouTube entries intentionally open their original video and were excluded.

## Prioritized improvements

### 1. Select the article body and remove surrounding publisher UI
**Evidence:** Collider begins with an author biography. Both IndieWire samples begin and end with a newsletter consent/reCAPTCHA paragraph and retain unrelated widget headings. Kotaku retains a newsletter and six recommended-story entries. Both It's Nice That samples retain metadata labels, tags, author profiles, recommendation cards, and newsletter copy. Dezeen appends topic lists. Colossal leaves an empty related-articles heading.

The extractor chooses all blocks in the preferred article/main zone. That is too broad when publishers put author components, recommendations, or multiple article elements inside the same zone. Skipping semantic footer/aside/form tags and short share-link lists does not remove equivalent div-based widgets.

**Implementation:** Evaluate bounded candidate content containers using semantic markup, text density, link density, and boundary attributes. Prefer the coherent story body over all article-tagged descendants. Carry container identity into block selection so a newsletter's text is excluded with its component. Add narrow publisher overrides only where generic selection remains ambiguous.

**Acceptance:** Every sampled story starts at its deck or editorial lead and ends at its editorial conclusion. Preserve useful corrections, ratings, photo credits, and further-reading links; do not globally cut the document at a word such as "Related" or "Share". Recalculate reading time after selection. Revisit all 20 cases to check for accidental paragraph loss.

### 2. Preserve emphasis, explicit breaks, and list structure
**Evidence:** Pitchfork's original 2027 tour paragraph contains **41 br elements and 19 strong/b elements**. Reader view compresses it into one paragraph, losing both separate date lines and the distinction between new and previously announced dates. The first building label in Dezeen's original roundup is a strong element inside a paragraph; the reader renders all 10 entry labels as ordinary body text. Rock Paper Shotgun's weekend contributors become names glued to paragraph openings without visual differentiation.

The HTML extractor records links and inline code but does not record bold or italic emphasis. Its br handling inserts a space. Small probes also show that ordered lists and nested lists produce flat li blocks without order or depth metadata. The renderer already understands strong spans and some list metadata, but the HTML extractor does not supply them.

**Implementation:** Track nested inline marks; allow bold, italic, and link/code marks to coexist. Preserve explicit line breaks as structured data while maintaining the safe plain-text fallback. Supply list depth, ordered status, start/value, and group information; render semantic lists. Keep authored paragraph and section boundaries rather than guessing new headings from content.

**Acceptance:** Tour dates remain separate lines and new dates remain bold. All 10 building labels remain emphasized. Nested ordered-list probes retain hierarchy and numbering. Ordinary wrapped prose does not gain arbitrary line breaks.

### 3. Normalize titles and promote metadata into one header
**Evidence:** /Film repeats its title because the metadata title has a publisher suffix. Colossal's animation profile and Stereogum's concert article repeat titles when straight and curly apostrophes differ. It's Nice That renders author/date labels as paragraphs but its reader header has only the reading time. Bandcamp Daily and Rock Paper Shotgun also lose authors; Stereogum loses both author and site. Publication dates are not part of the Article result schema, so some appear in the body and others disappear.

**Implementation:** Prefer a validated article headline; remove recognized publisher suffixes conservatively. Compare the leading body heading with a normalized title (Unicode punctuation, whitespace, suffix) without rewriting legitimate section headings. Resolve bounded author/date metadata from recognized structured markup and article header fields, with source-host fallback for the site. Treat feed authors as a provenance-aware fallback where the article lacks them.

**Acceptance:** One headline, one author/site/date/reading-time row, and no metadata labels in the article body. Preserve multiple credited authors when available; never substitute an author biography for a byline.

### 4. Make figures and media omissions explicit
**Evidence:** Colossal's photography source contains 14 figcaption elements in the inspected article selector; its reader contains four editorial paragraphs and an unrelated heading, with no figures or captions. The animation and architecture/design stories likewise lose the visual subject. Collider turns five gallery-caption items into ten duplicated bullets, including a filename-like label. It's Nice That's illustration sample retains repeated copyright captions as body paragraphs while omitting their images. Stereogum tells the reader to watch footage below, but supplies no media fallback.

Text-only behavior is currently declared by the reader; this is a product-capability gap as well as an extraction problem.

**Implementation:** Add structured figure data with image reference, alt text, caption, and credit kept together. Fetch useful renditions through the guarded image path, with bounded size and lazy loading. Exclude tracker/UI images. Deduplicate equivalent gallery entries by media identity within their component; do not globally deduplicate intentional repeated prose. Represent video/audio embeds as labeled links or lightweight media cards rather than running publisher scripts.

**Acceptance:** Readers can see which artwork or building the prose describes. Credits remain attached to their figure. Unavailable media gets a clear original-source link, and omitted images do not leave dangling gallery headings or anonymous caption lists.

### 5. Refine navigation and small structural presentation details
After extraction fixes, add a compact article outline for sufficiently long stories and roundups, and keep Back/Open original available while the reader scrolls. The observed reader is capped at a 640px internal scroll region; the action row disappears as it scrolls. Test that refinement in both the actual host and fullscreen mode.

Keep the current content width and generous paragraph rhythm as the starting point. Distinguish decks and captions from ordinary paragraphs. Render useful repeated listening links in a compact, wrapping group (Pitchfork's album roundup) while retaining each destination. Decode common named HTML entities fully: the RPS sample visibly retains an accented-letter entity in a person's name.

## Sample register
Each row is a live article clicked in the preview. "Clean body" describes the absence of obvious publisher widgets, not verified completeness.

| # | Source and sample | Main observations |
|---|---|---|
| 1 | [Collider: Mandalorian feature](https://collider.com/the-mandalorian-disney-plus-star-wars-best-small-franchise/) | Biography before lead; five gallery captions duplicated into ten bullets; trailing show card with malformed date |
| 2 | [Polygon: Uncharted essay](https://www.polygon.com/uncharted-lost-legacy-rec-playstation-naughty-dog/) | Good paragraph flow; appended newsletter |
| 3 | [RPS: game-poem essay](https://www.rockpapershotgun.com/the-other-one-jordan-magnusons-game-poem-jam-is-a-fascinating-collection-of-chimeras) | Clean body; missing author; literal accented-letter entity |
| 4 | [Kotaku: archive news](https://kotaku.com/troves-of-unseen-star-wars-material-emerge-online-after-effects-wizards-garage-sale-2000739602) | Glued category labels; social quote fragmented into three blocks; newsletter and six recommendations |
| 5 | [/Film: film review](https://www.slashfilm.com/2276428/behemoth-review-pedro-pascal-tony-gilroy-movie/) | Breadcrumb bullets and duplicate title; useful section headings and rating survive |
| 6 | [IndieWire: awards analysis](https://www.indiewire.com/awards/predictions/behemoth-oscar-chances-pedro-pascal-1235220080/) | Consent copy twice; author name as heading; orphaned widget headings |
| 7 | [Colossal: animation profile](https://www.thisiscolossal.com/2026/10/gaia-alari-animation/) | Duplicate title; no animation; orphaned related heading |
| 8 | [Dezeen: hotel architecture](https://www.dezeen.com/2026/10/03/kimpton-era-hotel-new-york-city-inc/) | Good prose; missing figures; eight trailing topic bullets |
| 9 | [Dezeen: brutalist roundup](https://www.dezeen.com/2026/10/03/brutalist-asia-book-roundup/) | Ten entry labels lose emphasis; no figures; seven trailing topics |
| 10 | [It's Nice That: Formula E branding](https://www.itsnicethat.com/articles/mox-formula-e-graphic-design-project-011026) | Metadata crowds opening; gallery remnants; biography, recommendations, newsletter; missing header author/site |
| 11 | [Bandcamp Daily: electronic roundup](https://daily.bandcamp.com/best-electronic/the-best-electronic-music-on-bandcamp-september-2026) | Clean body and 13 entry headings; missing author/media |
| 12 | [Pitchfork: tour dates](https://pitchfork.com/story/fontaines-dc-plot-2027-north-american-tour/) | Date lines and emphasis collapse into dense prose |
| 13 | [Pitchfork: album roundup](https://pitchfork.com/story/10-new-albums-you-should-listen-to-now-greg-freeman-quavo-victoria-monet/) | Ten entry headings survive; repeated listening links crowd prose; useful correction survives |
| 14 | [Stereogum: concert news](https://stereogum.com/2513514/mike-patton-performs-with-mariachi-gama-1000-for-mondo-canes-mexico-debut/news/) | Duplicate title; missing author/site; no footage fallback; tags/newsletter/recommendations |
| 15 | [Polygon: Witcher news](https://www.polygon.com/the-witcher-season-5-when-release-date-netflix/) | Relatively clean header, paragraphs, and subheading |
| 16 | [RPS: weekend column](https://www.rockpapershotgun.com/what-are-we-all-playing-this-weekend-402) | Clean body; contributor names lose differentiation; missing author |
| 17 | [IndieWire: long film review](https://www.indiewire.com/criticism/movies/behemoth-movie-review-pedro-pascal-1235220030/) | Same consent/header pollution; review grade survives |
| 18 | [Colossal: photography awards](https://www.thisiscolossal.com/2026/10/comedy-wildlife-awards-2026-finalists/) | Missing gallery and captions; orphaned related heading |
| 19 | [It's Nice That: illustration profile](https://www.itsnicethat.com/articles/sandy-christ-illustration-discover-011026) | Metadata/tags before lead; repeated image captions; author/recommendation/newsletter tail |
| 20 | [Bandcamp Daily: short album review](https://daily.bandcamp.com/album-of-the-day/stef-chura-dancing-alone-on-the-concrete-review) | Clean four-paragraph body; missing author/player |

## Code targets
- `src/adapters/reader.ts`: candidate/body selection, header deduplication, metadata, inline marks, breaks, lists, and figures. Preferred-zone selection and exact title comparison are around lines 281–292; metadata resolution is around line 310.
- `src/lib/text.ts`: bounded, complete entity decoding.
- `src/types.ts` and `src/tools/results.ts`: backward-compatible optional metadata, marks, list and media structure.
- `src/ui/room/reader.js`: marks, semantic lists, figures/media fallback, metadata header, and compact listening links.
- `src/ui/room/room.css`: caption/deck treatment, persistent reader controls, and outline layout.
- `test/adapters.test.ts` and `test/ui-browser.test.ts`: representative sanitized structural regressions and real-reader verification for the implementation work.

## Evidence
Screenshots: [IndieWire opening](reader-audit-2026-10-03/indiewire-reader.jpg), [Pitchfork tour dates](reader-audit-2026-10-03/pitchfork-tour-reader.jpg), [It's Nice That metadata](reader-audit-2026-10-03/its-nice-that-reader.jpg), [/Film duplicate title](reader-audit-2026-10-03/slashfilm-reader.jpg), [Collider opening](reader-audit-2026-10-03/collider-reader-top.jpg), [Collider gallery](reader-audit-2026-10-03/collider-reader-gallery.jpg), [Collider tail](reader-audit-2026-10-03/collider-reader-tail.jpg).

[Per-sample block counts and metadata](reader-audit-2026-10-03/sample-summary.json).
