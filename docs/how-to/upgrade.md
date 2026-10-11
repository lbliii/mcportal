# Upgrade an existing installation

Use the [public upgrade guide](https://mcportal.lol/upgrade), or give your agent
[the Markdown version](https://mcportal.lol/upgrade.md). It covers hosted connections,
local plugins, source checkouts, optional migration to hosted, data preservation,
verification and recovery.

The guide is maintained in [src/upgrade.md](../../src/upgrade.md). Each instance
serves it with its own origin and running release version, so instructions name
the correct endpoint and release tag. No separate copy is maintained here.

For release operators, see [Cut a release](release.md) and
[client support policy](upgrade-release-policy.md). A release is complete only when
the versioned packages, tagged hosted deployment and public guide agree. Verify
both a previous installed package and a newly opened UI, not just a repository
checkout. Refresh the concise release highlights in `src/updates.ts` when cutting
another release.

For existing users who cannot yet see notices, publish the guide with the release
in the original distribution channels. New update-check code cannot reach an
unchanged old local installation. Do not claim that publishing a release has
notified or upgraded every user.
