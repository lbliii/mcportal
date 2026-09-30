# Changelog

## v0.3.0 — 2026-09-30

MCPortal becomes a reading platform that lives in your agent, and a hosted service ready for a small invite-only beta.

### Reading in chat
- **Built for chat hosts:** the workspace renders inline in Claude, with no backdrop of its own, and sits in the host's surface.
- **Layouts:** a sideways-scrolling **columns** lane, where each column scrolls its own items, and picture **shelves**, one row per source.
- **Opening stories:** in the workspace, or as their own **reader card** in the conversation.
- **Look:** a custom icon set, denser controls and compact story details. The card height now shrinks back after the reader closes.

### Sources
- **Add anything:** paste a site, feed, `r/subreddit`, `owner/repo`, or a YouTube, Bluesky, Mastodon, Medium, PyPI, Lobsters, Stack Overflow or arXiv address. MCPortal finds a feed that works and previews it (`find_source`, `add_panel`, and the **+** sheet).
- **Thumbnails** for feeds, videos and repos. The server fetches them and hands them over as data URIs, so the view never contacts third parties.
- **Starter packs** (developer, AI, news, games, art, science, music, film) build a new user's portal in seconds. Every source was checked from a laptop and from the cloud.
- **OPML import and export:** bring subscriptions from another reader, or take yours anywhere.

### Your stuff
- **Saved items:** bookmark stories into a Saved panel. Layout edits can never drop them.
- **Onboarding:** "Make it yours" for new users, and "start over" on request.

### Hosted service
- **Postgres storage** for profiles and sign-in state. It's imported once from the old files, and point-in-time recovery is on.
- **Per-user usage limits:** a per-minute burst allowance and a daily cap, plus a global daily cap.
- **Accounts and invites:** invite-only sign-in with GitHub, suspension that takes effect within 30 seconds, and admins from `MCPORTAL_ADMINS`. The old allowlist still works.
- **One access gate:** `authorize()` runs before every tool call. Suspended accounts can't act, and tools only ever act on the caller's own portal.
- **Admin page** at `/admin`: invites, suspensions and the audit log. It's not MCP, so nothing a model reads can reach it. The same actions are available as `mcportal admin …` commands.
- **Invite links:** each invite has a `/join/<code>` page with setup steps, and the admin page gives you a ready-to-send message.

### For contributors
- **`bin/mcportal-dev.mjs`:** hot-reloads the server in Claude desktop without a restart. Setup is in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Plans** in [`docs/plans/`](docs/plans/): Postgres storage, local and hosted used together, clips, and identity and access (with portability).
- **Tests:** 59 tests, plus Postgres integration tests that run when `TEST_DATABASE_URL` is set.

### Upgrade notes
- **New runtime dependency:** `pg`, loaded only when `DATABASE_URL` is set. Local MCPortal still needs no `npm install`.
- **New environment variables:** `DATABASE_URL`, `MCPORTAL_ADMINS`, `MCPORTAL_OPEN_SIGNUP`, and `MCPORTAL_LIMIT_PER_MINUTE`, `MCPORTAL_LIMIT_PER_DAY` and `MCPORTAL_LIMIT_GLOBAL_PER_DAY`. See `.env.example`.
- **Sign-up:** setting `MCPORTAL_ADMINS` makes the server invite-only. With no admins and no allowlist, sign-up stays open, as before.
- **Column limit:** up to 8 columns, up from 4.

## v0.2.0

Hardened after an adversarial review. OAuth 2.1 with GitHub sign-in and per-user profiles.

## v0.1.0

The plugin daily driver: MCP server, workspace app, `/portal`, Railway config.
