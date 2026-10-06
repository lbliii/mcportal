# Plan: the rally engine, one way to watch anything

**Status:** proposed 2026-10-06. Nothing built. This is the shared engine under [events.md](events.md) (artists and venues → shows near you) and [shops.md](shops.md) (stores and products → new arrivals, sales, restocks). It's the concrete form of [Release 3](delivery-roadmap.md) ("Portal brings worthwhile updates to me") and the product map's **Intelligence** row. The [watch implementation contract](../watch-implementation-contract.md) is its first worked instance: its storage, linking, export, deletion and fetch rules apply to every kind here, not only artists.

## The principle: a rally

MCPortal and the agent each do what the other can't, and each pass leaves the next one better for the user:

| | The agent | MCPortal |
|---|---|---|
| Strong at | Understanding, conversation, judgment, web search | Memory, persistence, watching over time, a place to look |
| Weak at | Forgets between chats, has no clock, can't keep watch | Understands nothing, can't talk or reason |

The test for any feature built on this: *what does the agent hand MCPortal, and what does MCPortal hand back?* If it only goes one way, it's a plain app or a plain chat. MCPortal still never calls a model ([attention.md](attention.md), principle 1).

Every kind of watch plays the same rally. Only the middle of it, what counts as news, differs by kind.

| Step | Who | Generic (built once) | Supplied by the kind |
|---|---|---|---|
| 1. Ask | Agent | The `watch` tool | Which words mean this kind ("I love Phoebe Bridgers", "follow Aesop") |
| 2. Resolve | MCPortal | Preview candidates without writing | How a name or URL becomes an identity (a Ticketmaster attraction, a Shopify store) |
| 3. Confirm | Agent + you | Short-lived, account-bound preview selection | What disambiguation to show ("Phoenix, French band, 4 upcoming shows") |
| 4. Hold | MCPortal | Watch list, preferences, collection, budgets, shared cache | Which provider to call, with what scope |
| 5. Notice | MCPortal | Snapshots and the diff | Which changes are news (a price going *down*, a show being *cancelled*) |
| 6. Show | MCPortal | Findings as items in a portal | The item variant and the default view |
| 7. Hand back | MCPortal → agent | `list_new_items` with reasons, the reported set | Nothing |
| 8. Judge and learn | Agent | Save and dismiss signals | Nothing: the agent decides "is this worth telling you?" |

## Vocabulary

- **Watch:** something a user follows that isn't a feed, confirmed to one identity, with a scope (filters, a location). The list is the user's data.
- **Kind:** the type of watch: `artist`, `venue`, `store`, `product`; later more. A kind is code, not configuration.
- **Provider:** where a kind's observations come from (Ticketmaster, a Shopify storefront, a venue's iCal). A kind can have several.
- **Observation:** one normalized record (an event, a product) with a stable identity and a fingerprint of the fields whose change matters.
- **Finding:** a change worth showing: `new`, `changed`, `back`, `gone`, `expired`. Findings become items in portals.

"Watch" the noun is the user's subscription. The product map's `watch` *view* ("what changed since your last look") is one way to show findings; the names fit together on purpose.

## Kinds

| Kind | Subject | Identity | Providers | News | Portal |
|---|---|---|---|---|---|
| `artist` | A musician or act | `ticketmaster:<attractionId>` | Ticketmaster; SeatGeek later | New show near you; date, venue or status change on a saved show | Shows |
| `venue` | A venue, promoter or organizer | Calendar URL | iCal, The Events Calendar, page event data, Eventbrite by organizer | New show | Shows |
| `store` | A brand's own shop | Origin + platform | Shopify, WooCommerce, Etsy | New arrivals, sales, restocks, within a filter | Shop |
| `product` | One product, optionally one variant | Product URL (+ variant) | Platform JSON, page product data | Price drop, back in stock, gone | Watching |

Later kinds reuse the same engine: a repository's releases, a docs page changing, an author's new book, a speaker's talks.

## The kind contract

A sketch of the interface. Names are proposals, not shipped APIs.

```ts
interface WatchKind<Subject, Obs> {
  kind: WatchKindName;
  /** Name or URL → candidates. Bounded, budgeted, writes nothing. */
  resolve(query: string, ctx: KindContext): Promise<Candidate<Subject>[]>;
  /** One bounded collection for a confirmed subject and scope, through safe fetch. */
  collect(subject: Subject, scope: WatchScope, ctx: KindContext): Promise<Collected<Obs>>;
  /** Stable across changes: 'ticketmaster:G5v…', 'shopify:aesop.com:7712…'. */
  identity(obs: Obs): string;
  /** Only the fields whose change can be news. */
  fingerprint(obs: Obs): Fingerprint;
  /** The kind's rules: which differences are findings. */
  findings(prev: Fingerprint | undefined, next: Fingerprint | undefined, scope: WatchScope): Finding[];
  toItem(obs: Obs, finding?: Finding): Item;
  /** Events expire; products don't. */
  expiresAt?(obs: Obs): string | undefined;
  /** The shared-cache key for one public query; never includes account data or keys. */
  cacheKey(subject: Subject, scope: WatchScope): string;
}
```

`Collected` carries the observations plus honest coverage: which provider, how many pages, whether the result was partial, rate-limited or failed. A failed fetch is never an empty success.

## Shared readers: build once, every kind uses them

Most of the work isn't per kind. It's a few readers that many kinds share. Each kind resolves through a **ladder**, like the [docs portal](docs-portal.md)'s: the most standard, most structured source first, stopping at the first that works. The rung that worked is saved with the watch.

- **Page structured data (schema.org JSON-LD):** `Event`, `Product` and `Offer` blocks embedded in pages. Ticketmaster, Eventbrite, Dice and most shop platforms include them. One reader gives venue events and single-product watches on almost any site. Builds on the existing reader extraction.
- **iCal:** a dependency-free reader for venue calendars, Luma, Meetup and public Google Calendars.
- **Platform detection:** given a URL, recognize Shopify, WooCommerce or The Events Calendar and use the cheapest structured endpoint instead of the page. This extends `find_source`, which already turns a site into a feed.
- **Agent-facing surfaces:** where a site publishes them, `/.well-known/ucp`, a site's own MCP server, `llms.txt` and `agents.md` come first in resolve. MCPortal calls them server-to-server like any provider. Today they matter for shops ([shops.md](shops.md)); events have no equivalent standard and no official MCP servers from Ticketmaster, Eventbrite or Luma.
- **Keyed provider clients:** Ticketmaster, SeatGeek, Etsy. Operator keys live server-side and are scrubbed from cache keys, provenance, errors and logs, as the contract requires.

All of them go through the existing safe-fetch boundary, send the identifiable user agent, and respect robots.txt for page readers.

**Other agents' tools don't replace this.** A store's MCP server, or a ticketing MCP, answers "what's true right now" for whichever agent asks. None of them remembers what you care about or notices change over weeks. That's MCPortal's half of the rally; those servers are good providers for it.

## Noticing change

- **Snapshots:** per watch, a bounded map of identity → fingerprint. Public responses are cached and shared across accounts; snapshots and matches are account-owned.
- **The first collection is a baseline, not news.** Adding a store with 400 products shows its latest few as "latest", not 400 "new" items. Same for an artist's existing tour.
- **Disappearing isn't cancelling.** A missing result or a failed fetch leaves the last snapshot, marked stale. Only an explicit provider status (cancelled, sold out) is a finding.
- **Each kind decides what's news.** A price going down is; a price going up isn't, unless the product is saved. A new date for a saved show is; a ticket-count change isn't.
- **Group, don't flood:** many findings from one watch in one collection become one card ("12 new in the Fall drop"), following the flood-control research in `research_notes/River and reblog design research/stream_ordering_and_flood_control.md`.

## Items and portals

`Item` gains optional variant fields, rendered by the room:

- `event`: `startsAt`, timezone, venue, city, status (`onsale`, `cancelled`, `postponed`, `rescheduled`). Dates are shown prominently and never invented.
- `offer`: price, currency, previous price (when on sale), availability, variant summary.
- `finding`: type, the fields that changed (old → new) and when it was noticed.

One new source kind, `watches`, with config `{ kind, watchIds? }`, rather than one source kind per domain. Its default title and view follow the kind: **Shows** sorts by date and drops past events; **Shop** sorts by when something was noticed and suits the `gallery` view; **Watching** lists product changes. Everything portals already have comes free: provenance, refresh, seen sets, highlights, saving, reblogging.

## Collecting: two stages

1. **On demand.** Collection runs when the room opens or a portal refreshes, within budgets and the freshness each kind declares (stores daily, artists every few hours). Scheduled agent tasks can trigger it, but coverage between checks is incomplete and the plans say so.
2. **The Release 3 worker.** Durable item history, collection while the room is closed, retries and deduplication, a host-independent inbox, pause and delete. Budgets are per provider, with a reserve kept for interactive use. Restart and room-closed acceptance tests belong here.

Cost grows with distinct subjects (artists, stores), not with users, because public responses are shared. That suits a one-person service.

## Handing back

- **What's new since the agent last asked:** `list_new_items` reports what the user hasn't *seen*. A scheduled task needs what it hasn't *reported*. Add a reported set (same shape as seen sets) and one optional argument, working name `sinceLastCheck`.
- **Reasons:** each finding carries its own ("price dropped from $240 to $168", "new show 12 miles away"). The agent judges; MCPortal only states facts.
- **Taste signals:** what the user saves or dismisses per watch feeds the `signals` that `list_new_items` already returns.
- **A documented recipe:** the prompt to paste into a host's scheduled tasks. MCPortal can't wake an agent ([mcp-2026-07-28.md](mcp-2026-07-28.md)); the host's scheduler can.

## Tools

One pair for every kind, each with a token ceiling and frozen eval cases ([tool-surface.md](tool-surface.md)):

- **`watch`:** `{ kind, query | url, scope?, select? }`. Without `select`, it previews candidates and writes nothing. With a `select` from that preview, it confirms. Like `find_source` → `add_portal`, in one tool.
- **`unwatch`:** remove or pause one watch by id.
- **Preferences** (coarse location, clothing sizes) go through `account_settings`.
- **Listing** comes through `open_room` and the portals, not a new tool.

New kinds extend the `kind` enum; they don't add tools.

## Rules for every kind

- **MCPortal never calls a model.** The agent understands; MCPortal remembers and notices.
- **No buying.** No carts, checkout or purchasing on anyone's behalf. Cards link to the source's own page.
- **No affiliate links,** and no tracking parameters added.
- **Honest coverage:** "shows Ticketmaster lists", never "all concerts"; "this store's public catalogue", never "every product".
- **Private by default:** the watch list, preferences and which subjects matched a user stay out of social payloads. Sharing a finding shares only its public content.
- **Users own it:** watches, preferences and snapshots are in exports, restored by import without provider calls, and removed with the account.
- **Provider terms first:** a free quota isn't permission for every use. Each provider's terms are reviewed before it's turned on.
- **Third-party text is untrusted,** fenced for the model like `read_article` content.

## Storage

The contract's artist-only `WatchStore` generalizes:

- **Watch:** `{ id, kind, displayName, identity: Record<string, string>, scope, addedAt, updatedAt, paused }`. Unique per account on kind + primary identity. A cap per account, configured, not tied to pricing yet.
- **Preferences:** coarse location (one record, as the contract specifies), and small per-kind preferences such as sizes.
- **Snapshots:** per watch, bounded, account-owned.

File and Postgres implementations pass the same contract tests, with the same linking, export and deletion rules.

## Phases

| Phase | What ships | Size |
|---|---|---|
| 0 | The engine: generic watch store, `watch`/`unwatch`, item variants, the diff, the `watches` source, on-demand collection. Ships with its first kind, never alone | medium |
| 1 | First kind: **stores** (Shopify) → Shop ([shops.md](shops.md) phase 1) | small to medium |
| 2 | Second kind: **artists** (Ticketmaster) → Shows ([events.md](events.md) phase 1), once the contract's open decisions are settled | medium |
| 3 | Handing back: reported set, `sinceLastCheck`, the scheduled-task recipe | small |
| 4 | Shared readers: page structured data and iCal → venue watches and product watches | medium |
| 5 | The Release 3 worker and inbox | large |
| 6 | More kinds and providers | medium each |

**Why stores first:** Shopify's storefront endpoints need no key, no location and no provider agreement. That proves the engine (resolve, confirm, baseline, diff, findings, grouping) on the simplest provider. Artists then add the hard parts on a proven base: keys, quotas, location and expiring dates.

## Open questions (with the default we'd take)

1. **Which kind proves the engine?** Default: stores, for the reasons above. The earlier watches plan assumed artists.
2. **One `watches` source kind, or one per domain?** Default: one, configured by kind. Fewer source kinds; default views per kind.
3. **Are product watches a kind or a filter on a store watch?** Default: a kind. "This jacket" doesn't need the whole store.
4. **Watch caps.** Default: a configured cap per account, decided with usage. No pricing decision here.
5. **Where does a finding go when nothing shows its portal?** Default: it waits in `list_new_items` and the Release 3 inbox. No portal is added without the user asking.
