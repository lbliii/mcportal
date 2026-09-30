# Plan: identity and access

**Status:** phases 1, 1b (OPML) and 2 (admin page) built (2026-09-30); the rest proposed. Phase 1 keeps accounts, identities, invites and the audit log as one document (a file or a Postgres row, like the OAuth state) rather than separate tables; they move to tables when M2's social features need joins. Invites are their own list rather than an `invited` account status, and accounts record how they got in (`invite`, `bootstrap`, `open`). **Milestones:** accounts, invites and `authorize()` in M1.5; public profiles and social in M2.

## Principles

- **Nobody sets up an identity until they choose to.** Local MCPortal needs no account. The hosted service needs a private account. A public profile exists only once you share or want to be followed.
- **GitHub is the sign-in.** It suits the audience and costs nothing to run. Other providers can be added later without migrating anyone.
- **Ownership is the main rule.** You fully control your own data; you can only read other people's shares their audience allows; nobody writes anyone else's data.
- **The agent can't escalate.** Tools always act as the signed-in user, and admin actions are never tools.

## Identity layers

| Layer | Exists when | What it is |
|---|---|---|
| None | Local, never signed in | Full portal, saved items and clips on the machine |
| Account | Signed in to the hosted service | Private. A stable internal ID; syncs the portal; invisible to other users |
| Public profile | The user opts in (to share or be followed) | A claimed handle (e.g. `@lbliii`, suggested from the GitHub login), display name, optional bio and avatar |

**Accounts vs. sign-in methods.** `accounts` holds MCPortal's ID, status and role. `identities` maps a provider identity (for now `github:<numeric id>`) to an account. Today's IDs (`github-<id>`) stay valid as account IDs, so no data moves; new accounts get the same form while GitHub is the only provider. A second provider (Google, email link, passkeys) would just be another `identities` row on the same account.

**Handles:**
- 2–30 characters, `a-z 0-9 _`, unique and case-insensitive
- reserved words blocked (`admin`, `mcportal`, `api`, `settings`…)
- changeable, with the old handle held and redirecting for 30 days
- independent of the GitHub login: the login is only the suggested default

## Sharing and feeds (M2)

Native to MCPortal, not published to the open web.
- **Share:** a saved item or clip plus a note. The audience is `followers` or `mcportal` (any signed-in user). Everything else (saved items, clips, layout) is private unless shared.
- **Follow:** open for public profiles.
- **Mute** (their shares disappear for you) and **block** (they can't follow you or see your shares; symmetric hiding).
- **Report** a share or profile, which goes to admins.
- **Feed:** the Following panel shows shares from people you follow that you're allowed to see, newest first, with blocked and muted people removed.

Blocking and reporting ship with sharing, not after it.

## Access control

**Ownership (most rules):**

| Resource | Owner | Others |
|---|---|---|
| Profile/layout, saved items, clips | Create, read, update, delete | None |
| Share | Create, read, delete; edit the note | Read if the audience allows and not blocked |
| Public profile | Create, read, update, delete | Read (handle, name, bio, public share count) |
| Follow | Create or delete their own | See follower counts only |

**Roles (thin layer):**
- `user`: default.
- `admin`: bootstrapped from `MCPORTAL_ADMINS=lbliii`; can't be granted from inside the app. Can hide a share, suspend or reinstate an account, resolve reports, and manage invites.
- `moderator`: later, if others help.

**Enforcement:**
1. **One gate:** every operation goes through `authorize(actor, action, resource)` in `src/access.ts`. Tools and HTTP endpoints call it; there's no second path.
2. **Scoped queries:** every query is scoped to the acting account ID. Cross-user reads (feed, profile by handle) go through dedicated functions that apply audience, block and suspension rules.
3. **Later:** Postgres row-level security as a third layer.

**The agent's reach:**
- No tool accepts a user or account ID.
- Social tools read only what the signed-in user may see.
- Admin actions live on an admin page or CLI that requires the admin role, never on MCP. That way a prompt injection can't moderate, suspend or impersonate.

**Audit log:** admin actions, account deletion, handle changes, and share deletion by admins (who, what, when, target).

## Accounts, invites and suspension (M1.5)

- `accounts.status`: `invited` · `active` · `suspended`.
- **Invites** replace `MCPORTAL_ALLOWED_GITHUB_USERS`. An admin invites a GitHub login, and the account activates on first sign-in. Open sign-up is a switch for later. The environment variable is still honored as a bootstrap until the table exists.
- **Suspension** is checked on every request and every token refresh, the same way the allowlist is today, so it takes effect at once.

## Data rights and portability

Your portal is yours to move, not just to download.

- **MCPortal export:** one versioned, documented JSON file (`mcportal-export` with a schema version) containing layout and sources, saved items, clips, and later shares and follows (by handle). **Import** into any MCPortal: local to hosted, hosted to local, or another server. Device linking in the hybrid plan can start from it.
- **Standard formats:**
  - **Sources as OPML**, which any feed reader imports.
  - **Saved items as a Netscape bookmarks file**, which browsers and bookmark managers import.
  - **Clips as Markdown files** (one per clip, with front matter), usable in Obsidian, Notion and plain folders.
- **OPML import:** bring subscriptions in from another reader. Each feed is test-loaded through discovery, and working ones become panels (or a starter layout for a new user). This is small and a strong onboarding path, so it comes early.
- Imports only ever add; they never replace an existing layout without asking.

- **Delete account:** removes the account, identities, profile, saved items, clips, shares, follows and reactions, and revokes tokens. Reports the user filed stay, anonymized.

## Tables (Postgres)

- `accounts(id, status, role, created_at)`
- `identities(provider, subject, account_id, login, created_at)` with a unique key on `(provider, subject)`
- `public_profiles(account_id, handle, display_name, bio, avatar_url, created_at, updated_at)`
- `handle_history(handle, account_id, released_at)`
- `shares(id, account_id, kind, ref, note, audience, created_at, hidden_at)`
- `follows(follower_id, followee_id, created_at)` · `mutes(…)` · `blocks(…)`
- `reactions(share_id, account_id, kind, created_at)`
- `reports(id, reporter_id, target_kind, target_id, reason, status, created_at)`
- `audit_log(id, actor_id, action, target, detail jsonb, created_at)`

The existing `mcportal_profiles` (layout, saved items) and the planned `mcportal_clips` stay, keyed by account ID.

## Phases

| # | Ships | Milestone |
|---|---|---|
| 1 | `accounts` and `identities`, bootstrap admins, invites and suspension, `authorize()` wired into every tool | M1.5 |
| 2 | Admin page: invites, suspend, audit log | M1.5 |
| 1b | OPML import (onboarding) and OPML export | M1.5 |
| 3 | Public profiles and handles, full export and import, bookmarks and Markdown exports, delete account | M2 |
| 4 | Shares, follows, mutes, blocks, reports; Following panel | M2 |
| 5 | Reactions; row-level security | M2+ |
