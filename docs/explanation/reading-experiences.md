# Reading experiences

MCPortal brings the material already in a room into views for finding, understanding and finishing a bounded amount of reading. Source material and agent interpretation remain visibly separate.

## Find and keep

**Recall Shelf** searches saved links, retained clip text and reading history together. Filters cover kind, site, tags and reading status. Results distinguish retained material from links that must be fetched again. Kept passages carry locators: reopening highlights an exact, unique text match; changed or ambiguous passages show a notice rather than guessing.

**Topic Desks** are private collections of links, clips, personal notes and selected live portals. Agent orientations are explicit requests, labeled as agent writing and tied to evidence refs. Removing membership never removes the underlying saved item or clip. Missing sources remain visible for repair.

**Comparison** shows two or three sources in independently scrolling panes, with compact source tabs on narrow screens. Evidence passages and dated fetch information sit beside a separately labeled agent interpretation. Saving a comparison makes it a private collection. A missing source keeps the comparison editable.

**Reading trails** reuse collections with ordered steps, finish, skip and undo. Finishing a trail step does not mark the original article read.

## Read in the room

A portal can use its default presentation, list, cards, quotes, gallery or a structured GitHub release changelog when that source supports it. Unsupported preferences fall back visibly. Changing presentation preserves source configuration and room placement.

**Catch-up** captures at most 30 unseen stories from selected portals into a finite session. The captured set survives refresh, process restart and another linked device. Source failures are shown. Finishing or ending acknowledges only captured items in existing portals; it never marks an article read. New arrivals wait for another session.

The seven reading tabs use custom icons from the house set. Wide screens pair icons and labels; below 640px they use icons with accessible names and tooltips. Targets remain at least 44px tall. The selected tab uses a short underline; keyboard focus has its own visible outline.

## Changes and Upcoming

Reading watches are distinct from on-demand Shopify store follows. `watch_reading` manages pages, repository releases, public iCalendar URLs and confirmed Ticketmaster artist identities. The existing `watch`/`unwatch` tools continue to manage stores.

**Changes** retains dated, bounded text differences and availability problems. A failed request preserves the last successful baseline. Acknowledging a finding changes its unread state; asking an agent to explain it is a separate action.

**Upcoming** sorts real events by date and explicit timezone. Calendar entries can use UTC, an IANA zone, date-only dates or floating dates with a supplied fallback zone. Recurrence rules and ambiguous DST times are visibly omitted. Provider absence does not imply cancellation. Reschedules and cancellation updates project onto saved event metadata; past saved events remain saved.

Artist discovery needs the server's `TICKETMASTER_API_KEY`. The user selects a resolved artist and supplies city/country; no precise location is requested. Provider requests are bounded, cached and rate limited. Without a key, calendar watches remain available and artist lookup says it is unavailable.

A background worker checks due reading watches every six hours, with durable leases, retries and overdue status. Local workers pause while signed in to hosted state; linked clients use the hosted watch operation. Suspended accounts are skipped. No model runs in the worker.

## State and limits

Collections and reading experience state belong to the caller. Files and PostgreSQL use atomic updates and revisions. Linked methods enforce authenticated ownership. Account deletion removes both stores. Full exports include them; additive imports remap clip and portal refs, preserve unavailable references visibly and pause imported watches for review. Private collections and watch state never enter public Spaces.

| State | Limit |
|---|---|
| Collections | 50 per account; 200 entries and 8 live portals each; 256 KB each |
| Orientations / passages | 16,000 characters / 2,000 characters |
| Catch-up | 30 captured stories; 256 KB |
| Reading watches | 20 per account; 100 dated events per watch |
| Findings | 40 retained for 30 days; scheduled retention includes paused watches |
| Baseline / diff | 24,000 / 12,000 characters; bounded line comparison |
| Reading experience document | 2 MB |
| Full import upload | 80 MB |

The agent tools are `search_library`, `open_collection`, `update_collection`, `show_comparison` and `watch_reading`. `catch_up` is app-only. Collection evidence refs use `clip:ID` or `url:URL`.

## Automatic Space sections

An owner can preview eligible public room subscriptions and people followed on MCPortal, then enable each list independently for signed-in visitors. Optional pins, order and hides do not alter subscriptions or follows. Previously published recommendations retain their order and visibility; private curation never enters visitor responses. New automatic sources are checked without credentials, and private integrations, saved content, clips, local addresses and unrecognized secret feed URLs are excluded.

These automatic lists are currently part of the signed-in Space view. Public web pages keep the explicitly published recommendations and authored traveler list.
