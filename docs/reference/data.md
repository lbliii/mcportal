# Data

What MCPortal stores, where, and for how long; how to export it and delete it; and what its logs contain. The hosted service's [privacy policy](../../src/site.ts) (served at `/privacy`) says the same things for its users. Why there are two storage backends is in [local and hosted](../explanation/local-and-hosted.md).

## What is stored

| Data | Contents | Kept |
|---|---|---|
| Account | GitHub numeric user id and login, role, how the account joined, dates | Until the account is deleted |
| Room | Name, layout, portals and their settings, saved items, pinned results | Until changed or deleted |
| Private collections | Links, clip refs, notes, orientations and trail progress | Until removed; 50 per account, 200 entries each |
| Reading experiences | Captured catch-up, page/release/calendar/artist watches, baselines and inbox | 20 watches; 40 findings retained 30 days; 2 MB |
| Saved items | Link, title, source, date, note | Until removed (200 at most) |
| Store watches | HTTPS store origin, collection/sales scope, pause state, product observations and detected changes | Until removed or account deletion; 20 follows, 200 observations and 30 findings per follow, 5 MB per account |
| Clips | Content, title, note, tags, source | Until deleted (1,000 or 50 MB at most) |
| Reading history | URLs seen, opened or read, with title, time, progress and a resume anchor | The newest 1,000 per account |
| Seen marks | Per portal, 12-character hashes of item ids | Until the portal or account goes |
| Highlights | The agent's latest picks and reasons | 24 hours, until replaced |
| Handoffs | Link, title, place and selected passage sent to a new chat | 7 days, 50 at most |
| Public profile | Handle, name, bio, Space title, cover (ink, motif, random seed), format, topics, pinned post, chosen travelers, hidden stamps, web visibility, listing, brought-aboard aggregate, featured portals, reblog default | Until removed. A handle given up stays reserved for 30 days |
| Shares | A copy of the shared link or clip, the note and the audience | Until removed |
| Follows, mutes, blocks | Pairs of account ids | Until changed |
| Reports | Who reported what, why, and when | 180 days after resolution |
| Sign-in tokens | One-way hashes, with the app that asked | Access 1 hour, refresh 30 days. Unused app registrations: 180 days |
| Invites and audit log | Who invited whom; account creation, deletion, suspension, reinstatement | Invites lapse after 90 days. Log entries: a year at most, newest 2,000 |

Store previews are account-bound in memory for ten minutes. Public catalogues are cached for one day; account snapshots and findings are not shared. Export version 3 includes watches and accepts earlier exports; restoring watches validates the complete incoming watch list before writing it. The PostgreSQL `mcportal_watches` row is locked per account across replicas, and file-to-database startup import has its own migration marker.

Rate-limit counters, account-page and admin sessions, and sign-ins in progress live in memory only. Fetched feeds, pages and pictures are cached in memory (2 minutes to 1 day) and never written to storage. MCPortal stores no email address, name or password.

## Local storage

A local MCPortal keeps everything in one folder: `MCPORTAL_DATA_DIR`, or `~/.mcportal` ([`src/lib/files.ts`](../../src/lib/files.ts)). Files are written atomically. A file that can't be parsed is moved aside as `<name>.corrupt-<time>.json` rather than overwritten.

| Path | Contents |
|---|---|
| `watches/<sha256(user)>.json` | Private store follows and snapshots; atomic writes, invalid files are refused without being overwritten |
| `<user>.json` | The room: layout, portals, saved items, pinned results (`default.json` unless `MCPORTAL_USER` is set) |
| `clips/<user>.json` | Clips |
| `collections/data.json` | Account-owned collections with atomic shared-document updates |
| `experiences/data.json` | Account-owned reading sessions, subscriptions and findings with revisions |
| `reading/<hash>.json` | Reading history |
| `seen/<hash>.json` | Seen marks |
| `editions/<hash>.json` | Highlights (24 hours) |
| `handoffs/<hash>.json` | Handoffs (7 days) |
| `exports/` | Files written by `export_data` (mode 0600). Never removed automatically |
| `link.json` | A signed-in computer's tokens for the hosted account (mode 0600). Deleted on sign-out |
| `link.lock` | Lock so two processes sharing the folder refresh tokens one at a time |

`<hash>` is the SHA-256 of the user id. In ghost mode nothing leaves the computer except the fetches for feeds, pages and pictures.

When a local MCPortal signs in, its room is copied to the hosted account, and from then on the account holds the data. Signing out copies it back. Housekeeping on the computer expires only its own highlights and handoffs.

The HTTP server without `DATABASE_URL` uses the same folder, plus `auth.json` (sign-in state), `accounts.json`, `public-profiles.json` and `social.json`.

## Hosted storage

With `DATABASE_URL` set, the HTTP server stores everything in Postgres ([`src/db/schema.ts`](../../src/db/schema.ts)). Tables are created on start and never dropped. On first start it imports any files in the data folder once.

| Table | Contents |
|---|---|
| `mcportal_profiles` | Each account's room, as JSON |
| `mcportal_clips` | Clips, with a summary for lists and a full-text search vector |
| `mcportal_reading` | Reading history, one row per account and URL |
| `mcportal_seen` | Seen marks, one row per account and portal |
| `mcportal_editions` | Highlights, with an expiry |
| `mcportal_handoffs` | Handoffs, with an expiry |
| `mcportal_shares` | Shares and reblogs |
| `mcportal_follows`, `mcportal_mutes`, `mcportal_blocks` | Relationship pairs |
| `mcportal_reports` | Reports and their status |
| `mcportal_kv` | Documents under fixed keys: `auth` (sign-in tokens and app registrations), `accounts` (accounts, invites, audit log), `public-profiles` |
| `mcportal_meta` | The schema version |

## Retention

Housekeeping ([`src/housekeeping.ts`](../../src/housekeeping.ts)) runs a minute after start, then every 6 hours. It removes expired handoffs and highlights, resolved reports past 180 days, lapsed invites and old audit entries, and expired tokens and unused app registrations. A local MCPortal runs only the handoff and highlight tasks.

Caps (reading history, handoffs, seen marks) are enforced on write.

## Export

`export_data` (or the account page, `/account`) produces one of four files:

| Format | File | Contents |
|---|---|---|
| `mcportal` | `mcportal-export-<time>.json` | Room, clips, private collections, captured catch-up and reading watches, store watches, reading history (newest 1,000), public profile, shares, follows, mutes, blocks and reports filed. Another MCPortal can import it with `import_portal` |
| `bookmarks` | `mcportal-bookmarks-<time>.html` | Saved items, in the Netscape bookmarks format browsers import |
| `clips` | `mcportal-clips-<time>.tar.gz` | Clips as Markdown |
| `opml` | `mcportal-subscriptions-<time>.opml` | Feed sources as OPML |

Hosted, the tool returns a one-time download link that expires in 15 minutes. Local, it writes to `exports/` and returns the path. Handoffs, highlights and seen marks are not exported.

## Deletion

Deleting an account removes, in order: the room, store watches, private collections, reading experiences, reading history, handoffs, seen marks, highlights, clips, social data (shares, follows, mutes, blocks), the public profile, every sign-in token, and the account itself ([`deleteAccountData`](../../src/account.ts)). People delete their own account on the account page; there is no tool for it. An operator can do the same with [`mcportal admin delete`](configuration.md#admin-commands).

What outlasts an account names nobody: reports keep no reporter or subject (and resolved ones lose the reason), the audit log keeps a record that an account was deleted, and the account's handles stay reserved for 30 days.

Smaller deletions are tools: `remove_saved`, `delete_clip`, `unshare`, `remove_public_profile`, `remove_portal`.

## Logs

Logs go to stderr ([`src/lib/log.ts`](../../src/lib/log.ts)), as text or JSON (`MCPORTAL_LOG_FORMAT`). Each line is an event name plus fields.

| Logged | Not logged |
|---|---|
| Tool name, outcome, error code, duration | Tokens, OAuth codes or callback URLs |
| A request id tying one request's lines together | User ids (only a keyed hash, below) |
| HTTP method, status and path, with long path segments replaced by `:token` | IP addresses |
| Error stacks for crashes | Room contents, what was read, or third-party text |

The user reference is an HMAC of the user id under a key generated at startup. It correlates one process's lines and changes on every restart. An error message can occasionally name a site that failed to load. The hosting platform keeps its own request logs separately.

## Space portability and public copies

MCPortal exports use version 2 and include every Space field. Version 1 exports remain readable; an old `accent` maps to the nearest named ink set at import. Import restores a validated cover and format onto an existing Space. It does not claim a handle, change its visibility or discovery setting, publish text, re-post shares, feature travelers or trust exported stamp claims. Other exported social data is retained for your own records.

Space profiles remain one document; these optional fields require no database migration. Stamps are computed from account creation, share weeks and Space age. Only the anonymous brought-aboard count is retained after join notes are consumed. Public HTML is cached in memory for at most a minute, with fresh visibility checks before reuse. Public pages and feeds expose only the owner's chosen public fields and everyone posts; private switches, moderation and removal affect subsequent requests. Copies already made outside MCPortal may persist.

Private collections and reading experiences use the `collections` and `reading-experiences` PostgreSQL shared-document namespaces. Startup migration imports the corresponding files. Full imports pause reading watches for review, remap clip/portal references and retain missing evidence visibly; full upload limits are 80 MB. [Detailed limits](../explanation/reading-experiences.md#state-and-limits).
