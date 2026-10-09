# Tool result payloads

MCPortal defaults to **legacy** results: both `content` and `structuredContent` are model-visible, and the latter contains the complete typed data in `src/tools/results.ts`. There is no claimed model-result budget in legacy mode.

The opt-in `MCPORTAL_RESULT_MODE=component-v1` contract separates that data. Enable it only after verifying that the host delivers tool-result `_meta` to the component and excludes it from model context. A self-reported client name never enables the contract. The [official OpenAI plugin reference](https://developers.openai.com/plugins/reference#tool-results) documents this separation; other hosts need their own evidence.

| Field | Component mode |
| --- | --- |
| `content` | Attributed, untrusted text page |
| `structuredContent.resultView` | Format, source tool, text-part counts, optional account-scoped continuation handle |
| `_meta["mcportal/component-v1"]` | Complete original typed UI data |

The complete serialized JSON of **all result fields except `_meta`** has a 32,768-byte ceiling in this contract. UTF-8 bytes and JSON escaping count; this is not a tokenizer estimate. The component retains the complete data. Existing callers receive their original result shapes unless the operator explicitly enables the new mode. Small results use the same envelope to keep the contract predictable.

The app unwraps component metadata before using its existing typed rendering functions. If a host strips that metadata, the card reports that it cannot display the full result and tells the operator to use legacy mode; the attributed chat text remains usable. It does not render a silently truncated article as complete.

`read_result_page` reads further text parts using a random handle, scoped to the authenticated account. Handles expire within ten minutes and may be evicted sooner by the existing bounded cache. Restart also removes them. A missing handle asks the caller to repeat the original read. The tool uses the normal access and usage gates, and every page fences source data as untrusted. Do not retry a write with a new action merely to recover its text; use the operation's request key.

Article and docs text have their own pagination. `read_article` now accepts `part` (one-based); `read_doc_page` already does. A result-page handle continues the text of that particular call. To read the next part of the original article or document, follow that tool's `part` instruction. The card always has the complete extracted representation, subject to existing extraction limits.

The [payload benchmark](../../reports/m2-result-payloads.json) measures room, article, docs, clip, comparison and both live/unavailable handoffs through real handlers with synthetic source fixtures. Reproduce it with `node scripts/benchmark-result-payloads.ts`. It records legacy model bytes, component-mode model bytes and full wire bytes, so moving data is not mistaken for eliminating network cost. The candidate cases range from 446 to 12,573 model-visible bytes; the long docs result goes from 420,578 to 10,864 bytes. Random nonces, handles and timestamps can change exact sizes slightly.

`test/result-payload.test.ts` enforces the budget, complete component data, account isolation, Unicode-safe pagination, expiry and legacy results. `test/ui-passage.test.ts` drives the real card in a **simulated** host, including a host that drops metadata. This does not establish actual Codex or ChatGPT transcript behavior. Actual-host candidate verification remains an M2 exit requirement; keep component mode opt-in until that evidence exists.

The tool-definition footprint grows separately: +254 estimated tokens locally and +276 for an active hosted account (four characters per token estimate). The deliberate increases cover locator context, retry keys, article pagination and the 89-token continuation tool. The new app-only preference tools do not enter the model tool list.
