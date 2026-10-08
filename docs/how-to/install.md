# Install MCPortal

This guide installs MCPortal in each supported host, then covers signing in, updating and uninstalling. For a guided first run, follow [Getting started](../tutorials/getting-started.md) instead.

## Requirements

A local install needs Node.js 22.18 or newer (any Node 24 works). Node runs MCPortal's TypeScript directly, so there's no build step and no `npm install`. On an older Node, MCPortal exits with a message naming the version it found and where.

The hosted connector needs nothing on your computer.

## Ask your agent

Paste this into the agent you want to connect:

```text
Help me connect MCPortal to this agent.
Read https://mcportal.lol/install.md and add https://mcportal.lol/mcp as a remote MCP server using this host's supported setup.
If I need to change settings or sign in with GitHub, walk me through it. Then verify the connection and help me open my room.
```

A coding agent that can manage its host's MCP configuration can do the setup. A chat-only agent may need to walk you through connector settings. You'll complete GitHub sign-in in your browser. Giving an agent a link alone doesn't install a server.

The landing page's **Get it** section has the same prompt. Agents can read the site's [installation guide](https://mcportal.lol/install.md) directly or find it through [llms.txt](https://mcportal.lol/llms.txt). On a self-hosted instance, use that instance's guide and endpoint.

## Claude Code

### Hosted connection

From your terminal:

```bash
claude mcp add --transport http mcportal --scope user https://mcportal.lol/mcp
claude mcp list
```

In Claude Code, run `/mcp`, choose `mcportal`, and complete the browser sign-in. User scope makes the server available across projects. Start a new session if needed, then ask "open my room". See [Claude Code's MCP instructions](https://code.claude.com/docs/en/mcp).

### Local plugin

In a Claude Code session:

```text
/plugin marketplace add lbliii/mcportal
/plugin install mcportal@mcportal
```

Then type `/portal`, or ask "open my room".

The plugin adds the MCPortal server, the `/portal` command, and a skill that tells your agent how to route requests.

## Cowork

1. Open Cowork's plugin settings.
2. Add `lbliii/mcportal` as a plugin marketplace.
3. Install `mcportal`.
4. Ask "open my room".

## Claude desktop: local install

For a hosted connection in Claude desktop, follow [Hosted connector](#hosted-connector). For a local room, Claude desktop launches MCPortal from a copy of the repository.

1. Clone the repository:

   ```bash
   git clone https://github.com/lbliii/mcportal /path/to/mcportal
   ```

2. Find your Node path with `which node`. Claude desktop doesn't use your shell's `PATH`, so it needs the absolute path.
3. Open the config file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
4. Add `mcportal` under `mcpServers`, using your Node path:

   ```json
   {
     "mcpServers": {
       "mcportal": {
         "command": "/path/to/node",
         "args": ["/path/to/mcportal/bin/mcportal.mjs", "--stdio"]
       }
     }
   }
   ```

5. Quit and reopen Claude desktop.
6. In a new chat, ask "open my room".

To update, run `git pull` in `/path/to/mcportal` and restart Claude desktop.

## Codex

### Hosted connection

With the Codex CLI available:

```bash
codex mcp add mcportal --url https://mcportal.lol/mcp
codex mcp login mcportal
codex mcp list
```

Complete sign-in in your browser, then start a new session if needed and ask "open my room". If you use MCP settings instead, add a remote server with the same URL. The equivalent entry in `~/.codex/config.toml` is:

```toml
[mcp_servers.mcportal]
url = "https://mcportal.lol/mcp"
```

Keep your other configuration entries. See [Codex's MCP instructions](https://developers.openai.com/codex/mcp).

### Local source install

1. Clone the repository to `/path/to/mcportal`, as above.
2. Add MCPortal to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.mcportal]
   command = "node"
   args = ["/path/to/mcportal/bin/mcportal.mjs", "--stdio"]
   ```

3. Start Codex and ask "open my room".

## Hosted connector

Use this in hosts that support a remote Streamable HTTP server with OAuth, such as Claude on the web or desktop. A visual room requires MCP Apps support; other MCP hosts can use the tools through chat.

1. Open your host's connector settings. In Claude, open **Connectors**, usually under **Customize**, then choose **Add custom connector** and name it **MCPortal**. Enter this URL:

   ```text
   https://mcportal.lol/mcp
   ```

2. Your host sends you to MCPortal's consent screen, then to GitHub to sign in.
3. Enable the connector in your conversation if needed, then ask "open my room".

Organization accounts may require an owner to add a connector first. See [Claude's custom connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Anyone with a GitHub account can sign in. A [self-hosted](self-host.md) server may be invite-only; if sign-in there says your account isn't allowed, ask whoever runs it for an invite.

Some networks' DNS filters block newly registered domains, `mcportal.lol` among them. If your host can't reach the URL, ask your network admin to allow it, or install locally in the meantime.

If your organization blocks custom connectors, install locally and [sign in](#ghost-mode-or-signed-in) from there.

To run your own server instead, see [Self-host](self-host.md).

## Ghost mode or signed in

A local MCPortal starts in ghost mode: no account, everything in `~/.mcportal`, nothing shared.

Sign in to keep the same room on every device and to share and follow. Any of these starts it:

- Say "sign in to MCPortal".
- In the room, click **Ghost mode**, then **Sign in to sync and share**.
- On the welcome screen, click **Already have a portal? Sign in to bring it here**.

You sign in with GitHub in your browser. Open the link on the same computer: the sign-in finishes on a one-time local listener there. This computer's room is added to your hosted account, and nothing is removed.

After that, MCPortal still runs and fetches feeds on your computer, but your room, clips and shares live in your account. Each signed-in computer is listed on your account page, where you can revoke it.

To sign out, say "sign out of MCPortal" or click **Sign out** in the room's account menu. MCPortal copies your room back to this computer first, then returns to ghost mode.

By default a local MCPortal signs in to the public hosted service. To use another, set `MCPORTAL_HOSTED_URL` to its address. See [Configuration](../reference/configuration.md).

## Update the plugin

A marketplace you add yourself doesn't update automatically. Turn updates on once:

1. Type `/plugin`.
2. Open **Marketplaces**, then `mcportal`.
3. Choose **Enable auto-update**.

Or update by hand:

```bash
claude plugin update mcportal@mcportal
```

New versions load in your next session. [CHANGELOG.md](../../CHANGELOG.md) lists what changed.

## Uninstall and remove your data

1. If you're signed in, sign out first, so the sign-in is revoked and your room is copied back.
2. Remove MCPortal from your host:
   - Claude Code local plugin: `claude plugin uninstall mcportal@mcportal`, or use `/plugin`.
   - Claude Code hosted server: `claude mcp remove mcportal --scope user`.
   - Codex: `codex mcp remove mcportal`. Delete `/path/to/mcportal` too if you installed from source.
   - Claude desktop local server: delete the `mcportal` entry from the config file, then delete `/path/to/mcportal`.
   - Hosted connector: remove it in your host's connector settings.
3. Delete `~/.mcportal` to remove everything a local MCPortal stored. (If you set `MCPORTAL_DATA_DIR`, delete that folder instead.)

A local MCPortal keeps everything in that folder:

| Path | What it holds |
|---|---|
| `default.json` | Your room: layout, portals and saved items |
| `clips/` | Your clips |
| `seen/`, `reading/` | What you've seen and read, used for "what's new" |
| `editions/` | Your agent's latest highlights, kept for a day |
| `handoffs/` | Pages sent from the reader to a new chat |
| `link.json` | Your sign-in tokens, when signed in (readable only by you) |

To delete a hosted account and everything in it, sign in to the account page (say "open my account settings") and choose delete. To keep a copy first, ask your agent to export your data. [Data](../reference/data.md) lists what's stored and for how long.
