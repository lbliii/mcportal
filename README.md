# <picture><source media="(prefers-color-scheme: dark)" srcset="brand/lockup-on-dark.svg"><img src="brand/lockup.svg" alt="MCPortal" height="56"></picture>

*Your liminal webspace.*

**A reading platform that lives in your agent.** MCPortal is a personal, agent-composed room: live portals onto sources you choose (Hacker News, GitHub, YouTube channels, subreddits, Bluesky, Mastodon, and any site with a feed), laid out the way you ask, with a clean reader view and no ads. It ships as an MCP server with an [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) UI, so it renders inline in the agent hosts you already use.

- **v0.1 (M1):** plugin daily driver: MCP server, workspace app, `/portal`, Railway config.
- **v0.2 (toward M1.5):** hardened after an adversarial review, plus **OAuth 2.1 with GitHub sign-in and per-user profiles**, so a hosted deployment can be added to Claude as a custom connector.
- **v0.3 (M1.5, invite-only beta):** a chat-native workspace (columns lane, picture shelves, reader cards), **add anything** (MCPortal finds the feed), **thumbnails**, **starter packs** and **OPML import**, **saved items**, and a hosted service with **Postgres**, **usage limits**, **accounts, invites and an admin page**.
- **v0.6:** **one portal, local or hosted** (ghost mode, or sign in to sync across devices), **sharing, Spaces and handles**, **room layouts** led by your agent's picks, a **tool surface reworked for the long run**, and readiness for directory review. See [CHANGELOG.md](CHANGELOG.md).

```
you: /portal put GitHub on the left and add Simon Willison's blog
agent: arrange_room → find_source → add_portal → open_room
       ┌──────────────┬──────────────┬──────────────┐
       │ GitHub       │ Hacker News  │ Simon W.     │   ← ui://mcportal/room.html
       └──────────────┴──────────────┴──────────────┘
```

## What's here

| Piece | Where | What it does |
|---|---|---|
| MCP server | `src/http.ts`, `src/mcp.ts`, `src/server.ts`, `bin/mcportal.mjs` | Streamable HTTP (`/mcp`) and stdio. No runtime dependencies locally; the hosted server adds `pg` for Postgres. |
| Tools | `src/tools/` | One module per area (room, sources, saved, reader, docs, clips, account, social, reading); `kit.ts` is the shared runtime and `index.ts` the registry. See the tool reference below |
| Room app | `src/ui/room.html`, `src/ui/room/` | Columns lane and picture shelves, welcome and starter packs, add-a-source sheet, saved items, reader view and reader cards, lazy thumbnails, provenance toggle, fullscreen. Self-contained; its icon set is inline |
| Discovery | `src/discover.ts` | Turns a site, feed URL, `r/subreddit`, `owner/repo`, YouTube/Bluesky/Mastodon profile and more into sources that load |
| Starter packs | `src/packs.ts` | Eight interest packs of four live-checked sources each, for a new user's first room |
| Adapters | `src/adapters/` | Hacker News, GitHub (search, releases), RSS/Atom, reader view |
| OAuth | `src/auth/` | Authorization server + resource server per the MCP auth spec, GitHub sign-in |
| Boundaries | `src/lib/safe-fetch.ts`, `src/lib/ip.ts` | Outbound fetches can only connect to public IPs; size, time and redirect caps |
| Errors and logs | `src/lib/errors.ts`, `src/lib/log.ts` | Stable error codes for every expected failure; leveled, structured logs to stderr |
| Parsing | `src/lib/html.ts` | Linear-time HTML tokenizer used by reader view and feed summaries |
| Profile | `src/profile.ts`, `src/store.ts` | Your layout as validated JSON, one file per user |
| Plugin | `.claude-plugin/`, `.mcp.json`, `skills/portal/`, `commands/portal.md` | Claude Code / Cowork plugin; `/portal` command and routing skill |
| Deploy | `Dockerfile`, `.railway/railway.ts` | One Railway service plus a volume (Railway infrastructure as code) |
| Dev launcher | `bin/mcportal-dev.mjs` | Stdio launcher that hot-reloads the server when `src/` changes (see [CONTRIBUTING.md](CONTRIBUTING.md)) |

## Requirements

Node **22.18+** (or any Node 24). Node runs the `.ts` files directly: no build step and no `npm install` needed to run locally. The `bin/mcportal.mjs` launcher prints a clear message on older Node. `npm install` adds `pg` (used only when `DATABASE_URL` is set, i.e. hosted) and TypeScript for `npm run typecheck`.

## Try it locally

```bash
cd ~/Developer/mcportal
npm test                 # offline test suite
npm run smoke            # live check against HN, GitHub and an RSS feed (needs network)
npm start                # http://127.0.0.1:8787/preview  (bound to 127.0.0.1, no auth)
npm run demo             # same, with canned data and no network
```

To develop against Claude desktop (the room renders inline in chat, no deployment needed), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Install as a plugin (local, stdio)

**Claude Code**, inside a session:

```
/plugin marketplace add ~/Developer/mcportal
/plugin install mcportal@mcportal
```

**Cowork:** add `~/Developer/mcportal` as a plugin marketplace from Cowork's plugin settings and install `mcportal`.

**Updates:** a plugin marketplace you add yourself doesn't update automatically. Turn it on in `/plugin` → **Marketplaces** → `mcportal` → **Enable auto-update**, or update by hand with `claude plugin update mcportal@mcportal`. New releases arrive in your next session.

Then `/portal`, or ask "open my room" ("open my portal" works too). Your profile is stored in `~/.mcportal/default.json`.

**Ghost mode, or signed in.** A local MCPortal starts in ghost mode: no account, everything in `~/.mcportal`, nothing shared. To keep the same portal on every device and to share and follow, say "sign in to MCPortal", click **Ghost mode → Sign in** in the room, or **Already have a portal?** on the welcome screen. You sign in with GitHub in your browser; this computer's portal is added to your hosted account (nothing is removed), and from then on MCPortal still runs and fetches on this computer while your room, clips and shares live in the account. **Sign out** copies the portal back to this computer first. This is also the way in when your organization blocks custom connectors: install locally, then sign in. `MCPORTAL_HOSTED_URL` picks the hosted MCPortal (default: the public one). See [the plan](docs/plans/local-hosted-hybrid.md) for how it works.

**Codex** (stdio), in `~/.codex/config.toml`:

```toml
[mcp_servers.mcportal]
command = "node"
args = ["/Users/llane/Developer/mcportal/bin/mcportal.mjs", "--stdio"]
```

## Host it on Railway (remote connector)

1. Create a service named `mcportal` from this repo, then run `railway config apply`. [`.railway/railway.ts`](.railway/railway.ts) sets the Dockerfile build, health check and the `/data` volume. Preview any change with `railway config plan` first.
2. Generate a public domain. Add a **Postgres** service and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on MCPortal (profiles and sign-in state live there; turn on point-in-time recovery and scheduled backups). Without a database, attach a **volume at `/data`** and MCPortal uses files; with both, files found on the volume are imported once.
3. Create a **GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps):
   - Homepage URL: `https://<your-domain>`
   - Authorization callback URL: `https://<your-domain>/oauth/callback`
4. Set variables: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `MCPORTAL_ADMINS=<your-login>`. Setting admins makes the server invite-only; invite people with `mcportal admin invite <login>` (below).
5. Set who runs it and how to reach them, for the public pages (terms, privacy, support, security and `/.well-known/security.txt`): `MCPORTAL_OPERATOR` (your name), `MCPORTAL_CONTACT_EMAIL` (where support requests and security reports go; the support link defaults to it) and `MCPORTAL_JURISDICTION` (the law the terms are under, e.g. `the State of Oregon, USA`). `MCPORTAL_SUPPORT_URL` overrides the support link, and `MCPORTAL_SOURCE_URL` adds links to the source code (left out while the repo is private).
6. In Claude, add a custom connector with URL `https://<your-domain>/mcp`. Claude discovers the auth server, registers itself, and sends you through MCPortal's consent screen and GitHub sign-in.

Each person gets an account (`github-<id>`, which survives GitHub renames) and their own profile. Tokens are opaque, stored hashed, and bound to this server's `/mcp` resource. Access tokens last 1 hour; refresh tokens rotate on use. Every tool call passes one access gate: suspended accounts can't act, and tools only ever act on the caller's own portal.

**Managing who's in** (never exposed as MCP tools, so nothing a model reads can use them): sign in at **`/admin`** with GitHub (admins only) to invite people, suspend or reinstate accounts, and read the audit log. The same actions work from the command line; on Railway run them in the service with `railway ssh --service mcportal -- node bin/mcportal.mjs admin …`:

```bash
node bin/mcportal.mjs admin list                   # accounts and pending invites
node bin/mcportal.mjs admin invite <github-login>   # account is created at first sign-in
node bin/mcportal.mjs admin suspend <login> [why]  # cut off within 30 s; reinstate to undo
node bin/mcportal.mjs admin audit                  # who did what, when
node bin/mcportal.mjs admin delete <login> --confirm  # for someone who can't sign in to delete their account
```

`MCPORTAL_ALLOWED_GITHUB_USERS` (logins or numeric ids) still works as an allowlist: people admitted that way lose access when removed from it. Invited people stay until suspended.

**Alternative for single-user setups:** set `MCPORTAL_TOKEN` instead and connect with a custom header (Claude Code):

```json
{ "mcpServers": { "mcportal": { "type": "http", "url": "https://<your-domain>/mcp", "headers": { "Authorization": "Bearer ${MCPORTAL_TOKEN}" } } } }
```

Check a deployment with: `MCPORTAL_URL=https://<your-domain>/mcp MCPORTAL_TOKEN=… npm run smoke`.

**Health**: `GET /health` checks storage (Postgres answers, or the data directory is writable) and answers 503 when it can't reach it. **Usage**: the admin page shows today's budget use by account and per-tool call counts, errors and timings for the instance.

For an external authenticated availability probe, use `MCPORTAL_URL=https://<your-domain>/mcp npm run ops:check` with an authorized `MCPORTAL_TOKEN` supplied securely in the environment. See [hosted operations](docs/operations.md) for deployment verification, rollback, recovery drills and remaining launch checks.

**Logs** go to stderr, one event per line: `MCPORTAL_LOG_FORMAT=json` for a log platform, `MCPORTAL_LOG_LEVEL=debug|info|warn|error` (default `info`). Each HTTP request has an id, sent back as `x-request-id` and on every line it logs; a tool failure that is our bug says `reference <id>`, which finds its stack. Users appear only as a short hash.

## Reading experiences

Recall searches bookmarks, retained clip text and reading history together. Select two or three results for a comparison, or keep them in a Topic Desk. Desks have durable evidence, selected live portals, personal note clips and optional cited agent orientations. Reading trails add explicit finish/skip progress; catch-up captures a finite unseen story set and ends without marking articles read. Portal views offer lists, cards, quotes, gallery and GitHub changelogs.

Changes keeps dated text differences and fetch failures from page/release watches. Upcoming arranges public calendar or verified artist events by date and timezone. Watch subscriptions stay private, work locally or on a hosted account, and can be paused/deleted. Background checks run while the server is running; overdue checks are visible. Public calendars need no key. Artist lookup needs `TICKETMASTER_API_KEY` on the server and currently filters by city/country. Recurring or ambiguous calendar dates are visibly omitted. See [reading experiences](docs/plans/reading-experiences.md) for bounds and validation. Run `node scripts/reading-demo.ts` for an isolated preview with fictional desks, comparisons, changes and events.

Full exports include collections, catch-up and watches; importing is additive and imported watches begin paused. Removing collection membership leaves its underlying clip or bookmark. Account deletion removes the new stores too.

## Security model

| Threat | Defense |
|---|---|
| SSRF to localhost, private networks or cloud metadata | Every outbound socket connects only after its resolved address passes a public-IP check, inside the DNS lookup itself (no rebinding window). IPv6 is allowlisted to global unicast, so mapped, NAT64 and 6to4 forms can't sneak through. Redirects are re-checked, and credentials are dropped on cross-host hops. |
| Hostile pages or feeds hanging the server | Linear-time tokenizer; input, block and total-text caps; bounded cache. 3 MB adversarial inputs parse in well under 100 ms. |
| Prompt injection from third-party content | Adapters emit single-line plain text only. Tool results wrap third-party text in `<untrusted-content id="random">` fences. The UI never uses `innerHTML` and only opens http(s) links. |
| An agent "tidying" the user's layout | `arrange_room` changes only what it names, all or nothing, and reports every change; removing a portal is its own call, `remove_portal`, which hosts can ask the user to approve. |
| Exposed server | Binds to 127.0.0.1 by default and refuses a public bind without auth. The Host header allowlist blocks DNS rebinding; tokens are compared in constant time and never read from query strings on `/mcp`. |
| OAuth abuse | PKCE S256 required. Exact pre-registered redirect URIs only; errors before consent render a page and never redirect. MCPortal's own consent screen names the client. Consent is bound to the browser that loaded it (SameSite cookie, checked again on the GitHub callback) and must be same-origin, so a pre-fetched consent can't be approved cross-site. Codes are single-use. Refresh tokens rotate, and reusing a spent one revokes the whole grant. Tokens are audience-bound. The allowlist (login or numeric id) is re-checked on every request and every refresh. Registration, authorize and token endpoints are rate limited per IP. |
| The state API (`/api/v1/call`, for linked local MCPortals) | The same tokens, Host allowlist and Origin check as `/mcp`, and no CORS. Every call acts as the token's account: no method takes an account to act as. Each method has a param schema and the access gate and budget apply, as for tools. The server re-checks what a store would trust its caller with: rooms go through `validateProfile`, clips are rebuilt from their content with an id and size the server sets, shares name a clip or saved item the server looks up, seen marks and featured sources are limited to portals in the room. Deleting everything, imports, moderation and admin are not methods. Clients name their version; ones too old are told to update (426). Signed-in apps and devices are listed on the account page, where each can be revoked; clients can revoke their own grant (RFC 7009). |
| Linked computers | Signing in is OAuth with PKCE and a one-time loopback listener on 127.0.0.1 (RFC 8252); the consent screen names the computer, and the account page lists it with **Revoke**. Tokens live in `~/.mcportal/link.json` (0600), never in tool results, the room or logs. Refreshes are serialized across processes with a lock file, so a refresh token is never spent twice (which would revoke the sign-in). Signing out revokes the token (RFC 7009). |
| Stalled or slow upstreams | One timeout covers connect, headers and body, including gzip, deflate and brotli bodies (decompressors are wired with `pipeline()` so an abort tears them down). |

Known limits: OAuth state (pending sign-ins, auth codes) is in memory, so run one instance. Dynamic client registration is open, as the MCP spec expects: it's rate limited and capped at 500 clients, with least-recently-used eviction. `structuredContent` sent to the UI isn't fenced; the model-facing text is.

The `/preview` page never contains secrets. With a static token it asks for the token and keeps it in that tab's `sessionStorage`, so the token never appears in a URL.

## Tool reference

| Tool | Visible to | Purpose |
|---|---|---|
| `open_room` | model + app | Hydrate every portal and render the room; shows the welcome for a new user, or with `setup: true` |
| `build_room` | model + app | Build the room from up to 4 starter packs (replaces the layout; saved items stay) |
| `find_source` | model + app | Resolve anything the user wants to follow into working, previewed candidates |
| `add_portal` | model + app | Add one portal without moving anything else; refuses duplicates and sources that don't load |
| `pin_portal` | model | Show results the agent fetched with another connected tool (Jira, Slack, Confluence, …) as a portal, or refresh one by `portalId`. Stored, never fetched by MCPortal |
| `save_item` / `remove_saved` | model + app | Bookmark a link (with an optional note), or remove one |
| `arrange_room` | model + app | Change the room by naming each change: move portals, set column widths, retitle, change a portal's settings, rename the room, layout and where stories open. All or nothing; nothing else changes |
| `remove_portal` | model | Remove portals by id or title (a pinned portal takes its items with it) |
| `read_source` | model + app | Preview any source without changing the layout |
| `read_article` | model + app | Reader view for one URL; renders as its own reader card |
| `open_handoff` | model | Open a page sent from the reader to a new chat ("Open MCPortal handoff k7q2xm"), as a card where the user was, with any passage they selected |
| `create_handoff` | app only | Store the page, place and passage under a short code for a new chat (kept 7 days, 50 per account) |
| `list_sources` | model | Source types and their settings |
| `refresh_portal` | app only | Reload one portal, bypassing cache |
| `list_new_items` | model | What the user hasn't seen across the room, with refs, plus taste signals (saved, finished, clip tags, sites) for the agent to rank |
| `show_highlights` | model + app | The agent's picks (refs and a reason each) as a highlights card with the sources' own titles and links |
| `mark_seen` | app only | Record the items the user had on screen or opened, so `open_room` can say what's new to them |
| `get_thumbnails` | app only | Fetch item pictures through the guarded fetcher as data URIs |
| `import_opml` | model + app | Bring subscriptions from another reader: test-load each feed, build a new user's room from their folders or add to an existing one |
| `clip` | model | Keep a quote, exchange, note, table, image (SVG, PNG, JPEG, WebP) or link from the conversation as `content` text (exchanges as `turns`); the first clip adds a Clips portal |
| `search_library` | model and app | Search saved links, retained clips and reading history, with kind/site/tag/status filters |
| `open_collection` | model and app | Open a private desk, comparison or reading trail |
| `update_collection` | model and app | Keep, arrange, finish/skip steps and add a cited agent orientation |
| `show_comparison` | model and app | Show an explicitly supplied interpretation with validated evidence references |
| `watch_reading` | model and app | Follow pages, releases, public calendars and resolved artists; inspect, check, pause, delete and acknowledge findings |
| `catch_up` | app only | Capture/resume a finite reading session and explicitly end it |
| `search_clips` | model | Find clips by words, kind or tag, newest first |
| `get_clip` | model + app | One clip in full; renders as its own clip card |
| `update_clip` / `delete_clip` | model | Change a clip's title, note or tags, or delete it |
| `get_public_profile` / `set_public_profile` / `remove_public_profile` | model | Your opt-in public profile and space (handle, name, bio, space title, accent, opt-in sources/follows and optional pins/order/hides), or someone else's by handle. Hosted only |
| `export_data` | model | Everything as an MCPortal export, saved items as bookmarks, clips as Markdown, or sources as OPML: a one-time download link (hosted) or a file (local) |
| `import_portal` | model | Add an MCPortal export to the room; only adds. Hosted: returns a one-time upload link, so the file never passes through the model (up to 60 MB). Local: reads a `.json` path |
| `account_settings` | model | Link to `/account`, where people download everything or delete their account (never a tool) |
| `open_space` | model + app | Someone's space (or yours): title, bio, Follow, "Sources I read" (one-click add), "Fellow travelers" and their posts as a grid; owners preview automatic sections before enabling them; renders as a card |
| `share` / `unshare` | model | Share a saved link or clip with a note, or reblog someone's post (`reblogOf`), to followers (default) or everyone on MCPortal; needs a public profile. `unshare` also undoes a reblog |
| `get_share` | model + app | One share or reblog in full, with who reblogged it; renders as a card |
| `share_settings` | model | Who may reblog one of your posts (anyone, followers, nobody), or remove it from someone's reblog of it |
| `list_shares` | model | Your shares, or what someone shared that you may see |
| `relationship` | model | Follow, unfollow, mute, unmute, block, unblock by handle; the first follow adds a Following portal |
| `list_connections` | model | Who you follow, mute and block; your follower count |
| `report` | model | Report a share or person to the admins (they hide shares or suspend accounts on `/admin`) |

Space's **Sources I read** and **Fellow travelers** can grow from room subscriptions and MCPortal follows. Automatic lists stay private until the owner previews and enables each section in their Space. Existing featured sources keep their order and appear first; changing a profile never opts anyone in. Pins, order and hidden entries are optional preferences, independent of subscriptions and follows. Enabled sections update when the Space is next opened.

Automatic sources include Hacker News, public RSS/Atom feeds and GitHub sources. Feeds and named repositories are checked without authentication; private integrations, saved items, clips, docs portals, local addresses, credentials and unrecognized query or opaque secret URLs are excluded. Recognized public feed selectors (including YouTube channel/playlist feeds) are supported. Availability checks are cached for one minute; unavailable feeds or repositories can temporarily disappear. Public accessibility checks cannot reliably distinguish every secret URL, so the owner preview is part of enabling the section. People who go private, are suspended or are blocked by the viewer are excluded. Curation survives layout/limit changes, handle changes, visibility changes and temporary unfollows.

Limits: 8 columns, 4 portals per column, 30 items per portal, 200 saved items, 350 KB per picture. Clips: 32 KB of text, 500 KB per image, tables up to 50 × 500, and 1,000 clips or 50 MB per user. Freshness: HN 2 min, GitHub 5 min, RSS 10 min, reader 1 h, pictures 1 day.

## Next

The [delivery roadmap](docs/plans/delivery-roadmap.md) sequences the next product releases: compatibility, reading continuity, useful knowledge, proactive updates, and personal presentation.

MCPortal is a **reading platform with light social**, driven by your agent. Anything people share lives natively in MCPortal, not as public feeds. Your room is yours: it works without an account, and it exports in standard formats. Detailed plans live in [`docs/plans/`](docs/plans/).

**M1.5: public beta.** Done when someone who isn't the author can connect, onboard, and come back the next day to a room that still works.
- [x] Hosted server matches local; every starter-pack source checked from Railway (sources that block cloud servers swapped out)
- [x] `GITHUB_TOKEN` on the hosted server (fine-grained, public repos read-only; 5,000 requests/hour instead of ~60)
- [x] Per-user rate limits and daily fetch/thumbnail caps
- [x] Durable storage: Postgres for profiles and sign-in state, point-in-time recovery on ([plan](docs/plans/postgres-storage.md))
- [ ] Scheduled backups (daily + weekly) on the Postgres service: needs Railway Pro; do before public launch (PITR covers the beta)
- [x] Accounts, invites and suspension replacing the allowlist; one `authorize()` gate for every tool; admins from `MCPORTAL_ADMINS`; `mcportal admin` commands ([plan](docs/plans/identity-and-access.md), phase 1)
- [x] Admin page at `/admin`: invites, suspensions, audit log (phase 2)
- [x] OPML import (bring subscriptions from another reader) and OPML export (phase 1b)
- [x] Migrate `railway.toml` to Railway's infrastructure as code ([`.railway/railway.ts`](.railway/railway.ts))
- [x] Landing page at `/`, privacy policy at `/privacy`, terms at `/terms`, support at `/support`, security at `/security` and `/.well-known/security.txt`, with screenshots (`MCPORTAL_OPERATOR`, `MCPORTAL_CONTACT_EMAIL`, `MCPORTAL_JURISDICTION`, `MCPORTAL_SUPPORT_URL`)
- [ ] Submit to Claude's connector directory
- [ ] Show HN

**M2: your room, everywhere, and light social**
- [x] **Clips:** save quotes, exchanges, explanations, tables and images from the conversation or a reader selection; a Clips portal; the agent can search them across chats ([plan](docs/plans/clips.md)). Search-quality improvements remain planned.
- [x] **Devices:** local sign-in and hosted-state sync are implemented ([plan](docs/plans/local-hosted-hybrid.md)); production deployment and cross-host continuity still need verification.
- [x] **Portability:** full MCPortal export and import, saved items as bookmarks, clips as Markdown, delete account at `/account` ([plan](docs/plans/identity-and-access.md#data-rights-and-portability))
- [x] **Public profile (opt-in):** claim a handle (e.g. `@lbliii`); nothing is public until you choose
- [x] **Share** a saved item or clip with a one-line note (Claude can draft it; you approve it); audience is your followers or everyone on MCPortal
- [x] **Follow, mute, block, report**; followed shares appear in a **Following** portal; reports on the admin page
- **React** with one lightweight signal, so Following can surface what people liked

**Later**
- Standing intents: scheduled checks and digests ("tell me when anthropics/* ships a release"); first, watches for artists with concerts near you ([plan](docs/plans/watches.md))
- MCP 2026-07-28: serve the stateless protocol alongside today's, still without dependencies ([plan](docs/plans/mcp-2026-07-28.md))
- Built-in views of your own reading (what you read and save, by topic and source)
- Pictures in the reader view; clearer handling of paywalled articles
- Link cards for sites without feeds (e.g. TikTok via oEmbed), shared rooms for groups
- Postgres row-level security as a third access layer
- Open source, a one-click Railway template for running your own, and maybe federation between instances someday ([plan](docs/plans/open-source.md))
