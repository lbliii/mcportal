# Plan: one portal, run locally or hosted

**Status:** revised 2026-10-02 (replaces the 2026-09-30 proposal, which predated Postgres, the 0.5 tool names, clips and the social layer). Phases 1–6 built 2026-10-02 (modes in the open, contracts, hosted state API, remote stores, signing in and out, offline and polish); phase 7 (ship) next. **Milestone:** finishes M1.5 ("come back tomorrow on any device") and opens M2's social layer, reblogging first, to people who run MCPortal locally.

## The problem

Today there are two portals that don't know about each other:

- **Local** (stdio: the Claude Code plugin, the desktop bundle, the dev launcher). Data in `~/.mcportal`, no account.
- **Hosted** (Railway, `/mcp` with GitHub sign-in). Data in Postgres.

Signing in on the hosted site (`/account`) signs in a *browser*, not the local server. So an agent on a local portal can't answer "am I signed in?" with anything useful, and local users can't reach sharing or reblogging at all. Organizations that block remote custom connectors (the author's included) leave local as the only way in.

## Goal

One portal per person, three ways to run it, each obvious about which it is:

| Mode | Who | Account | State lives | Fetching | Social |
|---|---|---|---|---|---|
| **Hosted** | Connector users (eventually the connector directory) | Always (signed in when connecting) | Hosted | Hosted | Yes |
| **Local** | Contributors, privacy-minded people, first run of a local install | None | `~/.mcportal` | This machine | No |
| **Linked** | Local installs that sign in, including orgs that block remote connectors | The hosted account | Hosted | This machine | Yes |

A linked device and the hosted connector are the *same portal*: same room, saved items, clips, reading state, shares and follows.

## Design

### 1. Linked means local tools over hosted state

A linked local server runs every tool itself, exactly as it does today, but its `ToolContext` gets **remote implementations** of the storage and social interfaces that tools already depend on (`ProfileStore`, `ClipStore`, `ReadingStore`, `SeenStore`, `HandoffStore`, the social and public-profile services). The hosted server exposes those same interfaces over an authenticated API, scoped to the signed-in account.

Why this shape, rather than the alternatives:

- **Not forwarding MCP calls to `/mcp`.** That would fetch on Railway: cloud IPs get rate-limited more (on 2026-09-30 Reddit and nasa.gov answered 429 to Railway and worked locally), fetching is the bulk of the work and latency, and it would spend the hosted budget. Linked readers should be faster than hosted ones, not slower.
- **Not the old "ops" refactor.** Splitting every mutation into a serializable op meant rewriting most tools and keeping a second vocabulary in sync. `ProfileStore.update(change)` already says changes are synchronous and pure, so the remote store can use optimistic concurrency instead (below) and the rules stay in one place: the tools.
- **One codebase, one set of rules.** The hosted server's own tools and a linked device run the same tool code against the same contract. Tests run the contract against all three implementations (file, Postgres, remote).

Fetching, the reader, docs, thumbnails and the room app's assets stay local. Nothing about an unlinked local server changes.

### 2. The state API (`/api/v1`)

One endpoint, **`POST /api/v1/call`**, taking a batch of typed calls:

```
[{ "id": 1, "method": "clips.list", "params": { "query": "rust", "limit": 20 } },
 { "id": 2, "method": "room.get", "params": { "ifNoneMatch": 41 } }]
```

- **Methods mirror the interfaces**, one allowlisted entry each, with a param schema and an `access` class (read / write), all in one table (`src/api/methods.ts`). The dispatcher validates params, charges the budget, calls the same store or service the hosted tools use, and returns `{ id, result }` or `{ id, error: { code, message, retryable } }` using the existing error codes.
- **Other people's account ids never leave.** Where a profile would carry someone else's id, the API gives `@handle` instead and resolves it again when it comes back (`social.sharesOf`, `social.stats`); raw ids other than the caller's own are refused.
- **The account is never a parameter.** Every method acts as the token's account; the remote client drops the `userId`/`viewer` argument (and asserts it matches the linked account, so a mix-up is a bug, not a leak). This is the same rule as MCP tools.
- **A strict subset.** No `deleteAll`, no `import`, no admin or report-resolution methods, no account deletion. Those stay on the account page, the upload page and the admin page. `Social.forget`, `hideShare` and friends are never callable.
- **Batching** keeps `open_room` to one round trip: the room, seen sets and the Following feed in one request. Calls in a batch run concurrently and are independent; there are no cross-call transactions.
- **Why RPC rather than REST resources:** the interfaces are the contract already; one dispatcher means one place for auth, validation, budget, logging and metrics; batching is native. The only thing REST would buy is HTTP caching, and the room's revision check covers that.

**The room uses optimistic concurrency.** Profiles already carry `rev` in Postgres; file profiles gain it too.

- `room.get { ifNoneMatch? }` → `{ profile, rev }` or `{ unchanged: true }`.
- `room.put { profile, ifMatch }` → `{ rev }`, or a `conflict` error if the room changed elsewhere.
- `RemoteProfileStore.update(change)`: read the cached room (revalidated with `ifNoneMatch`), run `change` locally, `room.put` with `ifMatch`; on `conflict`, re-read and run `change` again (up to 3 times). `change` is pure and synchronous by contract, so re-running it is safe. Concurrent edits from two devices both land, the same as two hosted requests do today.
- The hosted side validates every `room.put` with `validateProfile` and rejects a room it can't parse; a client can't write anything the tools couldn't.

**Versions.** Every request sends `mcportal-client: <version>` and the API version is in the path.

- The hosted server answers `upgrade_required` (HTTP 426) for clients older than its minimum, with a message the tools pass on ("Update MCPortal to keep using your linked portal").
- A client that reads a room with a newer `version` than it understands refuses to write it (reads still work), so an old laptop can't clobber a newer schema.
- `me` returns the latest client version, so a local server can mention, once, that an update is available.

**Same boundaries as `/mcp`:** bearer tokens from the same OAuth server, Host allowlist, no CORS, body caps, per-account budget (1 unit per call; reads served as `unchanged` cost nothing).

### 3. Linking a device

The local server is a native OAuth client of the hosted server (authorization code + PKCE, loopback redirect, RFC 8252). The hosted OAuth server already supports dynamic registration, loopback redirects and rotating refresh tokens with reuse detection.

1. The user says "sign in" or "link my portal", or clicks **Sign in** on the room's account chip. `link_account` registers a client named "MCPortal on <computer name>", starts a one-shot listener on `127.0.0.1:<random port>`, and returns the authorize URL; the room opens it with `ui/open-link`.
2. The user sees MCPortal's consent screen, signs in with GitHub (invites apply), and lands on a "You're linked, you can close this tab" page served by the loopback listener.
3. The local server exchanges the code and writes `~/.mcportal/link.json` (mode 0600): hosted URL, account id, login, and tokens.
4. **First link merges this computer's portal into the account, additively**, using the existing import path (`importExport`): portals the account doesn't have, saved items and clips. Nothing is removed or reordered. If the account's room is empty, the local room becomes it as is. No dialog: additive is safe, and the result is visible straight away.
5. The local files are left untouched as a backup.

Token handling: refresh ahead of expiry; persist rotated refresh tokens atomically under a file lock (the dev launcher and two Claude windows can mean two processes, and reusing a spent refresh token revokes the grant); tokens never appear in tool results, the room, or logs.

**Unlinking:** `unlink_account` revokes the tokens (new `POST /oauth/revoke`, RFC 7009), copies the hosted room back into the local files additively (so nothing the user saved while linked disappears), and deletes `link.json`. The account page also lists linked devices with a **Revoke** button, so a lost laptop can be cut off from anywhere.

### 4. Tools and the room

Following the tool-surface plan (specific tools, scoped to who's calling):

- **`account_settings`** (all modes) says which mode this is, in one sentence the model can repeat: "Hosted, signed in as @lbliii", "Linked to mcportal-production as @lbliii, synced 12 s ago", or "Local, not signed in; say 'sign in' to sync this portal and share". It keeps the link to the account page.
- **`link_account`**: listed only on an unlinked local server.
- **`unlink_account`**: listed only when linked. Marked destructive.
- Social tools are listed on a linked server exactly as on the hosted one (the same `Reach` rules).
- **Room:** an account chip in the toolbar. Local: a quiet **Sign in**. Linked or hosted: the avatar, with "@lbliii · synced 12 s ago" or "offline: showing your last synced portal". The welcome screen on a local install gets a secondary "Already have a portal? Sign in" option.

### 5. Offline, caching and performance

- **Reads:** the room is cached in memory and revalidated after 30 s (`ifNoneMatch`, which costs nothing when unchanged). If the hosted server can't be reached, cached reads keep working with the offline notice, and feeds still load (they're fetched locally).
- **Writes the user asked for** (save, clip, arrange, share) fail clearly when offline ("can't reach your hosted portal; nothing was changed"). Queueing would bring conflicts back for something that's rare and visible.
- **Background writes** (seen marks, reading progress) are best-effort: they're batched, retried once, then dropped and logged. Losing a "seen" mark is harmless; failing a reader page over it isn't.
- **Connection reuse:** one keep-alive agent to the hosted server; batches for multi-call tools.

### 6. Fetch fallback (later)

A hosted relay (`POST /api/v1/fetch`) used only on network-level failures (DNS, refused, reset, timeout, TLS), never on 403 or 429, plus an opt-in "fetch through MCPortal" privacy setting. Same guarded fetcher, GET only, authenticated, budgeted. Valuable for locked-down networks but not needed for linking, so it's its own phase after this ships.

## Security notes

- The state API is a subset of what the signed-in user's own tools can already do, with the same account scoping; no method takes an account id.
- Linking connects an account, so it always goes through the browser consent screen, never silently. The device's name is on the consent screen and in the account page's device list.
- `link.json` holds bearer credentials: 0600, never logged, never returned to the model, deleted on unlink, revoked server-side.
- The loopback listener binds 127.0.0.1 only, accepts one request with the expected `state`, and closes.

## Phases

| # | Phase | Ships | Verifies |
|---|---|---|---|
| 1 | Modes in the open | `account_settings` names the mode; the room's account chip (local: "Local · not signed in", hosted: avatar) | "Am I signed in?" gets a correct answer in every mode |
| 2 | Contracts | Tools see social and public profiles through `SocialService` and `ProfileDirectory` (moderation left out); every profile store has `versioned()` and `replaceIf()` with revisions (files keep `rev` beside the profile); the contract suite covers revisions on files, memory and Postgres | No behavior change; existing tests pass |
| 3 | Hosted state API | `/api/v1/call` with batching, the method table, version header and 426, `room.get`/`room.put` with revisions, `POST /oauth/revoke`, linked devices on the account page | In-process: two clients, concurrent edits, conflicts retried, a stale schema refused, revocation, budget, no account id accepted |
| 4 | Remote stores | `src/link/client.ts` (batched per tick, one refresh on 401, coded errors) and `src/link/stores.ts` (every interface the tools use; the room cached 30 s with revisions and conflict retry; a newer room is read-only) | `test/linked.test.ts`: the real tools on a linked context against an in-process hosted app over HTTP: rooms, clips, reading, handoffs, two devices editing at once, sharing and following, batching, offline, signed out, newer schema. The store-level contract suite stays for files and Postgres, since remote stores deliberately don't offer `deleteAll` or imports |
| 5 | Linking | `src/link/signin.ts` (loopback OAuth; the resource from the server's metadata), `link-file.ts` (0600, refresh under a cross-process lock), `session.ts` (local or linked per request; first-link merge and sign-out copy-back through `/api/v1/import` and `/api/v1/export`, so they're one request each and keep clip dates), `link_account`/`unlink_account`, the room's account menu; `npm start` signs in too | `test/link-signin.test.ts`: sign in through consent and fake GitHub, merge, linked tools, sign out with copy-back and revocation; tampered and cancelled callbacks; two processes refreshing at once spend the refresh token once |
| 6 | Offline and polish | Offline: the room as last synced with a notice and a dotted chip ("offline" in the account menu); seen sets best effort; changes fail clearly. A newer hosted MCPortal is mentioned once. Welcome-screen notices are no longer dropped | `test/linked.test.ts` offline test; `test/link-signin.test.ts` identity, offline and nudge |
| 7 | Ship | README, CONTRIBUTING, privacy page, onboarding copy; deploy; the author links their Mac | The author's Mac and the hosted connector show the same portal, and sharing works from the Mac |
| Later | Fetch fallback | `/api/v1/fetch`, fallback on network failures, privacy setting | Falls back on DNS/timeout, not on 403/429; refuses private IPs |

Phases 1–3 are safe to deploy on their own. Phase 5 is the first time a local install talks to the hosted server.

## Decisions

Proposed defaults; each is reversible before phase 5 ships.

1. **State API shape:** batched RPC mirroring the store interfaces, rather than REST resources or forwarding MCP calls.
2. **First link:** merge additively without asking, rather than a "keep this computer's room or the hosted one" dialog.
3. **Unlink:** copy the hosted portal back to the local files, so unlinking never loses anything.
4. **Offline writes:** fail clearly for user actions, best-effort for seen marks and reading progress.
5. **Who can link:** anyone who can sign in to the hosted server (the invite list while it's invite-only).

## After this

- **Onboarding:** with linking in place, a local install has one obvious upgrade ("sign in to sync and share"), and a hosted user has nothing to install. The onboarding pass measures time from install to first room on each path (connector, desktop bundle, Claude Code plugin) with a scratch `MCPORTAL_DATA_DIR`, and fixes what's slow or confusing, including a GitHub-hosted plugin marketplace instead of a local path.
- **Reblogging:** builds on shares, follows and the Following portal, now reachable from local installs too.
