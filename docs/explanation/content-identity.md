# Content identity and retention

MCPortal keeps the existing account-scoped `url:` and `clip:` references. A URL identifies a source address; a clip identifies retained material owned by an account. Neither promises that today's remote page is the representation the reader originally saw. This decision resolves #119 and defines the additive locator work in #120.

## Identity decisions

Reading and collection URL references use `canonicalReadingUrl`: parse an HTTP(S) URL, reject credentials, preserve path and query, and remove the fragment. Different query parameters, documentation versions and Git refs remain distinct. Do not merge redirects, tracking aliases, syndications or similar titles automatically. A fetched representation may report a different address without rewriting a saved identity.

Saved links retain their original fragment for navigation; Recall merges their fragmentless reading identity with history. Clips remain separate even when their source URLs or quotations coincide. Publication uses the share's own identity and audience; a public post never turns its private source clip into a public object. Generated notes and collection orientations remain interpretation, with explicit references to evidence.

Add only optional `prefix`, `suffix`, `digest` and `revision` fields to passage locators. Prefix and suffix are each capped at 120 characters; text remains capped at 300. The digest describes normalized rendered source text, not ownership, authenticity or a content-store key. A revision, when a source provides one, describes its representation rather than replacing the versioned URL. A retained quote and the live source remain separate even when a locator resolves.

This small selector borrows surrounding-text context from the [W3C Text Quote Selector](https://www.w3.org/TR/annotation-model/#text-quote-selector) and representation distinctions from [W3C States](https://www.w3.org/TR/annotation-model/#states). It does not implement the full annotation model.

## Retention and availability

| Material | What survives | Limits and deletion |
|---|---|---|
| Saved link | Address, title, note and optional preview. The page body is fetched later. | 200 saved links per profile. Removing the link does not delete an independently retained clip. |
| Retained quote or note | Explicitly supplied content and source metadata, usable during source outages. | 1,000 clips and 50 MB per account; text is bounded to 32 KB per clip. Explicit clip/account deletion removes it. |
| Preserved copy | Only content explicitly captured in existing clip kinds. An article read is not an archived full page. | Existing clip limits apply. No new archive or retention promise. |
| Collection evidence | References, bounded URL excerpts and separate orientation text. | 50 collections, 200 entries each, 256 KB per collection; a comparison has at most three sources. Removing a reference does not erase its clip. |
| Handoff | A temporary source pointer and optional selected passage. | Seven days, at most 50 per account, not exported. A retained passage can still be shown during an outage until expiry. |
| Publication | The shared snapshot, its audience and its own share ID. | Unshare controls the publication independently of the private source; account deletion also removes owned social data. |

All source text, titles, locators, notes and exports remain untrusted data. A ref is never a bearer capability. Access always comes from the authenticated account and the existing share authorization rules.

## Scenario review

Reviewed against main `716620b` and the existing file, Postgres, linked and portability contracts. These are architecture decisions checked against code, not claims of a new human study.

| Scenario | Required identity and lifecycle behavior | Existing boundary |
|---|---|---|
| 1. Same page arrives through HN and RSS | One Recall page identity; arrivals do not erase retained clips. | `library.ts`, `reading.ts` |
| 2. Same address has different fragments | Preserve bookmark navigation; merge reading and collection URL refs without fragment. | `profile.ts`, `reading.ts` |
| 3. `?version=2` and `?version=20` | Keep separate. | `canonicalReadingUrl` |
| 4. `/v2/` and `/v3/` docs | Keep separate and route only through the caller's docs portals. | `library.ts` |
| 5. Git branch and commit addresses | Preserve the ref in the URL; do not alias mutable branches to commits. | `adapters/docs`, `library.ts` |
| 6. Redirect to a new URL | Read the destination safely without silently merging saved identities. | reader adapter, safe fetch |
| 7. Tracking parameters differ | Keep separate until an explicit alias contract exists. | `reading.ts` |
| 8. Same title on two sites | Keep separate. | `library.ts` |
| 9. Same source clipped twice deliberately | Separate clip IDs; request retries are the distinct concern of #121. | `clips.ts` |
| 10. Same clip ID requested by another account | Return no private object; never search another account. | clip stores, state API |
| 11. Same URL retained by two accounts | Independent private state and deletion. | profile, reading and collection stores |
| 12. Full page changes after clipping | Keep quotation; resolve current text conservatively and report relocation. | `evidence.ts`, passage UI |
| 13. Quotation occurs twice | Surrounding context may disambiguate; offsets alone never prove a citation. | additive locator contract |
| 14. Quotation disappears | Report unavailable; keep retained text. | Recall and handoff UI |
| 15. Source is offline or denied | Retained text remains usable; fetch failure does not rewrite it. | `open_handoff`, `get_clip` |
| 16. Legacy locator has only text/block | Continue unique text matching; never infer a digest or version. | additive locator contract |
| 17. Collection points to deleted clip | Keep an honest stale reference; do not manufacture replacement evidence. | collections, portability |
| 18. A generated note cites a source | Note remains interpretation, with its own clip identity. | clip kind/source metadata |
| 19. Generated collection orientation | References must name evidence; removed evidence is disclosed. | `collections.ts` |
| 20. Private clip is shared | Share is a separate publication snapshot; private clip access stays scoped. | `social.ts`, state API |
| 21. Unshare after private clipping | Remove publication independently; private material persists. | social store |
| 22. Handoff without selected text | Pointer and navigation only; no retained quote is implied. | `handoffs.ts` |
| 23. Handoff expires after seven days | Code stops resolving; no library/archive identity is invented. | handoff stores |
| 24. Export then import into another account | Validate material, remap imported clip references, preserve source versions; never republish exported social posts. | `portability.ts` |
| 25. Linked device signs out | Copy authorized portable material locally; temporary handoffs keep their separate lifecycle. | `link/signin.ts`, portability |
| 26. Delete account | Remove private retained material and owned publication data through existing deletion contracts. | account/deletion tests |

## Compatibility and migration

No identity migration is needed. Existing `url:`/`clip:` refs, exported version 3 files and account boundaries remain valid. New locator fields are optional. New readers validate them; legacy locators continue to work. An old writer may drop new context when explicitly replacing a locator, so readers must continue conservative matching without it. Context never overrides contradictory revision evidence or authorizes fetching private resources.

Validation is maintained in `test/library.test.ts`, `test/linked.test.ts`, `test/collections.test.ts`, `test/portability.test.ts`, `test/privacy.test.ts` and the Postgres/deletion suites. Locator-specific changed/repeated-text cases belong to #120; retry receipts belong to #121. This decision introduces no new store or embeddings.
