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

`publish` tags the merge commit `v<version>` and creates the GitHub release `MCPortal v<version>` with that version's changelog section as its notes. `--dry-run` shows what it would tag.

## 4. Deploy the same commit

Deploy the tagged commit to the hosted service, not whatever `main` has become since. Follow [Operate a hosted MCPortal](operate.md#deploy-a-release), and confirm `/health` reports the new version.

## How people get the release

| Install | How it updates |
|---|---|
| Hosted connector | On the next deploy. Nothing to do. |
| Claude Code or Cowork plugin | A marketplace you add yourself doesn't auto-update by default. Users turn it on in `/plugin` → **Marketplaces** → `mcportal` → **Enable auto-update**, or run `claude plugin update mcportal@mcportal`. The release arrives in their next session. |
| A clone (Codex, Claude desktop) | `git pull`, then restart the host. |

## Compatibility

Hosts cache tool lists and agents learn tool names, so the tool interface is versioned with the package. The interface is tool names, arguments, and the results described in `src/tools/results.ts`.

- **Breaking changes raise the minor version** while MCPortal is below 1.0. A renamed or removed tool or argument, a stricter schema or a different result shape is breaking. Note it under "For hosts and agents" in the changelog.
- **A renamed tool keeps its old name for one release,** as an unlisted alias that says where the tool moved. A removed tool says what replaces it, for one release.
- **`MIN_CLIENT_VERSION`** in `src/api/calls.ts` is the oldest local MCPortal the hosted state API accepts; older ones are told to update. It rises only in a release whose notes say so, never in passing. The release script never changes it.
- **Renaming a tool or the connector** that's listed in a directory also needs an edit to that listing, which is reviewed again.
