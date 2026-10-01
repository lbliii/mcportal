# MCPortal delivery roadmap

Status: proposed implementation sequence, agreed in product discussion on 30 September 2026. These releases describe planned work, not shipped capabilities. Effort is relative; release criteria determine readiness rather than calendar dates.

The product loop is: open your room, catch up, read something worthwhile, keep the useful part, and return to it later. Prioritize durable reading continuity and useful retrieval before proactive delivery or expanded social features.

## Release sequence

| Release | User promise | Scope | Effort |
|---|---|---|---|
| 0 | Portal works predictably in my host | Compatibility, discovery, navigation | Small to medium |
| 1 | My room remembers where I left off | Reading state, Continue Reading, catch-up | Medium |
| 2 | What I read becomes useful knowledge | Highlights, agent questions, unified search | Medium |
| 3 | Portal brings worthwhile updates to me | Collection worker, watches, inbox, digests | Large |
| 4 | My room feels unmistakably mine | Richer presentation, connections, discovery | Medium to large |

## Release 0 Make the foundation dependable

Deliver:

- Detect host capabilities during initialization; show supported actions and offer immediate fallbacks.
- Fix docs discovery so a broad parent index does not silently replace the requested project's docs.
- Give room readers and separate chat cards a consistent route home.
- Preserve room navigation and scroll position when opening and closing a reader.
- Establish a compatibility checklist for Codex desktop, Claude Desktop and Cowork, and ChatGPT. Keep terminal workflows useful through text tools.

Release criteria:

- Room to article to room, and room to docs to page to room, work without losing position.
- Unsupported host actions do not leave users waiting for a timeout.
- Sphinx and NemoClaw open the intended documentation through regression fixtures.
- Direct tool calls, context updates, messages, display modes, and restored views are manually verified in each host before claiming support.

Starting points: `src/ui/room.html`, `src/mcp.ts`, `src/adapters/docs.ts`, `src/docs-tools.ts`, and the existing docs and UI tests. The current discovery implementation tries ancestor llms.txt indexes before alternative index types; scope-aware selection is needed.

## Release 1 Make returning rewarding

Deliver:

- Durable reading state: canonical URL, last opened time, heading or block anchor, progress, and explicit read status.
- A Continue Reading strip with a small number of recent unfinished items.
- New since your last visit, with a stable cutoff for the current visit.
- A finite catch-up view with source filters and an explicit caught-up action.
- Separate seen, opened, and read states.

Start with items available from current fetches. Explain that catch-up covers retrieved items; complete coverage between visits requires Release 3 collection and remains subject to upstream feed limits.

Release criteria:

- Close the view, reopen in a new chat, and resume the same passage.
- Resume in another supported host when connected to the same hosted account.
- Refreshing does not reset the visit cutoff or make previously seen items appear new.
- Opening an article does not automatically mark it read.
- New state is included in export and account deletion.

Dependencies: Release 0; a reading-state store and stable item identity. Hosted-account continuity can ship independently of the planned local-to-hosted device linking in [the hybrid plan](local-hosted-hybrid.md).

## Release 2 Make reading compound

Deliver:

- Select text and Keep quote, with source URL and attribution.
- Select text and Ask your agent, with the passage and source attached to an explicit question.
- One search across saved links, clips, and reading history.
- Results that return to the original passage where possible.
- Lightweight collections and tags.
- Related saved material based initially on text and tags.

Release criteria:

- Saving a quote works directly from the UI without requiring an agent turn.
- A selected passage reaches the agent as source material, separate from the user's question.
- Find that heartbeat thing retrieves the saved NemoClaw page or its clip.
- Search results distinguish original content from agent-written explanations.
- Related suggestions explain the connection and can be dismissed.

Dependencies: Release 1 reading history, selection anchors, app-visible quote operations, and retrieval across existing stores. Add semantic search only when evaluation shows ordinary retrieval misses useful results. Extend [the clips plan](clips.md) rather than duplicating its storage design.

## Release 3 Make Portal anticipate

Deliver:

- Scheduled source collection with durable item history.
- User-defined watches: a repository release, a topic in selected feeds, or changes to a particular docs page.
- A Portal inbox with deduplication, dismiss and snooze actions, and clear reasons for each update.
- Finite digests built from collected items.
- Optional notification adapters for supported hosts.

Release criteria:

- Collection continues while the room is closed.
- Restarting the worker does not duplicate inbox items.
- Users can pause or delete watches.
- Missed fetches and rate limits are visible; catch-up never claims completeness when collection failed.
- Portal's inbox works independently of host notification support.

Dependencies: durable item history, a scheduled worker, bounded fetch budgets, retry and deduplication rules, and subscription storage. Build the worker and inbox before host-specific push integrations. ChatGPT Events and Claude Code channels are separate adapters with separate compatibility tests.

## Release 4 Add distinctive delight

Deliver:

- Per-portal presentation suited to articles, docs, videos, music, and saved collections.
- Room appearance preferences within the existing design system.
- Small accessible transitions that reinforce opening, saving, and returning.
- Occasional resurfacing: saved material, meaningful updates, and connections between items.
- Optional discovery through people's Spaces and recommended sources.

Release criteria:

- Appearance preferences persist without rearranging the user's room.
- Motion respects reduced-motion settings.
- Recommendations have understandable reasons and controllable frequency.
- Media integrations have verified host and provider support.

Visual polish can accompany every release. Elaborate media playback and social ranking should wait until the reading loop is reliable. Use [the design system](../design-system.md) for presentation work.

## Architecture and host boundaries

Add separate stores for reading state, item history, annotations, and watches. Use incremental server operations for frequent updates; keep the layout profile focused on preferences. Save reading position periodically and on navigation, with teardown as an additional opportunity rather than the only save mechanism.

Keep ordinary browsing and saving in direct UI tool calls. Invoke the agent for interpretation, questions, and composition. Model-context updates supply context for subsequent turns; they do not guarantee immediate model execution.

Portal owns navigation within its app, storage, collections, search, and presentation. The host controls app lifetime, available bridge capabilities, conversation execution, and surrounding application chrome. Do not promise an indefinitely live iframe, universal background notifications, or graphical rooms in terminal clients merely because MCP tools connect.

The repository currently uses a minimal request-response MCP implementation and does not implement a collection worker or server-initiated event stream. Adding proactive delivery is a distinct infrastructure project.

Official references reviewed during the assessment:

- [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)
- [MCP Apps host capabilities](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiHostCapabilities.html)
- [OpenAI MCP UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude)
- [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)
- [Claude Code channels](https://code.claude.com/docs/en/channels)

Host support and protocol requirements change. Revalidate these references when implementing adapters; the current session demonstrated Portal tool use and an app-to-chat reader handoff in Codex, not a full cross-host compatibility certification.

## Success measures

Use minimal, disclosed analytics to measure:

- Successful first room setup and first useful read.
- Return visits across different days.
- Continue Reading use.
- Quotes and links saved, then retrieved later.
- Catch-up sessions completed.
- Reader failures and host-action failures.
- Watch updates opened versus dismissed.

Set numerical targets after a small beta establishes a baseline. Returning and recovering something valuable matters more than maximizing time spent.

## First implementation milestone

Complete Release 0, then deliver Continue Reading. Demonstrate the full path: open NemoClaw, stop halfway through a page, close Portal, and return the next day to the same passage. Verify persistence across a new chat and a server restart before extending the feature to cross-host use.
