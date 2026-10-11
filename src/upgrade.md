# Upgrade MCPortal

This server runs **MCPortal {{VERSION}}**. [Read the release notes](https://github.com/lbliii/mcportal/releases/tag/v{{VERSION}}).

## Start here

Open **Settings → Updates**, or ask your agent: “Check my MCPortal version and help me update the installation I am actually using.” If your copy has no Updates section, follow the installation steps below once. Old copies cannot receive an update notice that was added after you installed them.

Keep one MCPortal connection enabled in each host. Before removing a duplicate, verify which connection has your room and whether it stores data locally or in your hosted account. Restarting an old local copy does not download new software.

## Hosted connection

If your connector URL is **{{PUBLIC_URL}}/mcp**, the service operator deploys updates for you. Open a new room card. If it still looks old, refresh or reconnect the MCP connection and start a new conversation; hosts may retain previously opened cards and cached tool definitions. No reinstall or data migration is needed.

If you operate your own server, use the [deployment guide](https://github.com/lbliii/mcportal/blob/main/docs/how-to/operate.md) and deploy a tested release tag.

## Local plugin

Your host manages the installed package. Use its plugin manager to update the existing MCPortal installation, then reload the plugin or start a new session as the host directs. Refreshing a marketplace catalog alone may not update the installed package.

For the existing Claude Code marketplace installation, run this in your terminal:

```sh
claude plugin update mcportal@mcportal
```

In Claude Code, run **/reload-plugins** to apply a downloaded update, or start a new session. To receive future updates automatically, open **/plugin → Marketplaces → mcportal → Enable auto-update**. Third-party marketplaces do not enable this by default. See [Claude's update instructions](https://code.claude.com/docs/en/discover-plugins#keep-plugins-updated).

In Codex, update through the plugin manager for the marketplace or package you installed, then reload the connection or restart the app. For local development marketplaces, update the source package first. See [Codex plugin instructions](https://developers.openai.com/plugins/build/plugins). For Cowork, use its plugin update controls and follow its reload prompt; Claude Code terminal commands apply only to Claude Code installations.

Do not uninstall to update: some hosts remove plugin data when uninstalling. Preserve the host's persistent plugin-data directory and account link. Downloaded archives are attached to the [versioned release](https://github.com/lbliii/mcportal/releases/tag/v{{VERSION}}); choose the same hosted or local variant and verify its SHA256SUMS before replacing package files. A checksum detects corruption; it is not a signature.

## Local source checkout

Find the checkout named in your host's MCP launch command; updating another checkout has no effect. Stop that MCP connection, back up its data directory (normally ~/.mcportal, or MCPORTAL_DATA_DIR), and inspect local changes:

```sh
git status --short
git fetch origin --tags
```

If the checkout has changes, preserve them and resolve the upgrade with your agent before proceeding. Do not reset or overwrite them. For an unchanged checkout, select this versioned release:

```sh
git switch --detach v{{VERSION}}
```

Use Node.js 22.18 or newer. Local stdio runs without npm install. A self-hosted process using Postgres also needs the release's runtime dependencies. Restart the MCP connection, open a new room, and check the version again. Your data directory stays in place.

## Move a local room to hosted

Hosted is the recommended installation for people who want deployments to arrive without maintaining a local runtime. Local mode remains supported; moving is optional.

First update the local copy and export a backup. While it is still the only active connection, sign in through **Settings → Account** to add its room to your hosted account. Verify your sources, saved items and clips there. Then disable the local connection, add the [hosted connection]({{PUBLIC_URL}}/install.md), sign in to the same account and verify the room again. Keep the local data and export until verification succeeds. Signing in synchronizes data; it does not update a local copy's code.

If moving from a source checkout to a local plugin instead, use the [explicit data migration guide](https://github.com/lbliii/mcportal/blob/main/docs/how-to/agent-plugin.md#move-an-existing-local-installation). Do not run two copies against a migration in progress.

## Update notices and privacy

New local copies check public version metadata at most once a day while used when automatic checks are enabled. Signed-in local copies default to automatic checks. Ghost mode defaults to no automatic checks: choose **Check now** or turn on **Check automatically** in Settings. Checks send no room content, account credentials or installation identifier; the version service receives an ordinary HTTP request, including the network address.

An optional update notice stays until dismissed. Dismissal is saved for that version on this installation; a later release can notify you again. Settings always keeps the update status and guide available. Required updates cannot be dismissed. A failed check never blocks local reading or erases the last confirmed update; the UI shows when the information is stale. Checks do not download or install code.

## Verify and recover

After upgrading, check **Settings → Updates** for the installed version. Open your room, one saved item and one clip; confirm sign-in or ghost mode is as expected. If a card says a different version is running, reconnect and open a fresh card.

Keep the previous runtime and a data backup until verification succeeds. If an upgrade fails, stop the new process and consult that release's migration and rollback notes before restoring the previous runtime. Do not overwrite current data with a backup without accounting for changes made since it was taken. Ask for help through [Support]({{PUBLIC_URL}}/support).
