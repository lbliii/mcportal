# Exploration: plates, places where the agent illustrates

An exploration, not a plan of record. It asks how MCPortal can give the agent room to draw (a chart of a watch's prices, a timeline of a story, a diagram of an article's argument) without MCPortal drawing anything itself, and without depending on one host's features.

## The MVP behind the `plates` lab

A thin slice is built to answer one question: does this work in real hosts? It's off unless `MCPORTAL_LABS=plates`.

| Built | Not yet |
|---|---|
| `show_plate`: the four kinds `series` (line or bar, dates or categories), `timeline`, `steps` and `matrix`, validated in `src/plates.ts`, drawn by `src/ui/room/plates.js` as a standalone card | Wells inside desks, comparisons, the reader, watches and Spaces |
| Refs checked like orientations; clip refs show the clip's title, url refs the title from reading history or the address | Keeping a plate (the `plate` clip kind) and bound data that redraws |
| A text form for every kind, returned as the tool's text | `figure` plates (agent SVG or PNG) |
| `get_lens` with `reading_activity`: an `outputSchema`, no `_meta.ui`, a text summary and a ready `lens.plate` for `show_plate` | More lenses (`watch_history`, `upcoming`, `collection_timeline`) |
| Unit tests (`test/plates.test.ts`) and a browser test of every kind | Reading the host's UI capability at `initialize` |

### Running the host test

Run a local MCPortal with the lab on and connect it to each host:

```bash
MCPORTAL_LABS=plates node bin/mcportal.mjs
```

For a desktop host over stdio, put `"env": { "MCPORTAL_LABS": "plates" }` in its MCPortal server entry. For the hosted service, set the variable on a staging deploy, not production.

In each host (ChatGPT with GPT-6, Claude desktop, Codex, Claude Code), ask the same three things and record what happens:

1. "Show me my reading activity for the last eight weeks." Does the host draw `get_lens` itself, call `show_plate` with `lens.plate`, or summarize the text?
2. "Draw a timeline of the posts in my backups desk." Does the agent build a valid `timeline` spec with refs on the first try? How often does validation refuse it, and does it recover from the error message?
3. "Sketch section 3 of this article as steps." Does the plate render in the room, and does the agent's reply match it?

Also note whether `open_room` still shows the room in ChatGPT or gets drawn over. Record results in [issue 144](https://github.com/lbliii/mcportal/issues/144).

## Why now

Hosts are starting to draw their own answers. ChatGPT's GPT-6 "Intelligent UI" (October 2026) builds replies from charts, maps, forms and small tools; Claude can show inline visuals. Neither offers an app a way in: there is no API for adding components to the model's catalogue. The only supported way for an app to show UI in a chat is still [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md), which the room already uses.

Two things follow:

- **The room can crowd the host out.** About a dozen model-visible tools attach `ui://mcportal/room.html`. When a tool asks for the room, the host shows the room and has nothing left to draw. None of our tools declares an `outputSchema`, so a host that wants to draw has to guess what our data means.
- **Most hosts draw nothing.** Claude Code, Codex in a terminal and most coding agents show only a tool's text. Whatever we build has to read well as text first.

So the question isn't "how do we plug into Intelligent UI". It's how MCPortal offers places, and data, that any agent can illustrate, and keeps what's worth keeping.

## The rally, applied to pictures

The test from the [rally](rally.md): what does the agent hand MCPortal, and what does MCPortal hand back?

| | The agent | MCPortal |
|---|---|---|
| Brings | Judgment about what's worth showing, the design of the picture, the words | Real data (prices, dates, reading history, sources), a place for the picture, safe rendering, memory |
| Hands over | A plate: what to show, how, and which evidence it rests on | A rendered plate, its text form, and later the same plate redrawn with fresh data |

MCPortal still never calls a model. A plate bound to MCPortal's own data can redraw itself after the agent has left: the agent designs a price chart once, and the collector keeps it current.

This revises one rule in [reading](../explanation/reading.md#clips): "Saved, not made. MCPortal stores a finished chart or diagram from the chat; it doesn't draw one." The new rule would be **the agent makes, MCPortal frames and keeps.** MCPortal renders only what the agent specified, from a small fixed grammar, and never invents the content.

## Vocabulary

- **Plate:** an illustration the agent places in MCPortal, with a title, a caption, an "agent illustration" label and the evidence it rests on. The word comes from books, where a plate is a full-page illustration, and it fits the paperback and print look. It avoids "view", which already means a portal's presentation (`list`, `cards`, `gallery`…).
- **Spec:** what a plate shows, in MCPortal's grammar (a series, a timeline, a set of steps, a matrix). Specs are data, not markup.
- **Figure:** a plate that is a finished image the agent made (SVG or PNG), shown as an `<img>`, exactly like an image clip today.
- **Binding:** where a spec's numbers come from. **Inline** data is supplied by the agent, frozen and labeled as such. **Bound** data names an MCPortal source (`watch:ID/price`, `reading:activity`) that MCPortal resolves itself, so the numbers are real and stay current.
- **Well:** a place in a surface that can hold a plate: the margin of a reader section, the head of a Topic Desk, a comparison, an edition's cover, a watch, a Space.

## Three mechanisms

They solve different problems, and each one works without the others.

### 1. Data lenses: data shaped for hosts that draw

For hosts that can draw (GPT-6, Claude visuals) give the model clean, schema'd data and stay out of the way: no `_meta.ui`, so the host draws instead of showing the room.

One tool, not one per shape, to keep the tool list short:

```jsonc
// get_lens: read-only, no room UI
{ "lens": "watch_history", "watch": "w_8k2" }
→ structuredContent: {
    "lens": "watch_history",
    "title": "Aesop Resurrection Hand Wash, 500 ml",
    "series": [{ "name": "price", "unit": "USD", "points": [["2026-09-12", 47], ["2026-10-01", 39]] }],
    "events": [{ "at": "2026-10-01", "label": "Sale" }],
    "source": { "url": "https://…", "checkedAt": "2026-10-09T06:00:00Z" }
  }
```

Starting lenses, all from data MCPortal already holds:

| Lens | Shape | Drawn as |
|---|---|---|
| `watch_history` | Time series plus events | A line chart with markers |
| `upcoming` | Dated, placed events | A calendar or a list by city |
| `reading_activity` | Counts by week, source and tag | Bars, a heatmap |
| `collection_timeline` | A Topic Desk's items by date | A timeline |
| `catchup_summary` | A session's stories by portal and outcome | A summary card |

Every lens declares an `outputSchema`, and its text `content` is a readable summary: the last value, the range, the next date. A text-only host loses nothing important.

This mechanism needs no new UI and helps every host. It's the cheapest place to start.

### 2. Plates: wells in MCPortal's own surfaces

For hosts that show the room (Claude desktop, Codex, ChatGPT), give the agent wells inside MCPortal's surfaces and let it fill them. The room renders the spec with its own components and design tokens, so a plate looks like MCPortal, follows the host's theme and keeps the room's safety rules.

```jsonc
// show_plate: model-visible, renders in the room
{
  "well": { "in": "desk", "id": "c_31" },          // or reader/section, comparison, watch, edition, space
  "title": "How the backup debate moved",
  "caption": "Three posts, two weeks: the argument shifted from cost to restore time.",
  "spec": {
    "kind": "timeline",
    "entries": [
      { "at": "2026-09-20", "label": "Cost first", "ref": "url:https://…" },
      { "at": "2026-09-27", "label": "Restore drills", "ref": "clip:k9" },
      { "at": "2026-10-03", "label": "Both, with numbers", "ref": "url:https://…" }
    ]
  },
  "refs": ["url:https://…", "clip:k9"]
}
```

**A first grammar**, small on purpose. Each kind has a defined text form, and no kind ships without one.

| Kind | Holds | Text form |
|---|---|---|
| `series` | Up to 4 named series of up to 500 points; line or bar | A table, plus first, last, min and max |
| `timeline` | Up to 40 dated entries with optional refs | A dated list |
| `steps` | Up to 24 nodes and their edges (a flow or argument map) | Numbered steps with "leads to" |
| `matrix` | Up to 8 × 8 labeled cells (compare sources on criteria) | A markdown table |
| `stat` | Up to 6 labeled numbers with units and change | One line each |
| `figure` | An agent-made SVG or PNG, checked by bytes like image clips | Its caption and alt text |

Maps are left out for now. The room's CSP loads nothing from the network, so there are no map tiles. `upcoming` places can be grouped by city in a list instead.

**Wells**, each building on something that exists:

| Well | Where | What the agent might put there |
|---|---|---|
| Reader margin | Beside a section, anchored by the passage locators the reader already uses | A diagram of the section's argument; a chart redrawn from a table in the article |
| Desk head | Above a Topic Desk, next to its agent orientation | A timeline or a map of the topic |
| Comparison | Beside the interpretation in `show_comparison` | A `matrix` of the sources against the question |
| Edition cover | Atop the room's edition from `show_highlights` | A `stat` or `series` summing up the day |
| Watch | On a watch's findings | A bound `series` of price or availability |
| Space | A frontispiece in a public Space, published only with the owner's approval | A plate kept from any of the above |

**Labels and evidence follow the orientation rules.** A plate is always marked as agent illustration. Refs use the same `clip:ID` and `url:URL` forms and are checked the same way: a ref that names nothing in the user's material is refused. Inline numbers are labeled "supplied by your agent"; bound numbers name their source and when it was checked.

### 3. Kept plates: the agent designs once, MCPortal keeps it current

A shown plate is temporary, like a comparison, until the user asks to keep it. Keeping is the same request as a clip ("keep that"), and the simplest store is a new clip kind, `plate`. Clips already have their own store, search, export, a gallery view and the "only on request" rule.

A kept plate stores its spec and its bindings, never a picture. That's what makes it more than a screenshot:

- **Bound plates refresh without a model.** A kept `watch_history` series redraws from the watch's latest observations whenever it's shown. A kept `reading_activity` chart counts the current week.
- **Any host can show it.** The room renders it; a host that draws gets the spec and data; a text-only host gets the text form.
- **"Show me my concert plate"** works next week in a different chat, or with a different agent.

That covers the "save a view" idea without a separate saved-views feature: a kept, bound plate is the recipe.

## One rule for every host

The plan rests on one order, from the bottom up:

1. **Text** that reads well on its own: every tool, every lens, every plate.
2. **Structured data** with a schema, for hosts that draw.
3. **The room**, for hosts that show MCP Apps.

Two supporting changes:

- **Read what the host says at `initialize`.** MCPortal advertises the UI extension ([mcp.ts](../../src/mcp.ts)) but never reads the client's side. Knowing whether the host renders MCP Apps lets the server tune its `instructions`: "`show_plate` renders in the room" versus "`show_plate` returns text; describe it". Whether a host draws its own UI isn't in the protocol, so lens guidance stays the same for all hosts.
- **Text-only hosts get a link.** A kept plate in a public Space has a web page, so a terminal agent can say "the chart is at mcportal.lol/@ana/…". Public Space pages are already prerendered; a plate would be prerendered to a static SVG the same way the link-preview PNGs are.

## Safety

Nothing here loosens the [security model](../explanation/security.md).

- **No agent markup in the room.** Specs are validated data, rendered with `textContent` and MCPortal's own SVG builders. A `figure` is shown only as `<img>`, as SVG clips are now.
- **Bounded.** Every kind has hard limits on points, entries, nodes and label length. Over the limit is refused, not truncated.
- **No network.** Plates resolve bound data through tools on the server; the room's CSP stays empty.
- **Third-party text stays fenced.** A plate's labels are the agent's words. Anything quoted from a source goes through a ref and arrives fenced as today.
- **Publishing is explicit.** A plate enters a public Space only through the agent, after the owner approves its exact title and caption, as with bios today.

## Phases

| Phase | What ships | Size |
|---|---|---|
| 0 | **Spike.** One lens (`watch_history`) as a data-only tool. Call it in ChatGPT with GPT-6 and in Claude desktop and record what each host draws. Also record whether `open_room` still shows the room in ChatGPT or gets redrawn. | small |
| 1 | **Lenses and text forms.** `get_lens` with the five lenses; `outputSchema` on them; read the client's UI capability at `initialize` and tune `instructions` | small to medium |
| 2 | **Plates in the room.** The grammar's renderers (`series`, `timeline`, `steps` first) in the design system; `show_plate` with comparison and desk wells; temporary until kept | medium |
| 3 | **Kept plates.** The `plate` clip kind; bound data for watches and reading activity; gallery view support | medium |
| 4 | **More wells.** Reader margin (anchored by passage locators), edition cover, watch plates | medium |
| 5 | **Plates in Spaces.** A frontispiece well, approval flow, static SVG prerender for web and RSS | medium |

Phase 0 decides the order after it. If hosts draw tool data well, phase 1 is worth most and phase 2 can wait. If they don't, plates in the room are the main way agents get to illustrate, and phase 2 moves up.

## What this doesn't do

- No arbitrary HTML, JavaScript or CSS from the agent, in the room or on the web.
- No model calls in MCPortal. Bound plates refresh from data; they never rewrite their own captions.
- No dependence on any one host's generative UI. If a host opens its UI to apps one day, specs that already exist could be mapped onto it; nothing here waits for that.
- No automatic plates. The agent places a plate when the user asks or when it judges it useful in conversation, and keeping is always the user's call.

## Docs to update if this goes ahead

- [Reading](../explanation/reading.md): replace "Saved, not made" with the new rule.
- [Reading experiences](../explanation/reading-experiences.md): plates in desks and comparisons.
- [Tools](../reference/tools.md): `get_lens`, `show_plate`, the `plate` clip kind.
- [Host compatibility](../reference/host-compatibility.md): what each host does with lenses and plates.
- [Design system](../reference/design-system.md): plate components and chart tokens.
- [Security](../explanation/security.md): the spec renderer.

## Open questions (with the default we'd take)

1. **Is "plate" the right word?** Default: yes. It fits the paperback look and doesn't collide with "view". Alternatives: "figure" (used above for images only), "illustration".
2. **One `get_lens` tool or lenses folded into existing tools?** Default: one new tool. Changing what existing tools return is a [compatibility](../how-to/release.md#compatibility) question, and some of them attach the room on purpose.
3. **Should inline-data plates be keepable?** Default: yes, labeled "supplied by your agent" and frozen. Only bound plates refresh.
4. **Do plates belong in clips or in collections?** Default: clips, for search, export and the "only on request" rule. A desk can hold a kept plate the same way it holds any clip.
5. **How much charting do we build?** Default: our own small SVG builders in the room, no library, consistent with the room's no-dependency rule. Five kinds, done well, before adding a sixth.
6. **Does a `figure` need its own kind, given image clips exist?** Default: yes, so a figure can sit in a well with a caption and refs; storage reuses the image clip checks.
