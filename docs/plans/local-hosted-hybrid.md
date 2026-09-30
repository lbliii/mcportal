# Plan: local + hosted MCPortal, used together

**Status:** proposed (2026-09-30). **Milestone:** foundation for M2 (light social); also finishes M1.5's "come back tomorrow on any device".

## Goal

One portal per person, wherever they use it. A local MCPortal (Claude desktop over stdio) and the hosted MCPortal (Railway) cooperate:

- **State lives on the hosted server** once a device is linked: layout, saved items, and later shares and follows. Every linked device, and the hosted connector, see the same portal.
- **Fetching happens locally** by default: home and office connections get blocked less than cloud IPs (on 2026-09-30 Reddit and nasa.gov answered 429 to Railway but worked locally), cost nothing, and aren't budgeted. The hosted server is a fallback for network-level failures.
- **Anything between people or while the laptop sleeps is hosted:** social features, digests, alerts.
- **Unlinked local MCPortal keeps working exactly as today.** Hosted-only users (directory connector) are unaffected.

It also gives users whose organizations block remote custom connectors (the author included) a route to hosted features: Claude talks to the local server, and the local server talks to the hosted account.

## Design

### 1. Split state changes out of the tools (`src/ops.ts`)

Today each tool both fetches and mutates the profile. Pull every mutation into pure functions that validate and apply one operation, with no network access:

```
applyOp(profile, op) -> { profile, summary } | { error }
op = { type: 'add_panel', spec, column? }
   | { type: 'replace_layout', profile, removePanelIds }   // update_profile
   | { type: 'set', layout?, openIn? }
   | { type: 'build_portal', packs, layout? }
   | { type: 'save', item } | { type: 'remove_saved', url }
   | { type: 'finish_onboarding' }
```

Tools keep their fetch-side checks (add_panel still test-loads the source, locally), then call `applyOp`. The hosted API calls the same function, so the rules (only add; never drop saved items; refuse duplicates; removal needs `removePanelIds`) exist once.

### 2. Hosted state API (`/api/v1`, bearer-authenticated like `/mcp`)

- `GET /api/v1/profile`: the profile plus its revision (`ETag`). `If-None-Match` answers 304.
- `POST /api/v1/ops`: apply one op to the latest state and return the new profile and revision. Ops are applied to whatever is current, so concurrent devices don't conflict. The exception is `replace_layout` (a whole-layout write), which requires `If-Match` and answers 412 if the layout changed elsewhere. The model is then told to re-read and retry.
- Profiles gain a `rev` counter, incremented on every write.
- Budgeted like tools: ops 1 unit, profile reads 1 unit.

State operations are forwarded, not merged: mutating tools on a linked device send the op to the hosted server instead of writing locally. No merge logic, no tombstones.

### 3. Linking a device (reuse the OAuth server)

The local server is a native OAuth client of the hosted server, using the authorization-code flow with PKCE and a loopback redirect (RFC 8252). The hosted server already supports this, including dynamic client registration, loopback redirect URIs, and rotating refresh tokens with reuse detection.

1. The user says "link my portal", or clicks **Link** in the workspace.
2. The local server registers a client (`redirect_uri = http://127.0.0.1:<random port>/callback`), starts a one-shot loopback listener, and returns the authorize URL. The app opens it with `ui/open-link`.
3. The user sees MCPortal's consent screen and signs in with GitHub (and the invite list applies).
4. The callback delivers the code. The local server exchanges it and stores tokens in `~/.mcportal/link.json` (mode 0600).
5. **First-link choice:** if both sides have a set-up portal, the UI asks whether to keep this computer's layout or the hosted one. Saved items are always unioned, since that's additive and safe.

Token handling:
- Refresh before expiry.
- Persist rotated refresh tokens atomically, under a file lock: the dev launcher and two Claude windows can mean two processes, and reusing a spent refresh token revokes the whole grant.
- Tokens never appear in tool results or logs.

New hosted endpoint: `POST /oauth/revoke` (RFC 7009), used by **Unlink**.

New tools (model + app):
- `link_account`: starts the flow and returns the URL.
- `link_status`: linked as @login, to which server, last sync.
- `unlink`: revokes the tokens and deletes `link.json`. It keeps a local copy of the portal, so nothing disappears.

### 4. Linked profile store (`LinkedProfileStore`, local)

- **Reads:** a cached copy with a 30 s freshness window, refreshed with `If-None-Match`. If the hosted server can't be reached, it serves the cache and adds a notice ("offline: showing your last synced portal").
- **Writes:** tools call `store.apply(op)`. This sends a `POST /ops` when linked, or runs `applyOp` locally when not. Offline writes fail clearly ("can't reach your hosted portal") instead of queueing. They're rare and user-initiated, and queueing would bring back conflicts.

### 5. Fetch routing (`FallbackFetcher`, local)

- Fetch locally first.
- Fall back to the hosted relay **only on network-level failures**: DNS failure, connection refused or reset, timeout, and TLS errors, the kind a corporate network or proxy causes.
- Never fall back on 403 or 429 from the site. The cloud gets blocked more often, not less.
- Hosted relay, `POST /api/v1/fetch`:
  - GET only, no custom headers except `accept`
  - same guarded fetcher (public IPs only, size, time and redirect caps)
  - binary bodies as base64
  - budgeted: 2 units, 1 per thumbnail
  - authenticated, so it's never an open proxy
- Optional privacy setting `fetchVia: "hosted"`: every fetch goes through the relay, so sites see Railway, not you. The default is `"local"`.
- The in-memory cache stays per process. A shared hosted cache for popular feeds can come later.

### 6. UI

- **Toolbar:** an account indicator. Unlinked shows a quiet **Link** icon; linked shows an avatar with a tooltip ("@lbliii, synced 12 s ago"); offline shows a small offline badge.
- **Welcome screen:** a secondary "Already have a portal? Link this computer" option.
- **First-link choice** dialog.
- **Unlink** confirmation.

## Security notes

- The relay is the risky piece. It stays behind the same boundaries as every other fetch: authenticated, budgeted, no private addresses, capped response size, and no pass-through of request headers or methods.
- Linking is an outward action (it connects an account). It always goes through the consent screen, never silently.
- `link.json` holds bearer credentials: 0600 permissions, never logged, never returned to the model, deleted on unlink, revoked on the server.
- The hosted API gets the same Host and Origin checks as `/mcp`, and no CORS.

## Phases

| # | Phase | Ships | Verifies |
|---|---|---|---|
| 0 | Prerequisites | `GITHUB_TOKEN`, volume backups, invite list (`MCPORTAL_ALLOWED_GITHUB_USERS`) | Linked data is backed up; only invited people can link |
| 1 | `src/ops.ts` refactor | Tools use `applyOp`; no behavior change | The existing 49 tests pass, plus op-level tests |
| 2 | Hosted state API | `rev`, `GET /api/v1/profile`, `POST /api/v1/ops`, `POST /oauth/revoke` | In-process tests: two clients, concurrent ops, 412 on a stale `replace_layout`, revocation |
| 3 | Linking | Local OAuth client, loopback listener, `link.json` plus lock, `link_account` / `link_status` / `unlink` | End-to-end against an in-process hosted app (fixture GitHub); a refresh race across two processes doesn't revoke |
| 4 | Linked store | `LinkedProfileStore`, first-link choice, offline notice | Link, edit on device A, see it on device B; offline read and write behavior |
| 5 | Fetch routing | `/api/v1/fetch`, `FallbackFetcher`, `fetchVia` | Simulated DNS or timeout failure falls back; 403 and 429 don't; relay refuses private IPs; budget applies |
| 6 | Ship | Docs (README, CONTRIBUTING, privacy notes), deploy, manual run in Claude desktop | The author links their Mac to Railway, and the portal matches on both |

Phases 1–2 are hosted-only and safe to deploy on their own. Phase 3 is the first user-visible change.

## Decisions (defaults proposed; confirm or change)

1. **First link when both sides exist:** ask the user (proposed), rather than always preferring the hosted portal.
2. **Default fetch route:** local, with fallback (proposed). Privacy mode is opt-in.
3. **Offline writes:** fail clearly (proposed), rather than queueing.
4. **Who can link:** anyone on the invite list. Until M1.5 opens sign-in, that's the allowlist.

## Out of scope here

Social features (M2), background digests and alerts, a shared hosted fetch cache, Postgres. This plan keeps the JSON-file store; `rev` and the ops API make that move easier later.
