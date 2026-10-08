# MCPortal: a content platform inside the agent

> Historical assessment at `75888bf`. Read the [current code reconciliation](current-baseline.md) before using this as an implementation backlog. Several proposed features subsequently landed on main.

Research and proposed direction · 8 October 2026

First validation audience: **developers and researchers who already use agents**, as selected by the user. The platform model remains broad.

## Product judgment

The mission is coherent. A reader, documentation browser, knowledge library, content dashboard, and lightweight publishing network can share one content foundation. The useful organizing principle is the lifecycle of material: **discover → inspect → understand → keep → retrieve → reuse → optionally share**. Different content archetypes need different navigation and controls within that lifecycle.

MCPortal should become the place where material remains identifiable, readable, and usable as a person moves between direct interaction and their agent. An agent can bring something into the room, interpret a selected passage, or compose a synthesis; the person can browse, read, save, and return without requesting a model turn for every action.

The biggest design risk is discontinuity: a passage that loses its source, a saved item that cannot be found, an agent answer whose scope is unclear, or a room that disappears with the conversation. Unifying those transitions is the core product work.

This research supports the architecture and interaction direction. It does **not** establish demand, product-market fit, or superior usability. Those require the participant studies in the [validation plan](delivery-and-validation.md).

## The opportunity has become more specific

Readwise already provides an MCP connection through which external agents can search reading material and highlights and change library state. “Your reading connected to AI” is therefore an existing competitive capability. MCPortal's proposed distinction is a persistent, directly manipulable content workspace **within the chosen agent**, joining incoming sources, documentation, retained knowledge, and attributable sharing. This is a differentiation hypothesis to test against existing workflows. [Readwise MCP documentation](https://docs.readwise.io/tools/mcp)

The first proof should be one complete experience:

> A developer opens a useful update, follows it into versioned documentation, asks their agent about a passage, keeps the evidence and explanation separately, then retrieves the passage in a later conversation.

A researcher should be able to complete the same lifecycle with an article and an evidence collection. Supporting both through the same identity, locator, action, and retrieval contracts tests the broad platform thesis more effectively than adding more disconnected views.

## Recommended decisions

| Decision | Consequence |
|---|---|
| One content reference, many appearances | An article arriving through a feed and a person's share can retain one reading state while preserving both discovery contexts. |
| Separate content, representation, and behavior | A documentation page can use shared text blocks while adding hierarchy, version, code, and symbol navigation. |
| Separate arrival, retention, reading, and publication | Receiving an item does not save it; opening does not finish it; clipping does not publish it. |
| Make agent context visible and deliberate | Show whether an action concerns a selection, page, or collection. Keep source material and generated interpretation distinguishable. |
| Persist useful state beyond the view | Reading position, clips, collections, and action receipts survive iframe teardown and new conversations where the same account is available. |
| Adapt the surface to host capabilities | Compact conversation entry, expanded workspace where supported, useful text fallback everywhere tools are available. |
| Extend the existing system incrementally | Preserve the renderer, token pipeline, direct UI actions, file/Postgres contracts, and existing continuity work. |

The host surface decision matters immediately. OpenAI's current guidance reserves inline cards for small tasks and discourages nested navigation and scrolling there. A complete room should be an expanded experience when that host permits it; other hosts need their own tested contracts. [OpenAI UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)

## Deliverables

| Document | What it resolves |
|---|---|
| [Evidence and current product audit](evidence-and-audit.md) | Primary-source comparisons, observed interface patterns, baseline strengths and gaps, and limits of the research. |
| [Experience and design system](experience-and-design-system.md) | Content archetypes, information architecture, five journeys, branching flows, interface schematics, component behavior, and accessibility. |
| [System architecture](system-architecture.md) | Content identity, passage locators, storage and search, UI/agent parity, host boundaries, permissions, and incremental migration. |
| [Delivery and validation](delivery-and-validation.md) | Prioritized work, dependencies, acceptance gates, participant research, retrieval evaluation, and success measures. |

## Relationship to existing work

This is a proposal supplement to the [delivery roadmap](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/plans/delivery-roadmap.md), [design system](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/design-system.md), and [product map](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/product-map.md). It does not silently replace earlier decisions. The code baseline is commit `75888bf`; some older planning documents still describe now-implemented features as future work.

The review included source and documentation inspection, current web documentation, and a browser walkthrough of MCPortal's local design fixture. External visual inspection covered vendor documentation and embedded product screenshots for Readwise and Zotero. No participant interviews, authenticated competitive product tests, production host certification, or new performance benchmark were completed. The recommendations and numeric release targets below are proposed, not measured results.
