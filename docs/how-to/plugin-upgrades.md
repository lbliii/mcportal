# Verify installation and upgrades

The portable package does not guarantee automatic updates. Use host-managed
package updates, and restart the MCP connection or session when that host
requires it. Hosted users receive server changes through the same endpoint;
changes to tool definitions may require a connection refresh.

## Reproduce the checks

With a current Claude Code executable, run:

```sh
MCPORTAL_CLAUDE_CLI=/absolute/path/to/claude node scripts/host-upgrade-check.ts
```

This opt-in probe builds both variants, validates them using Claude, installs
and updates a local test plugin, verifies installed version changes, then
uninstalls it. Claude configuration is confined to a new temporary directory.
It makes no model requests and does not sign in to MCPortal. Probe artifacts
remain for inspection. The generated repo-scoped Codex catalog can be inspected
with `codex plugin list` from its directory without modifying user marketplaces.

The builder provides `.claude-plugin/plugin.json` and `.mcp.json` alongside the
portable manifests. Claude's data path uses `CLAUDE_PLUGIN_DATA`; the portable
entry uses `PLUGIN_DATA`. Both select a persistent `mcportal` subdirectory.
No hooks are installed or required.

## Host checks before declaring support

Record host version, package version, results and failures for each release.

| Check | Codex desktop | Claude Code |
| --- | --- | --- |
| Package validation | Official schemas in automated tests | Native `plugin validate` in probe |
| Discovery/install/update | CLI catalog probe plus desktop verification | Isolated native CLI probe |
| Runtime starts without checkout | Packaged MCP initialization test | Same package test; confirm host variable expansion |
| Room/account retained | Migration tests plus real-host smoke | Migration tests plus real-host smoke |
| Existing process reload | Verify desktop restart/new chat | Restart/new session after update |
| OAuth sign-in | Manual test account | Manual test account |
| Offline startup | Packaged runtime test without updater | Same; feeds still need network |

Do not report a desktop UI or OAuth test as passed based on manifest validation
or a subprocess handshake. Use a test room and account, add a saved link and
clip, update the package, restart, and confirm the room, account and retained
items. Keep the previous package and data backup until verification succeeds.
Uninstall can remove plugin data; consult the host's retention option.

## Current constraints

Old Claude Code releases may have no plugin commands. Upgrade the host before
attempting installation. Current Claude plugin updates explicitly require a
restart to apply. Codex marketplace refresh and plugin installation are separate
operations; do not promise that refreshing a catalog restarts a running server.
We do not add a self-updater until host testing demonstrates a need for one.

References: [Agent Plugins](https://agent-plugins.org/specification),
[OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins),
[Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).
