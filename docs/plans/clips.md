# Plan: clips — save what we talk about

**Status:** proposed (2026-09-30). **Milestone:** first piece of M2. Useful alone now; shareable once M2 sharing lands.

## Goal

A commonplace book next to your reading. When you say "clip that", "save this table" or "keep that diagram", the agent saves a typed snippet from the conversation (or from an article) into MCPortal. Clips show in a **Clips** panel, and the agent can search them later ("what did we decide about Postgres backups?"). That's memory across chats that the user owns and can see.

MCPortal saves visuals; it doesn't make them. Hosts already render charts and diagrams in chat, so a clip stores a finished one. The later exception is built-in views of MCPortal's own data (reading history, topics across saved items).

## Clip kinds

| Kind | Stored as | Shown as |
|---|---|---|
| `quote` | `{ text, attribution? }` | pull-quote card |
| `exchange` | `{ turns: [{ speaker, text }] }` (max 20 turns) | compact dialogue |
| `note` | blocks parsed from markdown-lite: headings, paragraphs, lists, code, quotes | rendered like the reader view |
| `table` | `{ columns: string[], rows: string[][] }` (also accepts a markdown table) | a real table, horizontally scrollable |
| `image` | `{ mime, data }` (base64): SVG, PNG, JPEG or WebP | thumbnail, click to enlarge |
| `link` | `{ url }` plus note | like a saved item |

Every clip has an `id`, `kind`, `title`, optional `note` (the user's words), up to 10 `tags`, a `source` (`{ kind: 'conversation' | 'article' | 'web', url?, title? }`) and `createdAt` / `updatedAt`.

## Where clips live

Not in the profile: tables and images would bloat the one document every layout edit rewrites. A separate `ClipStore`:

```
add(userId, clip) · get(userId, id) · list(userId, { kind?, tag?, query?, limit, before? })
update(userId, id, patch) · delete(userId, id) · usage(userId)
```

- **Memory:** for tests.
- **File:** `<dataDir>/clips/<user>.json`, using the same mutex and atomic write as profiles. It's a subdirectory, so the Postgres import (top-level `*.json` only) never mistakes it for a profile.
- **Postgres:** `mcportal_clips(id text primary key, user_id text, kind text, title text, data jsonb, tags text[], search_text text, created_at, updated_at)`, indexed on `(user_id, created_at desc)`. Schema version 2. Every query is scoped by `user_id`.

The Clips panel is a native source kind (`clips`, config `{ kind?, tag?, limit }`) built from the store, not fetched. The first clip adds a Clips panel to the layout if there isn't one (only adds, like Saved).

## Tools

| Tool | Visible to | Does |
|---|---|---|
| `clip` | model + app | Save one clip. **Only when the user asks.** Picks the relevant content from the conversation, keeps quotes attributed, records where it came from. |
| `search_clips` | model + app | Find clips by words, kind or tag; newest first. Returns summaries. |
| `get_clip` | model + app | Return one clip in full. Renders as its own **clip card** in chat ("show me that table"). |
| `update_clip` | model + app | Change a clip's title, note or tags (not its content). |
| `delete_clip` | model + app | Remove a clip. Destructive; only on request. |

Tool results that include clip text wrap it as untrusted content: quotes may come from articles, and the model must not follow instructions inside a clip.

Server instructions gain: "When the user asks to clip, save or keep something from the conversation, use `clip`. When they refer to something from a past chat, try `search_clips`."

## UI

- **Clips panel:** each card shows a kind icon, title, first line or table size or image thumbnail, tags and age. In shelves it's a picture row when most clips are images.
- **Clip viewer:** opens in place like the reader, or as a clip card from `get_clip`, with a renderer per kind. Everything is built as DOM from structured data, never `innerHTML`. Images show via `<img src="data:…">`, so nothing inside an SVG can run and nothing loads from the network.
- **Clip from the reader:** select text in an article, and a "Clip quote" button saves it with the article as its source.
- **New icons:** clip, quote, table, image and note, in the existing icon style.

## Limits and safety

- **Size:** 32 KB of text per clip, 500 KB per image, tables up to 50 columns × 500 rows with cells up to 2 KB, and up to 1,000 clips or 50 MB per user. Over the limit, the tool refuses with a clear message.
- **Content checks:**
  - **SVG:** must be a single `<svg>` root. It's only ever shown as an image, so scripts and external references are inert.
  - **Raster images:** checked by their bytes, like thumbnails.
  - **Text:** plain text (markdown-lite is parsed into blocks, never interpreted as HTML).
- **Budget:** `clip` and `search_clips` cost 1 unit each, `get_clip` 1.
- **Privacy:** clips come only from explicit requests. Local MCPortal keeps them on the machine. On the hosted server they're in Postgres, scoped to the owner, and covered by point-in-time recovery. When devices are linked (hybrid plan), clips sync like profiles: `clip` and `delete_clip` become ops.
- **Not clippable:** interactive widgets as-is. A clip holds a static snapshot (SVG or PNG), the table's data, or the explanation's text.

## Phases

| # | Ships | Verifies |
|---|---|---|
| 1 | Clip model and validation (`src/clips.ts`), memory and file stores, the five tools, the markdown-lite and table parsers, a `clips` source kind with auto-added panel | Unit tests: every kind round-trips, limits refuse, SVG and raster checks, fenced results, user isolation, file store survives restart |
| 2 | UI: Clips panel cards, clip viewer and clip card, icons | Preview: each kind renders; a hostile SVG doesn't run; clip card from `get_clip` |
| 3 | Postgres `ClipStore`, schema v2, deploy | `TEST_DATABASE_URL` tests (isolation, search, limits); live on Railway |
| 4 | Clip quote from reader selection; search quality (Postgres full-text) | Preview and live |
| 5 (M2) | Share a clip with a note | With the sharing work |

## Open questions

1. **Panel placement:** does the first clip auto-add a Clips panel, as Saved does (proposed), or only when asked?
2. **Exchanges:** clip the assistant's words verbatim (proposed), or allow a summary?
3. **Export:** add "export my clips as Markdown" in phase 1, or later?
