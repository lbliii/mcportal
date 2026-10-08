# Plan: launch

## Why

Most people will find MCPortal in an agent's app directory: Claude's connector directory first, then OpenAI's for ChatGPT and Codex. A listing puts a hosted service in front of strangers, so it has to run like a mature one: published policies, a private security contact, honest data handling, predictable releases, and monitoring that notices trouble before users do. This plan covers what remains between today's service and a listing.

Directory requirements below were checked against Anthropic's and OpenAI's documentation on 2026-10-02. Both change often; re-check each one before submitting.

## Principles

- **The hosted connector is the main product.** The local plugin is the second path, for people who want MCPortal on their own machine. Anthropic's directory no longer lists `.mcpb` extensions, so the local server ships inside the plugin.
- **Money never enters the conversation.** No tool, room view or model-facing text sells anything. Both directories forbid it, and OpenAI bans upsell links inside apps outright.
- **Reviewers get a real account, not a demo.** A reviewer account is an ordinary account with realistic content, created on purpose, revocable, and audited.
- **Every rule a directory checks is also a test of ours.** Tool annotations, the content-security policy and description sizes are enforced by `npm run check`, so passing review is not a one-off.
- **GitHub is the only sign-in for users.** The reviewer sign-in below exists only for directory reviewers.
- **Tool names are a public contract once listed.** A rename keeps the old name for one release as a hidden alias.

## What's in place

Every tool carries a title and all three hints (`readOnlyHint`, `destructiveHint`, `openWorldHint`), checked by `test/tool-contract.test.ts`; descriptions are narrow and no tool both reads and writes; every model-visible tool has a token ceiling; the room's content-security policy is on both `resources/list` and `resources/read`; and OAuth advertises both client ID metadata documents and dynamic registration. The site publishes terms, a privacy policy that matches what's stored, a support page and a security policy with `/.well-known/security.txt`. Account deletion leaves no trace of the person (`test/deletion.test.ts` proves it), housekeeping expires everything that would otherwise grow forever, and exports cover all of a person's data. Releases go through `npm run release` and follow a written compatibility policy ([compatibility](../how-to/release.md#compatibility)), `npm run ops:check` probes a deployment, and [operating the hosted service](../how-to/operate.md) covers deploys, rollback, restores and incidents. The code is licensed AGPL-3.0.

## Tool contract

- Set `_meta.ui.domain`, which OpenAI requires. Its format differs by host (Claude derives hash-based `*.claudemcpcontent.com` names, ChatGPT URL-derived `*.oaiusercontent.com` ones), it depends on the final domain, and a wrong value could break the room in Claude. Either set it per client, or confirm Claude ignores ChatGPT's value.
- Audit what the hosted server returns on 5xx so every error is specific, as tool errors already are.
- Build the hidden-alias mechanism before the first tool rename after listing.

## Policies and settings

- Have a lawyer read the terms, especially limitation of liability and governing law.
- Set `MCPORTAL_CONTACT_EMAIL`, `MCPORTAL_OPERATOR`, `MCPORTAL_JURISDICTION` and `MCPORTAL_SOURCE_URL` in production.
- Turn on GitHub private vulnerability reporting once the repository is public.
- Choose a custom domain before submitting. The listing, OAuth metadata, OpenAI's domain verification and `_meta.ui.domain` all tie to it; moving later means a new OpenAI submission.

## Access for the public and for reviewers

**Open sign-up.** Set `MCPORTAL_OPEN_SIGNUP=1` in production, and only after backups and monitoring are live. Remove invite-only wording from the support page, README and sign-in screens. Add an admin switch that pauses new sign-ups during an abuse wave, off by default. Invites stay as a way to bring friends in: an invite link on the account page that anyone can share, with no rewards attached.

**Reviewer access**, in production, since reviewers test the listed URL:

- A reviewer sign-in form on the OAuth sign-in screen, shown only while a review flag is set and off between reviews.
- It accepts only accounts with a `reviewer` role, created from the admin CLI; it never creates an account.
- A long random password stored with scrypt, rotated after each review. Attempts are rate-limited, with a lockout.
- Every sign-in goes in the audit log and is revocable from `/admin`.
- **Sandboxed social:** reviewer profiles and shares are visible only to other reviewer accounts and admins, so a review never posts to real users.
- Two reviewer accounts, so following and sharing can be tested between them.
- A seed script that fills a reviewer account: a room with several layouts, saved items, clips and highlights, a public profile with shares, and a followed account.

A shared GitHub account won't do: GitHub's terms allow one login per person, and GitHub may ask for an emailed device code, which OpenAI's review rejects.

**Staging.** A second Railway environment with its own Postgres and domain, for trying releases, schema changes and backup restores, and for rehearsing the Claude and ChatGPT connection flows. Reviewers never use it.

**Abuse readiness.** Alert the admin by email or webhook on each new report, and check the per-account and global rate limits against expected directory traffic.

## Operations

- **Capacity.** The global daily budget (`globalPerDay`, 60,000 units by default in `src/lib/budget.ts`) is a cost guard. Measure a baseline, size the budget from the cost per request, and add an alert at 80% of it; no such alert exists yet.
- **Backups.** Schedule daily and weekly Postgres backups, confirm their real retention, and verify that point-in-time recovery archiving is live rather than merely configured. Then run the restore drill in [operating the hosted service](../how-to/operate.md) once, into staging, and keep the evidence.
- **Uptime.** Run `npm run ops:check` on a schedule from outside Railway, against `/health` and an authenticated `tools/list`. Page on repeated failure, on a version mismatch after a deploy, and on sustained 5xx.
- **Error rate.** Track 5xx responses and tool crashes over time. Anthropic's directory marks a connector degraded above 5% failed requests over 30 days and drops its health badge above 2%; watch the number ourselves.
- **Status.** A status line on `/support`, or a hosted status page, for incident notes.

## Host certification

Nobody has yet tested every host by hand. Test the room, reader, clips, sign-in and sharing in each, and record the results in [host compatibility](../reference/host-compatibility.md):

- Claude on the web, desktop, iOS and Android, and Claude Code with the plugin.
- ChatGPT in developer mode, and Codex.

## Submission

Both directories want the same assets: three to five PNG screenshots at least 1,000 px wide, cropped to the room, each with its prompt; at least three example prompts; a walkthrough video; and a name and short description within their length limits. OpenAI also wants five positive and three negative test cases.

**Claude**, at claude.ai/directory/manage:

- Docs, privacy, terms and support URLs; an icon and a permanent URL slug.
- Data-handling answers, reviewer credentials, the `ui/open-link` origins we own, and confirmation that every tool was run by hand.
- The plugin bundle, submitted from the public repository and paired with the connector.
- After listing, watch the health badge and file a listing edit for any tool rename.

**OpenAI**, once the Claude listing is steady:

- Developer identity verification.
- Domain verification at `/.well-known/openai-apps-challenge` on the custom domain.
- `_meta.ui.domain` for ChatGPT, unique to MCPortal, without breaking Claude.
- A test for the OpenAI OAuth callback (`chatgpt.com/connector_platform_oauth_redirect`). The redirect check already accepts any HTTPS URL.
- OpenAI rescans listed servers daily, so tool changes go live after its automated checks; skill or listing changes need a new upload.

## Billing

A paid tier may come later. If it does, it is bought and managed on the website's account page, never inside the conversation. When a limit is hit, the tool says what the limit is and when it resets, with no upgrade link, on every host. Before building it, re-check both directories' rules on paid tiers sold outside the product.

## Order

1. Tool contract, policies and settings.
2. Operations, then open sign-up and reviewer access. Backups and monitoring come before open sign-up.
3. Host certification, then the Claude submission.
4. The OpenAI submission.

## Open questions

- Is the automated "Community" listing enough at launch, or should MCPortal seek Anthropic's "Verified" review, where a person tests each tool?
- Can a public OpenAI plugin bundle a local stdio server, or is it remote-only? OpenAI's documentation doesn't say.
