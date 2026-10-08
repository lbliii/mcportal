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

## Move an existing local installation

Stop the old MCPortal connection before copying, and keep it stopped until the
new connection is working. This prevents a running server from changing files
while they are copied. Find the new plugin's persistent data directory in your
host; do not use its versioned installation directory.

```sh
node bin/migrate-data.mjs /absolute/path/to/old/.mcportal /absolute/path/to/plugin-data/mcportal
```

Run this from the local package using Node 22.18 or newer. The destination must
not contain an existing room; migrate before the first launch. The copy retains
nested reading state and account links. It leaves the old directory untouched,
refuses symlinks and special files, and publishes the new directory only after
the copy completes. Repeating a completed migration leaves the new room intact.
If a migration is interrupted, confirm no migration process is running before
removing the sibling `.migration-lock` directory and retrying. Do not merge two
active data directories with this command.

Keep the source until you have opened the new room and confirmed sign-in. A copy
in the same filesystem is not a substitute for your normal backup. Switching
back to the source restores its pre-migration state, not edits made afterward.

## Sign-in compatibility

`GET /.well-known/mcportal` publishes the minimum supported and recommended
client versions, upgrade documentation, and linked-state capabilities without
requiring an account. Local sign-in checks it before opening a callback listener
or registering OAuth. Unsupported clients receive an update action in the room;
a compatible older version can still sign in with an update notice. A failed or
unsupported compatibility check permits the existing OAuth flow to continue
with a notice; the authenticated state API still enforces the minimum version.
