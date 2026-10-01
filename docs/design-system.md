# MCPortal design system

The room and chat cards adapt to the host while keeping the portal's print-inspired identity. Functional colours are measured as pairs; photographs, clipped images and generated brand artwork retain their original colours.

## Source and generated assets

`design/tokens.json` is the version 1 authoring source. It uses an explicit, validated subset of the [DTCG 2025.10 format](https://www.designtokens.org/tr/2025.10/format/): opaque structured sRGB colours, dimensions, durations, numbers, font weights, font families, strings, and whole-value `{group.token}` references. Every token has an explicit type. Composite tokens, inherited types and external references are currently unsupported. The generator rejects missing references, cycles, mismatched types, duplicate CSS names and unsafe values.

Run `npm run design` after editing tokens or `src/ui/design/primitives.css`. Commit the generated CSS, plain-script palettes and TypeScript exports. `npm run design:check` and the test suite detect drift. Production still starts directly from a checkout; neither compilation nor new dependencies are required.

| Layer | Tokens | Use |
|---|---|---|
| Brand | `--mp-brand-paper`, `ink`, `teal`, `mustard`, `brick` | Artwork and print identity; not arbitrary functional text colours |
| Primitives | `space-*`, `radius-*`, `font-*`, `type-*`, `weight-*`, `line-*`, `duration-*`, `ease-*`, `layer-*` | Shared sizing, typography, spacing, motion and stacking |
| Semantic | `surface-*`, `text-*`, `border-*`, `action-*`, `focus-ring`, `status-*`, `source-*` | Functional meaning in light and dark palettes |
| Component | `control-*`, `icon-*`, `reader-*`, `portal-*`, `card-*` | Control targets, reading measure and room dimensions |
| Web variant | `web-*` | Paperback site palette, sharing common controls and primitives |

All emitted properties start with `--mp-`. Local art inks, source decoration and layout helpers use the same prefix, but are owned by their surface rather than host inputs. Some one-off geometry remains local: SVG coordinates, photographic overlays, responsive display type, asymmetric print shadows and masonry dimensions are intentional, not palette definitions.

## Theme contract

`src/ui/design/theme.js` resolves the entire functional palette synchronously, before view rendering. It accepts exactly these MCP host inputs:

| Host input | Product role |
|---|---|
| `--color-background-primary` | Canvas; other surfaces derive from it |
| `--color-background-secondary` | Inset, if readable with primary text |
| `--color-text-primary` / `--color-text-secondary` | Primary / secondary text |
| `--color-text-info` | Links |
| `--color-border-primary` | Control boundary |
| `--font-sans` / `--font-mono` | Bounded font-family overrides |
| `--border-radius-lg` | Card radius, 0–24px |

Unknown host properties never enter the product namespace. Direct opaque hex/RGB values work without browser colour APIs. Other browser-supported colours are resolved into opaque sRGB through a local canvas; translucent, invalid, contextual and unsafe values fall back to the house palette. `var()` references may refer only to another known colour input; cycles and external references are rejected.

Text and functional status/source labels require at least 4.5:1 against every candidate surface, including hover, pressed and selected. Control boundaries and focus require 3:1; action text requires 4.5:1 against its action background. An incoherent supplied colour is repaired using a house role or readable black/white foreground. Decorative dividers are deliberately softer. This resolver is independent of native `contrast-color()` support.

A partial context retains unrelated valid inputs. A changed light/dark scheme clears previous colour overrides before consuming the new palette, while retaining typography and radius. Null or blank inputs explicitly reset that override. A scheme follows the OS until the host explicitly selects one. Display-mode changes do not change the theme. `color-scheme` also themes native form controls.

## Surface and component contracts

| Surface / component | Contract |
|---|---|
| Welcome packs | Opaque canvas; selected boundary and icon; all descriptive text visible before hover |
| Toolbar / icon actions | Shared sizes; labelled actions, visible focus and pressed state |
| Portal rows / shelf cards | A real content-opening button separate from metadata links and save/share actions; no nested controls |
| Metadata / provenance | Secondary text readable in normal, hover and selected states; save actions always available |
| Add-source / composer | Input and placeholder semantics, control borders, disabled action feedback |
| Reader / docs | Shared readable measure and type; local code/table scrolling; container-aware contents drawer and wide sidebars |
| Clips / shares / Space | Same text/control roles; user accents decorate borders rather than recolouring functional buttons |
| Account / OAuth / admin | Shared primitives and semantic palettes; destructive action uses danger/on-danger pairing |
| Public site | Shared brand source and control semantics, with its stronger paper/ink presentation |

Controls have a 24px minimum target, raised to 44px for coarse pointers. Icon buttons use the common height token. Focus is a visible 2px outline with offset; selection uses more than hue. Action colours remain paired when pressed. Buttons stay discoverable without hover. Link-like controls without destinations respond to Enter and Space; actual navigation uses links.

Type tokens use `rem`; the room's root stays at `100%` so user text sizing is preserved. Reading measures and flexible containers allow wrapping; tables, code and room columns scroll locally when their contents require it. Container queries supplement existing viewport fallbacks rather than making old engines lose layouts.

Shared CSS handles increased contrast, forced system colours, coarse pointers and reduced motion. JavaScript scrolling honours reduced motion too. Do not invert an entire surface or apply blending/filtering to content images.

## Regression workflow

1. Run `npm run design:check`, `npm test` and `npm run typecheck`.
2. Run `node scripts/design-preview.ts` and open `http://127.0.0.1:8799`. It binds only loopback, uses in-memory profiles and offline fixtures, and loads the actual self-contained MCP App resource through JSON-RPC.
3. Click **Run browser checks**. The 80-case matrix covers welcome, columns, shelves, reader, docs, clip, share and Space; 360px/light and 1000px/dark frames; complete, theme-only, background-only, hostile and absent host inputs. Parent backing deliberately opposes the requested theme. Assertions cover opaque backing, render errors, control text contrast, visibility, target size, nesting, focus, image filters and accidental `rem` shrinkage. Each case also repeats these assertions at 200% text sizing; card actions must stay inside their card.
4. Use **Theme-only switch** and **Reset inputs** for lifecycle checks. Open a clip's share composer, keyboard through cards and metadata, and inspect web/auth/admin via the host's links. Screenshots supplement the measurements.

The initial implementation was checked in Codex's WebKit in-app browser. Chromium, actual Claude/Codex MCP host attachment, OS forced-colour/high-contrast settings and assistive-technology checks remain environment-specific release smoke checks; the local host does not prove them. Palette tests and CSS preference contracts run without native modern colour support. Contrast checks alone do not establish WCAG conformance.

Implementation roadmap: [design-system plan](plans/design-system.md).
