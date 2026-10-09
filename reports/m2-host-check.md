# M2 candidate host check

Status: **pending actual host connection**. The automated browser host is a fixture, not a Codex or ChatGPT result-visibility measurement. The available MCPortal connections point at the existing installed/hosted release, not this candidate. Computer-use access to the Codex application settings is blocked by the tool, so that route cannot install/restart the candidate connection.

The disposable probe uses the candidate's real dispatcher, tools and room asset with synthetic in-memory records and a fixture fetcher. It does not link to an account, read the user's MCPortal data or fetch external sources. Records disappear when the probe restarts.

Add a temporary STDIO MCP server named `mcportal-m2` in the desktop app's MCP settings:

- Command: `/opt/homebrew/bin/node`
- Argument: `/Users/lb/.codex/worktrees/020f/mcportal/scripts/probe-component-host.ts`

Save it and restart the connection. The [official MCP setup documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) describes this settings path. Remove the temporary server after validation.

In this chat, invoke the candidate `read_article` on `https://example.com/long`. The expected result has a `structuredContent.resultView` envelope and about 12.6 KB of model-visible JSON. Its component metadata contains the full extracted article (400 blocks in the recorded wire smoke test). The card should display sections beyond the first text page and support Find, Reading settings and passage selection. Inspect the actual transcript to confirm full article blocks are not included in model context; a tool response size estimate alone is insufficient.

Then check:

1. `open_room`: saved links, basic navigation, and account-local state.
2. `read_doc_page` with `docs=https://example.com/llms.txt` and `url=https://example.com/long.md`: the component renders the complete docs page and later headings; model text remains bounded.
3. `search_clips` then `get_clip`: retained quote text and `read_result_page` continuation, including another part and expiry/invalid-handle feedback.
4. `show_comparison` for the two fixture URLs: source and interpretation distinction.
5. `open_handoff` for the generated live and unavailable fixture handoffs: retained quote and live retry. Probe startup logs list their current synthetic codes.
6. Back/Escape, a selected quote, and sending a retained passage in the candidate card. Do not use production sharing or send anything to other users.

Record the exact host/version, candidate commit, identity mode (isolated synthetic local), tool transcript sizes, component observations and any dropped metadata. A host that includes `_meta` in model context or does not deliver it to the card is unsupported for `component-v1`; leave legacy mode enabled and report the finding. Do not infer ChatGPT behavior from a Codex result, or vice versa.

Completed evidence: raw stdio initialize/read_article smoke with 12,573 model-visible serialized bytes and 400 component blocks; seven-case benchmark; authorization/expiry/Unicode tests; browser tests for full metadata delivery and explicit missing-metadata fallback. These establish server and fixture behavior only.
