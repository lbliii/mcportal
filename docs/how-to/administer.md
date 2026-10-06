# Administer an instance

Decide who can sign in to your MCPortal, let people in, cut them off, act on reports, and delete an account for someone who can't. This assumes a hosted instance with GitHub sign-in; see [Run your own MCPortal](self-host.md).

Admin actions are never MCP tools. Nothing a model reads can invite, suspend or impersonate anyone. You use the `/admin` page in a browser or the admin CLI on the server.

## Who can sign in

Each person signs in with GitHub and gets an account with the id `github-<numeric id>`, so a GitHub rename doesn't matter. Three variables decide who gets in:

| Setting | Effect |
|---|---|
| `MCPORTAL_ADMINS` | These logins (or numeric GitHub ids) can always sign in and are admins. Setting it makes the server invite-only. |
| `MCPORTAL_ALLOWED_GITHUB_USERS` | An allowlist of logins or numeric ids. Also makes the server invite-only. |
| `MCPORTAL_OPEN_SIGNUP=1` | Anyone with a GitHub account can sign in, even with admins set. |

With neither admins nor an allowlist, sign-up is open to anyone. Set `MCPORTAL_ADMINS` before you share the URL.

On an invite-only server, an admin invites people by GitHub login. The account is created the first time they sign in.

How someone got in decides how long they stay:

- **Invited** people stay until an admin suspends them.
- **Allowlisted** people lose access when you remove them from the list.
- People who joined during **open sign-up** lose access if you close it, unless you invite them.

Access is re-checked on every request and every token refresh.

Admins come only from `MCPORTAL_ADMINS`. To add or remove one, change the variable and redeploy.

## The admin page

Go to `https://<your-domain>/admin` and sign in with GitHub. Only active admins get past sign-in. The page lets you:

- invite a GitHub login, or withdraw a pending invite;
- suspend or reinstate an account (you can't suspend yourself);
- review reports, and hide a reported share or dismiss the report;
- show a hidden share again;
- read the audit log;
- see today's usage budget by account, and per-tool call counts, errors and timings.

An invite gives you a link of the form `https://<your-domain>/join/<code>`. Send it to the person. It explains how to connect. The code isn't a secret: they still have to sign in as the invited login.

Admin sessions live in memory. Sign in again after a deploy.

## The admin CLI

The same actions run from the command line on the server. The CLI uses the server's storage (Postgres when `DATABASE_URL` is set, files otherwise). The running server picks up changes within 30 seconds.

```bash
node bin/mcportal.mjs admin list                       # accounts and pending invites
node bin/mcportal.mjs admin invite <github-login>      # prints the /join link
node bin/mcportal.mjs admin uninvite <github-login>
node bin/mcportal.mjs admin suspend <login|account-id> [reason]
node bin/mcportal.mjs admin reinstate <login|account-id>
node bin/mcportal.mjs admin audit [n]                  # last n entries, default 50
node bin/mcportal.mjs admin delete <login|account-id> --confirm
```

On Railway, run it inside the service:

```bash
railway ssh --service mcportal -- node bin/mcportal.mjs admin list
```

With Docker, use `docker exec <container> node bin/mcportal.mjs admin list`.

Report moderation (hide, dismiss, unhide) is on the admin page only.

## Suspend someone

Suspend from `/admin` or with `admin suspend <login> [reason]`. Within 30 seconds every tool call, state API call and token refresh from that account is refused, and they can't sign in again. Their data stays. The reason goes in the audit log.

To undo it, reinstate them.

## Delete an account for someone who lost GitHub access

People delete their own account at `/account`. If someone can't sign in, because they lost their GitHub account, you can do it for them:

1. Confirm the request comes from the account's owner. Deletion can't be undone.
2. Find the account with `admin list`.
3. Run `admin delete <login>` without `--confirm`. It names the account and what will go, and changes nothing.
4. Run it again with `--confirm`.

This removes the room, saved items, clips, reading state, public profile, shares, follows and sign-ins, the same as deleting from `/account`. The audit log records that an account was deleted, and by whom, without naming it.

## Reports

Signed-in people can report a share or a person from their agent with the `report` tool. Reports wait on the admin page; nothing notifies you, so check it regularly.

- For a share: **Hide** removes it from everyone's view but its author's. **Dismiss** closes the report and leaves the share up.
- For a person: dismiss the report, and suspend the account if it warrants it.

A resolved report about a hidden share keeps an **Unhide** button, to show the share again.

## The audit log

Account creation, invites, suspensions, reinstatements, deletions and moderation decisions are recorded with who did them and when. Actions from `/admin` are attributed to `admin:<login>`; actions from the CLI to `admin-cli:<user>`. Read it on `/admin` or with `admin audit`.
