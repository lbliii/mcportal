# Changelog

## Unreleased

## v0.8.0 — 2026-10-05

### The river and reblogging are on for everyone
- **The river is a regular layout,** beside columns and shelves, no longer behind `MCPORTAL_LABS=river`. The front page stays a lab.
- **Reblog from anywhere:** every story, row and shelf card has a reblog button, not only the river and Following. A story nobody has posted is saved first, then posted to your Space; one someone you follow posted reblogs their post, so the credit stays theirs. Saved items keep their Share button.
- **Reblogging is no longer a lab:** `share` takes `reblogOf`, `share_settings` is always listed and the API's reblog methods always answer. `MCPORTAL_LABS=reblog` and `=river` are now ignored.
- Narrow shelf cards shorten a domain or language before they drop a count, an age or a button.

### Standalone pages get a door, and the account page a dashboard
- **Door plates:** consent, account, invite, import and sign-in pages open with a night-sky plate over the card. The door is lit with the moon in it for a welcome or good news, and dark when a link has expired or sign-in failed (with a brick shadow in place of mustard). A short line over the heading carries the pulp voice where the news is good ("It's alive!", "A door has opened!") and a few words on light failures ("Signal lost"); consent, deletion and account text stay plain.
- **Consent screen:** the requesting app and MCPortal are joined by an orbit of dots above the text that names them.
- **Account page:** leads with "Signed in as @you" and sign-out, then tiles for portals, saved items and clips, signed-in apps in rows, each download as a card, and deletion in its own marked-off box. The page is rendered by `accountHome()`, which the design preview also shows at `/account-preview`.
- Primary buttons are mustard with a brick offset shadow, like the landing page's call to action.

### Reading, retrieval and privacy
- Continue Reading brings back recent unfinished articles and docs pages. Docs now resume and record explicit completion, and reading writes settle in navigation order. Inline columns offer five stories plus More, lane navigation and page controls; shelves keep visible navigation.
- PostgreSQL clips use schema v9 full-text relevance with literal fallback. Docs search includes each account’s fresh cached page bodies within the existing bounded cache; unvisited pages still use their outline.
- Export/import links require the owning account's browser session and uploads validate CSRF. Full exports include mutes, blocks, filed reports and Space preferences; shared-cache timestamps are omitted. Hosted linking requires HTTPS except loopback, credential requests refuse redirects, and new data directories are private. GitHub sign-in requests no scope; the hosted HTTPS origin sends HSTS.
- Bounded protocol observations record recognized version/host categories without raw client identity data. The verified migration assessment corrects the planned modern protocol requirements; modern wire behavior is not implemented.

### Launch operations
- A read-only `npm run ops:check` probe checks storage health and authenticated MCP discovery, with bounded, credential-free JSON output and no redirects or feed fetching.
- The hosted operations runbook records deployment verification, rollback, isolated backup restores, incident response and the remaining launch evidence. Railway IaC preserves explicit sign-up, usage-budget and public-page settings without enabling sign-up.
- The privacy page groups service providers and records policy changes.

### Fixes
- Sign-in failures identify the step, HTTP status when available, recovery action and support reference. GitHub errors distinguish expired codes, OAuth app configuration, unverified email and outages; account access messages identify the selected GitHub account. The room and agent can read the last failed attempt and retry with a fresh link. A failed initial portal import keeps sign-in and local data intact and reports a warning in the browser and room. Diagnostic logs omit credentials, callback state and raw provider text.
- The Ghost mode menu's sign-in button now starts login instead of silently failing when its click event is passed to the sign-in flow. Browser regressions cover both sign-in buttons and hosts that support, omit or decline opening links.
- Local sign-in pages refer to your app rather than Claude and show the hosted server's failure reason instead of labelling every denied sign-in as cancelled.

### Terms of service and a private security contact ([plan](docs/plans/directory-launch.md))
- **Terms of service at `/terms`,** with acceptable use, linked from every page and from the sign-in consent screen, which now also asks you to confirm you're at least 13.
- **A private way to report security problems:** the security page describes what to send, response times (acknowledged within 3 business days), a 90-day disclosure window and safe harbor for good-faith research. `/.well-known/security.txt` (RFC 9116) and `SECURITY.md` point to the same contact.
- **One contact address:** `MCPORTAL_CONTACT_EMAIL` is where support requests and security reports go, and the support link defaults to it. `MCPORTAL_JURISDICTION` names the law the terms are under.
- The support page says how soon we reply, and only mentions invite-only sign-up while sign-up is invite-only.
- The public pages no longer link to the source code, which isn't public yet; `MCPORTAL_SOURCE_URL` brings the links back.

## v0.7.0 — 2026-10-02

### The river (lab, `MCPORTAL_LABS=river`) ([plan](docs/plans/river.md), [research](reports/River%20and%20reblog%20design%20research.md))
- **One stream across your room:** a fourth layout that merges every portal into one column. Your agent's picks first (only when there's an edition), then what's new, a "You're caught up" divider, then what you've seen. Each portal keeps its own order and portals merge by time; the same link from two portals is one story ("also on Hacker News"). More than three in a row from one portal fold into "N more from X", which opens in place. Docs and pinned portals are named at the end rather than merged.
- **Stories:** the portal and its age on top (its name opens the portal), the picture across at 1.91:1, a larger title, a four-line summary at reading width, every action, separated by rules. j/k move between stories, o opens, s saves. A `role="feed"` of articles for screen readers.
- **Pages that end:** ten at a time inline ("10 more", focus moves to a "Stories 11 to 20" separator; "Open the full river" from the third page), twenty in fullscreen, where the next page loads as you near the end, at most twice. Switching modes keeps what's on screen.
- **Nothing moves while you read:** a refresh or a save updates stories in place; stories new to the river wait behind "N new since you started". Coming back to the page refreshes portals past their freshness, at most every five minutes; nothing polls.
- **People you follow:** a follow's share of a link in your feeds is that feed's story, lifted to where they shared it, with "@ana shared" above it and their note in their own voice.

### Reblogging (lab, `MCPORTAL_LABS=reblog`) ([plan](docs/plans/reblog.md))
- **Pass someone's post on, with the credit staying theirs:** a reblog references the original rather than copying it, so its note and clip are drawn live, and the count pools on the original. Reblogging a reblog reblogs the original and credits who you saw it through ("via @ben"). One reblog per person per post; `unshare` undoes it.
- **The author decides:** each post says who may reblog it (anyone, their followers, nobody), with an account default (`set_public_profile`'s `reblogs`). Followers-only posts can't be reblogged at all. Authors can change it later or remove their post from one reblog for good (`share_settings`); the reblog then says its author removed it. A deleted, hidden or suspended original leaves the reblogger's note and the link. Blocks with the original's author hide the reblog; muting someone hides their posts reblogged by others too.
- **In the room:** a door-shaped reblog button with a menu (Reblog, Reblog with a note, Undo reblog), the moon filling the doorway once you have, a new ink green, and a small print-stamp effect (not with reduced motion). If you haven't opened a story, the menu offers "Read it first?" without getting in the way. In the river, several follows reblogging one post are one card ("@ben and @dee reblogged @cy") with at most two notes: the original's and one reblog's. Your own post's card shows who reblogged it, removes it from one, and sets who can reblog it.
- **For agents:** `share` takes `reblogOf` and `reblogs`; `get_share` says who reblogged a post; `share_settings` is new. All of it is listed only while the lab is on.
- **Postgres schema version 8:** shares gain `root_id`, with an index for finding reblogs and a unique index for one reblog per account per post.

### Under the hood
- **Labs per server:** labs now travel in each request's tool context (default `MCPORTAL_LABS`), and a tool can declare arguments that exist only while a lab is on, so a lab costs the model nothing until it's on. Token budgets gain a `hosted-labs` profile.
- **The inline room sets its own height** after every size change as well as telling the host, for hosts that read the page's height instead.
- **Fix:** a Saved story's share button no longer drifts away from the other actions.

## v0.6.1 — 2026-10-02

### Deleting an account leaves nothing behind ([plan](docs/plans/directory-launch.md))
- **Nothing names you after you delete your account:** the sign-in records of apps only you used (which can carry your computer's name) go with it, the audit log no longer says whose entries were yours, reports you made or that were about you stop naming you (open reports about you are closed), and your handles stay reserved for 30 days without saying whose. In file mode, unreadable copies of your room and an empty clips file go too. A test creates every kind of data, deletes the account, and searches what's left.
- **Admins can delete an account for you** if you can't sign in any more: `mcportal admin delete <login> --confirm`, recorded in the audit log.
- **Retention on a schedule:** expired highlights and handoffs, reports resolved more than 180 days ago, invites unused for 90 days, audit entries older than a year and app registrations unused for 180 days are removed every 6 hours, so the privacy policy's "how long" holds on a quiet server too. The policy now states each.
- Under the hood, the server and the admin CLI open storage the same way (`src/storage.ts`).

### Shipping device linking ([plan](docs/plans/local-hosted-hybrid.md))
- **Sign in from the welcome screen:** a local MCPortal's first-run screen offers **Already have a portal? Sign in to bring it here**, which starts the same sign-in as the account chip.
- **Privacy policy:** a section on MCPortal on your own computer: ghost mode sends nothing to the service; signed in, your room is stored by the service while feeds are still fetched from your computer, tokens stay in a file only you can read, and you can revoke a computer from the account page.
- **Support and README:** organizations that block custom connectors can install MCPortal locally and sign in.
- **CONTRIBUTING:** how linked mode fits together and how to try signing in without touching your own link.

## v0.6.0 — 2026-10-02

MCPortal becomes one portal, local or hosted: run it on your computer in ghost mode or sign in to keep it in your account, with sharing, a Space and a handle. The room gains layouts led by your agent's picks, the tool surface is reworked for the long run (breaking; see "A tool surface for the long run" and "For hosts and agents"), and the service gets ready for directory review. 0.5.0 was never released on its own; its changes are here.

### Releases
- **One command per release step:** `npm run release -- prepare <x.y.z | patch | minor | major>` sets the version everywhere it's stated (package.json and its lockfile, the plugin, `SERVER_INFO`, then the generated `server.json` and `manifest.json`), moves "Unreleased" under it, runs `npm run check` and opens a release PR. After the merge, `npm run release -- publish` tags it and creates the GitHub release from that version's notes. `--dry-run` previews either step. See CONTRIBUTING.md.

### Ready for directory review ([plan](docs/plans/directory-launch.md))
- **Every tool states what it does:** `readOnlyHint`, `destructiveHint` and `openWorldHint` are set on every tool, and a test keeps them consistent with what each tool does. Open-world means a tool reaches the web or makes something visible to other people (`share`, `relationship`, `set_public_profile`). `build_room` is now marked destructive (it replaces the layout), and `export_data` is no longer read-only (it writes a file, or makes a download link).
- **The room's content-security policy** (no external origins) is on the `resources/list` entry as well as `resources/read`, so hosts can review it when they connect.
- **Logs can't name you:** the user reference in logs is a keyed hash whose key is made at startup, so it can't be traced back to an account (an unkeyed hash of a GitHub id could be).
- **The privacy policy matches what's stored:** it now lists reading history, seen marks, highlights, pages sent to a new chat, device names in app registrations and the account-page cookie; it no longer promises backups that aren't set up; it says what outlasts deleting your account; and it names WordPress.com's image service.

### Signing in from the room
- **The room follows your sign-in:** after **Sign in to sync and share**, the open room notices when you finish in the browser and redraws as signed in. It also re-checks who it belongs to when it comes back into view, so signing in or out through your agent shows up too.
- **Claim a handle in the room:** the account menu's **Claim a handle** opens a form (suggested from your GitHub login) and opens your new space when it's done. Before, it only showed an error.
- **Fix:** the account menu no longer closes itself when one of its buttons changes it, which hid the sign-in follow-up and the sign-out confirmation.
- **For hosts and agents:** a local MCPortal sends `notifications/tools/list_changed` after signing in or out and after claiming a handle, so the agent sees the sharing tools without restarting.

### Fix: forms in real browsers
- **Signing in and the account page work in a browser again.** Server-rendered pages were sent with `Referrer-Policy: no-referrer`, under which browsers send `Origin: null` with a form POST. Every form is checked for a same-origin Origin, so **Continue with GitHub** on the consent screen and the account page's sign out, import, **Revoke** and delete were refused as "Cross-site request refused". Pages now use `same-origin`, which still sends other sites no referrer. A headless-Chrome test now submits the consent screen and the account page's sign-out the way a person does (`test/ui-forms.test.ts`).

### Room layouts ([plan](docs/plans/room-layouts.md))
- **Your agent's picks lead the room:** `show_highlights` now keeps its picks as the room's edition for 24 hours, replacing the last. `open_room` returns the picks still in their feeds, in the agent's order, and what the room leads with: the agent's first pick, else the first new item, else the top item of the first feed. Only the refs and the agent's own words are stored; items are found again in the live feeds, so no site text is kept. Editions aren't exported and are deleted with your account. `show_highlights` is no longer marked read-only. Postgres gains `mcportal_editions` (schema version 7).
- **Front page (lab, `MCPORTAL_LABS=frontpage`):** a third layout made for the chat column. Your agent's lead story and picks with their reasons, then each portal's top three stories (picks aren't repeated) with "5 more" pages, ending with "You're caught up" or how many new stories wait inside your portals. Nothing in it scrolls on its own; the page grows instead. Without highlights, a button asks your agent to pick them. Offered in the toolbar and to the model only while the lab is on.
- **Open a portal:** a portal's title opens it to fill the room, in every layout: ten stories at a time inline, all of them fullscreen. The reader opens over it and comes back to it; Back or Escape returns to the room exactly as you left it. Where the browser can, the portal grows into place and a story into the reader (not with reduced motion).
- **Unseen items read heavier:** titles you haven't had on screen are bolder, beside their **New** mark.
- Under the hood, columns and shelves are entries in one layout registry and items draw through one component with forms, so new layouts don't touch existing ones. Both render exactly as before.

### One portal, local or hosted ([plan](docs/plans/local-hosted-hybrid.md))
- **Who you are, at a glance:** the room's toolbar ends with an identity chip. Signed in, it shows your handle (or your GitHub login before you claim one) and opens your space. Running without an account, it shows **Ghost mode** with a ghost icon and a dashed outline: your portal stays where MCPortal runs and nothing is shared. The old space button is folded into it.
- **"Am I signed in?" has an answer:** `account_settings` starts with the mode ("Ghost mode: not signed in…" or "Signed in to the hosted MCPortal as @handle") and returns it as `identity`; `open_room` returns `identity` too, for the toolbar. Sharing and profile tools refused on a local MCPortal now say it's in ghost mode.
- **Room revisions everywhere:** every profile store (files, memory, Postgres) reports a revision that each write increments and can replace a room only if it's still at a given revision (`versioned`, `replaceIf`); a stale replace is a `conflict`. Profile files keep `rev` beside the room; older files count as revision 1. Tools reach the social layer and public profiles through narrower interfaces (`SocialService`, `ProfileDirectory`) that a linked MCPortal can implement remotely. No behavior change.
- **The hosted state API:** `POST /api/v1/call` takes a batch of up to 20 calls (`room.get`/`room.put` with revisions, clips, reading, seen sets, handoffs, public profiles, sharing and follows) and is what a linked local MCPortal will use in place of its own files. It takes the same tokens as `/mcp` and acts only as the token's account. Inputs are checked the way the tools check them. In particular, a clip is rebuilt on the server, a share names a clip or saved item the server looks up, and seen marks and featured sources must be portals in the room. Clients send `mcportal-client: <version>` and get 426 if they're older than the server supports.
- **Signed-in apps and devices:** the account page lists everything signed in to your account (Claude, and later your linked computers) with a **Revoke** button each. `POST /oauth/revoke` (RFC 7009) lets a client end its own sign-in.
- **Fixes:** an oversized request body on `/mcp` now closes its connection, so a client that reuses connections can't have the unread body taken for its next request. A malformed reading URL is an `invalid_argument` instead of an internal error. `ClipStore.add` returns the clip as stored.
- **The linked side:** `src/link` has the state API client (calls in the same tick go as one request; a refused token is refreshed once) and remote versions of every store the tools use, so the same tools run on a local MCPortal with its state on the hosted account. The room is cached for 30 seconds and written with revisions; when two devices change it at once, the loser re-reads and re-runs its change. A room saved by a newer MCPortal can be read but not changed. Not wired to a sign-in yet.
- **Sign in from a local MCPortal:** ghost mode's chip opens a menu with **Sign in to sync and share** (or say "sign in to MCPortal": `link_account`). You approve on MCPortal's consent screen, which names the computer, and sign in with GitHub. This computer's portal is added to your account (nothing removed), and from then on the same tools run here against your hosted account: your room, clips, reading, sharing and follows, the same on every device. Signed in, the chip shows your handle and offers your space, the account page and **Sign out** (`unlink_account`), which copies your portal back to this computer first. `export_data` and `import_portal` go through the hosted account in one request each (`GET /api/v1/export`, `POST /api/v1/import`).
- **Offline, when signed in:** if the hosted MCPortal can't be reached, the room shows your portal as last synced, with a notice, and the chip goes dotted; feeds still load (they're fetched on your computer), "new" marks pause, and changes say they need the connection. A newer hosted MCPortal is mentioned once.
- **Fix:** a one-time notice (such as "your saved layout couldn't be read") is shown on the welcome screen too, instead of being dropped.
- **The plan for linking:** a local MCPortal will be able to sign in to your hosted account and keep fetching on your machine while your room, clips and shares live on the hosted server. Revised plan in `docs/plans/local-hosted-hybrid.md`.

### Reading with your agent ([plan](docs/plans/attention.md))
- **Ask about a passage:** select text in the reader or a docs page and a bar offers **Ask about this** and **Clip quote**. Asking gives your agent the passage (fenced as the site's text, with the page and the nearest heading), then posts a fixed "Let's talk about the passage I just highlighted" in your voice: the site's words never go into your message. Hosts that can't post messages get the passage as context and a nudge to ask; hosts that can't take context offer **Copy quote**. Nothing is sent until you click.
- **Clip quote** keeps the selection as a quote clip with its page as the source.
- **What's new since your last visit:** items you haven't had on screen are marked **New**, portal headings say "30 · 7 new", and `open_room` tells your agent "[hn-top] 30 items, 7 new" with the new ones first. The room records what stays on screen for a second (or that you open) with the app-only `mark_seen`, in batches every 10 seconds. A portal's first showing is its baseline, so nothing floods in as new; your own Saved and Clips portals never show "new". Seen sets live apart from reading history (500 items per portal), aren't exported, and are deleted with your account. Postgres gains `mcportal_seen` (schema version 6).
- **Highlights:** ask "what's worth reading today?" and your agent calls `list_new_items` (what you haven't seen across the room, in turn by portal, at most 60, with what MCPortal knows of your taste: recent saves and finished reads, clip tags, the sites you read most), picks with the conversation and what it knows of you, and calls `show_highlights`: a card of the sources' own items, each with the agent's reason. Picks must name items the room really has. **Not for me** marks one seen. Nothing about the picks is stored.
- **Send to a new chat:** from the reader's top bar (the whole page) or the passage bar (a selection), MCPortal keeps a pointer to the page, where you were and what you selected under a short code, and shows what to say in a new chat: "Open MCPortal handoff k7q2xm". There `open_handoff` opens the page as a card at that place, with the passage, and gives the agent its text. Send two pages to two chats and keep driving this one. Codes work only in your account, last 7 days (50 at most), aren't exported, and are deleted with your account. Postgres gains `mcportal_handoffs` (schema version 5).

### A tool surface for the long run (breaking)
See [the plan](docs/plans/tool-surface.md).
- **Edit by patch (breaking):** `arrange_room` replaces `update_profile`. It takes only the changes you name (`move`, `width`, `retitle`, `configure`, `name`, `layout`, `openIn`), applies them all or none, and can't touch anything it isn't given, so "never drop a portal you weren't asked to" is a guarantee rather than a rule for the model. `remove_portal` is its own call, marked destructive, so hosts can ask before it runs. Portals are named by id or exact title. `get_profile` is gone: the room and its ids come from `open_room`. The room app's layout switch uses `arrange_room` too.
- **One `content` for clips (breaking):** `clip` takes the clip as `content` text for every kind but an exchange: a quote, a note in markdown, a markdown table, a link's url, or an image as SVG markup or a data: URI. Exchanges keep `turns` and quotes keep `attribution`. `text`, `markdown`, `table`, `columns`, `rows`, `svg`, `image` and `url` are gone.
- **Social tools for people who use them:** a hosted account sees the ways in (`open_space`, `relationship`, `report`, `set_public_profile`) until it has a handle or follows, mutes or blocks someone; then the rest. Hosts cache the tool list per conversation, so the rest arrive in the next one, and the result that unlocks them says so.
- **Budgeted results:** `read_doc_page` returns long pages in parts (`part: 2` for the next), `read_article` gives the model the first part (the reader card has the rest), and `open_room` summarizes each portal's first items.
- **Shorter definitions:** descriptions and schema prose are rewritten to stand alone when a host's tool search surfaces one tool. Counted as the model sees them (name, description, input schema), about 3,600 tokens local, 4,100 hosted and 4,600 for an active social account (with the reading tools app-only, below), down from 4,700 and 6,000. Each tool has a token ceiling in `test/footprint-ceilings.json`; `npm run footprint -- --exact` asks the Claude API's counter.
- **The reader records reading:** opening an article in the room's reader records it, scrolling saves the furthest point reached (at most every 15 seconds and on leaving), coming back picks up there, and only "Mark as read" marks it read. `record_reading` and `get_reading` are app-only now; the model asks `list_reading`. See [docs/reading-state.md](docs/reading-state.md).
- **A frozen eval:** `evals/tool-selection.ts` cases never change; renames are declared in `evals/renames.ts`, runs repeat (`--runs`) and results are recorded (`--record`) and compared (`--compare`).

### For hosts and agents (interface changes)
- **Arguments are checked:** every tool call is checked against the tool's `inputSchema` before it runs. A wrong type (`column: "2"`), an unknown argument or a missing required one is refused with `invalid_argument` and a sentence naming the problem, where some were silently ignored before. `pin_portal` still trims extra items and tags rather than refusing them.
- **Error codes:** a failed call carries `structuredContent.error = { code, message, retryable }` (codes such as `not_found`, `conflict`, `limit_exceeded`, `rate_limited`, `unavailable`, `upstream_error`). A server bug reports `internal` with a reference, never its message.
- **A smaller footprint:** a local MCPortal no longer lists the sharing, space and public-profile tools (they're hosted only), and the longest tool descriptions and the server instructions are shorter (the sharing rules are sent only where sharing exists). What MCPortal costs every conversation it's connected to drops from about 8,000 tokens to about 7,300 hosted and 5,700 local. `tools/list` is grouped by area.
- **Removed `export_opml` (breaking):** `export_data` with `format: "opml"` exports sources as OPML.
- **Version 0.4.0**, for the interface changes in this section.
- **Admin API errors** are `{ error: code, error_description }`, like the OAuth endpoints.
- **`find_source` candidates** carry validated settings, exactly as `add_portal` will store them.

### Health, reliability and distribution
- **No lost changes:** two tool calls at once can't overwrite each other's change to the room (also across server instances on Postgres), and a failed read of shared data can't replace it with an empty document.
- **`/health` checks storage** and answers 503 when it can't reach it; the admin page shows today's usage and per-tool counters.
- **Listing files:** `server.json` (MCP Registry) and `manifest.json` (an MCPB bundle for Claude desktop) are generated from the code by `node scripts/distribution.ts`, so their tools and version always match.

### Design system
- **Shared tokens:** versioned, typed authoring source generates CSS, browser palettes and TypeScript exports for the room, reading/social cards, public site, account, OAuth and admin.
- **Validated themes:** an exact host adapter repairs unreadable colour pairs, clears stale colours on theme changes, supports partial/reset inputs and follows system preferences until the host selects a scheme. Functional contrast no longer depends on native `contrast-color()`.
- **Consistent controls:** visible save actions, separate card-opening and metadata controls, shared focus/selection/target sizes, container-aware layouts and user text sizing. Brand artwork and images keep their colours.
- **A lighter toolbar:** the layout control is a pill switch whose chosen half fills in, and pressed icons get a soft fill instead of an underline. Inline in a chat the header shows only the Portal mark; the wordmark returns in fullscreen or on wide screens.
- **Regression workflow:** generation drift and contrast/lifecycle tests plus a reusable fixture MCP Apps host with an 80-case browser matrix. See [the guide](docs/design-system.md).

### Host themes
- **Visible on every host backing:** inline welcome tiles and room content paint their own theme-matched background, fixing dark text disappearing over a black iframe until hover.
- **Adaptive contrast:** a shared luminance resolver derives readable text, muted text, borders and surface colours when host tokens are absent or inconsistent, with light/dark fallbacks, increased-contrast and forced-colour support. Host tokens cannot overwrite internal room palette or layout variables.

### Vocabulary
- **Room and portals:** your whole setup is now your **room**, and each window onto a source is a **portal** (it was called a panel). The app, tool descriptions, server instructions, skill, web pages and README use the new words. "Open my portal" still opens the room. See the glossary and rename plan in [docs/product-map.md](docs/product-map.md).
- **Renamed tools (breaking):** `open_workspace` → `open_room`, `build_portal` → `build_room`, `add_panel` → `add_portal`, `pin_panel` → `pin_portal`, `refresh_panel` → `refresh_portal`. Parameters `panelId` → `portalId`, `removePanelIds` → `removePortalIds` and `featuredPanelIds` → `featuredPortalIds`; results carry `portals`, `portal` and `portalId` instead of `panels`, `panel` and `panelId`. The old names are gone, with no aliases. Hosts ask you to approve the renamed tools again.
- **Renamed in the code:** `PanelSpec` → `PortalSpec`, `PanelResult` → `PortalResult`, the app is `src/ui/room.html` at `ui://mcportal/room.html`, and its CSS classes are `.portal*` with `data-portal`.
- **Stored data unchanged:** profiles still keep each column's portals under `columns[].panels`, and MCPortal exports keep the same format, so existing files, Postgres rows and exports load as they are.
- **Product map:** [docs/product-map.md](docs/product-map.md) maps every vertical, feature, component, variant and primitive.

### Docs
- **Read any docs site in your room:** ask for "docs.stripe.com", "nextjs.org/docs" or "react.dev docs" and `find_source` offers a docs portal that lists the site's sections. MCPortal reads the site's `llms.txt`, its Sphinx inventory (Python, Django, NumPy, Flask) or its sitemap, and pages as markdown where the site offers it, else through the reader.
- **Docs on GitHub too:** "rust-lang/book" or "astral-sh/ruff" turns a repo's markdown docs folder into the same kind of portal, ordered by its `SUMMARY.md` or `_sidebar.md` when it has one.
- **A docs viewer:** contents with search on the left, the page in the middle, "On this page" on wide screens, and a Contents drawer on phones. Search finds pages, and on Python-style docs functions and classes too: pick `str.split` and the page opens at its signature. Your agent's `open_docs` shows the same viewer as a card in the chat.
- **A Developer docs starter pack:** Stripe, Railway, Python and Next.js, on the welcome screen.
- **Clean pages:** headings, code with its language and a Copy button, tables, notes and warnings as callouts, and links. Docs-site components (tabs, cards, steps, parameter lists) become plain text. Prev and next buttons move through the docs, and links to other pages of the same docs stay in the reader.
- **For your agent:** `open_docs` shows a site's contents, `search_docs` finds pages and (on Sphinx sites) functions like `str.split`, and `read_doc_page` reads one page. Only pages of that site can be read, and docs text reaches your agent fenced as untrusted, including text addressed to AI agents.
- **Better reader view everywhere:** articles keep their tables, code languages, callouts and links too.

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
