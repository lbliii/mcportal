# Build an Agent Plugins package

MCPortal targets [Agent Plugins 1.0.0](https://agent-plugins.org/specification).
The repository root is the local plugin: `plugin.json` and `mcp.json` are generated
by `node scripts/distribution.ts`. Existing Claude packaging remains available.

Build into new directories outside the repository:

```sh
node scripts/plugin-package.ts hosted /tmp/mcportal-hosted
node scripts/plugin-package.ts local /tmp/mcportal-local
```

The hosted package contains skills, license, and a remote MCP connection to
`https://mcportal.lol/mcp`. The host discovers OAuth and manages credentials.
No Node installation is needed for this connection.

The local package additionally contains the runtime and requires Node 22.18 or
newer. Its MCP configuration resolves the launcher relative to `PLUGIN_ROOT`,
and selects `PLUGIN_DATA/mcportal` for user state. Client-managed data persists
across plugin upgrades; uninstall retention is determined by the host.
Existing source installations continue to use their existing directory.
Migration to plugin-managed storage is a separate step; do not delete old data.

The builder refuses existing destination directories and symlinks, and does
not copy repository configuration, credentials, tests, or development dependencies.
The package tests validate both variants against vendored official schemas and
initialize the packaged local server from outside its source checkout.

The host controls installation, updates, trust, and process restart. This package
does not require hooks or promise automatic updates in every host. Install only
one variant per host to avoid duplicate MCPortal tools.
