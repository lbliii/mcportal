# Watch implementation contract

Status: proposed prerequisite contract, assessed **2026-10-03** against primary provider documentation and the current repository. No watch implementation or authenticated provider call was made. Method and record names below are proposed interfaces, not shipped APIs.

## One sequence for both plans

[Watches](plans/watches.md) supplies the artist/Shows example; [delivery roadmap Release 3](plans/delivery-roadmap.md) supplies the durable collection and inbox promise. Their phases currently imply different infrastructure: an on-demand Shows portal does not keep checking between chats, and a reported set alone does not collect anything.

1. Resolve the operator and product decisions below, retaining the watches plan's dependency order: linking, onboarding, reblogging.
2. Ship **phase 1: confirmed artist watches and an on-demand Shows source**. Persist watches and coarse location; fetch on explicit room refresh/tool calls; render event dates, save, expire, and display changes discovered during those refreshes. Include file, Postgres, linked-account, export and deletion parity in this milestone. Describe coverage as retrieved Ticketmaster events, never all concerts or continuous monitoring.
3. Build Release 3's durable collection worker, item history, retries, deduplication, pause/delete, and host-independent inbox. Budget background collection separately and settle provider permission first. Restart and room-closed acceptance criteria belong here.
4. Add reported checkpoints and finite digests over that history, then the scheduled-agent recipe and optional host notification adapters. A recipe that invokes phase 1 may be described earlier only as scheduled **on-demand checks**, with the host doing the scheduling and incomplete between-check coverage disclosed.
5. Add venue calendars and other watch kinds after those foundations. Music services remain optional later integrations.

This reconciles the ordering without claiming the roadmap's proactive release is complete when phase 1 ships.

## Verified provider boundary

Ticketmaster Discovery uses `https://app.ticketmaster.com/discovery/v2/`, authenticates via query `apikey`, and documents default limits of **5,000 calls/day and 5 requests/second**. Attraction search/detail resolves its IDs; events accept `attractionId`, `countryCode`, `city`, `radius`, `unit` (`miles`/`km`), and `geoPoint` (geohash); `latlong` is deprecated. Deep paging requires `size * page < 1000`. Date filtering can omit TBA/TBD events by default. Events expose `id`, `name`, public `url`, venues/attractions, `dates.start` local date/time or instant, timezone and uncertainty flags, optional end data, and status `onsale`, `offsale`, `canceled`, `postponed`, `rescheduled`. These fields are optional inputs to a defensive normalizer. Pagination and provider coverage bound results. [Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).

An operator obtains a Discovery key through its developer account; ticket purchasing is a separate capability and outside this scope. [Getting started](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/).

Ticketmaster's general terms constrain caching to reasonable service periods, require owner-requested removal, reserve blocking for heavy calls outside direct user actions, and restrict deriving revenue subject to their stated exceptions. Operator review must settle retention, exports of saved provider content, commercial use and background polling before rollout. A free quota is not permission for every proposed use. [General terms](https://developer.ticketmaster.com/support/terms-of-use/).

MusicBrainz public reads currently need no API key and support JSON; non-commercial access is free, while commercial use requires its commercial arrangements. It is optional identity enrichment, not a Ticketmaster ID resolver. [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API). Artist search supports names/aliases, MBID, type, country, area and disambiguation; present these as candidate evidence. Escape the search syntax and encode parameters; neither score nor a similar name confirms identity. No automatic MBID-to-attraction crosswalk was verified. [Artist search](https://musicbrainz.org/doc/MusicBrainz_API/Search).

MusicBrainz requires an identifiable User-Agent with maintainer contact information. Its rate policy considers application, source IP and global load, documents average **one request/second per source IP** absent another agreement, and rejects throttled requests with **503**. Coordinate replicas sharing egress; handle 503 as well as other transient failures. [Rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).

These primary pages were verified on the assessment date. Revalidate limits and terms before activation. No account-specific allowance, response-header reset unit, SLA, event completeness or commercial entitlement was verified.

## Phase 1 behavior and private records

The minimum watch record is `{id, kind:'artist', displayName, ticketmasterAttractionId, musicBrainzId?, addedAt, updatedAt, paused}`. Scope records to the authenticated account, deduplicate by provider artist ID within that account, and use stable internal IDs. A name alone is insufficient to create an active Shows watch.

`watch` first previews bounded candidates without writing. The user chooses the intended artist; confirmation references a short-lived account-bound preview selection, revalidated on commit. Show resolved name and useful disambiguation before confirmation. Expired or foreign selections fail without writes. MusicBrainz enrichment is optional and separately confirmed; absent Ticketmaster matches produce an explanation, not an inferred active watch. `unwatch` removes one confirmed watch. Listing appears in `open_room`/Shows, including paused watches and the missing-location explanation; avoid another public listing tool.

Keep location in a separate private record: confirmed city, country, optional region for disambiguation, radius, unit and a coarse place reference. `account_settings` sets/clears it. Never collect device coordinates, home addresses or travel history. Permit a watch without location as the existing plan proposes, but perform no nearby event fetch until location is complete.

**Unresolved location decision:** choose an approved coarse city gazetteer/resolver and confirm the city among ambiguous candidates. Derive a city-centre geohash from that reference if radius search is promised; do not substitute exact-city filtering while claiming a radius was applied. Radius default/range, units, city reference precision and any external geocoding disclosure need explicit product agreement. No new default is selected here.

The Shows view merges event identity across watched artists, sorts dated upcoming events soonest first, and shows venue/city, public ticket link and uncertainty. Use a stable `ticketmaster:<event-id>` identity independent of title/date, so a reschedule preserves saving and seen state. Proposed event metadata: provider ID, matched artist IDs, venue reference, local date/time and timezone when known, optional start/end instant, provider status and normalized revision fingerprint. Retain source attribution; add no affiliate parameters. Never fabricate midnight or timezone for incomplete dates.

Proposed expiry rule: use a reliable end instant when available, otherwise expire after the final known local event date in a valid event/venue timezone. Date-only and multi-day fixtures must establish the exact boundary. If a safe boundary cannot be computed, label the date incomplete rather than applying the server's timezone. TBA/TBD events belong in a separate undated section when requested; they cannot be ranked as dated upcoming concerts. Product review must confirm this expiry rule before implementation.

Cancellation is an explicit provider status, not a missing search result; off-sale is distinct. Default upcoming results exclude canceled events, while saved references remain visibly canceled. Date, venue or status differences on a saved show appear as changes when explicitly refreshed, comparing a bounded account-owned previous snapshot with the new normalized fingerprint. A failed fetch or disappearance leaves the saved snapshot with an unavailable/stale explanation. Saved past events remain saved and marked past, subject to approved provider-content retention. Phase 1 creates no autonomous notifications or durable inbox.

Unwatching stops subsequent artist requests and leaves separately saved items intact. Pausing suppresses requests without discarding the watch. Changing/clearing location invalidates account-specific Shows views; it does not silently rewrite watches or saved events. Private watches, location and which artists matched a user's interests never enter social payloads. Sharing a saved show includes approved public event content only.

## Storage, linking, export and deletion contracts

| Surface | Required contract |
|---|---|
| Domain | `WatchStore.list/get/addConfirmed/remove/setPaused(userId, ...)`; `LocationStore.get/set/clear(userId, ...)`; export/import and `deleteAll(userId)` for both. Reads return copies. Missing IDs and repeated remove/pause have documented idempotent behavior. Add returns the existing watch for the same artist ID. |
| File | Separate per-account hashed filenames under the local data directory; keyed mutex and atomic replacement. Never put watch lists into portal config. Serialize concurrent add/remove; validation and count/byte limits precede replacement. |
| Postgres | Account-scoped tables and indexes, uniqueness on account/kind/provider ID, transactional quota enforcement and equivalent ordering/validation. Coordinate the next schema version during integration rather than reserving a number here. Contract tests run unchanged against file and PG. |
| State API | Proposed `watches.list/get/addConfirmed/remove/setPaused`, `watchLocation.get/set/clear`, with strict schemas and access/cost declarations. Bind account from auth context, never a request-supplied account ID. Preview is a budgeted fetch operation, not a zero-cost storage read. |
| Linked local | Remote stores implement the same domain methods and reject another account. Writes fail clearly offline; no independent local watch list is created. Bulk import/deletion use the hosted account path, matching existing remote-store conventions. |
| Provider execution | Hosted-linked Shows and preview run where the operator key lives through an authenticated, budgeted server operation; do not send the key to a local client. A `shows.read`/preview gateway is proposed wiring requiring separate approval of its schema and budget, not an existing method. |
| Export/import | Include watches, confirmed IDs, pause state and coarse location in the owner's export. Validate IDs, dates, schema, duplicates and quotas before mutation; import makes no provider requests. Additive watch restore deduplicates; location replacement requires an explicit restore choice. Export no API keys or preview tokens. Provider snapshot export depends on settled retention/use rights. |
| Account deletion | Delete watch/location records, account-owned event comparison snapshots and eventual reported/history/inbox references; revoke linked access through the existing account flow. Shared public caches contain no account relationship and expire under their budget/retention policy. Provider-requested removal also purges relevant shared content. |

Storage limits, fetch windows/page caps, candidate limits and retention durations must be configured consistently and agreed before coding; this document does not invent provider allowances or user entitlements.

## Operator and fetch prerequisites

Supply the Ticketmaster key outside chat through server-local secret configuration. `TICKETMASTER_API_KEY` would be a proposed environment name, not a supported setting today. Decide whether standalone local installs use a locally supplied key or explicitly link to a hosted service; neither mode can quietly borrow a hosted secret. MusicBrainz can be omitted from the first adapter if its use arrangements remain unresolved. Neither provider's pricing determines MCPortal billing: no Patron-only feature or charge is selected here.

Use the existing safe-fetch boundary with fixed provider origins, byte/time limits and redirects disabled for credential-bearing calls. Query credentials require explicit scrubbing: current fetch responses can retain their request URL. Keep keys out of cache keys, provenance, raw errors, logs, app/model results and exported records. Construct validated pagination requests instead of following arbitrary upstream links. Third-party names/text remain untrusted; validate public outbound links separately.

Shared public response caching may deduplicate the same canonical artist/coarse-area/radius/time-window query. Account views and interest matches stay private; return no shared-cache activity metadata. All entries remain under the existing byte/entry budget and provider retention constraints. A missing key must produce a clear unavailable source, not an empty success.

Provide application-wide provider budgets with bounded pages/retries, concurrency limits and backoff. Requests per cycle include artist-area pages, candidate resolutions and saved-event rechecks; shared caching reduces but does not eliminate those costs. Reserve quota for interactive use before any worker. Multiple replicas must share accounting or have allocated sub-budgets. Surface partial coverage, rate limits and failed refreshes. Verify the installed key's allowance operationally; do not infer reset units from example headers.

## Isolated implementation ownership and fixture acceptance

| Lane | Owned work | Integration boundary |
|---|---|---|
| Domain/storage | New watch/location interfaces, file and PG implementations, store contract fixtures | Parent coordinates schema, account deletion, portability and remote-store/API registration. |
| Providers | Ticketmaster normalizer/fetcher and optional MusicBrainz candidate resolver; sanitized, bounded fixture fetches | No UI/storage writes; domain IDs and event result shape agreed first. |
| Tools/presentation | Confirmation flow, settings, Shows rendering, saved-event status and change display | Parent coordinates shared `SourceKind`, `Item`, `ToolResults`, source dispatch and generated manifests. |
| Later infrastructure | Durable collection/history, inbox/reported checkpoints, digests and optional adapters | Separate Release 3 design and provider/operator approval; not part of phase 1. |

Concrete acceptance uses fake clocks and canned HTTP responses, with no live-service success claim:

- Phoenix candidates remain a preview until the chosen artist is confirmed; expired/foreign selection fails; optional MBID never overrides attraction identity; encoded names cannot inject query syntax.
- Missing key/location, ambiguous city, unsupported area and budget exhaustion explain the problem. Recorded requests contain the confirmed coarse area and radius; no precise-device location appears.
- Same event from two artists appears once; dates sort correctly across timezones; local-date, DST, multi-day, TBA/TBD and missing-timezone fixtures preserve uncertainty and agreed expiry.
- Cancellation, off-sale, date/venue changes and provider disappearance behave differently. Saved events retain identity after change or expiry; fetch failures never manufacture a cancellation.
- File/PG contract tests cover two-account isolation, concurrent deduplicated adds, quota boundaries, pause/remove, atomic invalid imports and idempotent deletion. Linked integration covers account binding, offline rejection, token scope and unavailable older servers.
- Export/restore round-trips approved private state; deletion removes every private reference; public sharing omits location/interests; secret canaries are absent from every output/error/log/cache key, including redirect and upstream pagination fixtures.
- Quota tests cover pagination caps, all-replica budgets, request coalescing, partial responses and bounded retry of transient failures. Restart/room-closed collection and reported/inbox deduplication tests are required later before making those promises.

The next implementable step is to settle the coarse-location resolver/defaults, retention/use permissions and key execution mode, then agree shared domain/event interfaces and implement the storage plus fixture-tested provider lanes. This assessment changes documentation only.
