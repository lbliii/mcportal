# MCP tools

Every tool MCPortal offers your agent, grouped by area. The registry is [`src/tools/index.ts`](../../src/tools/index.ts); each area has its own module beside it. Tool descriptions in the code are what the model reads; this page summarizes them.

## Reading the tables

**Hints** are the MCP tool annotations every tool declares. Hosts use them to decide when to ask before running a tool.

| Marker | Annotation | Meaning |
|---|---|---|
| `RO` | `readOnlyHint` | Changes nothing the user owns |
| `D` | `destructiveHint` | Can remove or overwrite something |
| `OW` | `openWorldHint` | Reaches the web, or makes something visible to other people |
| — | none of the above | Adds or changes the user's own data only |

**Inputs** lists the main arguments. A `*` marks a required one. The full JSON Schema is in each tool's `inputSchema`.

## Room

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `open_room` | `RO` `OW` | Opens the room: every portal in the user's layout, with what's new and each portal's id. Shows the welcome for a new user. | `setup` |
| `build_room` | `D` | Builds the room from up to 4 starter packs. Replaces the layout; saved items stay. | `packs*`, `layout` |
| `arrange_room` | — | Moves portals, sets column widths, retitles or reconfigures portals, renames the room, switches layout or where stories open. Only what you name changes. | `move`, `width`, `retitle`, `configure`, `name`, `layout`, `openIn` |
| `remove_portal` | `D` | Removes portals by id or title. Saved items and clips stay. | `portals*` |
| `pin_portal` | — | Shows results the agent fetched with another tool (Jira, Slack, a database) as a portal, or refreshes one. MCPortal never contacts that tool. | `items*`, `portalId`, `title`, `from`, `recipe`, `column` |
| `list_new_items` | `RO` `OW` | Lists what the user hasn't seen, each with a ref, plus taste signals for ranking. | `portals` |
| `show_highlights` | `OW` | Shows the agent's picks from `list_new_items` as a highlights card. The room leads with them for a day. | `picks*`, `title`, `intro` |

Layouts are `columns`, `shelves` and `river`. With the `frontpage` lab on, `build_room` and `arrange_room` also offer `frontpage` (see [configuration](configuration.md#labs)).

## Sources

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `find_source` | `RO` `OW` | Turns anything the user wants to follow into tested, previewed candidates: a site or feed, `r/subreddit`, `owner/repo`, `hn`, YouTube, Bluesky, Mastodon, Substack, a news search, or a docs site. | `query*` |
| `add_portal` | `OW` | Adds one portal from a `find_source` candidate. Nothing else moves; duplicates are refused. | `source*`, `config*`, `title`, `column` |
| `read_source` | `RO` `OW` | Fetches the latest items from one source without changing the room. | `source*`, `config` |
| `list_sources` | `RO` | Lists the source types and the settings each accepts. | none |
| `import_opml` | `OW` | Imports subscriptions from another feed reader. Working feeds become portals; a new user's room is built from their folders. | `opml*` |

Source types: `hn`, `rss`, `github`, `docs`, `saved`, `clips`, `following`, `lobby`. Pinned portals come only from `pin_portal`, and the People portal only from `suggest_people`.

## Reading

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `read_article` | `RO` `OW` | Opens a web page in reader view and shows it as a card. | `url*` |
| `list_reading` | `RO` | Lists pages the user opened and hasn't finished, newest first. | `unfinished`, `limit` |
| `open_handoff` | `RO` `OW` | Opens a page the user sent from the reader to a new chat ("Open MCPortal handoff k7q2xm"). Without a code, opens the newest unopened one. | `code` |

## Docs

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `open_docs` | `RO` `OW` | Opens a docs site in the docs viewer and returns its sections and pages. | `docs`, `portalId` |
| `read_doc_page` | `RO` `OW` | Reads one docs page as clean text, with its section and neighbors. Only pages of the named site. | `url*`, `docs`, `portalId`, `part` |
| `search_docs` | `RO` `OW` | Searches a docs site's titles, sections, Sphinx symbols and cached page bodies. | `query*`, `docs`, `portalId`, `limit` |

## Saved

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `save_item` | — | Saves a link for later, or edits a saved link's title or note. The first save adds a Saved portal. | `url*`, `title`, `note`, `source` |
| `remove_saved` | `D` | Removes one saved link. | `url*` |

## Clips

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `clip` | — | Keeps a quote, exchange, note, table, image or link from the chat, verbatim. The first clip adds a Clips portal. | `kind*`, `content`, `turns`, `title`, `note`, `tags`, `source`, `attribution` |
| `search_clips` | `RO` | Finds clips by words, kind or tag. Returns summaries. | `query`, `kind`, `tag`, `limit`, `before` |
| `get_clip` | `RO` | Shows one clip in full, as a card. | `id*` |
| `update_clip` | — | Changes a clip's title, note or tags. Content can't change. | `id*`, `title`, `note`, `tags` |
| `delete_clip` | `D` | Deletes one clip. | `id*` |

Clip kinds: `quote`, `exchange`, `note`, `table`, `image`, `link`.

## Social

Hosted servers only. A local MCPortal that isn't signed in has no social layer, so none of these are listed.

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `open_space` | `RO` | Opens someone's Space, or the user's own, as a card, with its link and which of their sources are already in the room. | `handle` |
| `get_public_profile` | `RO` | Returns the user's public profile and a suggested handle, or someone else's. | `handle` |
| `set_public_profile` | `OW` | Creates or changes the public profile and Space: handle, name, bio, Space title, accent, featured portals, default reblog setting, and whether `find_people` can suggest them (`listed`, off by default). | `handle`, `displayName`, `bio`, `spaceTitle`, `accent`, `featuredPortalIds`, `reblogs`, `listed` |
| `remove_public_profile` | `D` | Removes the handle, name and bio. The handle stays reserved for 30 days. | none |
| `share` | `OW` | Shares a saved link or clip with a note, or reblogs a post, to followers or everyone on MCPortal. | `savedUrl`, `clipId`, `reblogOf`, `note`, `audience`, `reblogs` |
| `unshare` | `D` | Removes a share or reblog. | `id*` |
| `get_share` | `RO` | Shows one share or reblog in full, as a card, with `canFollow` when it offers a Follow. | `id*` |
| `share_settings` | `D` `OW` | Changes who may reblog a post, or detaches it from someone's reblog (permanent). | `id*`, `reblogs`, `detach` |
| `list_shares` | `RO` | Lists the user's shares, or what someone shared that the user may see. | `handle`, `limit`, `before` |
| `relationship` | `OW` | Follows, unfollows, mutes, unmutes, blocks or unblocks a person. The first follow adds a Following portal. | `handle*`, `action*` |
| `list_connections` | `RO` | Lists who the user follows, mutes and blocks, and their follower count. | none |
| `find_people` | `RO` | Suggests listed people who share the user's topics (`about`), sites (`sources`) or taste (`like`); with none, their room. Each comes with reasons drawn only from what they made public. | `about`, `sources`, `like` |
| `suggest_people` | — | Keeps picks from `find_people` in the People portal, best first, each with a one-line reason. Suggestions last 30 days. | `picks*` |
| `report` | — | Reports a share or person to the admins with a reason. | `reason*`, `shareId`, `handle` |

Social tools appear in stages so they cost the model nothing until used:

- `set_public_profile`, `open_space`, `relationship`, `report`, `find_people` and `suggest_people` are listed whenever the server has a social layer.
- The rest appear once the account has a handle, a follow, a mute or a block.

## Account

| Tool | Hints | What it does | Inputs |
|---|---|---|---|
| `account_settings` | `RO` | Says whether the user is signed in (and as whom) or in ghost mode, and links the account page. | none |
| `export_data` | — | Exports everything, saved items as bookmarks, clips as Markdown, or sources as OPML. Hosted: a one-time download link (15 minutes). Local: a file path. | `format*` |
| `import_portal` | — | Adds an MCPortal export to the room; only adds. Hosted: returns a one-time upload link. Local: reads a file path. | `path`, `data` |
| `link_account` | `OW` | Signs a local MCPortal in to a hosted account. Returns a sign-in link. Listed only on a local MCPortal in ghost mode. | none |
| `unlink_account` | `D` | Signs this computer out. The portal is copied back first. Listed only on a signed-in local MCPortal. | none |

Account deletion is never a tool. It lives on the account page (`/account`) and in the [admin CLI](configuration.md#admin-commands).

## App-only tools

The room UI calls these through the MCP Apps bridge. They are declared with `_meta.ui.visibility: ["app"]`, so the model never sees them.

| Tool | What it does |
|---|---|
| `refresh_portal` | Reloads one portal, bypassing the cache |
| `mark_seen` | Records items the user had on screen or opened, for "new" |
| `get_thumbnails` | Fetches item pictures as data URIs through the guarded fetcher |
| `create_handoff` | Stores a page and selected passage under a short code for `open_handoff` |
| `record_reading` | Records that a URL was seen, opened or read, with progress |
| `get_reading` | Returns where the user left off in a URL |
| `pass_person` | The People portal's Not for me: removes the suggestion, and `find_people` remembers the pass for 90 days |

## Usage cost

On a hosted server each call spends units from the per-user budget ([`MCPORTAL_LIMIT_*`](configuration.md#usage-limits)). Local stdio is unlimited.

| Units | Tools |
|---|---|
| 20 | `import_opml`, `import_portal` |
| 5 | `find_source`, `export_data` |
| 3 | `open_room`, `list_new_items`, `open_handoff` |
| 2 | `read_source`, `add_portal`, `refresh_portal`, `read_article`, `open_docs`, `read_doc_page`, `find_people` |
| 1 to 4 | `get_thumbnails` (1, plus 1 per 8 URLs) |
| 1 | Everything else |

## Limits

| Limit | Value |
|---|---|
| Columns | 8 |
| Portals per column | 4 |
| Items per portal | 30 |
| Saved items | 200 |
| Picture size | 350 KB |
| Clip text | 32 KB |
| Clip image | 500 KB |
| Clip table | 50 columns × 500 rows |
| Clips per user | 1,000, or 50 MB |

Cache lifetimes: Hacker News 2 minutes, GitHub 5 minutes, feeds 10 minutes, reader pages 1 hour, docs indexes 1 day. Saved, clips, pinned and Following portals are never cached.
