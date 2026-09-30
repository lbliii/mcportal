# MCPortal

**The post-browser, starting as a plugin.** MCPortal is a personal, agent-composed workspace: live panels from sources you choose (Hacker News, GitHub, any RSS/Atom feed), laid out the way you ask, with a clean reader view and no ads. It ships as an MCP server with an [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) UI, so it runs inside agent hosts you already use.

This is the **M1 checkpoint** from the vision doc (`docs/`): a plugin daily driver.

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
| MCP server | `src/server.ts`, `src/mcp.ts` | Streamable HTTP (`/mcp`) and stdio. Zero runtime dependencies. |
| Tools | `src/tools.ts` | `open_workspace`, `get_profile`, `update_profile`, `read_source`, `read_article`, `list_sources`, and app-only `refresh_panel` |
| Workspace app | `src/ui/workspace.html` | Multi-panel MCP App: columns and stacked panels, reader view, per-panel refresh, "Sources" provenance toggle, fullscreen |
| Adapters | `src/adapters/` | Hacker News (Firebase API), GitHub (search, releases), RSS/Atom, reader view |
| Boundaries | `src/lib/safe-fetch.ts` | Outbound fetches: http(s) only, public IPs only (checked every redirect), size and time caps |
| Profile | `src/profile.ts`, `src/store.ts` | Your layout as validated JSON (one file per user; Postgres later) |
| Plugin | `.claude-plugin/`, `.mcp.json`, `skills/portal/`, `commands/portal.md` | Installable into Claude Code / Cowork; `/portal` command and routing skill |
| Deploy | `Dockerfile`, `railway.toml` | One Railway service plus a volume |

Design principles carried from the vision doc:

- **You own the layout.** The agent writes whole, validated profiles and is told never to move panels you didn't mention.
- **The model stays out of rendering.** Opening the workspace is a plain tool call with cached, freshness-bounded data.
- **Content is data, never instructions.** Adapters return plain text only (no HTML reaches the UI or the model), tool results label third-party content as untrusted, and the UI never uses `innerHTML`.
- **Show your work.** Every panel and article carries provenance: endpoint, fetch time, cache status, freshness window.

## Requirements

Node **22.18+** (or any Node 24). Node runs the `.ts` files directly, so there's no build step and no `npm install` needed to run it. `npm install` only adds TypeScript for `npm run typecheck`.

## Try it

```bash
cd ~/Developer/mcportal
npm test                 # 18 tests, offline (fixtures)
npm run smoke            # live check against HN, GitHub and an RSS feed
npm start                # http://localhost:8787/preview  (workspace in a normal browser tab)
npm run demo             # same, with canned data and no network
```

`/preview` is the same MCP App, talking to `/mcp` directly instead of through a host. It's the quickest way to see and tweak the UI.

## Install as a plugin

**Claude Code** (local, stdio), inside a Claude Code session:

```
/plugin marketplace add ~/Developer/mcportal
/plugin install mcportal@mcportal
```

**Cowork:** add `~/Developer/mcportal` as a plugin marketplace from Cowork's plugin settings and install `mcportal`.

Then `/portal`, or just ask "open my portal". Hosts that support MCP Apps render the workspace; others get the text summary from the same tools. Your profile is stored in `~/.mcportal/default.json`.

**Codex** (stdio), in `~/.codex/config.toml`:

```toml
[mcp_servers.mcportal]
command = "node"
args = ["/Users/llane/Developer/mcportal/src/server.ts", "--stdio"]
```

Codex gets the tools. Whether it renders the MCP App UI depends on its current MCP Apps support.

## Deploy to Railway

1. Create a service from this repo (it picks up `railway.toml` and the `Dockerfile`).
2. Attach a **volume at `/data`**.
3. Set `MCPORTAL_TOKEN` to a long random string. Optionally set `GITHUB_TOKEN`.
4. Check it: `MCPORTAL_URL=https://<app>.up.railway.app/mcp MCPORTAL_TOKEN=… npm run smoke`

Point a client at it. For Claude Code, replace `.mcp.json` with:

```json
{
  "mcpServers": {
    "mcportal": {
      "type": "http",
      "url": "https://<app>.up.railway.app/mcp",
      "headers": { "Authorization": "Bearer ${MCPORTAL_TOKEN}" }
    }
  }
}
```

**Known gap:** Claude's custom connectors (claude.ai, Desktop, Cowork's remote connectors) expect OAuth, not a static bearer token. Until OAuth lands (next milestone), use the local stdio plugin in those apps, or the bearer-token setup above in clients that support custom headers.

## Tool reference

| Tool | Visible to | Purpose |
|---|---|---|
| `open_workspace` | model + app | Hydrate every panel and render the workspace UI |
| `get_profile` | model | Read the saved layout |
| `update_profile` | model | Save a complete, validated layout |
| `read_source` | model + app | Preview any source without changing the layout |
| `read_article` | model + app | Reader view for one URL |
| `list_sources` | model | Source types and their settings |
| `refresh_panel` | app only | Reload one panel, bypassing cache |

Limits: 4 columns, 4 panels per column, 30 items per panel. Freshness: HN 2 min, GitHub 5 min, RSS 10 min, reader 1 h.

## Next

- **OAuth + multi-user** (Postgres store keyed by user) so the Railway deployment works as a Claude custom connector and a marketplace listing.
- **Standing intents** (M2): scheduled checks and digests, e.g. "tell me when anthropics/* ships a release."
- **Source discovery** (Orrery pattern): "add something that tracks Python releases" → shortlist → lock the exact source.
- **Resizable, dockable panels** in the app (Trellis-style) and pinning agent-generated views.
