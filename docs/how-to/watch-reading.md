# Watch reading and events

Use **Changes** for page edits and repository releases, and **Upcoming** for dated public-calendar and artist events. Reading watches are currently on `main` under [Unreleased](../../CHANGELOG.md#unreleased); hosted and plugin installs need a release and deployment that includes them.

## Watch a page or repository

Ask your agent for the page or repo you want to follow:

```text
watch this documentation page for changes: https://example.com/docs/migrations
```

```text
watch releases from astral-sh/uv
```

Your agent uses `watch_reading` with kind `page` or `releases`. The first successful check establishes a baseline. Open **Changes** to see later findings, their observation dates, bounded text differences and any availability problems. You can ask your agent to open a finding and explain it from its evidence.

A failed request keeps the last successful baseline. Acknowledging a finding changes its unread state; it does not change the source or mark an article read.

Page checks cover the first 24,000 characters of readable text. Release checks cover the latest 30 names, versions and dates; they do not detect edits to release notes. Coverage messages show these bounds.

## Follow a public calendar

Give your agent a public iCalendar URL and, for floating times, a timezone:

```text
follow this public calendar for Upcoming: https://example.com/events.ics
use America/New_York for times without a timezone
```

Upcoming sorts events by date. UTC, named timezones and date-only events are supported. Recurring events and ambiguous daylight-saving times are visibly omitted. Coverage messages explain what was left out.

Save an event to keep its link and dated metadata. Reschedules and cancellation updates from the watched source update saved event metadata; past events stay saved. An event disappearing from a provider's results does not prove it was cancelled.

## Follow an artist

Ask for the artist and city:

```text
find this artist's shows in New York, US
```

The agent first looks up artist candidates. Choose the correct identity before asking it to follow that artist in the city and country you named. MCPortal uses a verified Ticketmaster artist ID, rather than guessing from a name. No precise location is needed.

Artist lookup requires the operator's `TICKETMASTER_API_KEY`. If it is unavailable, the lookup says so; public-calendar watches still work. Self-hosters can set the key as described in [Configuration](../reference/configuration.md#storage-and-sources).

## Check, pause or remove a watch

Ask your agent to list watches, check one now, pause or resume it, remove it, or acknowledge findings. For example:

```text
list my reading watches and pause the uv releases watch
```

Reading watches normally check every six hours while MCPortal is running. Missed checks resume after startup; retries and overdue status are visible. Local installs check while their server process is running. Signed-in local installs use the hosted worker. No model runs in the worker, and these checks do not send notifications or a digest.

Imported reading watches start paused. Review them and explicitly resume the ones you want. Watches and findings remain private and are included in full export and account deletion.

## Store follows use Shop

To follow a Shopify catalogue, use [Following stores](follow-stores.md). Shop uses `watch` and `unwatch` and checks on demand when opened or refreshed. Reading watches use `watch_reading` and a background worker.

See [Reading experiences](../explanation/reading-experiences.md#state-and-limits) for watch and retention limits, and the [tool reference](../reference/tools.md#reading-collections-and-watches) for exact arguments.
