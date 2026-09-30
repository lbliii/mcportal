# MCPortal

**A reading platform that lives in your agent.** MCPortal is a personal, agent-composed portal: live panels from sources you choose (Hacker News, GitHub, YouTube channels, subreddits, Bluesky, Mastodon, and any site with a feed), laid out the way you ask, with a clean reader view and no ads. It ships as an MCP server with an [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) UI, so it renders inline in the agent hosts you already use.

- **v0.1 (M1):** plugin daily driver: MCP server, workspace app, `/portal`, Railway config.
- **v0.2 (toward M1.5):** hardened after an adversarial review, plus **OAuth 2.1 with GitHub sign-in and per-user profiles**, so a hosted deployment can be added to Claude as a custom connector.
- **v0.3 (M1.5, invite-only beta):** a chat-native workspace (columns lane, picture shelves, reader cards), **add anything** (MCPortal finds the feed), **thumbnails**, **starter packs** and **OPML import**, **saved items**, and a hosted service with **Postgres**, **usage limits**, **accounts, invites and an admin page**. See [CHANGELOG.md](CHANGELOG.md).

```
you: /portal put GitHub on the left and add Simon Willison's blog
agent: get_profile → update_profile → open_workspace
       ┌──────────────┬──────────────┬──────────────┐
       │ GitHub       │ Hacker News  │ Simon W.     │   ← ui://mcportal/workspace.html
       └──────────────┴──────────────┴──────────────┘
```

## What's here

| Piece | Where | What it does |
|---|---|---|
| MCP server | `src/http.ts`, `src/mcp.ts`, `src/server.ts`, `bin/mcportal.mjs` | Streamable HTTP (`/mcp`) and stdio. No runtime dependencies locally; the hosted server adds `pg` for Postgres. |
| Tools | `src/tools.ts` | See the tool reference below |
| Workspace app | `src/ui/workspace.html` | Columns lane and picture shelves, welcome and starter packs, add-a-source sheet, saved items, reader view and reader cards, lazy thumbnails, provenance toggle, fullscreen. Self-contained; its icon set is inline |
| Discovery | `src/discover.ts` | Turns a site, feed URL, `r/subreddit`, `owner/repo`, YouTube/Bluesky/Mastodon profile and more into sources that load |
| Starter packs | `src/packs.ts` | Eight interest packs of four live-checked sources each, for a new user's first portal |
| Adapters | `src/adapters/` | Hacker News, GitHub (search, releases), RSS/Atom, reader view |
| OAuth | `src/auth/` | Authorization server + resource server per the MCP auth spec, GitHub sign-in |
| Boundaries | `src/lib/safe-fetch.ts`, `src/lib/ip.ts` | Outbound fetches can only connect to public IPs; size, time and redirect caps |
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

To develop against Claude desktop (the workspace renders inline in chat, no deployment needed), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Install as a plugin (local, stdio)

**Claude Code**, inside a session:

```
/plugin marketplace add ~/Developer/mcportal
/plugin install mcportal@mcportal
```

**Cowork:** add `~/Developer/mcportal` as a plugin marketplace from Cowork's plugin settings and install `mcportal`.

Then `/portal`, or ask "open my portal". Your profile is stored in `~/.mcportal/default.json`.

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
5. In Claude, add a custom connector with URL `https://<your-domain>/mcp`. Claude discovers the auth server, registers itself, and sends you through MCPortal's consent screen and GitHub sign-in.

Each person gets an account (`github-<id>`, which survives GitHub renames) and their own profile. Tokens are opaque, stored hashed, and bound to this server's `/mcp` resource. Access tokens last 1 hour; refresh tokens rotate on use. Every tool call passes one access gate: suspended accounts can't act, and tools only ever act on the caller's own portal.

**Managing who's in** (never exposed as MCP tools, so nothing a model reads can use them): sign in at **`/admin`** with GitHub (admins only) to invite people, suspend or reinstate accounts, and read the audit log. The same actions work from the command line; on Railway run them in the service with `railway ssh --service mcportal -- node bin/mcportal.mjs admin …`:

```bash
node bin/mcportal.mjs admin list                   # accounts and pending invites
node bin/mcportal.mjs admin invite <github-login>   # account is created at first sign-in
node bin/mcportal.mjs admin suspend <login> [why]  # cut off within 30 s; reinstate to undo
node bin/mcportal.mjs admin audit                  # who did what, when
```

`MCPORTAL_ALLOWED_GITHUB_USERS` (logins or numeric ids) still works as an allowlist: people admitted that way lose access when removed from it. Invited people stay until suspended.

**Alternative for single-user setups:** set `MCPORTAL_TOKEN` instead and connect with a custom header (Claude Code):

```json
{ "mcpServers": { "mcportal": { "type": "http", "url": "https://<your-domain>/mcp", "headers": { "Authorization": "Bearer ${MCPORTAL_TOKEN}" } } } }
```

Check a deployment with: `MCPORTAL_URL=https://<your-domain>/mcp MCPORTAL_TOKEN=… npm run smoke`.

## Security model

| Threat | Defense |
|---|---|
| SSRF to localhost, private networks or cloud metadata | Every outbound socket connects only after its resolved address passes a public-IP check, inside the DNS lookup itself (no rebinding window). IPv6 is allowlisted to global unicast, so mapped, NAT64 and 6to4 forms can't sneak through. Redirects are re-checked, and credentials are dropped on cross-host hops. |
| Hostile pages or feeds hanging the server | Linear-time tokenizer; input, block and total-text caps; bounded cache. 3 MB adversarial inputs parse in well under 100 ms. |
| Prompt injection from third-party content | Adapters emit single-line plain text only. Tool results wrap third-party text in `<untrusted-content id="random">` fences. The UI never uses `innerHTML` and only opens http(s) links. |
| An agent "tidying" the user's layout | `update_profile` refuses to drop panels unless their ids are passed in `removePanelIds`, and it reports every move, retitle and reconfigure. |
| Exposed server | Binds to 127.0.0.1 by default and refuses a public bind without auth. The Host header allowlist blocks DNS rebinding; tokens are compared in constant time and never read from query strings on `/mcp`. |
| OAuth abuse | PKCE S256 required. Exact pre-registered redirect URIs only; errors before consent render a page and never redirect. MCPortal's own consent screen names the client. Consent is bound to the browser that loaded it (SameSite cookie, checked again on the GitHub callback) and must be same-origin, so a pre-fetched consent can't be approved cross-site. Codes are single-use. Refresh tokens rotate, and reusing a spent one revokes the whole grant. Tokens are audience-bound. The allowlist (login or numeric id) is re-checked on every request and every refresh. Registration, authorize and token endpoints are rate limited per IP. |
| Stalled or slow upstreams | One timeout covers connect, headers and body, including gzip, deflate and brotli bodies (decompressors are wired with `pipeline()` so an abort tears them down). |

Known limits: OAuth state (pending sign-ins, auth codes) is in memory, so run one instance. Dynamic client registration is open, as the MCP spec expects: it's rate limited and capped at 500 clients, with least-recently-used eviction. `structuredContent` sent to the UI isn't fenced; the model-facing text is.

The `/preview` page never contains secrets. With a static token it asks for the token and keeps it in that tab's `sessionStorage`, so the token never appears in a URL.

## Tool reference

| Tool | Visible to | Purpose |
|---|---|---|
| `open_workspace` | model + app | Hydrate every panel and render the workspace UI; shows the welcome for a new user, or with `setup: true` |
| `build_portal` | model + app | Build the portal from up to 4 starter packs (replaces the layout; saved items stay) |
| `find_source` | model + app | Resolve anything the user wants to follow into working, previewed candidates |
| `add_panel` | model + app | Add one panel without moving anything else; refuses duplicates and sources that don't load |
| `pin_panel` | model | Show results the agent fetched with another connected tool (Jira, Slack, Confluence, …) as a panel, or refresh one by `panelId`. Stored, never fetched by MCPortal |
| `save_item` / `remove_saved` | model + app | Bookmark a link (with an optional note), or remove one |
| `get_profile` | model | Read the saved layout |
| `update_profile` | model | Save a complete, validated layout (`removePanelIds` for explicit removals; can't touch saved or pinned items) |
| `read_source` | model + app | Preview any source without changing the layout |
| `read_article` | model + app | Reader view for one URL; renders as its own reader card |
| `list_sources` | model | Source types and their settings |
| `refresh_panel` | app only | Reload one panel, bypassing cache |
| `get_thumbnails` | app only | Fetch item pictures through the guarded fetcher as data URIs |
| `import_opml` | model + app | Bring subscriptions from another reader: test-load each feed, build a new user's portal from their folders or add to an existing one |
| `export_opml` | model | Sources as OPML for any feed reader (GitHub searches, saved and pinned panels have no feed and are listed as skipped) |
| `clip` | model | Keep a quote, exchange, note, table, image (SVG, PNG, JPEG, WebP) or link from the conversation; the first clip adds a Clips panel |
| `search_clips` | model | Find clips by words, kind or tag, newest first |
| `get_clip` | model + app | One clip in full; renders as its own clip card |
| `update_clip` / `delete_clip` | model | Change a clip's title, note or tags, or delete it |
| `get_public_profile` / `set_public_profile` / `remove_public_profile` | model | Your opt-in public profile and space (handle, name, bio, space title, accent, featured sources), or someone else's by handle. Hosted only |
| `export_data` | model | Everything as an MCPortal export, saved items as bookmarks, clips as Markdown, or sources as OPML: a one-time download link (hosted) or a file (local) |
| `import_portal` | model | Add an MCPortal export to the portal; only adds. Hosted: returns a one-time upload link, so the file never passes through the model (up to 60 MB). Local: reads a `.json` path |
| `account_settings` | model | Link to `/account`, where people download everything or delete their account (never a tool) |
| `open_space` | model + app | Someone's space (or yours): title, bio, Follow, "Sources I read" (one-click add) and their posts as a grid; renders as a card |
| `share` / `unshare` | model | Share a saved link or clip with a note, to followers (default) or everyone on MCPortal; needs a public profile |
| `get_share` | model + app | One share in full; renders as a card |
| `list_shares` | model | Your shares, or what someone shared that you may see |
| `relationship` | model | Follow, unfollow, mute, unmute, block, unblock by handle; the first follow adds a Following panel |
| `list_connections` | model | Who you follow, mute and block; your follower count |
| `report` | model | Report a share or person to the admins (they hide shares or suspend accounts on `/admin`) |

Limits: 8 columns, 4 panels per column, 30 items per panel, 200 saved items, 350 KB per picture. Clips: 32 KB of text, 500 KB per image, tables up to 50 × 500, and 1,000 clips or 50 MB per user. Freshness: HN 2 min, GitHub 5 min, RSS 10 min, reader 1 h, pictures 1 day.

## Next

MCPortal is a **reading platform with light social**, driven by your agent. Anything people share lives natively in MCPortal, not as public feeds. Your portal is yours: it works without an account, and it exports in standard formats. Detailed plans live in [`docs/plans/`](docs/plans/).

**M1.5: public beta.** Done when someone who isn't the author can connect, onboard, and come back the next day to a portal that still works.
- [x] Hosted server matches local; every starter-pack source checked from Railway (sources that block cloud servers swapped out)
- [x] `GITHUB_TOKEN` on the hosted server (fine-grained, public repos read-only; 5,000 requests/hour instead of ~60)
- [x] Per-user rate limits and daily fetch/thumbnail caps
- [x] Durable storage: Postgres for profiles and sign-in state, point-in-time recovery on ([plan](docs/plans/postgres-storage.md))
- [ ] Scheduled backups (daily + weekly) on the Postgres service: needs Railway Pro; do before public launch (PITR covers the beta)
- [x] Accounts, invites and suspension replacing the allowlist; one `authorize()` gate for every tool; admins from `MCPORTAL_ADMINS`; `mcportal admin` commands ([plan](docs/plans/identity-and-access.md), phase 1)
- [x] Admin page at `/admin`: invites, suspensions, audit log (phase 2)
- [x] OPML import (bring subscriptions from another reader) and OPML export (phase 1b)
- [x] Migrate `railway.toml` to Railway's infrastructure as code ([`.railway/railway.ts`](.railway/railway.ts))
- [x] Landing page at `/`, privacy policy at `/privacy`, support at `/support`, with screenshots (`MCPORTAL_SUPPORT_URL`, `MCPORTAL_OPERATOR`)
- [ ] Submit to Claude's connector directory
- [ ] Show HN

**M2: your portal, everywhere, and light social**
- [x] **Clips:** save quotes, exchanges, explanations, tables and images from the conversation; a Clips panel; the agent can search them across chats ([plan](docs/plans/clips.md)). Next: clip a quote from a reader selection, Postgres full-text search
- **Devices:** link a local MCPortal to your hosted account; state syncs, fetching stays local with a hosted fallback ([plan](docs/plans/local-hosted-hybrid.md))
- [x] **Portability:** full MCPortal export and import, saved items as bookmarks, clips as Markdown, delete account at `/account` ([plan](docs/plans/identity-and-access.md#data-rights-and-portability))
- [x] **Public profile (opt-in):** claim a handle (e.g. `@lbliii`); nothing is public until you choose
- [x] **Share** a saved item or clip with a one-line note (Claude can draft it; you approve it); audience is your followers or everyone on MCPortal
- [x] **Follow, mute, block, report**; followed shares appear in a **Following** panel; reports on the admin page
- **React** with one lightweight signal, so Following can surface what people liked

**Later**
- Standing intents: scheduled checks and digests ("tell me when anthropics/* ships a release")
- Built-in views of your own reading (what you read and save, by topic and source)
- Pictures in the reader view; clearer handling of paywalled articles
- More sign-in options (Google, email link, passkeys) as extra identities on the same account
- Link cards for sites without feeds (e.g. TikTok via oEmbed), shared portals for groups
- Postgres row-level security as a third access layer
