# Durable reading state

Reading activity is separate from the layout profile. The server scopes every call to the signed-in account (`ToolContext.userId`); tools never accept an account ID. Local stdio uses the configured local user. File storage survives restart under `<data directory>/reading/`; hosted Postgres uses `mcportal_reading`, added by schema version 4. Account deletion removes these records. The MCPortal JSON export includes `reading`; import adds validated, absent URLs and preserves existing positions. Old exports without reading remain supported.

## Tool contract

- `record_reading({url, status, title?, anchor?, progress?})` returns `structuredContent.reading` as one record. App-only.
- `get_reading({url})` returns a record or `null` in that field. App-only.
- `list_reading({unfinished?, limit?})` returns an array in that field. Defaults: unfinished true, limit 20; tool maximum 100. Ordered by last-opened time (seen-only records use last-seen time), then URL. Unfinished means opened, excluding seen-only and explicitly completed records.

A record has `url`, `status`, `lastSeenAt`, optional `title`, `lastOpenedAt`, `readAt`, `anchor: {heading?, block?}`, and `progress`. Times are server-generated ISO UTC strings. Blocks are nonnegative, zero-based indices; headings are text/ID resume hints of at most 300 characters. Positions are hints: readers should tolerate changed or missing headings/blocks. `anchor: null` clears the position. Omitted fields preserve previous values.

`seen` means an item was visible, and preserves existing status and position. It rejects progress/anchor updates. `opened` means the item was actually opened and records last-opened time; it explicitly reopens a previously completed item and clears readAt. `read` is explicit completion and sets readAt and progress 1. Progress in [0,1], including 1, never implies completion. Merely fetching article content does not create an activity event; UI integration should emit events from actual reader actions.

URL identity uses WHATWG URL normalization (host case/default ports), accepts only HTTP(S), rejects embedded credentials, and removes fragments so headings share a document identity. Query parameters, path case and trailing slashes remain significant; the server does not guess redirect equivalence or remove tracking parameters. Anchor data carries the fragment/position independently. URLs are capped at 4096 characters and titles at 300.

Stores retain at most 1000 recent records per account, evicting the least recently opened (or seen) when adding activity. Import is additive and fills remaining capacity; input is validated before reading records are written. File updates serialize within a server process and use atomic private-file replacement. Postgres incremental updates merge atomically across server processes. Deployments using files should run one writer per data directory, as with the existing file stores. File-to-Postgres moves use the account JSON export/import for reading history.

## Who records reading

The room's reader does; the model doesn't. `record_reading` and `get_reading` are app-only (`_meta.ui.visibility: ["app"]`), so the model never sees them, and `list_reading` ("what was I in the middle of?") is the model's way in. In the reader (`src/ui/room/reading.js`):

- Opening an article calls `get_reading`, scrolls to the saved block unless the article was finished, then records `opened` with its title.
- Scrolling measures where the user is (the first block on screen, and the share of blocks that have been on screen) and keeps the furthest point, so scrolling back up to leave doesn't lose it. That point is saved as `opened` with `progress` and `anchor.block` at most every 15 seconds, when the reader closes or another article opens, and when the page is hidden. Each save is one call against the usage budget.
- Only the "Mark as read" button at the end of the article records `read`.
- Failures are quiet: on a server without reading history the reader just doesn't track.

Docs pages now use the same position and explicit-completion tracking. Continue Reading
shows up to four recent unfinished items, reopening docs through their original portal
where possible. Clips and shares aren't tracked yet. Reading writes are serialized
across navigation so reopening does not race a position save or explicit completion.
