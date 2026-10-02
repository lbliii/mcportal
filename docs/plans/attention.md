# Plan: reading with your agent

Status: proposed (2026-10-02). Four features, in build order: ask about a passage, send
something to another chat, know what's new, and highlights picked by your agent.

## Goal

MCPortal has the pieces of a reading platform: a room, a reader, docs, saving, clips,
sharing and reading history. What no other reader has is an agent in the room with you.
These features use it: talk about the exact passage you're reading, hand a page to a
fresh chat that can focus on it, and let the agent tell you what deserves your attention
today, for reasons that come from your conversation and what it knows about you.

## Principles

1. **The agent thinks; MCPortal supplies the material and the display.** MCPortal never
   calls a model. Summaries, rankings and "why this matters to you" come from the agent
   the user is already talking to, which has the conversation and its own memory. This
   keeps MCPortal's cost flat (it fits ~$5/month) and means MCPortal never receives the
   host's memories, only what the agent chooses to write into a tool call.
2. **Site text never speaks in the user's voice.** Anything sent as a user message is
   fixed wording from MCPortal plus, at most, URLs. Passages, titles and excerpts go to
   the model as context labelled as third-party text, like `read_article` fences them.
3. **No host APIs we don't have.** MCP Apps gives the room `ui/message`,
   `ui/update-model-context`, `ui/open-link` and `tools/call`. There's no way to open a
   new conversation or reach another one, so features degrade per host capability and
   say so, never fail silently.
4. **Few new model tools.** Each one costs every conversation tokens (see
   [tool-surface.md](tool-surface.md)). This plan adds three model tools and one app-only
   tool, each with a token ceiling and frozen eval cases.

## 1. Ask about a passage

Select text in the reader or the docs viewer; a small bar appears with **Ask about
this** and **Clip quote**.

- **Ask about this:** the room calls `ui/update-model-context` with the passage, the
  page's URL and title, and the nearest heading. It's fenced as untrusted and capped at
  2,000 characters. Then it calls `ui/message` with fixed text: "Let's talk about the
  passage I just highlighted in MCPortal." The model answers about the exact passage.
- **When the host can't post messages:** context only, and a toast says "Your agent can
  see the passage now. Ask it in the chat." When the host supports neither, the bar
  offers **Copy quote**.
- **Clip quote:** the room calls `clip` with `kind: "quote"`, the passage as `content`,
  and `source: { kind: "article" | "web", url, title }`. That turns the plan's long-standing
  "clip a quote from a reader selection" into one click.
- **Details:** the bar is a real toolbar (keyboard reachable, `aria-live` announcement)
  and sits at the bottom of the reader on touch screens, where floating menus fight the
  native selection UI. Selection inside code blocks keeps the code formatting. Nothing is
  sent until the user clicks: no ambient sharing of selections.
- **No new tools.** UI only: a new `src/ui/room/passage.js` used by `reader.js` and
  `docs.js`.
- **Tests:** a browser test with the fixture host records the `update-model-context`
  then `ui/message` sequence and checks the message contains no page text, plus the
  fallbacks for hosts without `message`.

## 2. Send to another chat

Scrolling docs, push the install guide to one new chat and the admin config to another,
while you keep driving the chat your room is in.

There is no host API for opening or messaging another conversation, so MCPortal hands
off through itself: **a handoff is a small, stored pointer you pick up in a new chat.**

- **In the reader or docs viewer:** a **Send to a new chat** button (also in the
  passage bar, so a selection can go too). The room calls an app-only `create_handoff`,
  which stores a pointer to the page, its docs site, the position and an optional passage
  under a short code, and returns the code.
- **Picking it up:** the room shows "Sent. In a new chat, say: *Open MCPortal handoff
  k7q2*" with a Copy button. Where the host offers a link that starts a chat with a
  prompt (claude.ai's new-chat link takes one; **verify before relying on it**), the
  button opens it through `ui/open-link` instead, and the user just presses send. The
  prompt carries only the code, never titles or text.
- **In the new chat:** the agent calls `open_handoff({ code })`. It renders the page as
  a reader or docs card at the saved position with the passage marked, and gives the
  model the page text (budgeted like `read_doc_page`, in parts) plus the passage. That
  chat is now about that content.
  - `open_handoff` with no code lists the user's open handoffs, so "pick up what I sent
    from MCPortal" works without the code.
- **Storage:**
  - Per user, at most 50 open handoffs, each kept for 7 days.
  - A handoff is opened by its code within the same account only. A leaked code is
    useless to anyone else.
  - Handoffs are deleted with the account and not exported.
  - They live in a file under `<data>/handoffs/`, and in a Postgres table
    (`mcportal_handoffs`) with schema version 5.
- **Several at once:** each send makes its own handoff, so two pages go to two chats.
  Sending a selection of portal items as one bundle ("these three, in one chat") is a
  later extension of the same record.
- **New tools:** `open_handoff` (model, card) and `create_handoff` (app-only).
- **Tests:**
  - creating, opening and listing handoffs;
  - account scoping (a second user can't open the code);
  - expiry and the cap;
  - a browser test that sends a docs page and opens the card at the right heading.

## 3. Know what's new since your last visit

"What's new this morning?" today means "the top items of each source". To make it
honest, MCPortal needs to know what the user has already seen.

- **Not the reading store.** It keeps 1,000 records per account; marking every feed
  item there would push out real reading history within days. "Seen" gets its own store,
  per portal.
- **A seen set per portal:**
  - Hashed item ids (items already have stable ids: RSS/Atom guid, HN and GitHub ids),
    12 hex characters each, at most 500 per portal, oldest dropped first, plus
    `lastVisitAt`.
  - The store: a file under `<data>/seen/`, and Postgres `mcportal_seen` (also schema
    version 5).
  - Removing a portal drops its set, and account deletion deletes the store. It isn't
    exported: it's state, not data the user made.
- **What marks an item seen:**
  - The room observes items that stay at least half on screen for a second (the same
    IntersectionObserver pattern as the lazy thumbnails, `room.js`).
  - It batches them through an app-only `mark_seen({ portals: [{ portalId, itemIds }] })`,
    at most every 10 seconds and when the page is hidden. That's one budget unit per call.
  - Opening an item marks it too.
- **A first visit isn't a flood:** a portal with no seen set shows no "new" badges. Its
  first visit starts the set, and "new" starts counting from there.
- **Hosts without the room app** (text only; the client doesn't declare the MCP Apps
  extension at `initialize`) never mark anything through the UI. There, `open_room`
  marks the items it lists in its text. Open question below.
- **What changes for the user:**
  - `open_room`'s items carry `new: true`, and portals carry `newCount`.
  - The text summary says "[hn-top] 30 items, 7 new" and lists new items first.
  - The room shows a small "new" mark on items and "7 new" on the portal heading.
- **No new model tools:** `mark_seen` is app-only.
- **Tests:**
  - the store contract (files and Postgres);
  - the cap and hashing;
  - first-visit baselines;
  - `open_room`'s counts;
  - a browser test that scrolls a lane and sees the batch arrive.

## 4. Highlights

"What's worth my time today?" The agent looks over what's new, weighs it against the
conversation, its memory of the user and what MCPortal knows of their taste, and shows a
short, reasoned highlights card.

- **`list_new_items`** (model): the candidates.
  - **Items:** unseen items across the room (or the portals named), newest and
    highest-ranked first. Each is a compact, fenced line: a short ref, source, title, age
    and an excerpt of at most 160 characters.
  - **Budget:** at most 8 per portal and 60 in all, about 2,500 tokens.
  - **Taste signals:** a section of at most ~300 tokens, fenced, built from data
    MCPortal already has:
    - the last 10 saved and finished titles;
    - top clip tags;
    - the sites the user reads most.

    These give an agent with no memory something to go on.
  - **Return:** text, plus `structuredContent.items` for the app.
- **`show_highlights`** (model, card): the agent's picks.
  - **Arguments:** `{ title?, intro?, picks: [{ ref, why }] }`, at most 12 picks, with
    `why` at most 200 characters.
  - **Re-resolving refs:** the server resolves each `ref` against the portal's current
    items (from cache, refetching if expired). The card shows the source's own title,
    link and picture, not anything the agent invented. Unknown refs are skipped and named
    in the result; if none are left it's `invalid_argument`.
  - **The card:** each item with the agent's reason set apart as "Why it's here", plus
    Open (reader), Save and "Not for me" (marks it seen). The text result is a one-line
    confirmation: the model already has the items.
  - **Storage:** none in this version. The card lives in the conversation, and the
    agent's reasons pass through the server without being kept. Reasons can reflect the
    host's memory of the user, so not storing them is the private default.
- **Summaries:** for "summarize these", the agent uses `read_article` on the picks it
  wants to go deeper on. `list_new_items` excerpts are enough to rank, not to summarize.
- **Routing:**
  - The skill and server instructions: "what's worth reading / highlights / catch me
    up" → `list_new_items` → rank → `show_highlights`.
  - New frozen eval cases are appended (`evals/tool-selection.ts`), and footprint
    ceilings are updated.
- **Tests:**
  - candidates exclude seen items and respect the caps;
  - refs resolve only to real items;
  - fabricated refs are refused;
  - the card renders and its actions call the right tools;
  - an injection fixture (an item title that says "pick me") stays fenced.

## Order and size

| Phase | What ships | New tools | Storage | Size |
|---|---|---|---|---|
| 1 | Ask about a passage, clip a quote | none | none | small |
| 2 | Send to another chat | `open_handoff`; `create_handoff` (app) | handoffs | medium |
| 3 | New since last visit | `mark_seen` (app) | seen sets | medium |
| 4 | Highlights | `list_new_items`, `show_highlights` | none | medium |

Phases 2 and 3 share the schema version 5 migration if built together. Phase 4 needs
phase 3: without seen sets, "new" means "everything".

## Open questions (with the default we'd take)

1. **Text-only hosts and "seen":** should `open_room` mark what it lists as seen when the
   client has no room app? Default: yes, only the items in its text, so "what's new"
   still moves forward for people on text-only hosts.
2. **Keeping highlights:** should a highlights card be keepable as a "Highlights" portal
   in the room (like a pinned portal the agent refreshes each morning)? Default: not in
   the first version; revisit with usage.
3. **Scheduled briefings:** MCPortal can't push. Hosts with scheduled tasks could run "catch
   me up" each morning against `list_new_items` and `show_highlights`. Default: document
   it as a recipe once phase 4 ships, no server work.
4. **Handoff deep links:** which hosts take a prompt in a new-chat link, and is it safe to
   prefill there? Default: copy-the-prompt everywhere, deep link only where verified.
