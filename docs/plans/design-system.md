# Plan: design system and adaptive theming

Implementation: the six foundation phases below are delivered in the shared token source, generator, theme controller, migrated surfaces and fixture regression host. See [the contributor guide](../design-system.md) for exact contracts, validation and remaining environment-specific release smoke checks. The roadmap remains the rationale for future component work.


**Status:** proposed, 2026-09-30. The immediate iframe visibility fix is merged in [PR #5](https://github.com/lbliii/mcportal/pull/5). This plan defines the next implementation sequence and its acceptance criteria.

## Product goal

MCPortal should remain recognizably your room whether it appears in a chat card, fullscreen, or on the web. A single article, docs page, clip, share, or source portal should feel like a piece of the same place. Layout adapts to the available container; content, navigation, identity, and interaction states remain predictable.

Preserve the existing mid-century print identity: paper, ink, teal, mustard, brick, the Line icons, and source-specific art. Adapt functional surfaces and readable colours around that identity. Photos, shared images, diagrams, and original artwork retain their colours. Avoid blanket inversion.

## Current foundation and gaps

The room already has light/dark fallback colours, host variables, source inks, columns and shelves, several chat-card surfaces, and generated brand assets. PR #5 adds an opaque inline canvas, restricts host token namespaces, derives contrast with modern CSS where available, and handles increased-contrast/forced-colour preferences.

Remaining gaps:

- Generic names such as `--bg`, `--fg`, and `--surface` do not describe enough roles; spacing, type, radii, control sizes, and motion are mostly component literals.
- Room CSS, public-page CSS, account/admin/auth pages, and brand generation maintain overlapping values independently.
- Host variables are applied directly and retained. A theme-only update can leave colours from the previous theme; invalid, incomplete, or poorly contrasted host palettes need a defined policy.
- `contrast-color()` chooses black or white. It cannot inspect the parent iframe's backing, validate every supplied host pairing, or guarantee that a mixed muted colour remains readable.
- Keyboard focus frequently shares hover styling with no distinct outline. Some controls are 22px, and unsaved bookmark actions depend on hover/focus.
- Current host-context tests protect inputs; visual validation used a temporary fixture host. A reusable browser fixture is needed for rendering regressions.

## Decisions

1. Use one versioned, typed token source and committed generated outputs. Runtime startup continues to need no build step.
2. Prefix all product tokens with `--mp-`. Host variables enter through an explicit adapter; components never consume arbitrary host variables directly.
3. Treat a theme as a coherent set of colour pairs. Resolve and validate that set before applying it to the view.
4. Keep CSS responsible for presentation and platform preferences. A small theme controller handles host updates, validation, and contrast fallback; no model call is needed to choose readable colours.
5. Components use semantic roles. Source identity and decorative art have separate tokens from readable labels, actionable borders, and focus states.
6. Introduce tokens and component contracts incrementally in the current HTML/JS architecture. A framework migration is unnecessary for this work.

## Token architecture

| Layer | Examples | Responsibility |
|---|---|---|
| Primitives | `brand.paper`, `brand.ink`, `brand.teal`, `space.2`, `radius.sm`, `duration.fast` | Raw house values and reusable scales |
| Semantic | `surface.canvas`, `surface.card`, `text.primary`, `text.secondary`, `border.control`, `action.primary`, `action.onPrimary`, `focus.ring` | Purpose, contrast, and light/dark mapping |
| Component aliases | `control.height`, `reader.measure`, `portal.padding`, `card.mediaHeight` | Recurring component needs; avoid an alias for every CSS declaration |
| Identity | `source.saved`, `source.clips`, `source.following`, `art.paper`, `art.ink` | Source recognition and artwork, separately from functional colour pairs |

CSS names follow those roles: `--mp-surface-canvas`, `--mp-text-secondary`, `--mp-action-on-primary`, `--mp-control-height`, and `--mp-reader-measure`.

The initial set covers:

- **Surfaces:** canvas, card, inset, raised, input, hover, pressed, selected, and overlay.
- **Text and borders:** primary, secondary, link, placeholder, inverse, decorative divider, control boundary, and selected boundary.
- **Actions and status:** primary/foreground pair, danger/foreground pair, focus ring, success, warning, error, loading, and unread marker.
- **Typography:** UI/body/mono families; small, metadata, body, heading, and reading sizes; weight, line height, and maximum reading measure. Reading sizes use scalable units.
- **Geometry:** a small spacing scale, radii, icon sizes/strokes, control targets, density, and intentional stacking layers.
- **Motion:** short feedback durations and easing, plus reduced-motion replacements.

Author `design/tokens.json` with the supported `$type`, `$value`, `$description`, and alias conventions from the [Design Tokens Format Module](https://www.designtokens.org/tr/2025.10/format/). Document the supported subset; do not claim complete format conformance without validating it. The generator rejects unknown types, missing aliases, cycles, duplicate emitted names, and invalid values. Use a small Node script initially; add tooling only when it solves an identified limitation.

Proposed files:

| File | Purpose |
|---|---|
| `design/tokens.json` | Authoritative primitives, semantic mappings, and descriptions |
| `scripts/design.ts` | Validate tokens and generate deterministic outputs |
| `src/ui/design/tokens.css` | Committed CSS tokens, inlined into the MCP App |
| `src/design/generated.ts` | Committed shared exports for public-page styles and brand generation |
| `src/ui/design/theme.js` | Small host adapter/controller, inlined and tested as a complete file |
| `src/ui/design/primitives.css` | Shared control and content primitives, inlined into the MCP App |
| `docs/design-system.md` | Usage rules, theme precedence, components, and contribution guidance |

Extend `roomHtml()`'s existing include mechanism to inline these local assets. Preserve its self-contained resource and current CSP. Brand generation consumes shared primitives while retaining its established geometry and approved artwork; generated brand files continue to be regenerated, never edited by hand.

## Adaptive theme contract

Separate four independent decisions: colour scheme, palette, density, and motion. Fullscreen changes layout; it does not silently select a different colour scheme.

**Scheme precedence:** forced-colour accessibility mode; an explicit user scheme choice, if that setting is added; host `light`/`dark`; system preference. The initial release can keep the existing host/system scheme selection. Persist only user choices, never the currently resolved host palette.

**Palette precedence:** system colours in forced-colour mode; valid host colour pairs in follow-host mode; contrast-safe derived pairs; complete house fallback. Explicit light/dark user overrides use the corresponding house palette when the host supplies a conflicting palette. User/source accents decorate a validated palette and never replace text or canvas colours directly.

Map a finite list of host variables from the [MCP Apps host styles contract](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiHostStyles.html) into internal roles. Accept validated colours, bounded dimensions, and supported font values. Ignore unknown variables; reject invalid or fully transparent canvas values. Resolve aliases before checking pairs and do not inject arbitrary host CSS. Continue checking that bridge messages come from `window.parent`.

Define update semantics explicitly:

- Initialization creates a complete palette even with no host context.
- Partial notifications preserve unrelated values within the same scheme.
- A scheme change invalidates previously applied scheme-specific host colours; new colours in the same notification are applied together. Fonts and geometry can persist.
- An explicit empty/reset value clears the tracked host value and returns that role to its derived or house fallback.
- Display-mode-only and container-size updates leave the palette intact.
- Prepare one resolved palette, then apply it together. Avoid visible mixed states and feedback loops with the size observer.

### Contrast and CSS

Use `color-scheme` for native controls and system preference support. Consider `light-dark()` to simplify authored semantic pairs, retaining explicit fallbacks for supported embedded engines. Keep `contrast-color()` behind feature detection; it is an enhancement, not the correctness boundary.

Validate known semantic pairs: primary and secondary text against each surface where they appear, link text, action labels, input/placeholder text, selected states, and focus indicators. Aim for normal text at least 4.5:1, large text at least 3:1, and meaningful control boundaries/indicators at least 3:1 against adjacent colours, following [WCAG 2.2](https://www.w3.org/TR/WCAG22/#contrast-minimum) and [non-text contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast). Decorative dividers need not meet a control-boundary requirement. Disabled states remain visibly distinguishable and have readable status copy where needed.

If a host pair fails, preserve the valid opaque background and choose a readable foreground. Derive secondary colours only if they meet the text threshold; otherwise use the primary foreground. On engines without native contrast selection, use a small, deterministic luminance calculation after resolving supported colours into sRGB, with a tested house-palette fallback when conversion is unavailable. Re-evaluate on theme updates, not mouse movement or every rendered item.

Increased-contrast preferences strengthen secondary text, functional borders, and focus. Forced colours use system tokens and retain clear selected/focus cues. Reduced motion removes nonessential fades and transitions. No blanket filters on media. A CSS function cannot discover an unseen parent backing: all readable app surfaces must still paint an opaque, known background.

## Component and interaction contracts

Start with buttons/icon controls, inputs, segmented controls, chips, cards, portal frames, notices, skeletons, and focus treatment. Each specifies default, hover, focus-visible, pressed/selected, loading, disabled, empty, and error states where relevant. Hover supplements an already visible control or content state.

Set a product baseline of 24px minimum control targets and aim for 44px for primary touch controls. Preserve scan density through spacing and hit areas rather than shrinking actionable targets. Selected state combines shape/icon/text with colour. Keep a distinct keyboard focus ring visible and unobscured. Avoid nested interactive elements as components are migrated.

Build layouts around the actual card/container width with container queries and tested fallbacks. Keep columns/shelves as deliberate reading arrangements, but prevent essential toolbar actions and reader navigation from being clipped. Test text resizing, narrow cards, touch input, and long titles/code blocks.

The agent can summon a room, portal, item, or collection using the same primitives. Each surface should expose a consistent title/context, current selection, actions, loading/error state, and route back. Theme work establishes their visual contract; conversational navigation and new surface tools can build on it separately.

## Delivery sequence

| Phase | Scope and files | Exit criterion |
|---|---|---|
| 1. Inventory and tokens | Inventory literals across `room.html`, `site.ts`, account/admin/auth UI, and brand scripts; create token source/generator and contributor guide | Deterministic outputs; validated references; existing visual baselines preserved |
| 2. Theme controller | Extract host handling; map exact host tokens; implement lifecycle, contrast repair, and legacy fallbacks | All missing/partial/invalid/theme-change cases produce coherent readable palettes |
| 3. Controls and room | Migrate welcome, toolbar, add-source sheet, columns, shelves, cards, metadata, and notices | Visible content before hover; consistent focus, selection, control sizes, and status states |
| 4. Reading and social surfaces | Migrate reader, docs, clip, share, Space, and composer; use container-aware layouts | Same semantics across inline/fullscreen; content/media colours preserved; keyboard and narrow-layout checks pass |
| 5. Web surfaces | Share semantics with landing, support/privacy, account/admin, and OAuth pages while retaining their stronger brand presentation | Repeated controls and colours share definitions; destructive/account states remain plain and clear |
| 6. Regression gates | Promote fixture host into reusable harness; add generation, contrast, accessibility, and browser checks | A new source or host theme cannot silently reintroduce invisible content or inaccessible functional states |

Prefer one small PR per phase, splitting phase 3/4 by surface if needed. First implementation should be phase 1, then phase 2 before further visual redesign. New token and component naming is internal; profile storage and tool names do not need migrations.

## Verification and acceptance

Build a fixture-only MCP Apps host that uses the actual `roomHtml()` and JSON-RPC bridge. Exercise welcome, populated columns/shelves, reader, docs, clip, share, and Space fixtures, with light/dark complete palettes, theme-only context, no context, background-only context, invalid/transparent colours, internal-name collisions, theme changes with omitted variables, and explicit resets.

Run representative surfaces through black/white parent backings, inline/fullscreen, narrow/wide containers, and native contrast support enabled/disabled. Measure computed colours and geometry; screenshots supplement assertions rather than replacing them. Keep actual Codex and Claude smoke checks as separate evidence from the simulated host. Include Chromium and WebKit browser coverage when the available test environment supports both.

Acceptance gates:

- All content and essential actions visible at first paint, without hover.
- Validated functional colour pairs meet their documented thresholds in default, hover, selected, and focus states.
- Theme-only updates never retain the previous scheme's host colours.
- Missing/invalid host tokens and absent modern CSS features have deterministic, readable fallbacks.
- Keyboard navigation, visible focus, touch targets, increased contrast, forced colours, reduced motion, and text resizing work on representative surfaces.
- Photographs, clips, and brand artwork are not inverted or generically recoloured.
- MCP App remains self-contained; no new third-party network/font/style requests.
- `npm test`, typecheck, token-generation drift checks, and browser assertions pass. No claim of WCAG conformance from colour checks alone.

The first milestone is a welcome screen, room toolbar, and populated portal that share semantic tokens and survive hostile or incomplete host theme inputs. That makes subsequent design changes both safer and cheaper.
