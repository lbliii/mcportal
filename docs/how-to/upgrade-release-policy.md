# Release and client support policy

Release preparation updates all manifests from the same package version. Publish
runs repository checks and builds hosted/local Agent Plugins archives with
SHA256SUMS before tagging. It attaches those artifacts to the GitHub release.
Checksums detect corruption; they are not an independent code-signing mechanism.

`release-support.json` records the enforced minimum, announcement and effective
dates, reason, and whether an emergency exception applies. It must match
`MIN_CLIENT_VERSION`. Routine version bumps do not raise the minimum.

For an ordinary minimum-version increase:

1. Publish a compatible replacement release containing both plugin archives and
   SHA256SUMS while the old minimum is still supported.
2. Announce the replacement and removal date to users. Record the public notice
   and reason in the change description and fill the policy dates.
3. Allow at least 30 days between announcement and enforcement.
4. Raise the minimum only once the effective date has elapsed, then run
   `npm run support:check -- <previous deployed commit or tag>` before deployment.

The CI gate compares with the PR base or previous main commit and reads public
GitHub release metadata when the minimum increases. Publish compares against the
previous release tag. A missing/draft replacement, missing assets, future dates,
or an inadequate window fails the gate. Emergency removals require an explicit
flag and reason; they still require a published replacement and elapsed dates.
Protect main with the Plugin upgrade compatibility job to enforce this in the
repository. Unprotected branches or deployments bypassing CI are outside that
control; the deployment operator must run the check against the deployed version.

Upgrade tests cover generated schemas, packaged initialization, migrated rooms
and account links, interrupted migration, unsupported-client rejection before
OAuth, existing sign-in, and release archive integrity. Real host OAuth and
process reload remain on the host smoke-test checklist.

Keep runtime and data backups for rollback. Migration preserves the old source;
it does not synchronize later edits backward. This release introduces no data
schema rewrite. Any future irreversible migration requires a separate rollback
plan before it can ship.
