# MCPortal

**The post-browser, starting as a plugin.** MCPortal is a personal, agent-composed workspace: live panels from sources you choose (Hacker News, GitHub, any RSS/Atom feed), laid out the way you ask, with a clean reader view and no ads. It ships as an MCP server with an [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) UI, so it runs inside agent hosts you already use.

- **v0.1 (M1):** plugin daily driver: MCP server, workspace app, `/portal`, Railway config.
- **v0.2 (toward M1.5):** hardened after an adversarial review, plus **OAuth 2.1 with GitHub sign-in and per-user profiles**, so a hosted deployment can be added to Claude as a custom connector.

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
| MCP server | `src/http.ts`, `src/mcp.ts`, `src/server.ts`, `bin/mcportal.mjs` | Streamable HTTP (`/mcp`) and stdio. Zero runtime dependencies. |
| Tools | `src/tools.ts` | `open_workspace`, `get_profile`, `update_profile`, `read_source`, `read_article`, `list_sources`, app-only `refresh_panel` |
| Workspace app | `src/ui/workspace.html` | Columns of panels, reader view, per-panel refresh, "Sources" provenance toggle, fullscreen |
| Adapters | `src/adapters/` | Hacker News, GitHub (search, releases), RSS/Atom, reader view |
| OAuth | `src/auth/` | Authorization server + resource server per the MCP auth spec, GitHub sign-in |
| Boundaries | `src/lib/safe-fetch.ts`, `src/lib/ip.ts` | Outbound fetches can only connect to public IPs; size, time and redirect caps |
| Parsing | `src/lib/html.ts` | Linear-time HTML tokenizer used by reader view and feed summaries |
| Profile | `src/profile.ts`, `src/store.ts` | Your layout as validated JSON, one file per user |
| Plugin | `.claude-plugin/`, `.mcp.json`, `skills/portal/`, `commands/portal.md` | Claude Code / Cowork plugin; `/portal` command and routing skill |
| Deploy | `Dockerfile`, `railway.toml` | One Railway service plus a volume |

## Requirements

Node **22.18+** (or any Node 24). Node runs the `.ts` files directly: no build step and no `npm install` needed to run. The `bin/mcportal.mjs` launcher prints a clear message on older Node. `npm install` only adds TypeScript for `npm run typecheck`.

## Try it locally

```bash
cd ~/Developer/mcportal
npm test                 # 39 tests, offline
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

1. Create a service from this repo. It picks up `railway.toml` and the `Dockerfile`.
2. Generate a public domain. Attach a **volume at `/data`**.
3. Create a **GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps):
   - Homepage URL: `https://<your-domain>`
   - Authorization callback URL: `https://<your-domain>/oauth/callback`
4. Set variables: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and to keep it private `MCPORTAL_ALLOWED_GITHUB_USERS=<your-login>`.
5. In Claude, add a custom connector with URL `https://<your-domain>/mcp`. Claude discovers the auth server, registers itself, and sends you through MCPortal's consent screen and GitHub sign-in.

Each GitHub user gets their own profile (`/data/github-<id>.json`). Tokens are opaque, stored hashed, and bound to this server's `/mcp` resource. Access tokens last 1 hour; refresh tokens rotate on use. `MCPORTAL_ALLOWED_GITHUB_USERS` accepts logins or numeric GitHub ids (ids survive renames). Removing someone takes effect on their next request.

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
| `open_workspace` | model + app | Hydrate every panel and render the workspace UI |
| `get_profile` | model | Read the saved layout |
| `update_profile` | model | Save a complete, validated layout (`removePanelIds` for explicit removals) |
| `read_source` | model + app | Preview any source without changing the layout |
| `read_article` | model + app | Reader view for one URL |
| `list_sources` | model | Source types and their settings |
| `refresh_panel` | app only | Reload one panel, bypassing cache |

Limits: 4 columns, 4 panels per column, 30 items per panel. Freshness: HN 2 min, GitHub 5 min, RSS 10 min, reader 1 h.

## Next

- **M1.5 launch:** deploy, connect from Claude and Cowork, fix whatever real hosts reveal, then submit to plugin directories and post a Show HN.
- **M2, standing intents:** scheduled checks and digests ("tell me when anthropics/* ships a release").
- **Source discovery** (Orrery pattern): "add something that tracks Python releases" → shortlist → lock the exact source.
- **Postgres** for profiles and auth once there's more than one instance.
