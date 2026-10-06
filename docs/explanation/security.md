# Security

MCPortal fetches URLs that people and agents choose, shows other people's words to your agent, and keeps an account per person. This page explains the threats that follow from that and how the design answers each. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## Principles

- **Nobody needs an identity until they choose one.** A local install has no account. The hosted service has a private account. A public handle exists only once you claim one to share or be followed.
- **You own your data.** You fully control your own room, saved items, clips and posts. You read other people's posts only when their audience allows. Nobody writes anyone else's data.
- **The agent can't escalate.** Tools always act as the signed-in person. No tool accepts an account ID, and admin actions are never tools, so a prompt injection can't moderate, suspend or impersonate.
- **Third-party text is data.** Pages, feeds, docs and other people's notes reach the model fenced as untrusted, and reach the room as plain text.

## Threats and defenses

| Threat | Defense |
|---|---|
| SSRF to localhost, private networks or cloud metadata | Every outbound socket connects only after its resolved address passes a public-IP check, inside the DNS lookup itself, so there's no rebinding window. IPv6 is allowlisted to global unicast, so mapped, NAT64 and 6to4 forms can't sneak through. Redirects are followed by hand and re-checked; credentials are dropped on cross-host hops. |
| Hostile pages or feeds hanging the server | A linear-time HTML tokenizer; input, block and total-text caps; a byte-capped cache. Adversarial 3 MB inputs parse in well under 100 ms. |
| Stalled or slow upstreams | One timeout covers connect, headers and body, including compressed bodies. Decompressors are wired with `pipeline()`, so an abort tears them down. Size caps apply to decompressed bytes. |
| Prompt injection from third-party content | Adapters emit plain text only. Tool results wrap third-party text in `<untrusted-content id="random">` fences. Server instructions tell the model never to follow instructions inside them, including text addressed to AI agents. |
| Script injection in the room | The room never uses `innerHTML`; it builds DOM from structured data with `textContent`. It opens only http(s) links. SVG clips are shown only as `<img>`, so nothing in them runs. |
| An agent "tidying" your room | `arrange_room` changes only what it names, all or nothing, and reports every change. Removing a portal is its own destructive call, `remove_portal`, which hosts can ask you to approve. |
| An exposed server | Binds to `127.0.0.1` by default and refuses a public bind without auth. A Host header allowlist blocks DNS rebinding. Tokens are compared in constant time and never read from query strings on `/mcp`. |
| OAuth abuse | See [OAuth and tokens](#oauth-and-tokens). |
| A linked computer's tokens | Kept in `~/.mcportal/link.json` (mode 0600), never in tool results, the room or logs. Revoked on sign-out and from the account page. |
| One person running up the bill | A per-user budget (a per-minute burst and a daily allowance, in cost units per tool) and a global daily cap. Rate limits on the OAuth endpoints per IP. |

## Accounts and the access gate

An account is MCPortal's record of a person: an ID, a status (`active` or `suspended`) and a role (`user` or `admin`). A sign-in identity, `github:<numeric id>`, maps to an account. GitHub is the only sign-in method. Identities stay separate from accounts all the same, so another provider could be added without moving anyone's data.

**Who gets in.** An existing active account; a GitHub login an admin invited (the account is created on first sign-in); a login named in the bootstrap configuration; or anyone, when sign-up is open. Invites are their own list rather than an account status, and each account records how it got in (`invite`, `bootstrap`, `open`).

**One gate.** Every tool call and every hosted endpoint asks `authorize(actor, action, resource)` in `src/access.ts` before doing anything. There is no second path. Its rules are short:

- A suspended account can do nothing. Suspension is checked on every request and every token refresh, so it takes effect at once.
- `admin` actions need the admin role.
- A resource with an owner can be touched only by that owner.

Each tool declares its action (`read`, `write`, `fetch`) in its definition. A tool missing from the table would be treated as a write, the safe default; a test makes sure none is missing.

**Scoped queries.** Every store call is scoped to the acting account. Reads across accounts (the Following feed, a Space, a post) go through dedicated functions in `src/social.ts` that apply audience, block and suspension rules in one place (`canSee`). Stores only store.

**Admins.** The admin role comes only from configuration (`MCPORTAL_ADMINS`); it can't be granted from inside the app. Admins invite, suspend, reinstate, hide posts and resolve reports, on the `/admin` page or the `mcportal admin` CLI, never through MCP. Every admin action, account deletion, handle change and admin removal of a post goes to the audit log. See [administer](../how-to/administer.md).

## OAuth and tokens

The hosted service is its own OAuth 2.1 authorization server and resource server, as the MCP authorization spec describes. GitHub is the identity provider behind it; MCPortal asks GitHub for no scopes, only who you are.

- **PKCE S256** is required.
- **Redirect URIs** must match a pre-registered URI exactly. Errors before consent render a page and never redirect.
- **MCPortal's own consent screen** names the client (and for a linked computer, the computer). Consent is bound to the browser that loaded it with a SameSite cookie, checked again on the GitHub callback, and must be same-origin, so a pre-fetched consent can't be approved cross-site.
- **Codes are single-use.** Tokens are bound to their audience.
- **Refresh tokens rotate.** Reusing a spent one revokes the whole grant.
- **Revocation.** `POST /oauth/revoke` (RFC 7009) lets a client end its own sign-in. The account page lists every signed-in app and computer with **Revoke**.
- **Registration** is open, as the MCP spec expects, but rate limited and capped at 500 clients with least-recently-used eviction. Client ID metadata documents are fetched through the guarded fetcher.

The account and admin pages use their own browser sessions with CSRF tokens, and every form checks for a same-origin `Origin`. Export download and import upload links work only in the owning account's browser session. The hosted HTTPS origin sends HSTS.

## The state API

A linked computer reaches its hosted account through `/api/v1/call`. It has the same boundaries as `/mcp`: the same tokens, Host allowlist and Origin check, no CORS, body caps, the access gate and the budget. Every call acts as the token's account, and the server re-checks what a store would trust: rooms go through `validateProfile`, clips are rebuilt with a server-chosen ID and size, shares name a clip or saved item the server looks up, and seen marks and featured sources must be portals in the room. Deleting everything, imports, moderation and admin aren't methods. See [local and hosted](local-and-hosted.md#the-state-api).

## Fetching safely

All outbound HTTP goes through `src/lib/safe-fetch.ts`. A request must be http(s), carry no embedded credentials and name no local host. It can only connect to public addresses, checked inside the socket's DNS lookup so the address validated is the address used. It follows at most a few redirects, re-checking each hop, and is capped in time and decompressed bytes.

Some fetches are narrower still. `read_doc_page` reads only pages in a docs site's table of contents or on its domain, so the agent can't use it as a general fetcher. Thumbnails accept only JPEG, PNG, GIF and WebP whose bytes match their type, and reach the room as `data:` URIs.

## The room's content security policy

The room declares an empty CSP: no `connectDomains` and no `resourceDomains`. It loads nothing from the network itself. Pictures arrive as data URIs from `get_thumbnails`, fonts and icons are inline, and every request goes through a tool call to the server. A host can review the policy on both `resources/list` and `resources/read`. The public web pages make no third-party requests either; the wordmark font is served by MCPortal.

## What logs contain

Logs are structured events: an event name plus IDs, names, counts and timings. They never contain tokens, room contents or third-party text. Account IDs appear only as a keyed hash whose key is created at startup and exists only in the running process. Account IDs are guessable (`github-<id>`), so an unkeyed hash could be reversed by hashing every candidate.

Protocol observations record only fixed vocabularies: a known version or `other`, and a host category from an exact allowlist. Client names, version strings and capabilities are never logged.

## Retention

What MCPortal keeps only for a while is removed on a schedule, every six hours, so the privacy policy holds on a quiet server: expired handoffs and highlights, reports resolved more than 180 days ago, invites unused for 90 days, audit entries older than a year, and app registrations unused for 180 days. Deleting an account removes everything that names you. See [data](../reference/data.md).

## Known limits

- OAuth state (pending sign-ins, auth codes), the usage budget and rate limiters live in memory. Run one instance.
- `structuredContent` sent to the room isn't fenced; the model-facing text is. The room renders it as text.
- The `/preview` page never contains secrets. With a static token it asks for the token and keeps it in that tab's `sessionStorage`, so the token never appears in a URL.
