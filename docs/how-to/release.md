# Cut a release

Turn what's merged on `main` into a versioned release, then deploy it. Releases matter because plugin users only receive changes when the version changes: a merge alone reaches nobody.

You need push access to the repository, the [GitHub CLI](https://cli.github.com/) signed in, and a checkout with `npm install` run in it.

## 1. Prepare

From an up-to-date `main` with nothing uncommitted:

```bash
git switch --detach origin/main
npm run release -- prepare 0.9.0
```

`prepare` takes a version (`0.9.0`) or `patch`, `minor` or `major`. It:

1. sets the version everywhere it's stated (`package.json`, the lockfile, `.claude-plugin/plugin.json`, `src/mcp.ts`) and regenerates `server.json` and `manifest.json`;
2. moves the changelog's "Unreleased" section under the new version, dated today;
3. runs `npm run check`;
4. commits to a `release/v<version>` branch, pushes it, and opens a pull request whose description is the release notes.

It refuses if "Unreleased" is empty, the version is older than the current one, or the tag already exists. Add `--dry-run` to see the version and notes without changing anything.

Never change the version by hand. `npm test` checks that every file agrees.

## 2. Merge

Review the release pull request like any other and merge it.

## 3. Publish

From the merged `main`:

```bash
git switch --detach origin/main
npm run release -- publish
```

`publish` reruns the checks and support-policy gate, packages the hosted and local plugins with SHA256SUMS, tags the merge commit `v<version>`, and attaches those artifacts to the GitHub release `MCPortal v<version>`. Its notes come from that version's changelog section. `--dry-run` shows what it would tag.

## 4. Deploy the same commit

Deploy the tagged commit to the hosted service, not whatever `main` has become since. Follow [Operate a hosted MCPortal](operate.md#deploy-a-release), and confirm `/health` reports the new version.

## How people get the release

| Install | How it updates |
|---|---|
| Hosted connector | On deployment. Open a new room card; reconnect if the host still caches the old interface. |
| Claude Code plugin | Enable auto-update for the MCPortal marketplace, or run `claude plugin update mcportal@mcportal`, then `/reload-plugins` or start a new session. |
| Other plugin hosts | Update the existing package through the host's plugin manager and follow its reload prompt. Preserve persistent plugin data. |
| A source checkout (Codex, Claude desktop) | Update the checkout actually named in the MCP launch command to the release tag, preserve data, then restart the connection. |

The [upgrade guide](upgrade.md) gives the full steps. Update the release highlights in `src/updates.ts` before preparing each release and put a link to the public guide in its release notes. Verify the installed version, available-version metadata, guide and packaged manifests agree after deployment.

From the release introducing update notices onward, local installations can check public metadata daily, preserve a known notice while offline, and dismiss optional notices per version. Linked copies default to automatic checks; ghost copies explicitly opt in. Settings always provides version details and a manual check. Checks never install software. Hosted room cards show the running release's highlights.

Copies installed before these notices still need one manual upgrade. Publish the guide in the original distribution channel with the release; publishing new code cannot notify an unchanged old local process. Do not raise the minimum supported client just to advertise an improvement; the [support policy](upgrade-release-policy.md) governs that separately.

## Compatibility

Hosts cache tool lists and agents learn tool names, so the tool interface is versioned with the package. The interface is tool names, arguments, and the results described in `src/tools/results.ts`.

- **Breaking changes raise the minor version** while MCPortal is below 1.0. A renamed or removed tool or argument, a stricter schema or a different result shape is breaking. Note it under "For hosts and agents" in the changelog.
- **A renamed tool keeps its old name for one release,** as an unlisted alias that says where the tool moved. A removed tool says what replaces it, for one release.
- **`MIN_CLIENT_VERSION`** in `src/api/calls.ts` is the oldest local MCPortal the hosted state API accepts; older ones are told to update. It rises only in a release whose notes say so, never in passing. The release script never changes it.
- **Renaming a tool or the connector** that's listed in a directory also needs an edit to that listing, which is reviewed again.
