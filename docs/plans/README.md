# Roadmap

Plans are proposals, and they change. What MCPortal does today is described in the [explanation docs](../explanation/); this page lists only open work, roughly in the order it will happen.

The loop everything serves: open your room, catch up, read something worthwhile, keep the useful part, and find it again later. Reading continuity and retrieval come before proactive delivery or more social features.

## Next

1. **Launch.** Scheduled Postgres backups and a restore drill, external uptime checks, then open sign-up. Reviewer access, hand-testing every host, and listing in Claude's connector directory, then OpenAI's. [Plan](launch.md).
2. **Find it again.** One search across saved items, clips and reading history, with results that return to the original passage. Lightweight collections, and related saved material that says why it's related.
3. **Reader quality.** Check the reader-audit articles by hand for complete text, the right figures and correct author credits. Handle paywalled articles clearly.
4. **Watches.** Follow artists and get shows near you, then a background collector, an inbox and digests that work while the room is closed. [Plan](watches.md).
5. **Reactions.** One lightweight signal on a post, so Following can surface what people liked.
6. **A room that feels yours.** Presentation suited to each kind of portal (articles, docs, video, music), appearance preferences that persist, occasional resurfacing of saved material, and discovery through people's Spaces ([plan](finding-people.md); every handle opening a Space is built). Decide whether the front page lab graduates.
7. **MCP 2026-07-28.** Serve the stateless protocol beside today's, still without dependencies, once hosts send it. [Plan](mcp-spec-2026-07-28.md).
8. **Running your own.** A one-click Railway template, and federation between instances someday. [Plan](federation.md).

## Later

- Built-in views of your own reading: what you read and save, by topic and source.
- Link cards for sites without feeds, such as TikTok through oEmbed.
- Shared rooms for groups.
- Postgres row-level security as a third access layer.
- A moderator role, separate from admins.
- When a linked computer can't reach a site, fetch it through the hosted service instead, plus an opt-in setting to always fetch that way for privacy.
- Tool groups an account can turn on and off, and retiring tools that real use shows aren't earning their place.
- Decide the river's and front page's defaults from use: where items fold, how new and seen items are ordered, and "quiet" portals that stay out of the river.
- An activity view for your posts ("Ana reblogged your post").
- Docs portals that read `llms-full.txt`, MkDocs navigation and mdBook includes, use a docs site's own MCP server when it has one, show what changed since you last read a page, and switch between versions.
- Highlights kept as a portal, a scheduled "catch me up", and handoffs that carry several items.
