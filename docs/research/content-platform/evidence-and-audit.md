# Evidence and current product audit

> Historical assessment at `75888bf`. Read the [current code reconciliation](current-baseline.md) before using this as an implementation backlog. Several proposed features subsequently landed on main.

Reviewed 8 October 2026 · Baseline `75888bf`

## Research method and confidence

This is a desk-research and expert-review pass. Product documentation establishes advertised behavior; standards establish contracts; code establishes implementation at this checkout; local fixture observation establishes only that fixture's behavior. Recommendations connect these findings to MCPortal and are explicitly proposals. No comparative usability ranking or market-size claim follows from this material.

Sources were selected for the mechanisms they illuminate: intake and retention, collections, source-linked annotations, heterogeneous posts, AI control, and embedded interfaces. This is a focused comparison, not an exhaustive market survey. Sources are linked beside the claims they support; all were accessed on the review date.

## Product patterns to adopt or adapt

| Reference and observed/documented pattern | Implication for MCPortal | Boundary |
|---|---|---|
| Readwise separates automatically arriving Feed items from deliberately retained Library items. Its library configurations support different triage habits. [Intake](https://docs.readwise.io/reader/docs/faqs/adding-new-content), [library workflows](https://docs.readwise.io/reader/guides/workflows/library-configuration) | Keep source arrival separate from saved state. Offer a finite catch-up and an intentional library without treating every incoming item as unfinished work. | Do not copy several competing workflow modes at launch. Validate the simplest default with this cohort. |
| Readwise's Ghostreader operates across a library and at narrower scopes, with source-linked answers. [Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/global) | Page, passage, and collection are meaningful AI scopes. Evidence should reopen its source location. | This is established competitive behavior, not proof of a unique MCPortal feature. |
| Obsidian Bases offers multiple layouts, filters, and sorts over files and their properties. [Bases](https://obsidian.md/help/bases) | A portal can be a view over content, with layout independent of identity and retention. | This does not imply MCPortal should adopt Markdown files as its complete database or build a general spreadsheet. |
| Are.na connects the same block to multiple channels; connections carry discovery context. [Blocks](https://help.are.na/docs/getting-started/blocks), [connections](https://help.are.na/docs/getting-started/connections) | Reuse an item across collections without duplicating it. Treat curation and attribution as useful social activity. | Public/private collection semantics must be explicit; sharing cannot inherit private membership accidentally. |
| Zotero's reader connects annotations with notes and citations that return to source locations. It stores annotations separately from PDF files. [Reader](https://www.zotero.org/support/pdf_reader), [annotation storage](https://www.zotero.org/support/kb/annotations_in_database) | A retained quote needs a resolvable target. Personal interpretation should remain distinct from the source representation. | A complete scholarly reference manager and PDF editor are larger specialties; do not imply they are already supported. |
| Tumblr's Neue Post Format separates typed content blocks, layout, and reblog attribution. [NPF specification](https://github.com/tumblr/docs/blob/master/npf-spec.md) | The light social layer can compose existing content with an author's note and publication metadata. Keep origin, commentary, and reblog trail distinct. | Shared rendering does not erase publication permissions, deletion rules, or abuse controls. |

Readwise's library screenshot was inspected in its workflow guide. Its visible Inbox/Later/Archive controls make a lifecycle explicit. Zotero's documented reader screenshot shows annotations beside a source and notes with citations. These are useful interface precedents, but screenshots cannot establish task speed, discoverability, or user preference.

## Interaction and technical foundations

| Primary source | Finding | Proposed application |
|---|---|---|
| [Microsoft HAX Design Library](https://www.microsoft.com/en-us/haxtoolkit/library/) | AI interfaces should communicate capabilities, support correction and dismissal, explain behavior, and expose user control. | Visible source scope, editable requests, understandable recommendation reasons, recoverable actions, and controls over personalization. |
| [Nielsen Norman Group: recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/) | Visible cues reduce the need to remember commands or information. | Put Save, source identity, reading location, and search scope where needed; retain optional agent commands and shortcuts. |
| [Diátaxis](https://diataxis.fr/start-here/) | Tutorials, how-to guides, reference, and explanation serve distinct documentation needs. | Keep documentation structure and page purpose available; a polished prose reader alone is insufficient for API reference work. |
| [W3C Web Annotation model](https://www.w3.org/TR/annotation-model/) | Annotation bodies and targets are separable; quote selectors can include surrounding context. | Versioned source targets with quote/context selectors and explicit resolution outcomes. |
| [Readium locators](https://readium.org/architecture/models/locators/) | A locator can describe a resource, position/progression, text context, and format-specific fragments. | One locator envelope with text, page, or media extensions as actual renderer support grows. |
| [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html), [host capabilities](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiHostCapabilities.html) | App views and hosts communicate through a bridge; tools, messages, context updates, and other functions depend on host capabilities. | Negotiate each action. Treat model context updates as context for later turns, not guaranteed model execution. |
| [OpenAI tool-result reference](https://developers.openai.com/plugins/reference) | In the documented host, `structuredContent` and `content` reach both the model and component; result `_meta` is component-only. | Bound model-visible data. Use a tested host-specific UI delivery path for extra rendering data; structured data is not a privacy boundary. |
| [DTCG format 2025.10](https://www.designtokens.org/tr/2025.10/format/) | Typed tokens and references provide a portable format. This is a community specification, not a W3C Recommendation. | Continue the repository's explicit supported subset and validation rather than replacing the token system. |
| [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Reflow and minimum pointer targets have precise requirements and exceptions. | Validate narrow layouts and zoom; preserve the existing 24px minimum and larger coarse-pointer controls, without equating those checks to full conformance. |
| [ARIA feed pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/) | A dynamic ARIA feed carries focus, keyboard, position, and loading responsibilities. | Start with ordinary semantic lists and explicit pagination. Add `role=feed` only with its complete interaction contract. |

## What the repository already supplies

Paths below are implementation evidence, not claims that every deployment or host has been verified.

| Foundation | Evidence | Design consequence |
|---|---|---|
| Feed, documentation, bookmark, clip, and social items already meet in one presentation model. | [types](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/types.ts), [room items](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/ui/room/items.js) | Build on the common grammar. `Item` is currently a display summary, not a durable content registry. |
| Article/docs blocks cover headings, paragraphs, lists, code, quotes, tables, callouts, and inline spans. | [types](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/types.ts), [reader](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/ui/room/reader.js), [docs](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/ui/room/docs.js) | Reuse these blocks. Rich media, image blocks inside articles, and PDF behavior still need explicit extensions; clip images are a separate existing capability. |
| Reading continuity distinguishes seen, opened, and explicitly read, with stored progress and approximate heading/block anchors. | [reading specification](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/reading-state.md), [UI reading](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/ui/room/reading.js), [Postgres reading](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/db/reading.ts) | Improve precision and error feedback. Do not plan a second reading-state implementation. |
| Passage actions already support asking the agent and clipping a quote. | [passage actions](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/ui/room/passage.js), [clip tools](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/tools/clips.ts) | Extend scope communication and durable target information. This work is more specific than “add AI to the reader.” |
| Clips support quote, exchange, note, table, image, and link; saved links live in the profile. | [clips](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/clips.ts), [types](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/types.ts), [store](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/store.ts) | A unified library can begin as a read projection over existing stores. |
| Shared tool plumbing validates calls and distinguishes tool access. | [tool kit](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/tools/kit.ts), [schema](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/lib/schema.ts), [MCP](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/mcp.ts) | UI and agent actions can share domain operations while keeping tool visibility deliberate. |
| Host capability handling and text fallbacks exist. | [bridge](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/ui/room/bridge.js), [compatibility checklist](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/host-compatibility.md) | Test and refine actual host behavior; a fixture is insufficient certification. |
| File/Postgres stores, migrations, operations guidance, and a generated token system exist. | [storage](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/storage.ts), [database schema](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/src/db/schema.ts), [operations](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/operations.md), [design system](https://github.com/lbliii/mcportal/blob/75888bf901c9cc28924a403168a374beff0e454a/docs/design-system.md) | Keep a modular monolith and incremental migration. Operational release evidence remains its own gate. |

The checkout has separate documentation and clip search rather than the proposed unified retained-library retrieval contract. Agent-ranked highlights use bounded candidates; there is no basis here to promise complete collection between visits. Older plans are useful intent records, but shipped status should be reconciled against code and verification evidence before estimating work.

## Interface walkthrough: findings and hypotheses

The walkthrough used `scripts/design-preview.ts`, which serves the real UI resource with canned content and in-memory state. Wide views and a narrow documentation view were inspected in the Codex browser. These are observations and expert hypotheses, not participant-reported problems.

| Observation | Interpretation | Recommended treatment / validation |
|---|---|---|
| Documentation uses a readable central column, project navigation, code blocks, and an on-page area. At narrow width it exposes a Contents control. | A substantial specialized documentation experience already exists. | Preserve it; test locating a named symbol and returning to a prior page, including keyboard use and long code. |
| Several reader toolbar actions are represented principally by icons. Original-source and conversation-handoff actions require interpretation. | Accessible names can be present while visual discoverability remains uncertain. | Test labelled primary actions and source-link wording before changing the entire toolbar. |
| Selection exposes passage actions; the resting page emphasizes reading. | Progressive disclosure preserves focus but may hide a major capability from first-time users. | Provide a small initial cue and a keyboard-accessible page action; test whether people discover selection without coaching. |
| The river combines sources and attributed shares, and distinguishes curated highlights with explanatory text. | This is evidence of a shared content presentation working across archetypes in the fixture. | Preserve visible origin and authorship. Evaluate whether recommendation reasons help decisions. |
| The welcome fixture emphasizes packs and playful action copy. | It establishes personality, but source-pack choice may precede demonstrated value. | Offer a small useful sample and a direct “Add sources” route; test clear primary labels with playful secondary copy. |
| Some fixture actions depend on missing backing capabilities or stores. | Their disabled state cannot alone establish a production defect. | Verify with the relevant backing service and actual host before filing bugs. |

## Open questions that desk research cannot settle

1. Does the embedded room reduce enough switching to become a habitual entry point, compared with an existing reader plus agent tools?
2. Do developers and researchers understand Room, Library, and Space without an explanation?
3. Does a user expect Save to preserve a readable copy, or just a durable link? The interface must state the actual promise.
4. Which failures prevent trust first: missing content, inaccurate passage return, unclear agent scope, or unreliable host handoff?
5. Does light sharing improve knowledge reuse for this cohort, or remain an occasional output?

The [study plan](delivery-and-validation.md) turns these into observable tasks and decision gates.
