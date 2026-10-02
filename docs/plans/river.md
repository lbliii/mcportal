# Plan: the river, one stream across the room

Status: phases 1–3 built, 2026-10-02. Builds on [room-layouts.md](room-layouts.md) (layout
registry, item forms, editions, portal level) and comes before reblogging. Research:
[Feed and grid design lessons](../../reports/Feed%20and%20grid%20design%20lessons.md),
[River and reblog design research](../../reports/River%20and%20reblog%20design%20research.md).

## Goal

Columns, shelves and the front page all show the room *by portal*: each source is a
block, ranked inside itself. The river shows the room *as one stream*: every portal's
items merged into a single column you scroll down, newest and unseen first, each card
saying where it came from. It's the Tumblr dashboard or Reddit home feed of your own
sources, for when you want to wander rather than survey.

It is also where reblogging will live. A reblog only feels like Tumblr when your
follows' reblogs arrive in the same stream as your sources, with a reblog button on
every card. This plan builds the stream and leaves a slot for that action; the reblog
plan fills it.

The product map listed `river` as a per-portal view ("several sources merged into one
timeline"). This plan makes it a room layout instead and drops the per-portal view: once
the whole room can be a river, a portal that merges sources adds little.

## Principles

The room-layouts principles hold. What they mean here:

1. **Additive.** `river` is a fourth entry in `ROOM_LAYOUTS`, drawing the same profile
   and the same `open_room` data. No new tools, no migration, one click back.
2. **Explainable order, never an algorithm.** The order can be said in one sentence:
   *the agent's picks, then what's new, then what you've seen; each source in its own
   order, merged by time.* No engagement scores, no cross-source score blending (HN
   points, Reddit votes and blogs' nothing can't be compared honestly).
3. **Provenance on every card.** Without portal blocks, the card carries its portal: dot,
   title, and for Following, who shared it. Clicking the portal name opens the portal
   level, so the places are always one step away.
4. **No source drowns another.** A busy subreddit must not bury a weekly blog. Runs from
   one portal fold.
5. **Inline, the chat owns scrolling.** The river pages ("10 more") and ends ("You're
   caught up"). Nothing scrolls inside it. Fullscreen may load the next page as you
   approach the end, still without an inner scroller.

## Order

All in the client, from `state.portals`, `state.edition` and `state.lead`, which
`open_room` already returns.

1. **Picks.** The edition's lead and picks (`frontStories()`, shared with the front
   page), each with its "Why this", as a labelled block. Not repeated below, and never
   blended into the time order: GitHub's relevance-sorted feed was reverted to
   chronological in February 2025 after users said it got in the way of daily work.
2. **New.** Items marked `new`, merged across portals (below).
3. **A divider:** "You're caught up. Earlier from your portals." Shown only when there
   is something on both sides. It comes from the per-item seen sets (`src/seen.ts`), not
   a scroll offset: inline, the host owns the scroll position, and a single
   "last read" marker (Mastodon's) fits one timeline better than a merge whose sources
   reorder themselves.
4. **Seen.** The rest, merged the same way.

**The merge.** Each portal is a queue in its own order (HN's rank, a feed's order, the
newest-first of Saved and Following). Repeatedly take the head of whichever queue has
the newest head, by `publishedAt`. That keeps each source's own ranking intact while the
stream as a whole reads newest-first. An item with no date takes the date of the item
before it in its portal, or the portal's `fetchedAt` if it's first.

**What's left out.** Docs portals (tables of contents, not posts) and pinned portals
(agent-arranged data with no time) don't join the stream. The end of the river names
them: "Also in your room: Python docs, Release radar", each opening its portal level.
Portals with an error show one line at the top ("Signal lost: r/design. Retry").

**Duplicates.** The same URL from two portals (HN and a blog's feed) appears once, at
its first position, with both portals named ("Simon Willison · also on Hacker News"), as
NewsBlur's story clusters do. Match on the normalized URL across everything the river
holds this visit, including seen items, not within a fixed window: Mastodon's 40-item
window lets duplicates through. A copy that arrives later joins the earlier card's
"also on" tail instead of becoming a card.

## Folding

After merging, a run of more than **3** consecutive cards from one portal folds the rest
of that run into one row: "**7 more from r/programming**". Clicking it expands the run in
place (no reload, focus moves to the first revealed card). Folded new items still count
in the head's "N new". They're marked seen only when they're on screen, so folding never
hides news.

A fold row counts as **one** unit when paging, and what's expanded survives redraws.
Mastodon's hidden boosts still used page slots, so timelines looked empty; pages here count
what the reader sees.

Later, if one source still dominates, add a per-portal **quiet** setting with three levels:
normal, quiet (folds after 1, like Tapestry's Muffle) and out of the river (still in the
room, like Reeder's hide-from-Home). That's a portal config field, set from the card's
overflow menu ("Quiet this portal") or by the agent with `arrange_room`. Not in the first
cut.

## The card: a new item form, `story`

`renderItem(item, portal, 'story', look)` joins `row`, `tile` and `lead` in
`room/items.js` (named `story`, not `post`: Space posts already use `.post`). Top to bottom:

- **Context row,** only for Following: "@handle shared" (later "@handle reblogged"), muted,
  on its own line above the from line, as Tumblr, Mastodon and Bluesky place social
  context. Names are stored as plain text so the card survives a deleted account.
- **From line:** portal dot and title (a button that opens the portal level), the time.
  For a duplicate: "· also on …".
- **Picture across** when the item has a `thumb` (lazy, through `get_thumbnails` like
  everything else), in a box reserved at 1.91:1 (the link-card ratio Bluesky moved to in
  2024) so nothing shifts as it loads. Never cropped to a face guess, no site logos. A
  video gets the play mark. No picture, no empty box.
- **Title**, larger than a row's; **summary** up to 4 lines, held to about 34em (roughly
  70 characters a line); a share's note set apart
  in the share's voice.
- **Why this**, for picks.
- **Actions:** points and comments (as `compactMeta` draws them), open the original,
  save, share, and an overflow menu (quiet this portal, open the portal). The **reblog**
  button goes here later; until then "share" is offered on every card that has a URL, not
  only Saved (it saves then opens the composer).
- **Keys:** j/k move between cards, o opens, s saves, b reblogs later (Mastodon's set).

Cards are separated by thin rules, not boxes: closer to a printed page, and denser.

One content-opening button per card, actions beside it, never inside it (the form rule
from room-layouts). The stream is one reading column, max about 640px, centred in fullscreen;
under 600px they go edge to edge.

## Paging and end states

- **Inline:** the first page is the picks plus **10** units (a card or a fold row);
  "10 more" appends the next page. After 3 pages the button also offers "Open the full
  river" (fullscreen). The iframe grows; the host's `maxHeight` is respected as on the
  front page.
- **Height, every time.** After each page, fold expansion, pill redraw or late picture,
  send `size-changed` *and* set `document.documentElement.style.height`: Claude.ai has
  been reported to ignore the message and read the page's height (claude-ai-mcp issue
  #69). Never `100vh`.
- **Fullscreen:** pages of 20, and an `IntersectionObserver` on the last card loads the
  next one as it nears the viewport, at most 2 times; then the button. Google dropped
  continuous scroll in 2024, and the EU's 2026 findings against TikTok and Meta name
  infinite scroll. "More" stays the keyboard and reduced-motion path.
- **Semantics:** the stream is `role="feed"` of `article`s with `aria-busy` while a page
  loads; after "10 more", focus moves to a separator that reads "Stories 11 to 20" (the
  BBC GEL load-more pattern).
- **The end:** "You're caught up" when the new section is exhausted and nothing seen
  remains, else "That's everything your portals fetched." Then the "Also in your room"
  line. A refresh button sits beside it.
- **Refresh while reading:** new items arriving after a portal refresh don't reshuffle
  what's on screen. A pill at the top says "4 new since you started" and, when clicked,
  redraws the river at the top. (Places don't move.) Check for new items when the river
  opens or the page regains focus, not on a timer: WCAG 2.2.2 asks for a way to pause
  auto-updating news, and none is needed if nothing polls.

## Agent surface

- `river` joins `LAYOUTS` and `LABS`; `arrange_room` and `build_room` offer it only with
  the lab on (as `frontpage`). Footprint ceilings move by one enum word when the lab is
  on, none when off.
- When reblogging arrives, its tool applies the same audience and consent checks as the
  button, and asks before reblogging something the user hasn't opened (Twitter's 2020
  read-before-retweet prompt raised article opens 40%).
- `open_room`'s text for the model doesn't change: the agent still sees portals, counts
  and the edition. Picks lead the river exactly as they lead the front page, so
  `show_highlights` needs no change.

## Phases

### 1. Layout, merge, card

`river` in `LAYOUTS`, `LABS` (`MCPORTAL_LABS=river`) and `offeredLayouts`; an icon in
`scripts/brand.ts`; the toolbar button, hidden by the lab like the front page's. In
`room/layouts.js`: `river: { gridClass: 'river', draw, portal }`, where `portal(id)`
redraws the whole river (a single portal's refresh can move cards anywhere) but keeps
what's expanded and how many pages are shown. The `post` form in `room/items.js`. The
merge, dedupe and folding as plain functions in a new `room/river.js`.

Tests: `arrange.test.ts` for the enum and lab; a browser test that loads a fixture room
in `river`, checks order (picks, new, divider, seen), dedupe, one fold and its expansion,
that a page counts units not items, the feed roles, and that nothing scrolls internally; design preview gets a `river` view at 360/760/1000.

Done. `room/river.js` holds the merge (`riverStories`), folding (`riverUnits`), paging
(`riverPage`) and drawing; layouts gained an optional `redraw` for a layout without
portal blocks, and refreshes and saves go through one `redrawPortal`. Picks show only
when the agent left an edition: the room's fallback lead isn't labelled a pick. Stories
are `article`s in a `role="feed"`, numbered with `aria-posinset`; j/k/o/s work. Paging is
the simple version (10 units a page, "N more of M", focus to the first new story); phase 2
adds the separator, fullscreen loading, the height write and the pill. The toolbar icon is
a column of cards running off the bottom.

### 2. Paging, end states, refresh pill

As above. Browser test: page twice, refresh a portal, check nothing on screen moved and
the pill appears.

Done. The river remembers how many units it shows, not pages, so switching between inline
and fullscreen keeps what's on screen; each later page starts at a focusable separator
("Stories 11 to 20") that "more" sends focus to. Inline, "Open the full river" joins the
button from the third page when the host offers fullscreen. Fullscreen loads the next page
of 20 as the end nears, twice, then asks. The order first drawn is kept (`keepPlaces`):
a refresh or a save updates stories in place, and what's new to the river waits behind
"N new since you started", which redraws from the top. Coming back to the page refreshes
portals past their freshness, at most every 5 minutes; nothing polls. The end says "You're
caught up." when only new stories were left, else "That's everything your portals
fetched.", with a Refresh button. The page height is written after every size change
inline, for every layout (bridge.js), not only the river. `aria-busy` stays false: pages
come from memory, so there's nothing to wait for.

### 3. Following in the stream

Following items already carry `publishedAt` and `share`; give them the "@handle shared"
from line and the share's note. Share from any card. This is the hand-off point for the
reblog plan, which adds reblog chains, the reblog button and "reblogged from" lines to
this form.

Done. A story carries its sharers (`shared`: handle and note, read from a Following
item's "@handle" meta and its summary). A follow's share of a link that's also in a feed
is the feed's story: the feed's copy takes it over at the share's place, so a fresh share
lifts it (as a reblog will), and the context row says "@ana shared" ("@a and @b",
"@a, @b and 2 more") instead of "also on Following". The first sharer's note shows under
the title, set apart in Following's colour with their handle; a Following story's
summary (its note) isn't repeated, nor its "link" kind. Signed in, every story with a
link has a share button: it saves the story if it isn't saved, then opens the composer;
ghost mode shows none. The design preview's `river` view includes two follows' shares.

The reblog icon is already in the set (`reblog` in `scripts/brand.ts`): the repost loop
drawn as a doorway, one arrow along the sill and up the left jamb, the other over the arch
and down the right. Its moon is a state mark (`state: true`), drawn only while the button
is `aria-pressed`, so being reblogged never rests on colour alone. The reblogged colour
gets its own token (`--mp-action-reblogged`, an ink green) rather than reusing
`--mp-status-success`, which sits too close to the link and primary colour.

### 4. Evaluate

Use it daily alongside the front page. Count fold and duplicate expansions, pill clicks
and "Open the full river". Questions to answer: Does folding at 3 feel right?
Is new-first-then-seen better than pure newest-first? Should the river or the front page
be the inline default (room-layouts phase 7 assumed the front page)? Then decide whether
to add **quiet** portals.

## Open questions

- Does a river want a different `openIn` default? Tumblr expands posts in place; ours
  open the reader. Keep the reader for now.
- Should a stream card that's been on screen count as read for `list_new_items`, the
  same as in other layouts? Yes, by the existing `mark_seen` path, but check whether a
  fast scroll marks too much (`SEEN_AFTER` is 1s at half-visible). Folded cards are
  never marked until expanded and seen.
- How many items should a stream fetch? Portals fetch 10 by default; a river of 12
  portals has ~120 items, more than 12 pages once folds count as one. Raise per-portal
  limits only if real use runs out.
- Reblogging (its own plan) starts from the research: reference the original rather than
  copy it, keep a tombstone if it's deleted, record root, via and reblogger, pool the
  credit on the original sharer, one tap with an optional note, author consent controls
  (who can reblog, remove my post), and only one hop deep in the river.
