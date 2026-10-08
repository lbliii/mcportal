# Reading

MCPortal is a reader with an agent in the room. This page explains how the reader view and docs portals get clean text, how MCPortal remembers what you've read and seen, how your agent helps you choose and discuss, and how clips keep what matters. For tool details, see the [tool reference](../reference/tools.md).

## The agent thinks; MCPortal supplies

One principle shapes every reading feature: **MCPortal never calls a model.** Summaries, rankings and "why this matters to you" come from the agent you're already talking to, which has the conversation and its own memory of you. MCPortal supplies the material and the display.

That keeps MCPortal's running cost flat, and it means MCPortal never receives your host's memories, only what your agent chooses to write into a tool call.

Two more rules follow:

- **Site text never speaks in your voice.** Anything the room sends as a message from you is fixed wording plus, at most, a URL or a code. Passages, titles and excerpts go to the model as context labeled as third-party text.
- **No host APIs MCPortal doesn't have.** The room can call tools, post a message, update the model's context and open links. It can't open a new conversation or reach another one. Features degrade by host capability and say so.

## The reader view

`read_article` turns a page into clean blocks: headings with levels and anchors, paragraphs, nested and numbered lists, code with its language, tables, callouts, quotes, figures with captions, and links and emphasis as inline spans. The output is data, not HTML, so the room builds it with text nodes and the agent treats it as content.

Articles and docs pages share two reading controls. **Find** searches the title and rendered page text, including code and table cells. It shows the match count; Previous/Next and Enter/Shift+Enter move through matches. Ctrl+F or Command+F opens it when focus is inside the reader. Escape closes it and returns focus to Find. Docs index search remains a separate search of page titles and symbols.

**Reading** offers Standard, Large and Larger text, with Comfortable or Focused line widths and Reset. Choices carry across article and docs navigation within the current open card or preview session; a newly opened card starts at the defaults. Settings and find queries stay in the view and are not sent to tools or saved in the profile. Changing typography keeps the visible content block in place where the scroll range permits.

Getting there takes a few bounded passes over the page:

1. **Tokenize** with a linear-time HTML tokenizer. Hostile input costs O(n), never O(n²). Named entities are decoded with a bounded table.
2. **Select the story body.** The extractor tracks containers and their ancestry, scores them by structure (prose and link density, coherent paragraph runs, semantic hints), and drops publisher components: share bars, newsletter and consent boxes, author bios, breadcrumbs, tag lists and recommendations. It uses structure, not a list of publishers, so it works on sites it has never seen.
3. **Read the metadata** (headline, authors, published and updated dates, site) from the page's metadata and header markup, validated before use. The title is shown once, not again in the body. An author is never invented: when a credit is uncertain, it's left out.

### What survives

The reader keeps what the author wrote, not just the words:

- **Emphasis.** Bold, italic, links and inline code combine, so a bold link stays both.
- **Line breaks** the author put in (tour dates, addresses, verse) stay as breaks, without turning ordinary whitespace into new paragraphs.
- **Lists** keep their nesting, numbering and start values, and two adjacent lists restart independently.
- **Quotations** spanning several paragraphs stay one quote, with attribution where the page gives it.
- **Figures** keep their caption and credit. Pictures load through the guarded thumbnail fetcher, lazily, in a box sized in advance so a late image doesn't move your place. Each has a link to the image at its source.
- **Audio and video** aren't embedded. They become a labeled link to the source, so nothing plays or loads publisher scripts.

Above the article sits one metadata row: byline, site, publication date (and the update date when it differs) and reading time, estimated from the editorial text alone. Long articles (about 800 words or more, with at least three section headings) get a collapsible **On this page** outline. Headings without an anchor get a stable one, so outline links work without changing the source URL.

Reading position, passage selection and handoffs all walk the same logical blocks the reader draws, so a list or figure can't shift where you resume. A position saved before an article changed is restored as nearly as the stored block number allows.

Articles open in the room's reader or as a reader card in the chat, depending on the room's `openIn` setting. The model gets the first part of the text; the card has the rest. Reader pages are cached for an hour.

The reader doesn't run publisher scripts, autoplay media or bypass paywalls. When a site serves nothing useful, the reader says so and links the original.

## Docs portals

Docs sites now publish machine-readable versions of themselves for agents. A docs portal uses them to read any docs site without its front end: a table of contents, search, a calm reader and previous/next, with no banners or chat widgets. Your agent reads the same page you're on.

### The source ladder

A site is resolved once, when the portal is added, and the result is stored in the portal's settings so opening it never re-probes. For the **table of contents**, the first of these that validates wins:

1. **`llms.txt`**, at the path given, then walking up toward the site root, then `docs.<domain>` and `<domain>/docs`. Links to other `llms.txt` files are nested indexes, opened only when you go into one. Links to whole-site dumps (`llms-full.txt` and friends) are skipped.
2. **Sphinx `objects.inv`**, which covers most Python projects. Its page entries become the contents; the rest become a symbol index, so searching `str.split` jumps to its signature.
3. **`sitemap.xml`**, grouped into sections by the first path segment.

Candidates are tried one at a time, nearest first, because some sites answer bursts with 429.

For **each page**, MCPortal asks the page's URL for markdown first (`Accept: text/markdown`), then tries the URL with `.md` appended, then falls back to the HTML reader. The route that worked is remembered per host, so later pages go straight to it.

**GitHub repos** take their own route, so a project's docs can be read straight from the repo, with no docs site at all. Give it `owner/repo` or a folder link. One API call lists the repo's files, and a docs folder's markdown becomes the pages, ordered by `SUMMARY.md` or `_sidebar.md` when there is one. Without a folder, MCPortal picks the usual one (`docs`, `doc`, `book/src`, `website/docs` and so on), or the README. Translated docs keep English.

Without an outline file, each top-level folder is a section. Pages in deeper folders stay together inside their section, each folder led by its README or index, and their titles name the folder: uv's `docs/concepts/projects/workspaces.md` is **Projects › Workspaces** under **Concepts**. GitHub URLs never go through the generic ladder: walking up from a repo would find GitHub's own `llms.txt`. Public repos only.

### Judge bodies, not status codes

A response counts only if it's a 2xx **and** its body looks right. Some sites answer `/llms.txt` with 200 and an HTML page. An `llms.txt` must have a title and at least three links; markdown must not start with `<!doctype` or `<html>`; `objects.inv` must start with its version line.

### Docs talk to agents

Some docs address agents directly: `<SYSTEM>` tags, requests to add tracking parameters, instructions placed before the title. MCPortal fences page text as untrusted like any article. It shows tags like `<SYSTEM>` as literal text rather than removing them silently, so you can see what the page tried. It never adds parameters a page asks agents to add.

MDX components (`<Note>`, `<Tabs>`, `<Steps>`, `<Card>`) become callouts, labeled code blocks, lists and links. Only PascalCase tags count as components, so placeholders such as `<YOUR_API_KEY>` stay visible.

### Search

`search_docs` searches the site's outline (titles, descriptions, sections), Sphinx symbols, and the text of pages already in the bounded cache for your account. Pages nobody has opened are found by their outline only.

## Reading state

Reading history is kept apart from your room, per account, and the room records it, not the model.

- **Opening an article** records it as opened and scrolls back to where you were, unless you'd finished.
- **Scrolling** keeps the furthest point reached: the first block on screen and the share of blocks seen. Scrolling back up to leave doesn't lose it. The position is saved at most every 15 seconds, when the reader closes, when another article opens and when the page is hidden.
- **Only "Mark as read"** marks something read. Progress, even 100%, never implies completion.

`record_reading` and `get_reading` are app-only. The model asks `list_reading` for "what was I in the middle of?", and the room's Continue Reading shows recent unfinished articles and docs pages. Positions are hints: if a page changed, the reader tolerates a missing heading or block.

A URL's identity drops its fragment, so headings in one document share a record. Query parameters and trailing slashes still count; MCPortal doesn't guess at redirects or strip tracking parameters. Each account keeps its most recent 1,000 records.

## What's new to you

"What's new this morning?" is honest only if MCPortal knows what you've already seen.

**Seen marks** are kept per portal: the hashed IDs of up to 500 items, oldest dropped first. They're separate from reading history, which holds 1,000 records and would be pushed out within days by feed items.

- The room marks an item seen when it stays at least half on screen for a second, or when you open it, and sends marks in batches through the app-only `mark_seen`.
- A portal's first showing is its baseline, so a new portal doesn't flood you with "new".
- Your own Saved and Clips portals never show "new".

`open_room` then marks unseen items `new`, counts them per portal, and lists them first in the model's text ("[hn-top] 30 items, 7 new"). Seen marks are state, not something you made, so they aren't exported. They're deleted with your account.

## Highlights and editions

Ask "what's worth reading today?" and your agent:

1. calls `list_new_items` for unseen candidates across the room, capped per portal and overall, each as a short fenced line with a ref. It includes **taste signals** MCPortal already has (recent saves and finished reads, top clip tags, the sites you read most), so an agent with no memory still has something to go on;
2. ranks them with the conversation and what it knows of you;
3. calls `show_highlights` with refs and a reason for each.

The server resolves every ref against the room's real items, so the card shows the source's own title, link and picture, never anything the agent invented. A ref that matches nothing is refused.

The picks become the room's **edition** for 24 hours. Only the refs and the agent's own words are stored; items are found again in the live feeds, so no site text is kept. The room leads with the agent's first pick; without an edition, with the first new item of a feed; else the first feed's top item. It never leads with your own saved or clipped things.

## Asking about a passage

Select text in the reader or a docs page and a bar offers **Ask about this** and **Clip quote**. Asking puts the passage, the page and the nearest heading in the model's context, fenced and capped, then posts a fixed message: "Let's talk about the passage I just highlighted in MCPortal." The site's words never go into your message.

Hosts that can't post messages get the context and a nudge to ask. Hosts that can't take context get **Copy quote**. Nothing is sent until you click.

## Handing off to a new chat

There's no host API to open or message another conversation, so MCPortal hands off through itself. **Send to a new chat** stores a pointer (the page, your position, an optional passage) under a short code and shows what to say: "Open MCPortal handoff k7q2xm". In the new chat, `open_handoff` opens the page as a card at that place and gives the agent its text.

Codes work only in your account, so a leaked code opens nothing. Each account keeps at most 50, for 7 days. Codes leave out letters that are easy to misread, since people retype them. Handoffs are pointers, not things you made, so they aren't exported.

## Clips

Clips are a commonplace book beside your reading. Say "clip that" and your agent saves a typed snippet: a quote, a verbatim exchange, a note, a table, an image or a link, with a title, note, tags and where it came from. Later, "what did we decide about backups?" finds it with `search_clips`. That's memory across chats that you own and can see.

- **Only on request.** The agent clips only when you ask.
- **Saved, not made.** MCPortal stores a finished chart or diagram from the chat; it doesn't draw one.
- **Kept out of the room.** Tables and images would bloat the one document every layout edit rewrites, so clips have their own store. The first clip adds a Clips portal.
- **Safe by construction.** Clip text reaches the model fenced and the room as text. Images are checked by their bytes, and SVG is only ever shown as an image.
- **Search.** On Postgres, clips use full-text ranking with a literal fallback; locally, a plain text match.

Limits are generous but firm: see [data](../reference/data.md).

## Bring reading together

The newer [reading experiences](reading-experiences.md), currently under [Unreleased](../../CHANGELOG.md#unreleased), use the same material in Recall Shelf, private Topic Desks, comparisons, ordered trails and finite catch-up sessions. Recall searches kept text and metadata without fetching bookmarked pages. Collection and catch-up progress stay separate from an article's explicit **Mark as read** state.

For practical steps, see [Organize reading](../how-to/organize-reading.md). [Watch reading and events](../how-to/watch-reading.md) covers the background collector for Changes and Upcoming; it collects source evidence without calling a model.
