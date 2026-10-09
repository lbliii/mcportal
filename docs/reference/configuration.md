# Configuration

Every environment variable and command-line option MCPortal reads. [`.env.example`](../../.env.example) is a starting file for a server; the hosted deployment's variable list is [`.railway/railway.ts`](../../.railway/railway.ts).

The **Where** column says which mode reads a variable: **local** is MCPortal on your computer (stdio, or the HTTP server on loopback); **hosted** is the HTTP server others connect to.

## Command line

`bin/mcportal.mjs` is the entry point. It checks for Node.js 22.18 or newer, then starts the server.

| Command | What it does |
|---|---|
| `mcportal` | Runs the Streamable HTTP server at `/mcp` on `$HOST:$PORT` (default `127.0.0.1:8787`) |
| `mcportal --stdio` | Runs over stdio for a local host (Claude Code plugin, desktop bundle). Always stores data in files, never Postgres |
| `mcportal admin <command>` | Runs an admin command against the server's storage, then exits ([below](#admin-commands)) |
| `node bin/mcportal-dev.mjs` | Development stdio launcher: restarts the server when a source file changes, without dropping the host's connection |

From a checkout, `npm start` runs `mcportal`, `npm run stdio` runs `mcportal --stdio`, and `npm run demo` runs the HTTP server on offline fixtures with a throwaway data folder.

### Admin commands

Admin actions are never MCP tools, so nothing a model reads can invite, suspend or delete anyone. The commands use the same storage as the server (Postgres when `DATABASE_URL` is set, otherwise files). A running server picks up changes within 30 seconds.

| Command | What it does |
|---|---|
| `admin list` | Lists accounts and pending invites |
| `admin invite <login>` | Invites a GitHub login and prints the `/join/<code>` link |
| `admin uninvite <login>` | Revokes a pending invite |
| `admin suspend <login\|id> [reason]` | Suspends an account |
| `admin reinstate <login\|id>` | Reinstates a suspended account |
| `admin audit [n]` | Prints the last `n` audit-log entries (default 50) |
| `admin delete <login\|id> --confirm` | Deletes an account and everything it owns, as the account page does. Without `--confirm`, says what would be deleted |

On Railway: `railway ssh --service mcportal -- node bin/mcportal.mjs admin list`. See [Administer MCPortal](../how-to/administer.md) for when to use each.

## Network

| Variable | Default | What it does | Where |
|---|---|---|---|
| `HOST` | `127.0.0.1` | Interface to bind. The Docker image sets `0.0.0.0`. On anything but loopback, the server refuses to start without auth | both |
| `PORT` | `8787` | Port to listen on | both |
| `MCPORTAL_PUBLIC_URL` | `https://$RAILWAY_PUBLIC_DOMAIN`, else `http://localhost:$PORT` | Public base URL, for OAuth metadata, links and the Host allowlist | hosted |
| `MCPORTAL_ALLOWED_HOSTS` | none | Extra hostnames accepted in the `Host` header, comma-separated. Loopback names and the public URL's host are always allowed | hosted |
| `MCPORTAL_ALLOWED_ORIGINS` | none | Browser origins allowed to call `/mcp` directly, comma-separated. Rarely needed | hosted |
| `MCPORTAL_TRUST_PROXY` | on when `RAILWAY_ENVIRONMENT` is set | `1` takes the client address from the last `X-Forwarded-For` hop, for sign-in rate limits behind a reverse proxy | hosted |

## Authentication and access

Set GitHub OAuth, a static token, or both. With neither, the server runs only on loopback, as a local MCPortal.

| Variable | Default | What it does | Where |
|---|---|---|---|
| `GITHUB_CLIENT_ID` | none | GitHub OAuth app client id. With the secret, turns on multi-user sign-in. Callback URL: `<public URL>/oauth/callback` | hosted |
| `GITHUB_CLIENT_SECRET` | none | GitHub OAuth app client secret | hosted |
| `MCPORTAL_ADMINS` | none | GitHub logins or numeric ids that are admins, comma-separated. Admins can always sign in and use `/admin` | hosted |
| `MCPORTAL_ALLOWED_GITHUB_USERS` | none | Older allowlist of logins who may sign in, comma-separated. Still honored | hosted |
| `MCPORTAL_OPEN_SIGNUP` | off | `1` lets anyone with a GitHub account sign in, even when admins or an allowlist are set. With none of the three set, anyone can sign in | hosted |
| `MCPORTAL_TOKEN` | none | Static bearer token: one user, for clients that send custom headers | hosted |
| `MCPORTAL_USER` | `default` | Profile id for static-token and unauthenticated (local) access | both |
| `MCPORTAL_ALLOW_UNAUTHENTICATED` | off | `1` serves without auth on a non-loopback interface. Don't | hosted |

## Storage and sources

| Variable | Default | What it does | Where |
|---|---|---|---|
| `MCPORTAL_DATA_DIR` | `~/.mcportal` (`/data` in the Docker image) | Folder for file storage. See [data](data.md) | both |
| `DATABASE_URL` | none | Postgres connection string. When set, the HTTP server stores everything in Postgres, importing any files from the data folder once. Stdio ignores it. On Railway: `${{Postgres.DATABASE_URL}}` | hosted |
| `GITHUB_TOKEN` | none | GitHub token for GitHub portals: about 5,000 API requests an hour instead of about 60. Needs no scopes | both |
| `TICKETMASTER_API_KEY` | none | Enables verified artist lookup and event checks for reading watches. Calendar watches work without it. A linked computer uses the hosted server's key | both |
| `MCPORTAL_HOSTED_URL` | `https://mcportal.lol` | The hosted MCPortal a local one signs in to with `link_account`. Point it at your own server | local |
| `MCPORTAL_FIXTURES` | off | `1` serves canned data from `test/fixtures` instead of the network, for offline demos | both |
| `MCPORTAL_RESULT_MODE` | `legacy` | `component-v1` enables bounded model-visible results with full component data in `_meta`. Use only after actual-host verification; see [result payloads](result-payloads.md) | both |

## Usage limits

Units each tool call spends are listed in [tools](tools.md#usage-cost). Limits apply to the HTTP server; stdio is unlimited.

| Variable | Default | What it does | Where |
|---|---|---|---|
| `MCPORTAL_LIMIT_PER_MINUTE` | `120` | Units per user per minute | hosted |
| `MCPORTAL_LIMIT_PER_DAY` | `3000` | Units per user per day | hosted |
| `MCPORTAL_LIMIT_GLOBAL_PER_DAY` | `60000` | Units for all users together per day | hosted |

## Public pages

The landing page (`/`), `/privacy`, `/terms`, `/support` and `/security` read these.

| Variable | Default | What it does | Where |
|---|---|---|---|
| `MCPORTAL_OPERATOR` | "the person who runs this server" | Who runs the service, named in the privacy policy and terms | hosted |
| `MCPORTAL_CONTACT_EMAIL` | none | Contact address. The server refuses to start if it isn't an email address | hosted |
| `MCPORTAL_SUPPORT_URL` | `mailto:` the contact email, else the GitHub issues page | Where people get help | hosted |
| `MCPORTAL_JURISDICTION` | none | The law that governs the terms | hosted |
| `MCPORTAL_SOURCE_URL` | none | Link to the source code, shown in the footer | hosted |

## Logging

Logs go to stderr; stdout belongs to the stdio transport. What they contain is in [data](data.md#logs).

| Variable | Default | What it does | Where |
|---|---|---|---|
| `MCPORTAL_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` | both |
| `MCPORTAL_LOG_FORMAT` | `text` | `json` for a log platform | both |

## Labs

Labs are unfinished features, off unless named. A lab that's off is never offered to the model or shown in the room; what a user already chose with it stays valid.

| Variable | Default | What it does | Where |
|---|---|---|---|
| `MCPORTAL_LABS` | none | Labs to turn on, comma-separated. Read once at startup | both |

| Lab | What it adds |
|---|---|
| `frontpage` | A `frontpage` layout: the agent's picks, then each portal's top items, top to bottom |

`river` and `reblog` were labs and are now always on; naming them does nothing.

## Scripts

Read by the maintenance scripts in `scripts/`, not by the server.

| Variable | Default | What it does | Script |
|---|---|---|---|
| `MCPORTAL_URL` | none | Server to check: `https://…/mcp` (or loopback `http`) | `npm run ops:check`, `npm run smoke` (in-process when unset) |
| `MCPORTAL_TOKEN` | none | Bearer token for that server. Required by `ops:check` | `npm run ops:check` |
| `MCPORTAL_OPS_TIMEOUT_MS` | `10000` | Per-request timeout, 100 to 60000 ms | `npm run ops:check` |
| `MCPORTAL_LIVE` | off | `1` snapshots live data instead of fixtures | `npm run snapshot` |

## Set by the platform

MCPortal reads these when Railway sets them. You don't set them yourself.

| Variable | Effect |
|---|---|
| `RAILWAY_PUBLIC_DOMAIN` | Default public URL, and an allowed host |
| `RAILWAY_ENVIRONMENT` | Turns on `MCPORTAL_TRUST_PROXY` |
| `RAILWAY_SERVICE_NAME` | Names the actor in admin-CLI audit entries when `USER` is unset |

## Optional artist events

`TICKETMASTER_API_KEY` enables verified artist lookup and dated city/country event checks on the server. The key never enters exports, tool results or logs. Public iCalendar reading watches need no key. [Coverage and limits](../explanation/reading-experiences.md#changes-and-upcoming).
