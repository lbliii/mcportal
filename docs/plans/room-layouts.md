# Plan: room layouts, hierarchy and navigation

Status: proposed, 2026-10-02. Research: [Feed and grid design lessons](../../reports/Feed%20and%20grid%20design%20lessons.md).

## Goal

Items in the room all read equal, and inline the room puts two scroll axes inside the
chat's third. This plan gives the room rank (what's new, what the agent picked, what
leads), a third layout built for the chat column (the **front page**), three discrete
zoom levels (room → portal → item), and inline scrolling that never traps the chat.
Columns and shelves stay exactly as they are until the new layout earns the default.

## Principles

1. **Layouts are additive.** A layout is a renderer over the same room data (the
   profile's ordered columns of portals). Adding one never changes or removes another;
   a user can switch back at any time with the toolbar or `arrange_room`.
2. **The agent ranks; the room displays.** MCPortal still never calls a model. Picks and
   reasons come from `show_highlights`; without them the room uses a plain, explainable
   fallback (unseen first, then the source's own order).
3. **Places don't move.** Portals keep their order in every layout. Only the top of the
   front page (lead and picks) changes from visit to visit.
4. **Inline, the chat owns vertical scrolling.** No element inside the inline room
   scrolls on its own; more content is paged ("next 5") or one zoom level down.
   Fullscreen may keep the lane, with visible previous/next controls.
5. **Lists for reading, size for importance.** No masonry. Sizes come from a few fixed
   card forms, never from content height.
6. **Motion is orientation, not decoration.** Level changes animate with View
   Transitions where available; reduced motion and unsupported hosts switch instantly.

## Versioning layouts

What exists today makes this cheap:

- `Profile.layout` is a named enum (`LAYOUTS` in `src/profile.ts`), validated with a
  fallback to `columns`. A new value is an additive change; old profiles stay valid.
- The portal structure (`columns[].panels[]`) is layout-neutral, so the front page reads
  the same order and nothing is migrated.

What to add:

- **A layout registry in the client.** Each layout is a module
  (`room/layouts/columns.js`, `shelves.js`, `frontpage.js`) with the same contract:
  `render(profile, portals, ctx) → Node`. `drawLayout` picks one by name. Today the
  choice is `shelves ? … : …` inside `drawLayout` and again inside `renderPortal`.
- **Derive enums from `LAYOUTS`.** `build_room` and `arrange_room` hard-code
  `['columns', 'shelves']` in their schemas; generate them from `LAYOUTS`.
- **Labs gate.** `frontpage` is accepted by validation from the start but only offered
  in the toolbar and tool schemas when `MCPORTAL_LABS=frontpage` (env) or the account
  has labs on. Turning it off falls a profile back to its previous layout, kept in
  `previousLayout`.
- **Layout per display mode.** The research points to the front page inline and columns
  in fullscreen. Add optional `inlineLayout` (default: same as `layout`) so a user can
  have both; profile `version` stays 1 because both fields are optional.
- **Code rollback.** Tag `room-layouts-baseline` on `main` before phase 2, and keep the
  design-preview screenshots of columns and shelves from phase 0 as the visual record.

## Do we have the bones?

**Solid:**

- Tokens: typed DTCG source, generated CSS/JS/TS, drift checks (`npm run design:check`).
- Theme contract: host inputs validated, contrast repaired, light/dark, forced colours.
- Primitives: icon buttons, segmented switch, controls with 24/44px targets, focus ring.
- Regression host: `scripts/design-preview.ts`, 80 cases across views, widths, themes
  and hostile host inputs, at 200% text.
- Data: `Item.new` (seen sets), `score`, `image.kind`, `video`, `clip.kind`, `share`;
  `list_new_items` and `show_highlights` already give the agent candidates and picks.
- Bridge: size-changed reporting, fullscreen request, capability-gated fallbacks.

**Missing:**

| Gap | Today | Needed |
|---|---|---|
| Component layer | `renderItem`, `renderCard`, `renderPortal`, `renderShelf` are separate functions in `room.js` with a `media` boolean | One item component with named **forms**: `row`, `lead`, `tile`, `quote`, `clip`; one portal-block component with sizes |
| Item form | Implicit (has thumb? is video? is clip?) | `formOf(item, portal)` in the client, from the fields above plus the source; move to the server only if a source needs it |
| Layout registry | Two branches in `drawLayout` | Registry above |
| Picks in the room | Highlights render once as their own card; nothing persists them | Latest **edition** stored per user (picks, reasons, intro, time), returned by `open_room`, expiring after a day or when every pick is seen |
| Lead fallback | None | Deterministic: first unseen item of the first portal with any, else first item |
| Navigation model | View switches by root classes (`article-view`) and hidden flags | A small view state: `{ level: 'room' \| 'portal' \| 'item', portalId?, itemId? }` with back, used by Escape and the back control |
| Portal level | Doesn't exist | A portal filling the frame, paged |
| Transitions | None | `transition(update)` helper: `document.startViewTransition` when supported and motion allowed, else plain update; shared `view-transition-name` per portal and item |
| Paging and end states | Portals scroll internally | "Next 5" pager primitive; "You're caught up" end; section header primitive |
| Inline height | Fixed `--mp-lane-height: 560px` | Content height inline, reported to the host; respect host `maxHeight` when given |
| Regression checks | No layout-specific assertions | Front page and portal level in the matrix at 380/760/1000; an assertion that nothing scrolls internally inline (report-only for columns/shelves until phase 6) |

## Phases

### 0. Baseline

Tag `room-layouts-baseline`. Add 380 and 760 to the preview widths and capture
columns/shelves screenshots inline and fullscreen. Add the nested-scroll assertion in
report-only mode so today's violations are on record.

### 1. Measure the hosts

Fill in the manual certification in [host-compatibility.md](../host-compatibility.md)
for Claude desktop, Claude web, Claude mobile, ChatGPT and Codex: inline width, whether
height is capped (`containerDimensions`), fullscreen support, and whether View
Transitions run in the iframe. These numbers set the front page's breakpoints.

### 2. Component layer (no visual change)

Extract the layout registry, the item component with forms (`row` and `tile` reproduce
today's rows and cards exactly), the portal block, the view state, and the transition
helper. The preview matrix must show no visual difference for columns and shelves.

### 3. Rank

- Unseen styling (weight plus the existing New mark) and "N new" in every portal head.
- Editions: `show_highlights` stores the latest edition (new table `mcportal_editions`,
  schema version 7; memory store alongside). `open_room` returns it with the room and
  tells the agent its age, so it can offer to refresh.
- Lead fallback as above. The agent's lead, when given, wins.
- Tool surface: no new model tools; `show_highlights` gains an optional `lead` ref.
  Eval cases updated per [tool-surface.md](tool-surface.md).

### 4. Front page (labs)

Top to bottom: edition header (date, N new), the lead, up to 3 picks with "why this",
then each portal as a block with its top 2–3 items in its form, then "You're caught up".
One column under 600px, a strict two-column grid above (portal blocks fill left to
right in profile order). Ends at content height; no internal scroll.

### 5. Portal level and transitions

Clicking a portal head (front page, columns or shelves) opens the portal level: the
portal fills the frame, paged five at a time inline, scrolling in fullscreen. Back and
Escape return to the room at the same place. Portal and item get shared transition
names so the block grows into the portal and the row into the reader.

### 6. Inline ergonomics for columns and shelves

Inline only: columns cap each portal at N items with "more" (opens the portal level)
instead of scrolling internally; the lane shows visible previous/next controls and page
dots; shelves use mandatory snap and always-visible arrows. Fullscreen unchanged. Turn
the nested-scroll assertion from report-only to failing.

### 7. Evaluate and default

Use it daily for two weeks with real rooms at real host widths. If it holds up, make
`frontpage` the `inlineLayout` default for new rooms and for rooms whose layout was
never chosen by the user; existing choices are kept. Announce in the changelog with how
to switch back.

## Open questions

- Should a fresh edition be built automatically (the agent calls `list_new_items` on
  `open_room`), or only when the user asks? Automatic costs tokens every open.
- Portal sizes on the front page: equal blocks, or let `arrange_room`'s column width
  (1–4) mean block size?
- Is "N new" enough hierarchy for portals with no agent picks, or do they need a
  per-portal lead too?
