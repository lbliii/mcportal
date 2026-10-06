# Operate a hosted MCPortal

Deploy a release, confirm it works, roll it back, restore from a backup, cut off credentials and handle an incident. This is the runbook for a production instance on Railway with Postgres. For first-time setup, see [Run your own MCPortal](self-host.md).

A merged pull request, a tagged release and a working deployment are three different things. Check each one.

## Deploy a release

1. Cut the release first ([Cut a release](release.md)) and note the commit it tagged.
2. Check out exactly that commit in a clean directory. A fresh worktree avoids shipping stray local files or `node_modules`:

   ```bash
   git fetch --tags origin
   git worktree add --detach ../mcportal-deploy v<version>
   cd ../mcportal-deploy
   ```

3. Build and run the image locally, and check that it boots:

   ```bash
   docker build -t mcportal:check .
   docker run --rm -d -p 8787:8787 -e MCPORTAL_TOKEN=local-check --name mcportal-check mcportal:check
   curl -s http://127.0.0.1:8787/health
   docker rm -f mcportal-check
   ```

   Don't skip this. When a service has a volume, Railway stops the old container before starting the new one. A container that crashes at boot (a missing file the image didn't copy, a bad import) takes the site down until you roll back.

4. Link the directory to your service and deploy it:

   ```bash
   railway link        # choose the project, the production environment and the mcportal service
   railway up --detach --path-as-root .
   ```

   `--path-as-root .` makes the CLI upload this directory. Without it, the CLI uploads the project directory it was first linked from, which may be a different checkout at a different commit.

5. Follow that deployment until Railway reports it succeeded. Record the commit, version, deployment ID and time.

Variable changes trigger their own deploy. To change several at once, set them with `railway variables --skip-deploys --set …` and deploy once.

## Verify a deployment

1. `GET /health` answers `200` with the new `version` and `"storage": "postgres"`. A `503` means it can't reach storage.
2. The logs show `http.ready`. Database migrations run before it, so this line means the schema is current.
3. With a dedicated test account, sign in through your agent, open the room, save a link, and open `/account`.
4. Run the external probe (below) from outside Railway.

## Monitor from outside

`npm run ops:check` is a read-only probe. It reads `/health`, then makes authenticated `initialize` and `tools/list` requests. It doesn't open a room, fetch feeds or write data.

```bash
MCPORTAL_URL=https://<your-domain>/mcp npm run ops:check
```

Supply `MCPORTAL_TOKEN` through your monitor's secret store, never in the URL or command line. The probe prints JSON with the failed stage, an error code and the HTTP status, and exits `0` only when storage and MCP discovery both pass. It refuses redirects and requires HTTPS except on loopback. `MCPORTAL_OPS_TIMEOUT_MS` sets each request's timeout (100 to 60,000 ms; default 10,000).

The probe is only a check. Schedule it and page on it in your monitoring service. Page on repeated failures, a version mismatch after a deploy, and sustained 5xx or tool errors. OAuth access tokens expire after an hour, so a monitor that uses OAuth needs its own token refresh. Tell an expired monitor credential apart from a real outage before you wake anyone.

## Roll back

1. In Railway, pick the last deployment you verified, not merely the previous one, and redeploy it.
2. Before you do, check whether the release you're leaving migrated the database. The schema only moves forward. The older app can run against it only if the migration was additive and the old code ignores what's new.
3. Never unset `DATABASE_URL` to get service back. The app would fall back to files on the volume, which don't have anything written to Postgres since.
4. Verify the rolled-back deployment as above.

## Back up and test a restore

Turn on point-in-time recovery and scheduled backups on the Postgres service, and check the retention you actually get on your Railway plan. A setting isn't coverage: confirm that recent backups completed and that PITR archiving is live.

Practice a restore before you need one. Restore into an isolated staging environment, never over production:

1. Record the backup ID or PITR target time.
2. Prepare staging with its own Postgres, volume, domain, GitHub OAuth App and secrets. Keep sign-up closed there. Treat the copied personal data as production data.
3. Restore the backup into staging's Postgres with Railway's recovery flow. Note when it starts and when it's usable.
4. Check `/health`, then sign in fresh with test accounts (restored cookies won't be valid). Check the room, saved items, clips, reading positions, Spaces and shares, export, and account deletion.
5. Record how much data the restore lost and how long it took. Confirm the app version runs on the restored schema.
6. Revoke any production credentials copied into staging, then delete the copy.

Once restores work, say what your retention really is on `/privacy`, and schedule the next drill.

## Cut off credentials

| What leaked or misbehaves | What to do |
|---|---|
| One person's app or device | They revoke it on `/account` under signed-in apps and devices. |
| A whole account | Suspend it on `/admin` or with `admin suspend` ([Administer](administer.md)). Every request and refresh from it is refused within 30 seconds. |
| `MCPORTAL_TOKEN` | Set a new value and redeploy. The old one stops working. |
| `GITHUB_CLIENT_SECRET` | Generate a new secret in the GitHub OAuth App, set it, redeploy, then delete the old secret in GitHub. |
| `GITHUB_TOKEN` | Revoke it in GitHub, create a new one, set it and redeploy. |
| `DATABASE_URL` | Rotate the Postgres credentials in Railway and redeploy. |

After rotating, check that the old value fails. MCPortal stores tokens hashed, so a database copy doesn't expose usable tokens, but rotate the database credentials anyway.

## Handle an incident

**Sign-in or the room breaks after a deploy.** Find the release and a request ID: every response carries `x-request-id`, and an error that's a bug shows `reference <id>` to the user. Search the logs for it. Reproduce with a test account. If it's the release, roll back.

**The database is down.** `/health` answers `503`. Check the Postgres service in Railway. If you must restore, restore into isolation first, check it, then point production at it. Write down any writes you lost.

**Credentials are compromised.** Follow the table above. Keep the audit log. Never paste a compromised value into a ticket or chat.

**Abuse or cost.** Check reports and usage on `/admin`. Lower the usage limits instead of removing them (see the [configuration reference](../reference/configuration.md)); the admin page shows today's budget by account. To close an open server quickly, set `MCPORTAL_OPEN_SIGNUP=0` with `MCPORTAL_ADMINS` set: with neither admins nor an allowlist, sign-up stays open whatever the flag says.

**Telling people.** MCPortal sends no notifications. Post a plain status note where your users look: what's affected, since when, and when you'll update next. Afterwards, record the time to recover and the fixes you'll make.

## Logs

Logs go to stderr, one event per line. Set `MCPORTAL_LOG_FORMAT=json` for a log platform and `MCPORTAL_LOG_LEVEL` to `debug`, `info` (default), `warn` or `error`. Every line from a request carries its request ID. Users appear only as a short hash; tokens, profile contents and third-party text are never logged.

Housekeeping removes what MCPortal keeps only for a while: expired handoffs and highlights, resolved reports, old audit entries, lapsed invites and unused app registrations. It runs a minute after startup and every six hours after. It logs `housekeeping.done` with what it removed.
