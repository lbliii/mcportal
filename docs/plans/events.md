# Plan: events, starting with concerts near you

## Why

Your agent understands you but forgets between chats and can't keep watch. MCPortal remembers and persists but understands nothing. A watch splits the work: in conversation the agent learns you like an artist and adds them to your watches; MCPortal checks for weeks, which no chat can; when a show is announced near you it's waiting the next time the agent looks; the agent judges whether it's worth your evening. What you save or skip sharpens the next round. MCPortal still never calls a model. None of this is built yet.

This is the first event kind on [the rally engine](rally.md), which supplies the generic watch list, `watch`/`unwatch`, collection, the diff and handing back. [Shops](shops.md) is the other planned kind. The storage, fetching and data rules below are written for artists and generalize to every kind.

## What a watch is

A watch is something you follow that isn't a feed. MCPortal keeps checking it and shows new findings as items in a portal. Events have two kinds:

- **`artist`:** follow a performer anywhere near you, resolved to a Ticketmaster attraction id (and a MusicBrainz id where known).
- **`venue`:** follow a place, promoter or organizer, whoever plays, resolved to a calendar it publishes. This catches the small shows big ticketing APIs miss, and needs no location, since the venue is the location.

Both feed one **Shows** portal.

- **The watch list is yours,** per account, like clips: in `~/.mcportal` locally, in Postgres when hosted, included in exports, deleted with the account.
- **A list, not per-portal config,** because the same list will feed later kinds (a new album, a book).
- **Findings are items in a portal.** A new **Shows** source kind lists upcoming shows for your watched artists near you, and gets everything portals already have: provenance, refresh, seen marks, highlights and saving.

## How MCPortal learns your taste

1. **The agent asks,** or notices artists while you chat and offers to watch them. Each watch is confirmed by name and resolved to an id, so Phoenix the band isn't Phoenix the city.
2. **Paste or import** a list of names or a playlist link; the agent resolves each and shows what it matched.
3. **Connect a music service,** later and optional, as an onboarding shortcut and never a sign-in method. Apple Music's MusicKit can read library artists but needs an Apple Developer membership and a browser authorization step. Spotify's API offers top and followed artists, but new apps start in a development mode capped at a few users; check its terms first.

## Where events come from

Checked 2026-10-06 unless noted. Revalidate limits and terms before turning anything on.

| Source | Access | Role |
|---|---|---|
| **Ticketmaster Discovery** | Free key; details below | **First artist provider.** Broad coverage, searchable by attraction and location |
| **SeatGeek** | Free `client_id`; events by performer and by latitude, longitude and range; about 1,000 requests an hour reported | **Second artist provider,** for coverage Ticketmaster misses. Read its terms first |
| **MusicBrainz** | No key; details below | Optional identity enrichment. Not a Ticketmaster id resolver |
| **The Events Calendar (WordPress)** | No key: iCal at `/events/?ical=1`, JSON at `/wp-json/tribe/events/v1/events` | **First venue provider.** Very common among small venues |
| **iCal generally** | No key: Luma calendars, Meetup groups, public Google Calendars | Venue provider through the shared iCal reader. Suits talks and meetups as much as music |
| **Event data in pages** | schema.org `Event` blocks on venue sites, Eventbrite, Dice and Ticketmaster pages | Venue provider through the shared structured-data reader; the fallback for venues without a calendar |
| **Eventbrite** | Search across Eventbrite was removed in 2020; the API lists events only by a known organization or venue id | **A venue provider, not a discovery source:** follow one organizer, never "find events near me" |
| **Bandsintown** | An app id issued per artist; other uses need Bandsintown's written consent | **Out,** unless Bandsintown agrees to this use |
| **Songkick** | Not accepting new API partners | **Out** |
| **AXS, Dice** | No public API | Only through event data in their pages |

None of these publishes an official MCP server or an agent-commerce standard like the stores' UCP; the MCP servers that exist for Ticketmaster, Eventbrite and Luma are community wrappers of the same APIs. So events need no agent-facing rung in their resolve ladder yet.

Event data is public, so fetches are cached per artist and area, or per calendar, and shared across accounts. Cost grows with distinct artists and venues, not with users.

### Provider limits

Checked against the providers' documentation on 2026-10-03. Revalidate before building.

- **Ticketmaster Discovery** (`https://app.ticketmaster.com/discovery/v2/`) authenticates with an `apikey` query parameter and documents 5,000 calls a day and 5 requests a second by default. Events filter by `attractionId`, `countryCode`, `city`, `radius`, `unit` and `geoPoint` (a geohash; `latlong` is deprecated). Deep paging requires `size * page < 1000`, and date filters can omit TBA events. Events carry an id, name, public URL, venues, attractions, start date or instant, timezone, uncertainty flags and a status (`onsale`, `offsale`, `canceled`, `postponed`, `rescheduled`); treat every field as optional. Its [terms](https://developer.ticketmaster.com/support/terms-of-use/) limit caching to reasonable periods, require removal on request, reserve the right to block heavy calls not made on a user's behalf, and restrict revenue from the data. A free quota isn't permission for background polling: settle retention, export of saved event data and background use before rollout.
- **MusicBrainz** reads need no key and are free for non-commercial use. Requests need an identifiable User-Agent with contact details; the average limit is one request a second per source IP, and throttled requests get 503. Artist search returns candidates, never confirmed identity. There is no verified crosswalk from MusicBrainz ids to Ticketmaster attractions.

## Location

- **Coarse only:** a city, a country, an optional region to tell same-named cities apart, and a radius. Never device coordinates, a home address or travel history.
- Set in conversation through `account_settings`, kept in its own private record, never public, never in a shared payload.
- An artist watch can exist without a location. The Shows portal then says it needs a city and fetches nothing for it. Venue watches never need one.

**Open:** choose a coarse city gazetteer, confirm the city among ambiguous candidates, and derive a city-centre geohash if radius search is promised. Don't filter by exact city while claiming a radius. Radius default and range, units, and any disclosure for external geocoding need deciding.

## Events expire

Concerts are the first items that go stale on a date.

- **An event item:** venue, city, public ticket link with no affiliate parameters, and the date shown prominently. Never invent midnight or a timezone for an incomplete date.
- **Identity** is `ticketmaster:<event-id>`, independent of title and date, so a rescheduled show keeps its saved and seen state. The same event from two watched artists appears once.
- **Sorted by date,** soonest first. TBA events go in a separate undated section.
- **Gone after the date.** Expire after a reliable end instant, or else after the last known local date in the venue's timezone. If no safe boundary exists, mark the date incomplete rather than use the server's timezone. Saved past events stay saved, marked past.
- **Changes are news.** Cancellation is an explicit status, not a missing search result, and off-sale is different again. A changed date, venue or status on a saved show appears as a change on the next refresh, compared against a small account-owned snapshot. A failed fetch leaves the saved snapshot with a stale notice; it never manufactures a cancellation.

## What counts as news

| Change | Artist watch | Venue watch | On a saved show |
|---|---|---|---|
| New show | Yes, if within your radius | Yes | n/a |
| Date or time change | No | No | Yes |
| Venue change | No | No | Yes |
| Cancelled or postponed | No (drops out) | No (drops out) | Yes |
| Goes on sale | Later, if asked for | Later | Yes |

The same show from Ticketmaster and a venue calendar is matched on venue, date and headliner, and appears once with both links.

## Tools

As few new model tools as possible, each with a token ceiling and eval cases:

- **`watch`** previews bounded candidates without writing. You choose one; confirming refers to a short-lived, account-bound selection that is rechecked on commit. An expired or foreign selection fails without writing. No Ticketmaster match means an explanation, not a guessed watch.
- **`unwatch`** removes one watch and leaves separately saved shows alone. Pausing stops requests without forgetting the watch.
- **Listing** comes through `open_room` and the Shows portal, including paused watches and the missing-location note.

## Storage, linking and data rights

| Surface | Contract |
|---|---|
| Records | A watch is `{id, kind: 'artist', displayName, ticketmasterAttractionId, musicBrainzId?, addedAt, updatedAt, paused}`, deduplicated by provider id within an account. Location is a separate record. |
| Stores | `WatchStore` (list, get, addConfirmed, remove, setPaused) and `LocationStore` (get, set, clear), with export, import and `deleteAll`. One contract test suite runs against both file and Postgres. |
| File | Per-account hashed filenames under the data directory, a keyed mutex and atomic replacement. Never inside portal config. |
| Postgres | Account-scoped tables, uniqueness on account, kind and provider id, quotas enforced in the transaction. |
| Linked local | Remote stores implement the same methods. Writes fail clearly offline; no separate local list is created. |
| Provider calls | Run where the operator's key lives. A linked local install calls a budgeted hosted operation; the key never reaches the client. A standalone local install supplies its own key. |
| Export and import | Watches, ids, pause state and coarse location. Import makes no provider requests and deduplicates; replacing location needs an explicit choice. No keys or preview tokens. |
| Deletion | Watches, location, comparison snapshots, and later any reported marks or inbox entries. Shared caches hold no account link. A provider's removal request also purges shared copies. |

Private watches, location, and which artists matched your interests never enter social payloads. Sharing a saved show shares only public event content.

## Keys, fetching and budgets

- The Ticketmaster key is server-local configuration, supplied outside chat. No setting for it exists yet. A missing key shows an unavailable source, not an empty one.
- Fetch through the existing safe-fetch boundary with fixed provider origins, byte and time limits, and no redirects on credentialed calls. Scrub the key from cache keys, provenance, errors, logs, results and exports; fetch responses can carry their request URL. Build pagination requests ourselves rather than following upstream links.
- Provider budgets are application-wide, with capped pages and retries, limited concurrency and backoff. Reserve quota for interactive use before any background worker. Replicas share accounting or split the budget. Show partial coverage, rate limits and failed refreshes.

## The return shot: scheduled agent tasks

MCPortal can't wake an agent; hosts with scheduled tasks can. The reported set, `sinceLastCheck` and the scheduled-task recipe are shared by every kind, so they're in [the rally engine](rally.md#handing-back).

## Sequence

1. **Artist watches and an on-demand Shows portal.** Confirmed watches, coarse location, event items that expire, fetched on explicit refresh. File, Postgres, linked, export and deletion parity in the same step. Describe coverage as "Ticketmaster events retrieved", never "all concerts" and never continuous monitoring.
2. **Durable collection.** A scheduled worker with item history, retries, deduplication, pause and delete, and an inbox that works on every host. Collection continues while the room is closed; restarts don't duplicate items; missed fetches are visible.
3. **Reported marks and digests** over that history, then the scheduled-task recipe and optional host notification adapters. A recipe may come earlier only if it says it runs on-demand checks with gaps between them.
4. **Venue watches:** The Events Calendar, then any iCal, then event data in pages; Eventbrite organizers. Then SeatGeek as a second artist provider, deduplicated with Ticketmaster.
5. **More kinds** on the rally engine: new releases, books, talks.
6. **Music services:** Apple Music, then Spotify if its terms allow.

Before step 1: settle the location resolver and defaults, provider retention and use rights, and where the key runs.

## Acceptance

All with fake clocks and canned HTTP responses; no live-service claims.

- Phoenix candidates stay a preview until one is confirmed; expired or foreign selections fail; a MusicBrainz id never overrides the Ticketmaster attraction; encoded names can't inject query syntax.
- Missing key, missing location, ambiguous city and an exhausted budget each explain themselves. Requests contain only the confirmed coarse area and radius.
- One event from two artists appears once; dates sort correctly across timezones; local-date, daylight-saving, multi-day, TBA and missing-timezone cases keep their uncertainty.
- Cancellation, off-sale, date or venue change, and disappearance behave differently. Saved events keep identity through change and expiry.
- File and Postgres contract tests cover two-account isolation, concurrent adds, quotas, pause and remove, atomic failed imports and repeated deletion. Linked tests cover account binding and offline rejection.
- Export round-trips; deletion removes every private reference; shares omit location and interests; a secret canary appears in no output, error, log or cache key.
- Quota tests cover page caps, shared budgets, coalesced requests, partial responses and bounded retries.

## Open questions

1. **Travel:** "I'll be in Chicago in March." Not in step 1; perhaps a second, dated location later.
2. **Sharing a show** with friends who might go: works like any saved item.
