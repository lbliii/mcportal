# Plan: a Railway template, and federation later

## Why

MCPortal is open source under AGPL-3.0, so anyone can run their own. Two things would make that practical and worthwhile. A one-click template makes running your own a short task rather than an afternoon. Federation would let people on their own instances follow and reblog people elsewhere, instead of reading alone. The template is near-term; federation is an idea to keep the design open for, not a commitment.

## A Railway template

Publish a one-click template to Railway's marketplace: the app plus Postgres. It doubles as a recipe for the hosted deployment. See [running your own](../how-to/self-host.md) for the manual steps it would automate.

To get right:

- **GitHub OAuth setup.** Every self-hoster needs their own GitHub OAuth app. The template prompts for the client ID and secret; clear steps decide whether the deploy takes two minutes or fifteen.
- **Say what a single instance is.** Follows, shares, reblogs and Spaces work only within one instance until there is federation.
- **Good docs keep questions down.** Template users ask questions in Railway's template queue, and the template's docs should answer the common ones first.

## Federation

Three shapes, simplest first.

1. **Hub first.** Self-hosted instances connect to the main MCPortal as a meeting point: their shares are published to the hub, and their people can follow people there. One connection per instance, moderation in one place. It extends the linked mode, where a local install already signs in to a hosted account (see [local and hosted](../explanation/local-and-hosted.md)).
2. **Direct server to server.** Instances talk to each other with signed requests, inboxes and discovery by address. Real federation, with real costs: spam, blocks across servers, and deletes that must propagate.
3. **ActivityPub, opt-in.** A bridge to Mastodon and the wider fediverse.

### Why ActivityPub is opt-in

Publishing on MCPortal is native: shares, follows and reactions live inside the product and are seen by people on MCPortal, not published to the open web. ActivityPub is the opposite. Posts land in Mastodon timelines, strangers reply, copies sit on servers nobody here controls, and deletes are requests, not guarantees.

As an opt-in it fits, as it does for Threads (a per-account switch, off by default) and WordPress (a plugin). It would be per person on the hosted service and per instance for self-hosters. If built, start outbound only: opted-in shares go out and can be followed, and nothing comes in. Most moderation and spam work is incoming content.

### Nothing in the schema blocks it

- A share holds a full copy of its content (`mcportal_shares.data`), not references to other rows. That copy is what would travel between servers.
- Follows, mutes and blocks are text pairs `(a, b)`, so `b` could later hold an address on another server, such as `alice@her-portal.app`.

Two changes would help if these areas are touched anyway: give people and shares an address that includes the server, not only a local id; and record reblogs and follows as activities (who did what to which thing).
