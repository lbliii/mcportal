# Plan: events, starting with concerts near you

**Status:** proposed 2026-10-02 as the watches plan; reworked 2026-10-06 on top of [the rally engine](rally.md). Nothing built. The engine supplies the watch list, `watch`/`unwatch`, collection, the diff and handing back; this plan covers only what's specific to events. The [watch implementation contract](../watch-implementation-contract.md) holds the verified Ticketmaster details and the artist storage, location and expiry rules.

## The rally, for concerts

1. **Agent → MCPortal.** In conversation the agent learns you like an artist and adds them to your watches.
2. **MCPortal holds it.** It keeps checking for weeks, which no chat can.
3. **MCPortal → agent.** A show is announced near you; it's waiting the next time the agent asks.
4. **Agent → you.** The agent judges it: the date, whether it clashes with something you mentioned, whether to save it.
5. **A better next rally.** What you save or skip sharpens what's worth watching.

## Two kinds

- **`artist`:** follow a performer anywhere near you. Resolved to a Ticketmaster attraction id (and a MusicBrainz id where known), confirmed by name, so "Phoenix" the band isn't confused with the city.
- **`venue`:** follow a place, promoter or organizer, whoever plays. Resolved to a calendar the venue publishes. This catches the small shows big ticketing APIs miss, and needs no location, since the venue is the location.

Both feed one **Shows** portal: upcoming shows, soonest first.

## How MCPortal learns your taste

From lightest to heaviest. Phase 1 is the first rung only.

1. **The agent asks**, or notices artists while you chat and offers to watch them.
2. **Paste or import:** a list of names or a playlist link. The agent resolves each one and shows what it matched.
3. **Connect a music service** (later, optional, an onboarding shortcut and never a sign-in method):
   - **Apple Music:** MusicKit can read library artists. Needs the Apple Developer Program ($99/year) and a MusicKit JS authorization step in the browser.
   - **Spotify:** the API offers top and followed artists, but since 2025 new apps start in a development mode capped at a few users. Check the current terms before relying on it.

For venues, the agent can suggest them from your city ("the venues where your artists usually play") and confirm each one.

## Where events come from

Checked 2026-10-06 unless noted. Revalidate limits and terms before turning anything on.

| Provider | Access | Verdict |
|---|---|---|
| **Ticketmaster Discovery** | Free key; 5,000 calls/day, 5 requests/second; search by attraction plus city and radius | **First artist provider.** Details and terms caveats in the contract |
| **SeatGeek** | Free `client_id`; events by performer and by latitude, longitude and range; about 1,000 requests/hour reported | **Second artist provider**, for coverage Ticketmaster misses. Read its terms first |
| **The Events Calendar (WordPress)** | No key: iCal at `/events/?ical=1` and JSON at `/wp-json/tribe/events/v1/events` | **First venue provider.** Very common among small venues |
| **iCal generally** | No key: Luma calendars, Meetup groups, public Google Calendars | Venue provider via the shared iCal reader. Suits talks and meetups as much as music |
| **Event data in pages** | schema.org `Event` blocks on venue sites, Eventbrite, Dice and Ticketmaster pages | Venue provider via the shared structured-data reader. The fallback for venues without a calendar |
| **Eventbrite** | Search across Eventbrite was removed in 2020; the API lists events only by a known organization or venue id | **A venue provider, not a discovery source.** Follow one organizer; never "find events near me" |
| **Bandsintown** | An app id issued per artist, with written consent required for other uses | **Leave out** unless Bandsintown agrees to this use |
| **Songkick** | Not accepting new API partners | **Leave out** |
| **AXS, Dice** | No public API | Only through event data in their pages |

Public event data is cached per artist and area, or per calendar, and shared across accounts.

## Location

- **Coarse only:** a city, a country and a radius, set in conversation or in account settings. Never precise location, never a home address.
- **Locally**, it stays in `~/.mcportal` with the rest of the room.
- It isn't public, and it isn't shared through social features.
- The resolver, radius defaults and units are open decisions in the contract.

Artist watches without a location are allowed: the Shows portal says it needs a city. Venue watches never need one.

## Events expire

Concerts are the first items that go stale on a date:

- **The `event` item variant:** `startsAt`, timezone, venue, city, status and a ticket link, with the date shown prominently. Never invent a time or timezone for a date-only event.
- **Sorted by date**, soonest first, not by when the item was found. TBA shows sit in their own undated section.
- **Gone after the date:** past events drop out of the portal. Saved ones stay saved, marked as past.
- **Changes are news:** a new date, a cancellation, or a venue change on a show you saved. Cancellation is an explicit provider status; a show missing from a result is not a cancellation.
- **One show, many artists:** a bill with two watched artists appears once.

The exact expiry rule (end time, date-only, multi-day) is in the contract and needs product review before coding.

## What counts as news (the kind rules)

| Change | Artist watch | Venue watch | On a saved show |
|---|---|---|---|
| New show | Yes, if within your radius | Yes | n/a |
| Date or time change | No | No | Yes |
| Venue change | No | No | Yes |
| Cancelled or postponed | No (drops out) | No (drops out) | Yes |
| Goes on sale | Later, if asked for | Later | Yes |

## Phases

These follow the engine's phases in [rally.md](rally.md).

| Phase | What ships | Size |
|---|---|---|
| 1 | Artist watches from Ticketmaster, coarse location, the Shows portal, expiring event items. The agent asks | medium |
| 2 | Venue watches: The Events Calendar, then any iCal, then event data in pages; Eventbrite organizers | small to medium |
| 3 | SeatGeek as a second artist provider, deduplicated with Ticketmaster | small |
| 4 | Paste and import lists; Apple Music, then Spotify if its terms allow | medium |

Onboarding can borrow phase 1 early: the music starter pack could end with "tell me a few artists you like".

## Open questions (with the default we'd take)

1. **Watch without location?** Default: yes. The Shows portal says it needs a city.
2. **Travel:** "I'll be in Chicago in March." Default: not in phase 1; a second, dated location later.
3. **Shared Shows:** reblogging a show to friends who might go. Default: works like any saved item.
4. **Ticket links:** use the source's own link, with no affiliate parameters. Default: yes.
5. **Same show from two providers:** Ticketmaster and a venue calendar both list it. Default: match on venue + date + headliner; keep the provider's ticket link, and the venue's own page as a second link.
