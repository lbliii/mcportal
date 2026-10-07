# Local and hosted

MCPortal runs on your own computer or as a hosted service, and a local copy can sign in to a hosted account. This page explains the modes, what runs where in each, how storage is chosen, and why linking works the way it does. To set one up, see [install](../how-to/install.md) or [self-host](../how-to/self-host.md).

## One portal, three ways to run it

| Mode | How you connect | Account | Your room lives | Feeds are fetched by | Sharing |
|---|---|---|---|---|---|
| **Ghost mode** | Local plugin or desktop bundle (stdio), not signed in | None | Files on your computer | Your computer | No |
| **Linked** | The same local install, signed in | Your hosted account | The hosted service | Your computer | Yes |
| **Hosted** | The hosted connector at `/mcp` | Your hosted account | The hosted service | The hosted service | Yes |

A linked computer and the hosted connector are the same portal: the same room, saved items, clips, reading history, shares and follows. Sign in on your laptop, and the room you see in a hosted chat is the one you just arranged.

Every mode says which one it is. The room's toolbar ends with an identity chip: a ghost with a dashed outline in ghost mode, your handle when signed in, a dotted outline when a linked computer is offline. Ask your agent "am I signed in?" and `account_settings` answers with the mode in one sentence.

### Ghost mode

Ghost mode is the default for a local install. Nothing leaves your computer except the feed and page requests themselves. There's no account, no handle and no sharing; the sharing tools aren't listed at all. Data lives in `~/.mcportal` (or `MCPORTAL_DATA_DIR`).

Ghost mode exists because some people want a reader that never reports to a service, and because some organizations block remote connectors. For them, local is the only way in.

### Linked

A linked computer runs every tool itself, exactly as in ghost mode. The difference is where the tools read and write. Its `ToolContext` holds remote versions of the stores (room, clips, reading, seen marks, handoffs, editions, social and public profiles), which call the hosted state API instead of touching files.

Fetching, the reader, docs pages, thumbnails and the room's assets stay on your computer.

### Hosted

The hosted service runs the same tools against Postgres and fetches from its own servers. You connect it as a custom connector and sign in with GitHub when you do. It's the simplest path: nothing to install.

## Why linking keeps fetching local

The obvious design would forward a linked computer's MCP calls to the hosted `/mcp`. MCPortal doesn't, for three reasons.

- **Cloud addresses get refused more.** Some sites rate-limit or block cloud provider IP ranges and answer a home connection normally.
- **Fetching is most of the work.** It's where the time goes and what the hosted usage budget pays for. A linked computer should be faster than the hosted service, not slower.
- **One set of rules.** The hosted tools and a linked computer run the same tool code against the same store interfaces. The contract tests run against files, Postgres and the remote stores, so the rules live in one place: the tools.

An earlier idea, splitting every change into a serializable operation, would have meant rewriting most tools and keeping a second vocabulary in sync. Optimistic concurrency on the room avoids that (below).

## The state API

A linked computer talks to one endpoint, `POST /api/v1/call`, which takes a batch of up to 20 typed calls:

```json
[{ "id": 1, "method": "clips.list", "params": { "query": "rust", "limit": 20 } },
 { "id": 2, "method": "room.get", "params": { "ifNoneMatch": 41 } }]
```

Methods mirror the store interfaces, one allowlisted entry each, with a parameter schema and an access class, in one table (`src/api/methods.ts`). The dispatcher validates, charges the budget and calls the same store the hosted tools use. Calls in one tick go out as one batch, so `open_room` costs one round trip.

It's RPC rather than REST because the interfaces are already the contract, one dispatcher means one place for auth, validation, budget and logging, and batching comes free. REST's one advantage, HTTP caching, is covered by the room's revision check.

The API is a strict subset of what your own tools can do:

- Every call acts as the token's account. No method takes an account to act as.
- Other people's account IDs never leave the server; they appear as `@handle`.
- The server re-checks what a store would otherwise trust: a room goes through `validateProfile`, a clip is rebuilt with an ID and size the server sets, a share names a clip or saved item the server looks up.
- Deleting everything, imports, moderation, admin and account deletion are not methods. Those stay on the account, upload and admin pages. Export and import for linking go through `GET /api/v1/export` and `POST /api/v1/import`, one request each.

### Two devices, one room

Rooms carry a revision that every write increments, in files and in Postgres alike.

1. A linked computer reads the room with `room.get`, cached for 30 seconds. Revalidating with `ifNoneMatch` is free when nothing changed.
2. To change it, the computer runs the tool's change locally and sends `room.put` with `ifMatch`.
3. If another device changed the room in between, the server answers `conflict`. The computer re-reads and runs the change again, up to three times.

This is safe because a room change is pure and synchronous by contract. Two devices editing at once both land, as two hosted requests do.

### Versions

Every request names its client version. The server answers `426 upgrade_required` to clients older than it supports, with a message the tools pass on. A client that reads a room saved by a newer MCPortal can read it but refuses to write it, so an old laptop can't overwrite a newer format. A newer hosted version is mentioned once.

## Signing in and out

A local MCPortal is an OAuth client of the hosted service: authorization code with PKCE and a loopback redirect (RFC 8252).

1. You say "sign in to MCPortal" or click **Sign in** on the identity chip. `link_account` registers a client named for your computer, starts a one-shot listener on `127.0.0.1`, and returns the sign-in URL.
2. You approve on MCPortal's consent screen, which names the computer, and sign in with GitHub.
3. The computer writes `~/.mcportal/link.json` (mode 0600) with the hosted URL, your account and tokens.
4. **Your local portal merges into the account, additively.** Portals the account lacks, saved items, clips and reading history are added; nothing is removed or reordered. Additive is safe, so there's no "keep which room?" dialog. The local files stay as a backup.

**Signing out** (`unlink_account`) copies the hosted room back to the local files, again additively, revokes the token (RFC 7009) and deletes `link.json`. Nothing you saved while linked disappears. The account page lists every signed-in app and computer with **Revoke**, so a lost laptop can be cut off from anywhere.

Refresh tokens rotate, and reusing a spent one revokes the whole sign-in. Two local processes (the dev launcher and two app windows, say) could race, so refreshes are serialized across processes with a lock file.

## Offline

- **Reads** keep working. The room shows as last synced, with a notice, and feeds still load because they're fetched locally.
- **Changes you ask for** (save, clip, arrange, share) fail clearly: "can't reach your hosted portal; nothing was changed". Queueing them would bring back conflicts for something rare and visible.
- **Background writes** (seen marks, reading progress) are best effort. Losing a seen mark is harmless; failing a page over it isn't.

## Storage: files or Postgres

Storage is chosen once, at startup.

- **No `DATABASE_URL`:** files in the data directory. Each store writes its own files (`clips/`, `reading/`, `seen/`, `handoffs/` and so on) with a per-user mutex and atomic, private file replacement. A stdio server always uses files.
- **`DATABASE_URL` set:** Postgres. Each store has a table (`mcportal_profiles`, `mcportal_clips`, `mcportal_reading`, `mcportal_seen`, `mcportal_shares` and others). Shared documents such as accounts, public profiles and OAuth state are rows in `mcportal_kv`. The schema version is in `mcportal_meta`, and tables upgrade in place on start.

`/health` reports which one is in use and answers 503 when storage can't be reached.

Why both? Files mean a local install needs nothing but Node.js, and a contributor can read their data with a text editor. Postgres gives the hosted service transactional writes, row locks across instances, and point-in-time recovery. The store contract tests keep the two honest.

Files suit one writer per data directory. Postgres updates merge atomically across server processes, though other in-memory state (budgets, pending sign-ins) still assumes one instance.

Moving between them uses the MCPortal export: export from one, import into the other. Imports only add. A server started against an empty database also copies any profile and sign-in files from the data directory once, never overwriting rows.

## Static-token and local HTTP servers

Two smaller setups use the same code:

- **`npm start`** serves HTTP on `127.0.0.1` with no authentication. It behaves like a local stdio install, including ghost mode and signing in. It refuses to listen on a public address without auth.
- **A static token** (`MCPORTAL_TOKEN`) runs a single-user server without GitHub sign-in, for a private self-hosted instance.

See [configuration](../reference/configuration.md) for every variable.
