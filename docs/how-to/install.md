# Install MCPortal

This guide installs MCPortal in each supported host, then covers signing in, updating and uninstalling. For a guided first run, follow [Getting started](../tutorials/getting-started.md) instead.

## Requirements

A local install needs Node.js 22.18 or newer (any Node 24 works). Node runs MCPortal's TypeScript directly, so there's no build step and no `npm install`. On an older Node, MCPortal exits with a message naming the version it found and where.

The hosted connector needs nothing on your computer.

## Claude Code

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

## Claude desktop

Claude desktop launches MCPortal from a copy of the repository.

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

1. Clone the repository to `/path/to/mcportal`, as above.
2. Add MCPortal to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.mcportal]
   command = "node"
   args = ["/path/to/mcportal/bin/mcportal.mjs", "--stdio"]
   ```

3. Start Codex and ask "open my room".

## Hosted connector

Use this in hosts that let you add a custom connector by URL, such as Claude on the web.

1. Add a custom connector with this URL:

   ```text
   https://mcportal.lol/mcp
   ```

2. Your host sends you to MCPortal's consent screen, then to GitHub to sign in.
3. Ask "open my room".

The hosted service may be invite-only. If sign-in says your account isn't allowed, ask for an invite on the service's [support page](https://mcportal.lol/support).

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
   - Claude Code: `claude plugin uninstall mcportal@mcportal`, or use `/plugin`.
   - Claude desktop or Codex: delete the `mcportal` entry from the config file, then delete `/path/to/mcportal`.
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
