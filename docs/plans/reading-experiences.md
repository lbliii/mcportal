# MCPortal reading experiences plan

Status: implementation and validation, 8 October 2026. This extends the [delivery roadmap](delivery-roadmap.md) with concrete experiences and implementation slices. Phase sizes are relative, not calendar commitments.

Build Recall Shelf first, Topic Desk second, and Comparison View third. These turn MCPortal's existing sources, reader, clips, and reading history into material people can recover and use. Add specialized portal views alongside that work. Reading trails can then reuse collections; Changes and Upcoming depend on the collection and watch infrastructure already planned.

## Existing foundation

The current repository has columns, shelves, River, an experimental Front Page, docs browsing, article and docs reading positions, Continue Reading, passage actions, clips, saved links, highlights, and reader handoffs. Local files, hosted Postgres, and linked local clients already have storage patterns to extend. These are code capabilities; deployment and host verification remain separate release checks.

Unified retrieval, durable collections, comparisons, per-portal presentation, a collection worker, and event watches need new work. Reading history holds titles, URLs, status, and resume hints; it is not a full article archive. Clips hold retained content, but their source metadata currently has no passage anchor. Highlights reference current feed items and expire, so they cannot serve as durable collection membership.

## Experience sequence

| Order | Experience | First useful version | Relative size | Roadmap connection |
|---|---|---|---|---|
| 1 | Recall Shelf | Search saved links, clips, and reading history together | Medium | Release 2 retrieval |
| 2 | Topic Desk | A durable collection with related live sources and optional agent notes | Medium to large | Release 2 collections |
| 3 | Comparison View | Compare two or three sources with passages and cited agent interpretation | Medium | Release 2 agent questions |
| Alongside 1 to 3 | Portal views | List, cards, quotes, gallery, then changelog | Small to medium per view | Release 4 presentation |
| After continuity checks | Finite catch-up | A bounded session over currently retrieved stories | Small to medium | Release 1 catch-up |
| After Topic Desk | Reading trails | Ordered collection entries with explicit step completion | Medium | Extension of Release 2 |
| After collection worker | Changes panel | Retained baselines, diffs, and a durable watch inbox | Large | Release 3 watches |
| After watch infrastructure | Upcoming | Events by date from watched artists and public calendars | Medium to large | [Concert watches](watches.md) |

Catch-up can ship independently when its continuity checks pass. Small presentation improvements should not hold up retrieval. The first three experiences do not require background collection or a model running inside MCPortal.

## Navigation and presentation

Keep the room as the home surface. Add a Search entry in the toolbar and a Collections entry when the person has a collection. Search opens Recall Shelf; choosing a collection opens its Topic Desk. Preserve the room's layout, scroll position, and any active query when opening a reader and returning.

Comparison opens from a small selection tray in search results or a desk. It is a temporary reading surface until the person keeps the comparison. Trails are an ordered presentation of a collection. Catch-up is a River session with a finish. Changes and Upcoming are portal sources with specialized views.

Use the current design system and renderers. In compact host displays, comparisons show source tabs and a shared evidence list; fullscreen can put sources beside each other. All actions remain accessible without hover or pointer gestures. Host capabilities determine whether an agent action can send a message; the fallback is an explicit copyable request with source references.

## Phase 1 Recall Shelf

User promise: “Find that explanation I kept, and take me back to it.”

One search covers saved-link titles and notes, retained clip text and tags, and reading-history titles and URLs. Filters narrow by kind, site, tag where available, and reading status. Results show why they matched, their source, and whether the content is a quote, personal note, conversation exchange, or link. Preserve available clip provenance without guessing who authored older notes.

Merge a saved link and its reading record by the existing canonical reading URL, retaining both states. Show individual clips separately because two passages from the same page can be useful independently. Do not remove arbitrary query parameters when deduplicating. Results open the clip, docs page, or article through the existing reader routes.

Start with ordinary text retrieval. Reuse Postgres clip relevance and deterministic local matching, then merge result kinds with a documented ranking rule and stable tie breakers. Exact phrase and title matches should outrank weak metadata matches. The implementation must paginate through eligible records or search within each store; scanning only the first page of linked clips or reading history would silently lose results. A normal search must not fetch the web or reread every article.

Add optional passage anchors to newly created quote sources, using the existing heading and block resume approach plus a bounded selected-text hint. Resolve conservatively; if the page changed, open the page or retained quote and explain that the original position is unavailable. Existing clips remain valid.

Acceptance criteria:

- “Heartbeat” retrieves a relevant saved NemoClaw page, quote, and reading record with understandable result labels.
- An older matching item beyond the first linked-store page can be found.
- Opening a result and returning preserves the query, filters, and position.
- New quote results return to the passage when it still resolves; changed pages have a clear fallback.
- Empty queries, removed clips, unavailable pages, and duplicate saved/history records behave predictably.
- Search stays within the caller's data and works with files, Postgres, and a linked local client.

First implementation slice: federated retrieval, one model-and-app search operation, Recall Shelf UI, and existing reader navigation. Add durable quote anchors in the next slice. Related resurfacing follows only after retrieval is useful; keep it dismissible and explain the matching tag or phrase.

## Phase 2 Topic Desk

User promise: “Keep my reading about this subject together.”

A desk has a title, a short purpose, durable kept material, selected live sources, and optional notes. For example, a Local first software desk could hold an introductory article, three saved quotes, relevant docs, and a conversation explanation. Its live section shows current items from explicitly selected room portals; its kept section stays useful after those items leave their feeds.

Create a desk from selected results, or ask the agent to assemble one from material it can actually reference. The agent can draft an orientation with citations to desk entries. Label that orientation as agent-written and record when it was composed. Refresh live items directly through the UI; updating the orientation requires an agent action. Never silently rearrange the room or add subscriptions to create a desk.

Introduce a Collection store outside the layout profile. Entries reference clip IDs or canonical URLs with title and optional passage metadata. Keeping a transient feed item creates a durable collection link record; it does not implicitly consume a Saved slot or archive the full page. Removing an entry only removes membership. A deleted underlying clip becomes unavailable and cannot be reconstructed from a private cached copy.

Live source references name selected portal IDs. If a portal is removed, its live section becomes unavailable and can be reconnected explicitly; kept entries stay. Store personal notes as existing note clips referenced by the collection. Keep agent orientations with their evidence references and creation time, separate from source excerpts.

Proposed initial limits: 50 collections per account, 200 entries and 8 live portals per collection, and a 16 KB orientation. Validate these against export sizes and local-store performance before release. File and Postgres stores, linked API methods, export/import, sign-out copying, and account deletion must all support collections together.

Acceptance criteria:

- Create a desk, add a link and quote, close the chat, and reopen the same desk after a server restart.
- Keep material from a feed, refresh until the item leaves the feed, and still open the kept entry.
- Removing an entry leaves its clip, bookmark, and source subscriptions intact.
- Missing sources and clips are visible without blocking the rest of the desk.
- Citations resolve to actual collection entries; removed evidence makes the orientation visibly stale.
- Export/import preserves collections and remaps imported clip references without changing an existing room.

Keep desks private in this phase. Publishing a desk or trail through a Space is separate work because referenced private material needs its own visibility rules.

## Phase 3 Comparison View

User promise: “Help me understand how these sources differ, with the evidence in front of me.”

Select two or three articles, docs pages, or text clips. Open them in a comparison surface with independent positions and source labels. Let the person keep passages under a question such as “How do these approaches handle persistence?” Ordinary reading and passage selection work without an agent turn.

An explicit Ask your agent action sends the question and bounded source material. The agent returns a comparison organized into agreements, differences, and open questions, with citations naming the exact source or retained passage. MCPortal validates citation references and renders the interpretation separately from evidence. A valid reference verifies where a citation points; it does not prove the agent's conclusion is correct.

Start comparisons as temporary UI state. Keep comparison saves the question, selected evidence, and interpretation as a collection-backed record. Retained excerpts have explicit size limits and collection quotas. Source URLs and fetched times remain visible so revisiting an old comparison does not imply that live pages still say the same thing.

Acceptance criteria:

- Compare two docs pages, move between evidence and interpretation, and return to both reading positions.
- No interpretation appears until the user requests an agent action or an agent explicitly supplies one.
- Unknown evidence references are rejected; missing or inaccessible pages remain visible as missing evidence.
- A kept comparison survives restart and export/import without depending on an expired edition or handoff.
- Compact and fullscreen layouts preserve the selection and have usable keyboard navigation.

## Portal views

Add an optional validated `view` preference to each portal. Missing preferences preserve today's layout-dependent rendering. The room layout continues to arrange portals; views decide how an individual portal presents its material.

| View | First supported material | Behavior |
|---|---|---|
| List | All existing item sources | Current rows |
| Cards | All existing item sources | Current cards adapted to the available width |
| Quotes | Quote clips | Retained quote, attribution, source link, and tags |
| Gallery | Items with images and image clips | Pictures with accessible titles and existing open/save actions |
| Changelog | GitHub releases | Group by repository, show release date and version from adapter data |

Define supported source and layout combinations before exposing choices. Unsupported combinations fall back visibly to the default. Gallery keeps usable placeholders for missing images. Changelog should first use structured release metadata; generic RSS releases need an explicit mapping before they can use the same view reliably. A view change cannot change source settings or move a portal.

Ship the preference contract and one useful view first, then extend the registry. Verify preference round trips, old profiles, linked clients, narrow columns, and picture-free sources. Older clients must preserve unknown preferences or refuse incompatible writes rather than drop them.

## Finite catch up and reading trails

Catch-up freezes a candidate set from currently retrieved unseen stories when the session starts. Offer source filters and a count such as 10 stories, with a rough time estimate only when there is enough information. New arrivals wait outside the session. Save, skip, and finish are direct UI actions. Finishing acknowledges only the captured set and never marks articles read; refresh and server restart preserve the active session. Show which sources failed to load and that coverage is limited to retrieved items.

Trails reuse ordered collection membership. Each step has a link or clip, an optional reason to read it, and explicit completion. Reading position resumes through the existing reader, while finishing a trail step is its own action. An agent can propose an order and learning goal; the user can reorder or skip steps. Shared trails wait for a later publication model.

## Changes and Upcoming

Build durable item collection, watch subscriptions, a worker, retries, and an inbox according to [Release 3](delivery-roadmap.md#release-3-make-portal-anticipate) before promising unattended updates.

Changes begins with a selected docs page and repository releases. Retain bounded page baselines, show fetch dates and an actual text diff, and optionally ask the agent to explain it. A failed fetch or unreadable page is an availability event, not a content deletion. Separate meaningful source changes from rendering noise. Pause/delete, retention limits, missed-check visibility, deduplication, and export/deletion are release requirements.

Upcoming follows the [concert watch plan](watches.md): coarse location, resolved artist identities, verified providers, and date-based items. Add public venue calendars after the first event adapter works. Dates render in an explicit timezone, cancellations and reschedules are updates, and past saved events remain marked as past. Recheck provider terms and host support when implementing integrations.

## Shared engineering work

Use one evidence reference format across search, collections, and comparisons: record kind, stable clip ID or canonical URL, available source metadata, optional passage locator, and origin context. Existing feed highlight hashes remain transient selection references; resolve them into durable records when keeping material. Durable excerpts must be explicitly kept and bounded, while search indexes should be rebuildable.

Keep retrieval and persistence in MCPortal. The host agent supplies orientations, comparisons, and reading-path proposals. Browse, save, filter, reorder, and refresh should use direct app operations. All new durable stores need the same caller isolation, local/hosted/linked parity, additive import, export, and deletion guarantees as clips and reading history.

Keep the model tool surface small. Add unified search first; reuse existing reader and clip operations. Introduce collection and comparison operations only with their implementation slices, grouping related actions where schemas stay understandable. Apply existing footprint ceilings and tool-selection evaluation to any new model-facing tools.

## Implementation slices and validation

| Slice | Deliverable | Validation that matters |
|---|---|---|
| 1 | Evidence/result contract and unified retrieval | Retrieval fixtures, deterministic paging/ranking, duplicates, caller isolation, linked-store coverage |
| 2 | Recall Shelf and opening results | Browser navigation, preserved query and scroll, docs/article/clip routing, narrow host displays |
| 3 | Quote locators and collection storage | Changed-page fallback, file/Postgres parity, linked round trips, restart, additive import and reference remapping |
| 4 | Topic Desk UI and agent orientation | Kept versus live material, unavailable entries, evidence validation, room layout preservation |
| 5 | Temporary comparison and agent result rendering | Source budgets, failed fetches, citation validation, explicit agent action, compact/fullscreen behavior |
| 6 | Keeping comparisons | Evidence retention limits, reopening, export/import, underlying deletions |
| Independent | First per-portal view and finite catch-up | Compatibility fallback, session cutoff, arrivals held back, explicit completion |
| 7–8 | Trails, watch worker, Changes, Upcoming | Progress persistence, retry/deduplication, timezone and expiry behavior, provider-specific validation |

Run the relevant store, API, portability, and browser suites for each slice, plus typecheck and the design checks for affected surfaces. Verify actual host behavior before claiming an agent action or cross-host continuity works. Avoid spending the first release on broad visual redesign or semantic indexing.

The first milestone is Recall Shelf: keep a relevant page and quote, leave the chat, find both later with “heartbeat,” and resume the page through the appropriate reader. Its search also becomes the selection foundation for desks and comparisons. Evaluate retrieval with expected relevant results, then observe successful reopenings, useful collection revisits, and evidence opened from comparisons. Set usage targets after a small beta establishes a baseline.


## Delivered implementation and boundaries

The implementation now includes all eight experiences, with private Collection and Experience stores in files/Postgres and owner-bound hosted state methods for linked clients. `search_library`, `open_collection`, `update_collection`, `show_comparison`, and `watch` serve the agent; `catch_up` is a direct app operation. Changes and Upcoming can also be ordinary room sources. Orientations and interpretations remain explicit agent output.

Watches check every six hours while the server runs, with durable leases, retries and overdue status; the worker resumes missed checks at startup. Up to 20 watches per account retain the latest 24,000 characters of readable page text or the latest 30 release names/versions/dates. Diff displays are bounded to 12 KB. Forty findings and provider events expire after 30 days; scheduled retention also covers paused watches. Imported watches start paused. Ordinary article fetches are still not archives.

Upcoming supports up to 100 dated events per watch. Public calendars support explicit UTC/IANA zones, date-only entries, floating dates with an explicit fallback zone, and cancellation updates. Recurring rules and ambiguous DST wall times are visibly omitted rather than expanded incorrectly. Artist watches require a server-side `TICKETMASTER_API_KEY`, preview matching attraction identities and filter by city/country; radius-based geographic search remains a later extension. Unknown dates are omitted with a coverage notice. Provider absence is never inferred as cancellation. Saved events remain dated and marked past; known reschedules/cancellations project current metadata onto saved items without background layout writes.

Ticketmaster's [Discovery documentation](https://developer.ticketmaster.com/products-and-docs/apis/discovery/v2/) and [terms](https://developer.ticketmaster.com/support/terms-of-use/) were reviewed on 8 October 2026. Public requests share an hourly cache, are serialized at no more than four per second and have a 4,500-request per-process daily allowance. Deployments with multiple replicas must provision provider quota per replica or use a shared provider gateway; failures remain visible and retry later. The key never enters UI data, exports or logs. Calendar parsing follows the explicit dates and status properties in [RFC 5545](https://www.rfc-editor.org/info/rfc5545/).

Release preparation still uses the repository release script; implementation does not change package versions or deploy the hosted service. Live host checks and a configured event-provider check are separate from fixture-backed Chrome, linked-account and Postgres validation.


## Validation record — 8 October 2026

- `npm run check` passed: server/UI type checks, generated design/distribution and tool-footprint gates, offline tool-selection contracts, and the full suite (417 tests, 392 passed, 25 environment-dependent skips, no failures).
- A separate temporary Postgres run passed all 14 database tests, including collection concurrency, experience migration, revisions and watch leases.
- Supplemental Chrome tests passed passage recovery after text moved, duplicate/changed-text fallback, quote/gallery/changelog presentations at 320 pixels, and repair after removing a comparison source. The final UI adjustment also passed typecheck.
- The live smoke check passed populated Hacker News, GitHub, RSS and article-reader sources plus structured repository release metadata.
- The review preview uses isolated fictional data: `node scripts/reading-demo.ts`. Host bridge behavior is exercised through the browser harness; a real host installation and live Ticketmaster credentials were not available for this validation.
