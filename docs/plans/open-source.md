# Plan: open source, a Railway template, and federation later

**Status:** thinking, 2026-10-02. Nothing decided, nothing built. Leaning toward open-sourcing around the directory launch ([directory-launch.md](directory-launch.md), decision D2). Federation is filed away as "think about later".

## Why open source fits MCPortal

- **The users are developers.** GitHub is the only sign-in, so everyone has a GitHub account. That audience trusts open code and finds things through repos. A public repo is distribution a solo founder doesn't have to pay for.
- **It's a trust product.** People connect their agent to a service that remembers what they read. Readable code answers "what does it do with my data?" better than a privacy policy alone. The Anthropic plugin listing needs a public repo anyway.
- **The code isn't what people pay for.** The ~$5/mo buys the hosted service: the running instance, the social network, backups, watches that keep running. Few people self-host a reader, and those who do weren't likely to pay.

## License

| Option | What it does | Trade-off |
|---|---|---|
| **AGPL-3.0** (leaning) | Anyone running a modified copy as a service must publish their changes | Real open source; puts off commercial clones |
| FSL | Source-available; bans competing hosted copies, becomes Apache/MIT after two years | Stronger protection, but not open source by the usual definition |
| MIT / Apache-2.0 | Anything goes | No protection against a hosted clone |

Patron features (archive, higher limits) stay in the open code. Self-hosters get them free; that's normal for an AGPL service. Decide this once and don't try to lock features out later.

## Before the repo goes public

- [ ] Move business material to a private repo: `reports/` (market research), `research_notes/`, and anything strategic in `docs/plans/`.
- [ ] Scan the full git history for secrets, or start the public repo from a fresh initial commit. Flipping visibility publishes every past commit.
- [ ] `LICENSE`, `manifest.json` `license`, and the README (directory-launch Phase 2 checklist).
- [ ] `CONTRIBUTING.md` sets expectations: issues welcome, PRs by discussion first.
- [ ] Security reports go to a private channel, not public issues (already a directory-launch gap).
- [ ] Check any outside-work or open-source policy from a day job.

Going public is one-way: forks and clones stay out there. A natural moment is the directory launch.

## A Railway template

Publish a one-click template to Railway's marketplace (the app plus Postgres). Railway's kickback program (checked 2026-10-02, [docs](https://docs.railway.com/templates/kickbacks)):

- **15%** of the usage that deployments of the template generate.
- **25%** in total when we answer questions in the Template Queue. If there are no questions, the full 25% applies.
- Marketplace templates only, so the repo must be public first. Paid as Railway credits by default, or cash in $100 withdrawals.

A one-person instance probably costs ~$5–10/mo, so roughly **$1.25–2.50/mo per self-hoster**. That's a bonus, not a business model, but it comes from people who wouldn't subscribe. It also turns "someone runs their own copy" into something that pays us, and the template doubles as a recipe for our own deployment.

To get right:
- **GitHub OAuth setup.** Every self-hoster needs their own GitHub OAuth app. The template prompts for the client ID and secret; clear steps decide whether it's a two-minute deploy or fifteen.
- **Self-hosted means a personal reader.** Follows, shares, reblogs and Spaces only work inside one instance until there's federation. Say so up front.
- **Docs keep the support queue quiet.** The extra 10% is for answering questions.

## Federation, later

Self-hosters are cut off from the social layer. If that becomes a real request, some way of following and reblogging across instances. Three shapes, simplest first:

1. **Hub first (leaning).** Self-hosted instances connect to the main MCPortal, which is the meeting point: their shares are published to the hub, and they can follow people there. One connection per instance, moderation in one place, and the hosted network stays a reason to pay. It extends the **linked** mode in [local-hosted-hybrid.md](local-hosted-hybrid.md), where a local install already signs in to the hosted account.
2. **Direct server-to-server.** Instances talk to each other: signed requests, inboxes, discovery by address. Real federation, with real costs: spam, blocks across servers, deletes that have to propagate.
3. **ActivityPub, optional.** A bridge to Mastodon and the wider fediverse.

**Why ActivityPub is opt-in, not the default.** Publishing is native to MCPortal: shares, follows and reactions live inside the product and are seen by people on MCPortal, not published to the open web as feeds or public pages (decided 2026-09-30). ActivityPub is the opposite: posts land in Mastodon timelines, strangers reply, copies sit on servers we don't control, and deletes are requests, not guarantees. As an opt-in it fits, with precedent in Threads (a per-account fediverse switch, off by default) and WordPress (an ActivityPub plugin). Per user on the hosted service, per instance for self-hosters. If built, start **outbound only**: opted-in shares go out and can be followed, but nothing comes back in. Most of the moderation and spam work is incoming content.

### Nothing in the schema blocks this

- A share holds a full copy of its content (`mcportal_shares.data`), not references to other rows. That's what has to travel between servers.
- Follows, mutes and blocks are text pairs `(a, b)`, so `b` could later hold an address on another server (`alice@her-portal.app`).

Small things that would help if these areas get touched anyway: give users and shares an address that includes the server, not just a local id; record reblogs and follows as activities (who did what to which thing).
