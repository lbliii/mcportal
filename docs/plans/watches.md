# Plan: watches, starting with concerts near you

**Status:** proposed 2026-10-02. Nothing built. Comes after the agreed order: device linking ([local-hosted-hybrid.md](local-hosted-hybrid.md)), onboarding, then reblogging. This is the concrete form of README's "standing intents" and the product map's **Intelligence** row.

## The principle: a rally

MCPortal and the agent each do what the other can't, and each pass leaves the next one better for the user:

| | The agent | MCPortal |
|---|---|---|
| Strong at | Understanding, conversation, judgment, web search | Memory, persistence, watching over time, a place to look |
| Weak at | Forgets between chats, has no clock, can't keep watch | Understands nothing, can't talk or reason |

Concerts as the example:

1. **Agent → MCPortal.** In conversation the agent learns you like an artist and adds them to your watches.
2. **MCPortal holds it.** It keeps checking for weeks, which no chat can.
3. **MCPortal → agent.** A show is announced near you; it's waiting the next time the agent asks.
4. **Agent → you.** The agent judges it: the date, whether it clashes with something you mentioned, whether to save it.
5. **A better next rally.** What you save or skip sharpens what's worth watching.

The test for any feature built on this: *what does the agent hand MCPortal, and what does MCPortal hand back?* If it only goes one way, it's a plain app or a plain chat. This extends the [attention plan](attention.md)'s first principle: the agent thinks, and MCPortal supplies the material and the display. MCPortal still never calls a model.

## What a watch is

A **watch** is something the user follows that isn't a feed: an artist, and later an author, a speaker, or a repository's releases. MCPortal keeps checking it and surfaces new findings as items in a portal.

- **The watch list is the user's data**, per account, like clips. It's in exports and deleted with the account. Locally it lives in `~/.mcportal`; hosted, in Postgres (one schema version).
- **A watch** has a kind (`artist` first), a display name, the external ids it resolved to (a Ticketmaster attraction id, and a MusicBrainz id where known) and when it was added.
- **Findings are items in a portal.** A **Shows** portal (a new source kind) lists upcoming shows for your watched artists near you. It gets everything portals already have: provenance, refresh, seen sets, highlights and saving.
- **Why a list rather than per-portal config:** the same list will feed later kinds (a new album, a book), so it belongs to the person, not to one portal.

## How MCPortal learns your taste

From lightest to heaviest. Phase 1 is the first rung only.

1. **The agent asks**, or notices artists while you chat and offers to watch them. Each watch is confirmed by name and resolved to an id, so "Phoenix" the band isn't confused with the city.
2. **Paste or import:** a list of names or a playlist link. The agent resolves each one and shows what it matched.
3. **Connect a music service** (later, optional, an onboarding shortcut and never a sign-in method):
   - **Apple Music:** MusicKit can read library artists. Needs the Apple Developer Program ($99/year) and a MusicKit JS authorization step in the browser.
   - **Spotify:** the API offers top and followed artists, but since 2025 new apps start in a development mode capped at a few users, and the extended quota targets established businesses. Check the current terms before relying on it.

## Where events come from

- **Ticketmaster Discovery API:** free with a key, broad coverage, searchable by attraction and location. The first adapter. Check current quotas before building.
- **Venue calendars (iCal or RSS):** many local venues publish them. They catch small shows the big APIs miss, and they're MCPortal's home turf. A dependency-free iCal reader, through the same safe-fetch boundary as feeds. Phase 3.
- **Bandsintown:** strong per-artist data; read its terms on attribution and allowed uses before adding it.
- **Songkick:** not accepting new API partners; leave it out.

Event data is public, so fetches are cached per artist and area and shared across accounts. The cost grows with distinct artists, not with users, which suits a one-person service.

## Location

- **Coarse only:** a city, a country and a radius, set in conversation or in account settings. Never precise location, never a home address.
- **Locally**, it stays in `~/.mcportal` with the rest of the room.
- It isn't public, and it isn't shared through social features.

## Events expire

Concerts are the first items that go stale on a date. That's new for portals:

- **An event item variant:** `startsAt`, venue, city and a ticket link, with the date shown prominently.
- **Sorted by date**, soonest first, not by when the item was found.
- **Gone after the date:** past events drop out of the portal. Saved ones stay saved, marked as past.
- **Changes are news:** a new date, a cancellation, or a venue change on a show you saved.

## The return shot: scheduled agent tasks

MCPortal can't wake an agent, and the [2026-07-28 MCP spec](mcp-2026-07-28.md) doesn't change that. Hosts with scheduled tasks can: "every morning, check my portal and tell me about anything good." The agent serves again on a schedule; MCPortal does the cheap, constant watching in between.

One gap to fix first: `list_new_items` reports what the user hasn't **seen**, and seen sets only move when the user views the room. A daily task would repeat the same items each morning.

- **A "reported" set alongside seen sets:** the same shape (hashed item ids per portal, capped), moved only when the agent asks for what's new since its last check.
- **One optional argument on `list_new_items`** (working name `sinceLastCheck`) rather than a new tool, per [tool-surface.md](tool-surface.md).
- **A documented recipe:** the prompt to paste into a host's scheduled tasks. This also settles open question 3 in [attention.md](attention.md).

## Tools

As few new model tools as possible, each with a token ceiling and frozen eval cases:

- **`watch`**: add, by name, with the matched candidates previewed first (like `find_source` → `add_portal`).
- **`unwatch`**: remove one.
- **Listing** comes through `open_room` and the Shows portal, not a new tool.

Location is set through `account_settings`.

## Phases

| Phase | What ships | Size |
|---|---|---|
| 1 | Watch list (artists), Shows portal from Ticketmaster, the agent asks, coarse location, event items that expire | medium |
| 2 | `sinceLastCheck` and the reported set; the scheduled-task recipe | small |
| 3 | Venue calendars (iCal) | small to medium |
| 4 | More kinds: new releases, books, talks | medium each |
| 5 | Apple Music, then Spotify if its terms allow | medium |

Onboarding can borrow phase 1 early: the music starter pack could end with "tell me a few artists you like".

## Open questions (with the default we'd take)

1. **Watch without location?** Default: yes. The Shows portal says it needs a city, and the watches still feed other kinds later.
2. **Travel:** "I'll be in Chicago in March." Default: not in phase 1; a second, dated location later.
3. **Shared Shows:** reblogging a show to friends who might go. Default: works like any saved item once reblogging ships.
4. **Ticket links:** use the source's own link, with no affiliate parameters. Default: yes, no affiliate links.
