# Contributing

Thanks for helping with MCPortal. Bug reports, ideas and pull requests are all welcome.

- **Issues** are the place for bugs, questions and proposals. Search first; add to an existing one if it fits.
- **Small fixes** (typos, clear bugs, a failing source) can go straight to a pull request.
- **Larger changes** (a new tool, a change to the tool interface, storage or auth) should start as an issue, so we can agree on the shape before you write the code.
- **Security problems** go privately, not in an issue. See [SECURITY.md](SECURITY.md).

By contributing, you agree that your work is licensed under the project's [AGPL-3.0 license](LICENSE).

## Set up

You need Node **22.18+** (or any Node 24). Node runs the `.ts` files directly; there's no build step.

```bash
git clone https://github.com/lbliii/mcportal.git
cd mcportal
npm install
npm run check
```

`npm run check` type-checks the server and the UI, checks the generated design files, and runs every test. It's the gate for every pull request and also runs in the plugin upgrade compatibility workflow on GitHub. To run it before each push:

```bash
git config core.hooksPath .githooks
```

Other commands you'll use:

```bash
npm test          # the offline test suite
npm run demo      # the room with canned data and no network
npm start         # the room with live data
npm run smoke     # a live check against Hacker News, GitHub and an RSS feed (needs network)
```

`npm start` and `npm run demo` serve the room at **http://127.0.0.1:8787/preview**. Use `127.0.0.1`, not `localhost`: the server binds IPv4 only, and some browsers try `::1` first.

## Develop against Claude desktop

This shows the room rendering inline in a real chat, with no deployment or sign-in. Claude desktop launches the server from your checkout over stdio.

1. Find the absolute path to Node with `which node`. Claude desktop doesn't use your shell's `PATH`.
2. Add `mcportal` to `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json` (on Windows, `%APPDATA%\Claude\claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "mcportal": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/path/to/mcportal/bin/mcportal-dev.mjs"]
       }
     }
   }
   ```

3. Quit and reopen Claude desktop, start a new chat and ask "open my room".

`bin/mcportal-dev.mjs` holds Claude's connection open and restarts the real server behind it whenever a `.ts` file under `src/` changes, so:

- **Server code** is live on the next tool call.
- **Room UI** is read fresh each time a card opens. Ask for the room again to see a change; a card already in the chat is frozen.
- **Tool names, descriptions and schemas** may be cached per chat. Start a new chat, or restart Claude if a change doesn't show.

Reload messages go to stderr, which appears in Claude desktop's MCP logs. Your profile lives in `~/.mcportal/default.json`. To try a new user's first run without touching it, set `MCPORTAL_DATA_DIR` to a scratch directory in the `env` of that config entry.

To check the stdio server without Claude:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | node bin/mcportal.mjs --stdio
```

## Develop against Claude Code

Install your checkout as a local plugin, which adds the `/portal` command and skill:

```text
/plugin marketplace add /path/to/mcportal
/plugin install mcportal@mcportal
```

## Conventions that matter

The [architecture explanation](docs/explanation/architecture.md) covers how the pieces fit. These are the rules reviewers check:

- **Tools** live in `src/tools/`, one module per area. Each declares its `access` (`read`, `write` or `fetch`) and its budget `cost`. Keep `inputSchema` exactly as strict as the handler: if the handler trims or normalizes a value, the schema shouldn't refuse it.
- **Results the UI reads** are one typed contract in `src/tools/results.ts`. A handler checks its `structuredContent` with `satisfies ToolResults['tool']`.
- **Errors**: throw an `AppError` (`src/lib/errors.ts`) with a code from `ERROR_CODES` for anything expected, and branch on `error.code`, never on message text. Anything else is treated as a bug.
- **Logs**: use the logger you're given (`ctx.log` in tools) with an event name and flat fields. Never log tokens, profile contents, third-party text or raw user ids; `userRef()` hashes an id.
- **Layout changes** go through `src/layout.ts`, which never moves or drops the user's other portals or saved items.
- **The room UI** is plain JavaScript type-checked through JSDoc. Type every function, and add new element ids to `src/ui/ui.d.ts`. A new view or flow gets a test in `test/ui-browser.test.ts`, which drives the real room in headless Chrome (set `CHROME_PATH` if it can't find one).
- **Linked mode**: a store method the tools start using needs a state API method in `src/api/` and a remote version in `src/link/`. `test/linked.test.ts` runs the real tools against an in-process hosted server.
- **Avoid new runtime dependencies.** Locally MCPortal has none; the hosted server adds only `pg`. Raise a new one in an issue first.
- **The tool interface is a public contract.** Read the [compatibility policy](docs/how-to/release.md#compatibility) before renaming or changing a tool.
- **The fetch and OAuth boundaries** stay consistent with the [security model](docs/explanation/security.md).
- **Screenshots** on the landing page and in the README come from `node scripts/screenshots.ts`: each is a chat turn with the real room in an MCP Apps frame, captured by headless Chrome. It fetches feeds and docs live, so retake them when the UI changes visibly, and check that each agent reply still matches the page it shows. `--serve` lets you look before capturing.

## Plan and track work

Use [GitHub Issues](https://github.com/lbliii/mcportal/issues) for tasks and research, native sub-issues for epic breakdowns, and milestones for delivery outcomes. The [tracking guide](docs/how-to/track-work.md) explains labels, dependencies, triage and completion. Check existing issues and open PRs before starting an implementation.

The issue chooser includes bug, feature, task, research and epic forms. Use the PR template to describe the resulting behavior and actual validation; link a parent epic without closing it unless its whole outcome is complete.

After completing a milestone or changing its scope, run `npm run planning:check`. The [planning flywheel](docs/how-to/planning-flywheel.md) explains the automatic research queue and how we keep the next two milestones prepared.

## Before you open a pull request

- `npm run check` passes.
- If you touched storage (`src/db.ts`, `src/db/`, `src/store.ts`, `src/auth/store.ts`), run the Postgres tests. They skip unless `TEST_DATABASE_URL` is set, and each run uses its own schema. A throwaway local cluster works:

  ```bash
  initdb -D /tmp/mcportal-pg -U postgres -A trust
  pg_ctl -D /tmp/mcportal-pg -o "-p 55432" start
  TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres \
    node --test test/db.test.ts test/store-contract.test.ts test/privacy-db.test.ts
  pg_ctl -D /tmp/mcportal-pg stop
  ```

- If you touched an adapter or `src/lib/safe-fetch.ts`, run `npm run smoke`.
- If you touched the brand (`scripts/brand.ts`), run `npm run brand` and commit what it writes. Brand files are generated; see [brand/README.md](brand/README.md).
- If you touched design tokens or shared controls, run `npm run design` and commit its outputs. See the [design system reference](docs/reference/design-system.md).
- If your change is visible to users or agents, add a line under "Unreleased" in [CHANGELOG.md](CHANGELOG.md). Don't change the version; releases do that ([Cut a release](docs/how-to/release.md)).
