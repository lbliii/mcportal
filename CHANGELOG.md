# Changelog

## Unreleased

### Vocabulary
- **Room and portals:** your whole setup is now your **room**, and each window onto a source is a **portal** (it was called a panel). The app, tool descriptions, server instructions, skill, web pages and README use the new words. "Open my portal" still opens the room. See the glossary and rename plan in [docs/product-map.md](docs/product-map.md).
- **Renamed tools (breaking):** `open_workspace` → `open_room`, `build_portal` → `build_room`, `add_panel` → `add_portal`, `pin_panel` → `pin_portal`, `refresh_panel` → `refresh_portal`. Parameters `panelId` → `portalId`, `removePanelIds` → `removePortalIds` and `featuredPanelIds` → `featuredPortalIds`; results carry `portals`, `portal` and `portalId` instead of `panels`, `panel` and `panelId`. The old names are gone, with no aliases. Hosts ask you to approve the renamed tools again.
- **Renamed in the code:** `PanelSpec` → `PortalSpec`, `PanelResult` → `PortalResult`, the app is `src/ui/room.html` at `ui://mcportal/room.html`, and its CSS classes are `.portal*` with `data-portal`.
- **Stored data unchanged:** profiles still keep each column's portals under `columns[].panels`, and MCPortal exports keep the same format, so existing files, Postgres rows and exports load as they are.
- **Product map:** [docs/product-map.md](docs/product-map.md) maps every vertical, feature, component, variant and primitive.

### Clips
- **Keep things from the conversation:** say “clip that” and Claude saves a quote, an exchange (verbatim), a note, a table, an image (an SVG, PNG, JPEG or WebP chart or diagram) or a link, with a title, note and tags (`clip`).
- **Find them in later chats:** `search_clips` by words, kind or tag, and `get_clip` shows one as its own clip card. `update_clip` and `delete_clip` edit and remove them.
- **A Clips portal:** the first clip adds one. Clips open in a viewer with a renderer for each kind. `add_portal` can add filtered portals, such as only tables or only one tag.
- **Safe by construction:** clip text is always fenced as untrusted for the model and built as text in the UI. Images are checked by their bytes, and an SVG is only ever shown as an image, so nothing in it runs.
- **Storage:** files locally (`<data dir>/clips/`) and a new `mcportal_clips` table on the hosted server (schema version 2, upgraded in place).

### Your data and identity
- **Export everything:** `export_data` gives a one-time download link (hosted) or a file (local). You get one versioned MCPortal export (layout, sources, saved items, clips, public profile), saved items as a bookmarks file, clips as Markdown with front matter and images (`.tar.gz`), or sources as OPML.
- **Import:** `import_portal` adds an MCPortal export to any room. It only adds, running twice changes nothing, and every clip is re-validated. On the hosted server, the tool returns a one-time upload link (or you can use the account page), so exports up to 60 MB go straight from the browser to the server instead of through the model. Local MCPortal reads a file path.
- **Account page** at `/account`: sign in with GitHub to download everything, import an export, or delete your account. Deletion needs the typed confirmation, and it removes the room, clips and public profile, revokes every sign-in token and removes the account. It is never an MCP tool.
- **Public profiles (opt-in):** claim a handle (suggested from your GitHub login) with a display name and bio. Other signed-in users can look you up. A handle you give up is held for you for 30 days.

### Sharing
- **Your space:** a public profile is also a space people visit and follow. It has a title (say “liminal webspace”), a bio and an accent colour, your posts as a picture-rich grid (images, quotes and tables inline), and “Sources I read”: feeds you feature from your room, which visitors add to their own with one click. `open_space` shows anyone's space, or yours, as a card, and the toolbar has a My space button.
- **Share from the room:** a share button on saved items and in the clip viewer. You write the note and pick the audience yourself.
- **Share** a saved link or a clip with a note, to your followers (the default) or everyone on MCPortal. It needs a public profile. What you share is copied as it is, and Claude asks you to approve any note it writes.
- **Follow** people by handle. Their shares appear in a **Following** portal, which your first follow adds. **Mute** hides someone from that portal. **Block** hides you from each other and removes follows both ways.
- **Report** a share or a person. Admins see reports on `/admin` and can hide a share (only its author still sees it, marked hidden), dismiss the report or suspend the author. Every action is audited.
- **Safe by default:** other people's notes and shares always reach Claude fenced as untrusted text, and account ids never leave the server. Deleting your account removes your shares, follows, mutes and blocks, and anonymizes the reports you filed.
- **Storage:** new Postgres tables for shares, follows, mutes, blocks and reports (schema version 3, upgraded in place).

### Brand
- **A new look:** the Portal mark (a door with an orbit through it), a Line version for the interface, and a Jost wordmark, in a mid-century sci-fi print style. The room header, the onboarding screen and the public pages use them.
- **Your liminal webspace:** the new tagline. MCPortal works in any MCP agent, so the pages and invite messages no longer say it lives "inside Claude".
- **Icons everywhere:** a favicon, an app icon and a social card for link previews. MCP clients that show server icons get the mark too (`serverInfo.icons`).
- **The public pages in the house style:** the landing page opens on a night-sky band with a door, an orbit and a halftone planet, over cream pages (ink in dark mode). Headings are set in Jost, served by MCPortal itself, so the pages still make no third-party requests (the CSP adds `font-src 'self'`). Pictures sit on an off-register block of colour, and sections open with a halftone rule. `/privacy` and `/support` share the layout, and all three pages now talk about "your agent" instead of Claude.
- **Icons that match the mark:** the room's icons are redrawn on the Line mark's grid and stroke. Columns are two doorways, the bookmark and "open original" have arched tops, a space is someone's doorway, refresh runs around a tilted orbit, and corners share one radius. They're generated with the marks, so they can't drift apart.
- **A pulp voice in the room:** loading, empty states, onboarding and toasts read like a 1950s sci-fi paperback ("Receiving transmissions…", "All quiet on this frequency… for now.", "Summon my portal!", "It's alive!"), always with a plain line saying what happened or what to do. Tooltips, accessible labels, and account or destructive actions stay plain. Everything that said Claude or "your assistant" now says "your agent".
- **Every source its own colour:** a feed's dot and its cards' top edge take the lead ink of its fallback art, so they match its pictures and no two sources on screen share a colour (every feed used to be the same teal). Your own portals take the house inks: Saved mustard, Clips teal, Following brick, Pinned ink. Dark mode tints them toward paper so the dark inks still show. The room accent (pressed buttons, the primary button) is teal instead of blue.
- **New screenshots** on the landing page, showing the new header, icons and colours.
- **One source:** `npm run brand` draws every brand file from one script, and a test keeps the committed files in step with it. See `brand/README.md`.

### Pictures
- **Fallback art:** items without a picture, or whose picture is still loading, show a small portal scene printed like a mid-century sci-fi paperback: flat inks on paper, halftone dots and an off-register keyline. Five motifs (arches, orbits, a doorway with a ring through it, a grid bent by gravity, a starfield through a door) and eight ink sets. Every source on screen gets its own style, and each item its own placement. Dark mode prints on the darkest ink.
- **More thumbnails load:** when a feed says an image is over the size cap, the thumbnail comes from a smaller one in the post (/Film). Oversized WordPress uploads are resized by WordPress's image service (Colossal). A timed-out or failed fetch is retried on the next load instead of staying blank for a day.

### Reader view
- **No more share bars:** articles no longer open with "Share • Pin • Email" (Colossal), a "Share" heading over "Comments" and "Read Later" (Quanta), or "x.com / Facebook / LinkedIn / Mail" twice (Google blog). A list is dropped only when every item is a short share or utility link, so real lists stay, even ones that name Facebook or LinkedIn.

### Hosted service
- **Public pages:** a landing page at `/` with screenshots, a privacy policy at `/privacy` and support at `/support`. `MCPORTAL_SUPPORT_URL` and `MCPORTAL_OPERATOR` configure them.
- **Railway infrastructure as code:** `.railway/railway.ts` replaces `railway.toml`.

## v0.3.0 — 2026-09-30

MCPortal becomes a reading platform that lives in your agent, and a hosted service ready for a small invite-only beta.

### Reading in chat
- **Built for chat hosts:** the workspace renders inline in Claude, with no backdrop of its own, and sits in the host's surface.
- **Layouts:** a sideways-scrolling **columns** lane, where each column scrolls its own items, and picture **shelves**, one row per source.
- **Opening stories:** in the workspace, or as their own **reader card** in the conversation.
- **Look:** a custom icon set, denser controls and compact story details. The card height now shrinks back after the reader closes.

### Sources
- **Add anything:** paste a site, feed, `r/subreddit`, `owner/repo`, or a YouTube, Bluesky, Mastodon, Medium, PyPI, Lobsters, Stack Overflow or arXiv address. MCPortal finds a feed that works and previews it (`find_source`, `add_panel`, and the **+** sheet).
- **Thumbnails** for feeds, videos and repos. The server fetches them and hands them over as data URIs, so the view never contacts third parties.
- **Starter packs** (developer, AI, news, games, art, science, music, film) build a new user's portal in seconds. Every source was checked from a laptop and from the cloud.
- **OPML import and export:** bring subscriptions from another reader, or take yours anywhere.

### Your stuff
- **Saved items:** bookmark stories into a Saved panel. Layout edits can never drop them.
- **Onboarding:** "Make it yours" for new users, and "start over" on request.

### Hosted service
- **Postgres storage** for profiles and sign-in state. It's imported once from the old files, and point-in-time recovery is on.
- **Per-user usage limits:** a per-minute burst allowance and a daily cap, plus a global daily cap.
- **Accounts and invites:** invite-only sign-in with GitHub, suspension that takes effect within 30 seconds, and admins from `MCPORTAL_ADMINS`. The old allowlist still works.
- **One access gate:** `authorize()` runs before every tool call. Suspended accounts can't act, and tools only ever act on the caller's own portal.
- **Admin page** at `/admin`: invites, suspensions and the audit log. It's not MCP, so nothing a model reads can reach it. The same actions are available as `mcportal admin …` commands.
- **Invite links:** each invite has a `/join/<code>` page with setup steps, and the admin page gives you a ready-to-send message.

### For contributors
- **`bin/mcportal-dev.mjs`:** hot-reloads the server in Claude desktop without a restart. Setup is in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Plans** in [`docs/plans/`](docs/plans/): Postgres storage, local and hosted used together, clips, and identity and access (with portability).
- **Tests:** 59 tests, plus Postgres integration tests that run when `TEST_DATABASE_URL` is set.

### Upgrade notes
- **New runtime dependency:** `pg`, loaded only when `DATABASE_URL` is set. Local MCPortal still needs no `npm install`.
- **New environment variables:** `DATABASE_URL`, `MCPORTAL_ADMINS`, `MCPORTAL_OPEN_SIGNUP`, and `MCPORTAL_LIMIT_PER_MINUTE`, `MCPORTAL_LIMIT_PER_DAY` and `MCPORTAL_LIMIT_GLOBAL_PER_DAY`. See `.env.example`.
- **Sign-up:** setting `MCPORTAL_ADMINS` makes the server invite-only. With no admins and no allowlist, sign-up stays open, as before.
- **Column limit:** up to 8 columns, up from 4.

## v0.2.0

Hardened after an adversarial review. OAuth 2.1 with GitHub sign-in and per-user profiles.

## v0.1.0

The plugin daily driver: MCP server, workspace app, `/portal`, Railway config.
