# Plan: listing MCPortal in the Claude and OpenAI directories

**Status:** proposed (2026-10-02). D1 decided 2026-10-02: open sign-up, GitHub sign-in only. The requirements below were checked against Anthropic's and OpenAI's docs on 2026-10-02. Both change often, so re-check each one before submitting.

## Goal

Get MCPortal listed in Claude's directory first and OpenAI's (ChatGPT and Codex) second, and run it like a mature service:
- published policies
- a private way to report security problems
- predictable releases
- monitoring that tells us before users do
- billing kept away from the conversation

## Principles

- **The hosted connector is the main product.** Most people will add MCPortal from the directory on the Customize page in Claude, or the apps menu in ChatGPT. The local plugin is the second, power-user path. Anthropic's directory no longer lists `.mcpb` extensions, so the local version ships inside the plugin.
- **The room never sells; the account page does.** Money is only handled on the hosted website (`/account`), never in a tool, the room UI, or text the model reads. That keeps us inside both directories' payment rules. OpenAI explicitly bans selling subscriptions and showing upsell links in the app.
- **Reviewers get a real account, not a demo.** The tester account is a normal account seeded with realistic content. It's created on purpose, can be revoked, and logged in the audit log.
- **Every rule a directory checks also gets a test of ours.** Annotations, CSP and description sizes are enforced in `npm run check`, so passing review isn't a one-off.
- **GitHub is the only sign-in, for good.** Everyone signs in with GitHub; there is no plan for a second provider. The one exception is the reviewer path in Phase 3, which is for directory reviewers only and never offered to users.
- **Tool names are a public contract once listed.** Renames go through a deprecation window (see Phase 5), never a silent change.

## Decisions needed first (Lawrence)

| # | Decision | Options | Leaning |
|---|---|---|---|
| D1 | Who can sign up | **Decided:** open to anyone with a GitHub account. Invites stay, as a way to bring friends in, not a gate. | — |
| D2 | Code license | MIT, Apache-2.0, source-available (e.g. FSL), proprietary with a public repo | Undecided. The plugin listing needs a public repo, but not necessarily an open-source license. |
| D3 | How reviewers sign in | A reviewer-only sign-in on our authorization server; a dedicated GitHub account we hand over | Reviewer-only sign-in, used for both directories. A shared GitHub account breaks GitHub's terms (one login per person, and a review team is several people), and GitHub can ask for an emailed device code, which OpenAI rejects. Reviewer accounts aren't users, so the GitHub-only rule for users stands. |
| D4 | Paid tier shape | Free plus ~$5/mo "Patron" with higher limits and more storage; free only at launch | Launch free. Add billing after the Claude listing is stable (Phase 8). |
| D5 | Domain | Keep `*.up.railway.app`, or a custom domain | A custom domain before submitting. The listing, OAuth metadata, OpenAI domain verification and the MCP Apps `_meta.ui.domain` all tie to it, and moving later means a new OpenAI submission. |
| D6 | Who submits | Personal paid Claude plan; OpenAI individual or business verification | Individual for both, unless there's a company. |

## Phase 1: the tool contract (code)

- [ ] Every tool states all three hints: `readOnlyHint`, `destructiveHint`, `openWorldHint`. About 32 tools are missing `openWorldHint`, which hosts read as `true`. Only tools that fetch the open web (sources, articles, docs, thumbnails) should be `true`.
- [ ] A test that fails if a tool is missing a title or any of the three hints, or has a write tool marked read-only.
- [ ] Review the descriptions against both directories' rules:
  - narrow and accurate
  - no instructions aimed at the model beyond how to use the tool
  - no tool that both reads and writes
- [ ] `test/footprint-ceilings.json` covers all 47 tools (today 41).
- [ ] MCP Apps metadata:
  - CSP on the `resources/list` entry as well as `resources/read`
  - `_meta.ui.domain`, unique to MCPortal and required by OpenAI
  - `ui/open-link` origins we own, declared so Claude doesn't ask to confirm each link
- [ ] Error text is specific everywhere. This is mostly done (coded tool errors with a reference number); audit what the hosted server returns for 5xx.
- [ ] Prefer CIMD over dynamic client registration in our OAuth metadata, as Anthropic recommends for directory traffic. Both already work; check the advertised order and keep DCR.

## Phase 2: policies and trust (docs and site)

- [ ] **Terms of service and acceptable use** at `/terms`, linked in the footer and on the consent screen. It covers:
  - accounts and age (13+)
  - content and conduct for shares and profiles
  - moderation and removal
  - the service "as is" and liability
  - termination
  - changes to the terms, with notice
  - governing law
  - Get a lawyer's read before launch if budget allows.
- [ ] **Privacy policy fixes** (the full list of mismatches is in Phase 2b):
  - add the subprocessors (Railway, GitHub, Automattic's image proxy, Stripe later)
  - add a "last updated" date and a change log
- [ ] **Private security contact:**
  - `SECURITY.md` and `/.well-known/security.txt` with a security mailbox, not GitHub issues
  - turn on GitHub private vulnerability reporting
  - state a response target (e.g. acknowledge within 3 business days)
- [ ] **License** per D2: a `LICENSE` file, `manifest.json` `license`, and the README.
- [ ] **Age:** state 13+ at sign-up (consent screen) as well as in the privacy policy.
- [ ] **Support:** the support page names a real contact and expected response time, and drops "invite-only".

## Phase 2b: data handling (before open sign-up)

An audit on 2026-10-02 found the foundations solid (sign-in tokens stored only as hashes, the GitHub token used once and dropped, SSRF-safe fetching, CSRF on the account page, no content or IPs in logs), but the privacy policy promises things the code doesn't do. Every statement on `/privacy` must be true before open sign-up.

**Statements that aren't true today:**
- [ ] **Logs:** the policy says logs don't record your user ID. They record `userRef`, a hash with a fixed prefix (`src/lib/log.ts`). GitHub ids are sequential and the repo will be public, so it can be reversed. Key the hash with a secret (`MCPORTAL_LOG_KEY`), and say what logs keep.
- [ ] **Backups:** the policy promises point-in-time recovery and that backups roll over within 30 days. Nothing sets that up. Configure backups with 30-day retention (Phase 4), or change the wording until they exist.
- [ ] **What we store:** add reading history (up to 1,000 URLs, titles and progress per user), seen marks, highlights (editions), handoffs (a URL and passage), and the device name recorded when a computer links. Add the account-page cookie (1 hour) to the cookie section.
- [ ] **"Keeps only your GitHub user ID and login":** make clear this is about GitHub data, not everything stored.

**Deletion that leaves traces** (`deleteAccountData`, `src/account.ts`):
- [ ] OAuth client records from linked computers keep the computer's hostname; delete the user's clients.
- [ ] The audit log keeps `@login` after deletion; keep the event, drop the login.
- [ ] Reports: drop the reason text of reports the user filed, and anonymize reports about them once resolved.
- [ ] File mode: remove `.corrupt-*.json` backups and the emptied clips file.
- [ ] An admin path to delete an account for someone who has lost access to GitHub (verified by hand, logged).
- [ ] A test that creates every kind of data for an account, deletes it, and finds nothing left.

**Retention: nothing grows forever:**
- [ ] Purge expired highlights (editions) and handoffs on a schedule, not only when the same user writes again.
- [ ] Set retention for resolved reports, pending invites, the audit log and unused OAuth clients, and state each one in the policy.

**Smaller fixes:**
- [ ] Tie the export download and upload links to the browser session that opens them; today anyone holding the link can use it for 15 minutes.
- [ ] Stop returning `cached` and `fetchedAt` from the shared fetch cache to users: they reveal whether someone else opened the same URL within the hour.
- [ ] The "everything" export includes mutes, blocks, reports you filed, and the full Space settings (title, accent, featured sources).
- [ ] Send HSTS on the hosted site.
- [ ] Request no GitHub scope instead of `read:user` (the id and login don't need one).
- [ ] Create the local data directory with owner-only permissions; refuse `http://` hosted servers when linking (except loopback, for tests).

## Phase 3: access for the public and for reviewers

- [ ] **Open sign-up** (D1):
  - turn on `MCPORTAL_OPEN_SIGNUP`, and add it to the preserved variables in `.railway/railway.ts`
  - remove "invite-only" wording from the support page, README and sign-in screens
  - keep an emergency brake (an admin switch that pauses new sign-ups during an abuse wave), off by default
- [ ] **Invites as encouragement:**
  - an invite link on the account page (and maybe in your Space) that anyone can share
  - record who invited whom, as accounts already record how they got in
  - no rewards or tiers tied to invites for now
- [ ] **Reviewer access** per D3, in production (reviewers test the listed URL; staging can't stand in):
  - a reviewer sign-in form on the OAuth sign-in screen, shown only while `MCPORTAL_REVIEW_LOGIN=1`; off between reviews
  - accepts only accounts with a `reviewer` role, created with the admin CLI (`mcportal admin reviewer create`); never a way to make an account
  - long random password, stored as a slow hash (scrypt); no MFA; rotated after each review
  - login attempts rate-limited, with a lockout
  - every sign-in in the audit log; revocable from the admin page
  - **sandboxed social:** reviewer accounts' profiles and shares are visible only to other reviewer accounts and admins, so reviews never post to real users
  - two reviewer accounts, so following and sharing can be tested between them
- [ ] **Staging environment:** a second Railway environment with its own Postgres and domain, for trying releases, database changes and backup restores, and for practice runs of the Claude and ChatGPT connection flows. It is not where reviewers go.
- [ ] **Seed script** for a "fully populated" reviewer account:
  - a room with several layouts
  - saved items, clips and highlights
  - a public profile with shares
  - a followed account
- [ ] **Abuse readiness for open sign-up:**
  - the admin is alerted (email or webhook) on new reports
  - rate limits checked against the per-user and global budgets

## Phase 4: operating it

- [ ] **Capacity:** raise or rework `globalPerDay` (60,000 today). It's a cost guard, so size it from Railway's cost per request and alert at 80%, rather than letting directory traffic hit a hard wall.
- [ ] **Backups:** scheduled Postgres backups, with a restore drill that's written down and has actually been run once.
- [ ] **Uptime monitoring:** an external check on `/health` and on an authenticated `tools/list`, paging Lawrence.
- [ ] **Error tracking:** count 5xx and tool crashes over time. Anthropic's health badge drops when more than 2% of requests fail over 30 days, and is "degraded" above 5%, so watch that number ourselves.
- [ ] **A short incident runbook:** roll back a deploy, restore from backup, revoke tokens, post a status note.
- [ ] **Status note:** a simple status line on `/support`, or a hosted status page.

## Phase 5: release discipline

- [ ] **Release script:** one command bumps the version everywhere it lives (`package.json`, `.claude-plugin/plugin.json`, `manifest.json`, `server.json`, `SERVER_INFO`), moves "Unreleased" in the CHANGELOG under a version, tags, and pushes. Plugin users only get updates when the version changes.
- [ ] **Catch up:** cut v0.5.0 (or v0.6.0) with the current "Unreleased" changelog, and update the README's "latest" line.
- [ ] **Compatibility policy**, written down:
  - `MIN_CLIENT_VERSION` only rises with a release note
  - a tool rename keeps the old name for one release, as a hidden alias that says it's moving
  - Claude listing name changes go through a listing edit
- [ ] **README:** how to turn on auto-update for the plugin marketplace (it's off by default for third-party marketplaces).

## Phase 6: certify the hosts

Nobody has hand-tested every host yet (`docs/host-compatibility.md`). Test the room, reader, clips, sign-in and sharing in each, and record the results in that file.

- [ ] Claude: web, Desktop, mobile (iOS/Android), and Claude Code with the plugin.
- [ ] ChatGPT (developer mode) and Codex.
- [ ] **Submission assets:**
  - 3–5 PNG screenshots, at least 1000px wide, cropped to the room, each with its prompt
  - at least 3 example prompts
  - OpenAI's 5 positive and 3 negative test cases
  - a walkthrough video
  - a 30-character name and short description

## Phase 7: submit to Claude

- [ ] **Connector:** submit at claude.ai/directory/manage with:
  - docs, privacy, terms and support URLs
  - icon and URL slug (permanent)
  - data-handling answers
  - reviewer credentials
  - confirmation that every tool was run by hand
- [ ] **Plugin bundle:** submit from the public repo and pair it with the connector.
- [ ] Wait for the automated scan (listed as "Community"); answer any review requests.
- [ ] After listing: watch the health badge, and handle listing edits for any tool renames.

## Phase 8: billing (after D4)

### What Patron includes

Patron (~$5/mo) is "keep more, keep it forever, find it again". It sells storage and archiving, which are also where our costs are. It never sells access to people.

**Always free**, because the social layer only works if everyone is in it, and charging to leave isn't by the book:
- the hosted room, sync across devices, and the local and linked modes
- sharing, reblogging, following, your Space and handle
- export and account deletion

**Patron:**
- **Permanent archive:** a saved item keeps a readable copy, so it still opens after the original site changes or disappears.
- **Search everything:** full-text search across saved items, clips and reading history.
- **Higher limits:** free stays generous (200 saved items, 1,000 reading-history entries, 8 columns, the daily usage budget); Patron lifts them, with more clip and image storage.
- **Space extras:** themes and art, more featured sources, a supporter badge.
- **Maybe later:** a daily edition delivered outside the chat. It needs email addresses, which is a data-handling decision of its own.

The pitch lives on the website and the account page only. Inside the conversation, hitting a limit just says what the limit is and when it resets.

### Building it

Billing lives only on the hosted website:
- [ ] Stripe Checkout and the Stripe customer portal on `/account`.
- [ ] A webhook keeps an `entitlements` record per account (tier, status, period end). Entitlements set the budget and storage limits; the server enforces them, never the client.
- [ ] **Out of the conversation:**
  - when a limit is hit, the tool error states the limit and when it resets, with no "upgrade" link or pitch
  - the room shows limits neutrally, if at all
  - this holds on every host, so we don't have to branch per platform
- [ ] **Policies:** terms gain billing, refund and cancellation sections; the privacy policy adds Stripe as a subprocessor.
- [ ] **Verify before building:**
  - Anthropic's policy on paid tiers sold outside the product, and on linking to the account page from tool text
  - OpenAI's rule on apps whose limits rise with an off-platform subscription

## Phase 9: submit to OpenAI

- [ ] Developer identity verification (D6).
- [ ] Domain verification at `/.well-known/openai-apps-challenge` on the custom domain.
- [ ] Allow the OpenAI OAuth callback (`chatgpt.com/connector_platform_oauth_redirect`). Our redirect-URI check already accepts any https URL; add a test for this one.
- [ ] Submit with the test cases, video, reviewer credentials and an optional country allowlist.
- [ ] Afterwards: OpenAI rescans the server daily, so tool changes go live after automated checks, and changes to skills or listing details mean a new upload.

## Order and rough size

1. **D1–D6** (decisions).
2. **Phases 1, 2, 2b and 5 together.** Mostly code and docs, about one to two weeks of sessions.
3. **Phase 4**, then **Phase 3.** About a week; backups and monitoring come before open sign-up goes live.
4. **Phase 6**, then **Phase 7.** The Claude listing.
5. **Phase 8**, then **Phase 9**, once the Claude listing is steady.

## Open questions

- Do we want a "Verified" review from Anthropic, where a person tests each tool, or is the automated "Community" listing enough at launch?
- Can a public OpenAI plugin bundle a local stdio server, or is it remote-only there? Not confirmed in OpenAI's docs.
