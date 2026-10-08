# UI experience inventory

Reviewed October 7, 2026, from v0.10.1. The first implementation pass refines the article, documentation, and shared reading controls. Other entries are source-reviewed opportunities, not claims that their changes are implemented or that every page has been visually tested.

The goal is a reading environment worth returning to: understand an article, explore an open source manual, copy a working example, ask about a passage, and resume in the right place. Keep the existing MCPortal palette, native controls, content safety boundaries, and six room layouts.

## Design approach

Emil's design engineering guidance informs focus, immediate navigation, copy feedback, and dismissal behavior. Impeccable's Read and Operate guidance informs hierarchy, states, responsive navigation, and consistency. Taste's editorial and preservation guidance fits articles, public Spaces, and marketing; its landing-page patterns do not belong in dense product controls or admin tables. Use the existing native JavaScript and token system without new runtime dependencies.

The reading direction is a refinement of the incumbent system: restrained expression, very little motion, and enough density for real documentation. Source text remains source text. Publisher scripts, tracking, and embeds remain outside the renderer; figures continue through the existing guarded thumbnail tool.

## Surface inventory

| Surface | Implementation | What works | Opportunity and order |
| --- | --- | --- | --- |
| Article and website reader | `src/ui/room/reader.js` | Structured lists, quotes, figures, metadata, source links | First pass: larger rem headings, calmer prose rhythm, copy every code example, keyboard-focusable overflow regions |
| Open source and website documentation | `src/ui/room/docs.js` | Section contents, title/symbol search, nested indexes, previous/next pages | First pass: narrow heading outline, destination focus, Contents focus and state, real navigation links and current-page state |
| Reading continuity and handoffs | `reading.js`, `passage.js`, `handoff.js` | Resume, explicit Mark as read, source-bound selection and chat handoff | First pass: constrain passage actions, dismiss local UI before exiting, improve copy fallback; preserve block identities and resume precedence |
| Six room layouts | `layouts.js`, `items.js`, `river.js` | User preference, common story actions, distinct compositions | Recently shipped; keep action and metadata behavior consistent as readers evolve |
| Expanded source view | `levels.js` | Keeps room nodes, scroll position, and focus | Next: distinguish keyboard activation from pointer transitions |
| Welcome, add source, and import | `room.js`, `add.js` | Packs, editable source inputs, preview and busy feedback | Next: stabilize overlapping scans, improve empty/error recovery, verify long results and import reports |
| Toolbar, identity, and settings | `room.html`, `toolbar.js` | Native layout popover and explicit identity/offline modes | Next: align account-menu focus and dismissal with other controls |
| Clips, shares, and composers | `social.js`, `reblog.js` | Attribution, audience choice, readable notes, common reader shell | Next: keyboard-operable image zoom and recoverable composer failures |
| People and recommendations | `highlights.js`, `social.js` | Context for shared stories and follow actions | Next: verify pending/empty states, long biographies, and focus after follow/save actions |
| Public Space and print shop | `space.css`, `space-format.js`, `social.js` | Distinct formats and personal identity | Later: rem-based functional text and retained focus during preference saves |
| Account, consent, sign-in, invites | `page.ts`, `account.ts`, `auth/oauth.ts`, `link/signin.ts`, `admin.ts` | Shared script-free shell, explicit account actions | Later: consistent task typography and local form feedback; preserve all legal/auth copy and routes |
| Admin dashboard | `src/ui/admin.html` | Semantic headings, bounded table scrolling, text statuses | Later: initial loading and per-row action states |
| Landing, support, policies | `site.ts`, `web-brand.css` | Specific brand, real screenshots, self-hosted assets | Later: scope type and motion to persuasion versus sustained reading |

## First reading pass

| Before | After | Why |
| --- | --- | --- |
| Copy appears only when code has a label or language | Every code block has Copy; denied clipboard selects the exact source text | An extracted command should be as useful as a labeled example |
| Heading sizes use fixed pixels | Title and section hierarchy use rem and existing type tokens | Respect text preferences and distinguish sections from prose |
| Docs outline disappears in narrower cards | Compact On this page uses the actual rendered heading identities | Navigate long guides in the same chat frame where they open |
| Docs contents only toggles visibility | Expanded state is announced; search is brought into view; close returns focus | Opening navigation should bring the reader to a usable destination |
| Docs and inline section jumps scroll only | Destination headings receive focus below persistent controls | Keyboard navigation and visible reading position should agree |
| Sidebar entries act as buttons without URL targets | Real URL/hash links and current-page announcements retain in-app handlers | Restore familiar navigation semantics |
| Passage actions have unbounded width; Escape may also exit | Action bar wraps inside the viewport; local controls dismiss first | Preserve context on small screens and during repeated reading actions |
| Previous page outline remains while loading another page | Outline clears during loading; page reports busy state | Avoid offering stale destinations |

## Discovery pass

| Before | After | Why |
| --- | --- | --- |
| Docs search only finds pages and symbols | Find searches the current title and authored content, with counts and Previous/Next | Locate a detail while staying in the page |
| One fixed prose size and measure | Three text sizes and two line widths, shared across article/docs navigation in this session | Let readers choose their comfort without changing room controls |
| Browser find and Escape have no page-specific workflow | Ctrl/Command+F from the reader, Enter/Shift+Enter, explicit Close and focus return | Keep repeated actions instant and predictable |

## Follow-up reading capabilities

The first discovery pass implements page find and session-local reading comfort. Remaining capabilities need focused design and implementation:

1. **Find within the rendered page.** Implemented for titles and authored blocks, with match count, next/previous, keyboard controls, and a separate docs title/symbol search. Queries stay local; searches display at most 1,000 matches and report the cap.
2. **Reading preferences.** Session-local text size and line width controls follow article/docs navigation, with Reset. The profile has no reading settings; durable preferences remain a future profile/tool proposal.
3. **Better extraction coverage.** Evaluate syntax-rich examples, diagrams, math, admonitions, definitions, and complex tables against representative open source manuals. Preserve authored content before adding visual interpretation.
4. **Website fallback and diagnosis.** Give unsupported or partially extracted pages clear source actions and recovery. Render extracted content faithfully without executing the publisher's application.
5. **Stable navigation context.** Consider section position indicators and heading permalinks that can be carried into handoffs, without introducing a second competing history system.

Validate each next pass against real article and GitHub documentation examples, narrow and wide MCP frames, dark mode, increased text size, keyboard focus, failed requests, and existing reading restoration tests. A responsive viewport does not prove physical touch gestures or screen-reader behavior.
