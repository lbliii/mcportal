# Hosted operations

This runbook covers the hosted service. A merged PR and a tagged release are separate
from a verified deployment. Keep sign-up closed until backups, monitoring and the
host certification checklist have evidence.

## Current deployment inventory

Read-only inspection on 3 October 2026 found:

| Resource | Value |
|---|---|
| Railway project | `b6172f83-da6d-48c1-aa73-7a88fdf31601` (`mcportal`) |
| Production environment | `13c74b8a-54c7-4b40-bc62-aebb50e68b98` |
| App service | `4c67ad67-5e3e-4091-8c29-7be20d7ab0cc` |
| Postgres service | `c5ff735f-0b75-425f-9613-3e1d0f18245a` |
| Public origin | `https://mcportal-production.up.railway.app` |
| Latest successful deployment observed | `1fa709d6-86ea-4c7f-a8e6-4df197896a9b` (2 October) |

Only production was present. PITR configuration was enabled with a bucket wired, but
the CLI's live archiver and coverage probes failed because no SSH key was offered.
This is configuration evidence, not a completed recovery test. Scheduled backups,
their retention and external paging were not verified. Refresh this inventory before
an incident; do not assume the latest deployment is the last known-good one.

## External availability check

From a monitor outside Railway, run:

```bash
# Supply an existing authorized bearer credential through the monitor's secret store.
# Never put credentials in the URL, command arguments or captured logs.
MCPORTAL_URL=https://mcportal-production.up.railway.app/mcp npm run ops:check
```

`MCPORTAL_TOKEN` must be present in the environment. The check reads `/health`, then
makes authenticated `initialize` and `tools/list` requests. It does not open a room,
fetch feeds, or write user data. JSON output includes the failed stage, a bounded
code, and an HTTP status where available; exit status is 0 only when storage and MCP
discovery both pass. Redirects are refused. HTTPS is required except on loopback.
`MCPORTAL_OPS_TIMEOUT_MS` sets each request's timeout (100–60,000 ms; default 10,000).

Use a dedicated monitor account and rotate its credentials. OAuth access tokens expire
after an hour: a monitor using OAuth needs secure token refresh outside this script.
Do not add a static-token auth path to production simply to make this check pass.
Page on repeated failures, on a version mismatch after deploy, and on sustained 5xx
or tool-error growth. Separate expired monitor credentials from a storage outage.
The script supplies a probe; scheduling, paging and long-term error aggregation must
still be configured in the selected monitoring provider.

## Release and rollback

1. Run `npm run check`, the required Postgres tests, and adapter smoke checks. Record
   browser and manual host results with the PR; missing environments are not passes.
2. Merge the reviewed changes to `main`. Use the release script described in
   [CONTRIBUTING](../CONTRIBUTING.md#cutting-a-release) to prepare and publish a release.
3. Deploy that release commit to the app service. Record commit, release, deployment
   ID and time. Follow that exact deployment until Railway reports `SUCCESS`.
4. Verify `/health` reports the expected version and `storage: "postgres"`, run the
   authenticated probe, and exercise sign-in, room loading, save and resume with a
   dedicated test account. Record the observations.
5. If regression requires rollback, choose a previously verified app deployment in
   Railway. Check whether new code migrated the database before rolling back. Additive
   migrations can remain only when the old app is compatible with them. Never unset
   `DATABASE_URL` to restore service: the old volume does not contain new Postgres writes.
6. Verify the rollback deployment and repeat the availability and account checks.

## Backups and a recovery drill

Configure daily and weekly Postgres backups and confirm their actual retention before
public launch. Check Railway plan requirements rather than assuming schedules are
available. Verify fresh completed backups and live PITR archiving; a setting alone
does not establish usable coverage.

Run the first restore into an isolated staging database, never over production:

1. Record the backup ID, timestamp and recovery target. Prepare staging with its own
   Postgres, volume, domain, OAuth application and secrets. Disable real-user sign-up
   and isolate any copied personal data from reviewers and users.
2. Restore the selected backup or PITR target into staging using the supported Railway
   recovery flow. Record when the restore starts and becomes usable.
3. Check schema version and store health. Through test accounts, verify profile,
   saved items, clips, reading positions and social isolation, plus export and deletion.
   Exercise fresh sign-in instead of assuming restored browser cookies remain valid.
4. Record lost-write interval and recovery duration. Confirm the app release is
   compatible with the restored schema. Revoke copied production credentials before
   exposing staging and clean up recovery copies according to the retention policy.
5. Keep the evidence with the backup inventory and schedule the next drill. Update
   `/privacy` with actual retention only after the configured schedules are verified.

## Incident response

- **Sign-in or reader regression:** identify the request/reference and the release;
  inspect structured logs without collecting raw tokens, provider bodies or user content.
  Reproduce with a test account and use the verified rollback path if appropriate.
- **Database outage:** confirm `/health` storage failure and database status. Pause
  traffic if necessary. Recover in isolation and validate before switching production
  to a restored database; document any known lost writes.
- **Credential compromise:** revoke the affected app/device from `/account`, or
  suspend an affected account through `/admin`. Rotate compromised operator secrets
  through Railway and the provider, then verify old credentials fail. Keep the audit
  log; never put compromised values in a support ticket.
- **Abuse or budget pressure:** keep the admin alerting path operational; review new
  reports, rate limits and daily usage. Alert at 80% of the global budget. Size the
  budget against measured request costs instead of removing the cap. With admins
  configured, set `MCPORTAL_OPEN_SIGNUP=0` to restore invite-only access during an
  incident; the same value without admins or an allowlist does not close sign-up.
- **Communication:** publish a factual status note through the chosen support/status
  channel, with affected features, start time and next update. Record the recovery
  time and follow-up fixes. This runbook does not send notifications automatically.

## Launch evidence still required

Production contact/operator/jurisdiction; domain and license decisions; separate
staging; backup schedules and restore evidence; external paging and report alerts;
capacity baseline; reviewer-only access and seeded accounts; the real-host checks in
[host-compatibility](host-compatibility.md); and directory submission assets. Publishing,
turning on signup and removing lab gates happen after their own review and trials.
