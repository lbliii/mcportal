# Plan: solid foundations before more features

Status: in progress (2026-10-01). An audit of `src/` (excluding `src/ui`) found the code
correct and well-tested, but held together by convention rather than contracts. This plan
turns the conventions into code: one error vocabulary, one tool runtime, one logger, shared
helpers, smaller files and a stricter compiler.

## What the audit found

**Errors.** Nine error classes, only `OAuthError` with a machine-readable code. Behaviour
depended on message text: thumbnails regex-matched `safe-fetch`'s wording (`/exceeded/`,
`/Timed out/`) and imports stopped on `/clips, the most|MB allowed/`. Upstream statuses were
flattened into prose ("Feed responded 503"). `reading.ts` threw 14 plain `Error`s for
validation, so `reading-tools` showed any failure, I/O included, to the user. `mcp.ts` and
`admin.ts` returned raw internal error messages. HTTP JSON errors came in three shapes.

**Tool runtime.** `ok()` was re-declared in five modules (a sixth variant in
`reading-tools`); "not available here" guards were copied per module; about 80 ad-hoc
argument coercions and nothing checked arguments against `inputSchema`. Each tool's
permission (`access.ts` `TOOL_ACTIONS`) and cost (`budget.ts` `toolCost`) lived in parallel
tables keyed by name, and had drifted: `open_docs`, `search_docs` and `read_doc_page` were
missing from the permission table and silently treated as writes. `tools.ts` (838 lines) was
both the portal tools and the shared runtime that every other `*-tools.ts` imported back.

**Observability.** One `log(string)` sink, not on `ToolContext`, so tools, adapters and stores
couldn't log; six modules wrote straight to stderr. No levels, no request ids, no structured
output; about 25 catch blocks swallowed failures without a trace. `/health` is static.

**Duplication.** slug ×3, `isRecord` ×3, sha256 ×5, random ids ×15, clamp ×6, HTML escape ×3,
http-URL validators ×4, body/form readers ×4, and the account and admin pages' session and
CSRF code (security-sensitive) duplicated.

**Contracts.** Profile read-modify-write happens at ~10 sites with no atomic update, so
concurrent tool calls can lose a change; every caller re-attaches `saved` by hand after
`validateProfile`. `AuthPersistence` doubles as a generic document store for accounts,
profiles and social, each re-implementing load/parse/cache/mutex. File and Postgres stores
share no contract tests (and their page-size caps already disagree: 100 vs 200).
`PortalSpec.config` is `Record<string, unknown>`, which drives most `as unknown as` casts.

**Size.** `ui/room.html` 1769 lines (1420 of inline JS), `adapters/docs.ts` 815,
`auth/oauth.ts` 634 (a third of it generic web helpers other pages import), `lib/markdown.ts`
583, `clips.ts` 475, `social.ts` 448, `db.ts` 424.

**Types.** `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch` and `noUnusedParameters` already pass with zero changes;
`noUnusedLocals` needs one; `exactOptionalPropertyTypes` needs 47.

## Phases

Each phase lands as its own commit with `npm test` and `npm run typecheck` green.

1. **Errors.** `src/lib/errors.ts`: `AppError` with a stable `code` from `ERROR_CODES`
   (each with an HTTP status and whether it's retryable), `UpstreamError` for other servers'
   failures. Every domain error class extends it; callers branch on `code`, never on text.
   Tool errors carry `structuredContent.error = { code, message, retryable }`. Anything that
   isn't an `AppError` is a bug: logged with its stack, reported as `internal` with an error
   id, its message never shown.
2. **Tool runtime.** `src/tool-kit.ts` holds `ToolDef`, `ToolContext`, `ok`, `toolError`,
   `toolFailure`, `untrusted` and the availability guards. Each `ToolDef` declares its own
   `access` and `cost`; a test checks every tool does, and that `readOnlyHint` agrees with
   `access`. Arguments are checked against `inputSchema` before the handler runs. `tools.ts`
   splits by area (room, sources, saved, pins, OPML, reader, thumbnails); layout operations
   (`ensurePortal`, `addPortalTo`) move to `src/layout.ts`.
3. **Observability.** `src/lib/log.ts`: a leveled, structured logger (text locally, JSON
   with `MCPORTAL_LOG_FORMAT=json`), on `ToolContext` and every store that needs it, with a
   request id per HTTP request and one event per tool call (name, outcome, code, ms).
   Replaces the direct stderr writes; swallowed failures that matter log at `warn`/`debug`.
4. **Shared helpers.** `src/lib/web.ts` (send, body/form readers, cookies, HTML pages and
   escaping) out of `auth/oauth.ts`; `src/lib/ids.ts` (random ids, sha256); one slug, one
   `isRecord`, one clamp.
5. **Compiler ratchet.** Turn on the free strict flags now; work `exactOptionalPropertyTypes`
   down separately.
6. **Peel big files** behind barrel re-exports so importers don't change: `ui/room.html` into
   `ui/room/*` fragments (via the existing include mechanism), `adapters/docs.ts` into
   `adapters/docs/*`, `db.ts` into `db/*`, `lib/markdown.ts` inline and MDX parts.

Later, separately: `ProfileStore.update(fn)` for atomic read-modify-write; one
`DocumentStore` replacing `AuthPersistence` for non-auth documents; shared contract tests
for file and Postgres stores; typed `PortalSpec.config`; deduplicating page sessions between
the account and admin pages.
