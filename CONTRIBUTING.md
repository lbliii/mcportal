# Contributing

MCPortal runs from a checkout with no build step. Node **22.18+** runs the `.ts` files directly.

```bash
git clone git@github.com:lbliii/mcportal.git ~/Developer/mcportal
cd ~/Developer/mcportal
npm test            # offline test suite
npm run demo        # canned data, no network
npm start           # live data
```

Open the room at **http://127.0.0.1:8787/preview**. Use `127.0.0.1`, not `localhost`: the dev server binds IPv4 only, and some browsers resolve `localhost` to `::1` first.

## Develop against Claude desktop

This is the fastest way to see the room render inline in a Claude chat. It doesn't need a deployment, sign-in, or permission to add custom connectors: Claude desktop launches the server from your checkout over stdio and lists it under Connectors.

1. Find your Node path with `which node`. Claude desktop doesn't use your shell's `PATH`, so it needs the absolute path.
2. Add `mcportal` to `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json` (on Windows, `%APPDATA%\Claude\claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "mcportal": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/Users/<you>/Developer/mcportal/bin/mcportal-dev.mjs"]
       }
     }
   }
   ```

3. Quit and reopen Claude desktop.
4. In a new chat, ask **"open my room"**.

Your profile lives in `~/.mcportal/default.json`.

`mcportal-dev.mjs` keeps Claude's connection open and runs the real server behind it. When a `.ts` file under `src/` changes, it restarts the server and replays the connection handshake, so Claude doesn't notice. What that means for your edits:

- **Server code** (`src/**/*.ts`): live on the next tool call. No Claude restart needed.
- **Room UI** (`src/ui/room.html`, with its styles and script split into fragments under `src/ui/room/*`, inlined by `roomHtml()` in `src/mcp.ts`; new fragments must be added to `UI_INCLUDES`): read fresh each time a card opens. Ask Claude to open the room again to see changes. A card that's already in the chat is frozen, because it's sandboxed and can't reload itself.
- **Tool names, descriptions or schemas**: Claude may cache the tool list per session. Start a new chat, or restart Claude if a change doesn't show.

Reload messages go to stderr, which shows up in Claude desktop's MCP logs. To run without hot reload, use `bin/mcportal.mjs` with `--stdio`.

To check the stdio server without Claude:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | node bin/mcportal.mjs --stdio
```

## Develop against Claude Code

Install the repo as a local plugin, which includes the `/portal` command and skill:

```
/plugin marketplace add ~/Developer/mcportal
/plugin install mcportal@mcportal
```

## How the server code fits together

- **Tools** live in `src/tools/`, one module per area. Each `ToolDef` declares its `access` (`read`, `write` or `fetch`, for the access gate) and its budget `cost`; `test/foundations.test.ts` checks every tool does, and that `readOnlyHint` agrees. Arguments are checked against `inputSchema` before the handler runs, so keep the schema exactly as strict as the handler: if the handler trims or normalizes something, the schema shouldn't refuse it.
- **Errors**: throw an `AppError` (`src/lib/errors.ts`) or one of its subclasses with a code from `ERROR_CODES` for anything expected. Branch on `error.code`, never on message text. In a handler, `toolFailure(error, 'Not added: ')` turns an expected error into a tool error and rethrows bugs. Anything that isn't an `AppError` is treated as a bug: logged with its stack, shown to the user only as a reference.
- **Logs**: use the `Logger` you're given (`ctx.log` in tools, `deps.log` elsewhere), with an event name and flat fields: `log.warn('source.failed', { source, code })`. Never log tokens, profile contents, third-party text or raw user ids (`userRef()` hashes one).
- **Layout changes** go through `src/layout.ts` (`withLayout`, `addPortalTo`, `ensurePortal`), which never move or drop the user's other portals or saved items.

## Before opening a PR

- `npm test` passes, and `npm run typecheck` passes if you touched types.
- If you touched storage (`src/db.ts`, `src/store.ts`, `src/auth/store.ts`), run the Postgres tests too. They're skipped unless `TEST_DATABASE_URL` is set, and each run uses its own schema:

  ```bash
  TEST_DATABASE_URL=postgres://localhost:5432/postgres node --test test/db.test.ts
  ```
- `npm run smoke` passes if you touched an adapter or `safe-fetch` (needs network).
- If you touched the brand (`scripts/brand.ts`), run `npm run brand` and commit what it writes. Brand files are generated, not edited; see [brand/README.md](brand/README.md).
- If you touched design tokens or shared controls, run `npm run design`, commit its outputs, and run `npm run design:check`. Use the [design-system guide](docs/design-system.md) for theme contracts and the fixture browser workflow.
- Changes to the fetch or OAuth boundaries stay consistent with the security model in the [README](README.md#security-model).
