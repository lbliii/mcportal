# Run your own MCPortal

Host MCPortal on Railway so your agent can reach it as a remote connector, for you alone or for a small group. The same Docker image runs on any container host.

A self-hosted MCPortal is its own island. Spaces, shares, follows and reblogs reach only people with accounts on your instance. They don't reach the public MCPortal or any other instance.

You need a Railway account, the [Railway CLI](https://docs.railway.com/guides/cli), a GitHub account and a clone of this repository with `npm install` run in it.

## 1. Create the service

1. In a Railway project, create a service named `mcportal` from your copy of this repository.
2. From the checkout, preview and apply the infrastructure config:

   ```bash
   railway config plan
   railway config apply
   ```

   [`.railway/railway.ts`](../../.railway/railway.ts) sets the Dockerfile build, the `/health` check and a volume at `/data`. Edit its volume region to suit you. Variable values never live in that file; you set them in Railway.

3. Generate a public domain for the service. MCPortal reads it from `RAILWAY_PUBLIC_DOMAIN` and uses it as its public URL and Host allowlist.

## 2. Choose storage

**Postgres (recommended).** Add a Postgres service to the project and set this on `mcportal`:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Turn on point-in-time recovery and scheduled backups on the Postgres service. The schema is created and migrated at startup.

**Files.** Without `DATABASE_URL`, MCPortal keeps everything as JSON files on the `/data` volume. That suits one person or a few friends.

If both exist, MCPortal imports the files it finds on the volume into Postgres once, then uses Postgres.

## 3. Create a GitHub OAuth App

People sign in with GitHub. In GitHub, go to **Settings → Developer settings → OAuth Apps → New OAuth App** and enter:

| Field | Value |
|---|---|
| Homepage URL | `https://<your-domain>` |
| Authorization callback URL | `https://<your-domain>/oauth/callback` |

Generate a client secret.

## 4. Set the variables

Set these on the `mcportal` service:

| Variable | Value |
|---|---|
| `GITHUB_CLIENT_ID` | from the OAuth App |
| `GITHUB_CLIENT_SECRET` | from the OAuth App |
| `MCPORTAL_ADMINS` | your GitHub login (comma-separate several) |

Setting admins makes the server invite-only. You then let people in from `/admin` or the admin CLI; see [Administer an instance](administer.md).

Then fill in the public pages. The landing page, terms, privacy, support and security pages and `/.well-known/security.txt` name whoever runs the server:

| Variable | What it's for |
|---|---|
| `MCPORTAL_OPERATOR` | your name, or your organization's |
| `MCPORTAL_CONTACT_EMAIL` | where support requests and security reports go |
| `MCPORTAL_JURISDICTION` | the law your terms are under, for example `the State of Oregon, USA` |
| `MCPORTAL_SOURCE_URL` | a link to the source code, shown in the footer |
| `MCPORTAL_SUPPORT_URL` | optional; overrides the support link, which defaults to the contact email (or, with neither set, this project's GitHub issues) |

MCPortal is licensed under the AGPL-3.0. If you run a modified copy, the license requires you to offer your users its source: set `MCPORTAL_SOURCE_URL` to your fork, not this repository.

A `GITHUB_TOKEN` (a fine-grained token with no extra scopes) raises the GitHub API limit for GitHub portals from about 60 requests an hour to 5,000. Every other setting, including usage limits and logging, is in the [configuration reference](../reference/configuration.md).

Railway redeploys when variables change. To set several without a deploy each, use `railway variables --skip-deploys --set …`, then deploy once.

## 5. Connect your agent

Add a custom connector in your agent with the URL `https://<your-domain>/mcp`. The agent discovers the authorization server, registers itself, shows MCPortal's consent screen and sends you to GitHub to sign in. Then ask it to "open my room".

## 6. Verify

Check storage and the version:

```bash
curl https://<your-domain>/health
```

It answers `200` with `"ok": true`, the version and the storage in use (`postgres` or `files`). It answers `503` when it can't reach storage.

Then open the room through your agent, save a link, and sign in to `/admin` and `/account` in a browser.

## Single-user alternative: a static token

If only you will use the server, and your agent supports custom headers, you can skip the OAuth App. Set `MCPORTAL_TOKEN` to a long random string and connect with an `Authorization` header. In Claude Code:

```json
{
  "mcpServers": {
    "mcportal": {
      "type": "http",
      "url": "https://<your-domain>/mcp",
      "headers": { "Authorization": "Bearer ${MCPORTAL_TOKEN}" }
    }
  }
}
```

A static token also lets you run the live smoke test against your deployment. It opens a room and reads an article through the real server:

```bash
MCPORTAL_URL=https://<your-domain>/mcp MCPORTAL_TOKEN=… npm run smoke
```

Both kinds of auth can be on at once. Treat the token like a password: anyone holding it acts as `MCPORTAL_USER` (default `default`).

## Run the Docker image anywhere

The [Dockerfile](../../Dockerfile) builds a self-contained image. Node runs the TypeScript directly; the only runtime dependency is `pg`.

```bash
docker build -t mcportal .
docker run -p 8787:8787 -v mcportal-data:/data \
  -e MCPORTAL_PUBLIC_URL=https://<your-domain> \
  -e GITHUB_CLIENT_ID=… -e GITHUB_CLIENT_SECRET=… -e MCPORTAL_ADMINS=<your-login> \
  mcportal
```

The image listens on `0.0.0.0:8787` and stores files in `/data`. It refuses to start on a public interface without auth (OAuth or `MCPORTAL_TOKEN`). Outside Railway, set `MCPORTAL_PUBLIC_URL` to the address people reach it at, and put it behind a proxy that terminates HTTPS.

Run one instance. Pending sign-ins and authorization codes live in memory, so two replicas would lose each other's sign-ins.

## Next

- [Administer an instance](administer.md): invites, suspensions, reports, deleting accounts.
- [Operate the service](operate.md): deploys, rollback, backups and incidents.
