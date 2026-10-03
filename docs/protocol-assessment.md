# MCP protocol assessment

Assessed 2026-10-03 against `origin/main` (`aaaf90e`), the current protocol core and the proposed migration plan. This is evidence and a bounded implementation proposal, not a modern-protocol compatibility claim.

The cited July revision is published: the official latest specification resolves to **2026-07-28**. The [release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/) and [SDK migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md) are accessible. The [official SDK release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.0) confirms v2.3.0 on October 2, including server creation per HTTP request. No SDK installation is needed for this assessment.

## Corrections before implementing the plan

| Topic | Verified requirement |
|---|---|
| Request metadata | The version and client capabilities are required in `params._meta`; client identity is recommended, not required. Merely recognizing a version header is insufficient. [Base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) |
| Discovery and results | `server/discover` returns `supportedVersions`, capabilities and instructions; identity belongs in result `_meta`. Modern results require `resultType`, including ordinary successful tool calls. Reusing the legacy initialize result directly is incorrect. [Schema reference](https://modelcontextprotocol.io/specification/2026-07-28/schema) |
| Cache hints | Required on cacheable results: discovery, tools/prompts/resources/template lists and resource reads. Ordinary tool calls do not require these fields. Conservative hints are `ttlMs: 0`, `cacheScope: 'private'`. [Modern JSON schema](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.json) |
| HTTP | Version/body agreement and conditional `Mcp-Name` are mandatory. Names require sentinel decoding when encoded. Header failures use HTTP 400 / `-32020`; unsupported versions use HTTP 400 / `-32022`; unknown methods use HTTP 404 / `-32601`. Each POST contains a single message. [HTTP binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| Deprecations | The announcement names roots, sampling and logging as deprecated; elicitation remains an MRTR input mechanism. [Release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/) |
| SDK API | Explicit modern entry points are `createMcpHandler(factory)` and `serveStdio(factory)`. Clients opt in using `versionNegotiation`; default clients remain legacy. These APIs are verified, but not adopted here. [SDK protocol guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md) |

## Current compatibility

`src/mcp.ts` negotiates four legacy versions, ending at `2025-11-25`. It has no discovery handler, per-request modern envelope processing, result discriminator or cache hints. `src/http.ts` does not inspect modern routing headers and accepts bounded JSON-RPC batches. Its existing POST-only, sessionless operation is useful groundwork, but does not establish modern conformance. The app's `2026-01-26` handshake is a separate MCP Apps protocol.

A modern-only client therefore cannot rely on MCPortal. Dual-era clients may fall back to initialization; that is an inference from the official compatibility rules, not a host certification. The existing legacy behavior should remain available while migration is evaluated. [Version compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)

## Smallest next step

Collect the bounded `initialize` and rejected `server/discover` observations implemented below, using a fixed protocol-version vocabulary and exact whitelisted host categories. Log no arbitrary client names, device/version strings, capabilities, account identifiers or message content. Review one week of authenticated hosted observations before choosing a migration target. Host categories are self-reported diagnostics, never authorization or compatibility evidence. Modern direct requests can bypass both observed methods; absence of events cannot prove absence of modern clients.

Next, pin both official schemas to an immutable repository revision and validate captured legacy wire messages. The [legacy JSON schema](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.json) is available alongside the modern schema. Add semantic cases that schemas alone cannot enforce: notification silence, unsupported-version negotiation, deterministic account-scoped tool catalogs, header/body agreement, cache isolation and unchanged legacy responses.

A later minimum dual-era patch would own `src/mcp.ts`, a transport validation helper, focused protocol tests and the MCP HTTP route through coordination with its owner. It must add discovery, per-request envelopes, correct modern result encoding and HTTP validation together; adding a version string alone would misrepresent support. MRTR, subscriptions, Tasks and OAuth changes require separate scope and evidence. No modern wire behavior, authentication change or runtime dependency is implemented by this assessment.

## Implemented observation prerequisite

`protocol.initialize` now records `requestedVersion`, `selectedVersion` and `host`. `protocol.discovery_probe` records the requested metadata version and host when an unsupported discovery request arrives; its `-32601` reply is unchanged. Requested versions are restricted to the four supported legacy constants, verified `2026-07-28`, `missing` and `other`. Selected versions remain the existing supported constants. Host labels are `claude`, `claude_code`, `chatgpt`, `codex` or `unknown`, derived from an exact alias whitelist after a 64-character input bound. No identity text, client version, capabilities or account identifier is added by these events.

These observations count requests, not distinct users, and are emitted through the existing logger. Tests cover known aliases, unsupported/malformed input, secret-like strings, notifications and byte-equivalent replies. The code has not been deployed and the one-week observation window has not begun. Direct modern requests remain outside this telemetry's coverage.
