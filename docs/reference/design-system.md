# Design system

The tokens, type, colors, components and page shells every MCPortal surface shares: the room and its cards, and the standalone web pages. The brand itself (marks, wordmark, inks, voice) is in [brand/README.md](../../brand/README.md).

## Files

| File | Role |
|---|---|
| [`design/tokens.json`](../../design/tokens.json) | The source of truth for every token |
| [`scripts/design.ts`](../../scripts/design.ts) | Validates the tokens and generates the files below |
| `src/ui/design/tokens.css` | Generated CSS custom properties, inlined into the room |
| `src/ui/design/palettes.js` | Generated light and dark palettes for the theme controller |
| `src/design/generated.ts` | Generated exports for the web pages and brand script |
| `src/ui/design/primitives.css` | Hand-written shared control rules (focus, targets, preferences) |
| `src/ui/design/theme.js` | The theme controller: maps host inputs onto tokens |
| `src/ui/web-brand.css`, `src/web-brand.ts` | The standalone pages' masthead, card, footer and embedded font |

Run `npm run design` after editing `tokens.json` or `primitives.css`, and commit the generated files. `npm run design:check` and the test suite fail if they drift. The server runs from a checkout with no build step.

### Token format

`tokens.json` uses a validated subset of the [DTCG 2025.10 format](https://www.designtokens.org/tr/2025.10/format/): opaque sRGB colors, dimensions, durations, numbers, font weights, font families, strings, and whole-value `{group.token}` references. Every token states its `$type`. Composite tokens, inherited types and external references aren't supported. The generator rejects missing references, cycles, mismatched types, duplicate CSS names and unsafe values.

Token paths become CSS names with an `--mp-` prefix, in kebab case: `action.onPrimary` becomes `--mp-action-on-primary`.

## Token layers

| Layer | Tokens | Use |
|---|---|---|
| Brand | `brand-paper`, `ink`, `teal`, `mustard`, `brick` | Artwork and print identity, not functional text |
| Primitives | `space-*`, `radius-*`, `font-*`, `type-*`, `weight-*`, `line-*`, `duration-*`, `ease-*`, `layer-*` | Sizing, type, spacing, motion, stacking |
| Semantic | `surface-*`, `text-*`, `border-*`, `action-*`, `focus-ring`, `status-*`, `source-*` | Functional meaning, with light and dark values |
| Component | `control-*`, `icon-*`, `reader-*`, `portal-*`, `card-*` | Control targets, reading measure, room dimensions |
| Web | `web-*` | The standalone pages' paper-and-ink palette |

Some geometry stays local on purpose: SVG coordinates, photo overlays, display type, print shadows and masonry sizes.

## Scales

| Group | Values |
|---|---|
| Space | 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40 px |
| Radius | `xs` 4, `sm` 6, `control` 8, `card` 10, `lg` 12 px |
| Control | `height` 26, `minimum` 24, `touch` 44 px |
| Icon | `small` 14, `normal` 16 px; stroke 1.75 |
| Motion | `duration-fast` 150 ms, `duration-feedback` 200 ms, `ease-standard` ease-out |
| Layers | `layer-sticky` 5, `layer-toast` 10 |
| Room | `portal-column-width` 18rem, `portal-padding` 10px, `card-width` 13.5rem, `card-height` 9.375rem, `card-media-height` 13.375rem |

## Type

| Token | Value |
|---|---|
| `font-ui` | System sans (`ui-sans-serif, system-ui, …`) |
| `font-mono` | System mono (`ui-monospace, "SF Mono", Menlo, monospace`) |
| `font-heading` | `"MCPortal Jost", Jost, Futura, sans-serif`, for the web pages |
| `type-11` to `type-22` | 0.6875rem to 1.375rem; the name is the pixel size at a 16px root |
| `weight-*` | `normal` 400, `medium` 500, `strong` 600, `heading` 700 |
| `line-*` | `ui` 1.45, `body` 1.6, `heading` 1.2 |
| `reader-*` | `measure` 50rem, `line` 1.65 |

Type sizes are in `rem`, and the room's root stays at 100%, so the user's text size is respected. In the room, the host may override `font-ui` and `font-mono`.

## Color

Semantic colors, light and dark. The light set is the house palette in a host that supplies none.

| Role | Light | Dark |
|---|---|---|
| `surface-canvas` | `#FFFFFF` | `#161616` |
| `surface-inset` | `#F5F5F2` | `#1D1D1C` |
| `surface-hover` | `#EFEFEB` | `#242423` |
| `surface-selected` | `#E4E9E6` | `#2C3330` |
| `text-primary` | `#1B1B1A` | `#ECECEA` |
| `text-secondary` | `#646460` | `#A5A59F` |
| `text-link`, `action-primary`, `focus-ring` | `#1D6B63` | `#5FB0A4` |
| `action-on-primary` | `#FFFFFF` | `#1F2A36` |
| `action-danger` | `#B91C1C` | `#F87171` |
| `border-control` | `#777772` | `#80807A` |
| `border-divider` | `#E3E3DE` | `#343432` |
| `source-saved` | `#8A6100` | `#E0A526` |
| `source-clips` | `#1D6B63` | `#5FB0A4` |
| `source-following` | `#A73B27` | `#F29883` |
| `source-pinned` | `#1F2A36` | `#C7D3DE` |
| `web-canvas` | `#F2E6CF` | `#1F2A36` |
| `web-text` | `#1F2A36` | `#F2E6CF` |
| `web-link` | `#1D6B63` | `#E0A526` |

The full set, including `status-*`, `surface-raised`, `surface-input` and the remaining `web-*` roles, is in `tokens.json`.

Photographs, clipped images and generated artwork keep their own colors. Nothing inverts a whole surface or filters content images.

## Theme contract

`src/ui/design/theme.js` resolves the room's whole palette before the view renders. It accepts only these host inputs:

| Host input | Becomes |
|---|---|
| `--color-background-primary` | `surface-canvas`; other surfaces derive from it |
| `--color-background-secondary` | `surface-inset`, if primary text is readable on it |
| `--color-text-primary`, `--color-text-secondary` | `text-primary`, `text-secondary` |
| `--color-text-info` | `text-link` |
| `--color-border-primary` | `border-control` |
| `--font-sans`, `--font-mono` | `font-ui`, `font-mono` |
| `--border-radius-lg` | `radius-card`, clamped to 0–24px |

Rules:

- Unknown host properties never enter the `--mp-` namespace.
- Colors resolve to opaque sRGB. Translucent, invalid or unsafe values fall back to the house palette. A `var()` may refer only to another known color input.
- Text and status or source labels need 4.5:1 against every surface they appear on, including hover, pressed and selected. Control borders and focus need 3:1. A failing host color is replaced with a house role or a readable black or white. Decorative dividers are softer by design.
- A partial update keeps the other valid inputs. A light/dark switch clears color overrides but keeps fonts and radius. A blank input resets that override. Display-mode changes don't touch the theme.
- With no host scheme, the room follows the operating system. `color-scheme` themes native form controls too.

Contrast checks alone don't establish WCAG conformance.

## Components

| Surface | Contract |
|---|---|
| Welcome packs | Opaque canvas; selected state shown by border and icon; all text visible without hover |
| Toolbar and icon actions | Shared sizes; labeled actions; visible focus and pressed state |
| Portal rows and shelf cards | One button opens the content; metadata links and save/share actions are separate; no nested controls |
| Metadata | Secondary text stays readable in hover and selected states; save is always visible |
| Add-source sheet and composers | Real inputs and placeholders; control borders; disabled feedback |
| Reader and docs | Shared measure and type; code and tables scroll on their own; contents drawer adapts to the container |
| Clips, shares, Spaces | Same text and control roles; a user's accent colors borders, never buttons |
| Account, sign-in, admin | Shared primitives; destructive actions use the danger pair |

Shared rules, in `primitives.css`:

- Controls are at least 24px, 44px on coarse pointers.
- Focus is a 2px outline with a 2px offset. Selection never relies on hue alone.
- Buttons are visible without hover. Navigation uses real links; link-like controls respond to Enter and Space.
- Increased contrast strengthens secondary text and borders. Forced colors use system colors. Reduced motion removes transitions, including scripted scrolling.
- Layouts wrap. Container queries add to viewport fallbacks rather than replace them.

## Standalone pages

Every page outside the room shares one shell, `page()` in [`src/page.ts`](../../src/page.ts): a brand masthead, a content card with a print shadow, one `h1`, and a Help, Privacy, Terms and Security footer. Pages are self-contained: the logo is inline SVG, and the favicon and Jost font are data URIs. No CDN, tracker or script.

| Page | Rendered by |
|---|---|
| Landing, privacy, terms, security, support | [`src/site.ts`](../../src/site.ts) (its own paperback layout) |
| OAuth consent and hosted sign-in errors | `src/auth/oauth.ts` |
| Local sign-in result (on the loopback callback) | `src/link/signin.ts` |
| Account, downloads, imports, deletion | `src/account.ts` |
| Invites; admin sign-in | `src/admin.ts` |
| Admin dashboard | `src/ui/admin.html`, with the same masthead and footer |
| Browser 404 | `src/http.ts` |

`page()` options:

| Option | Effect |
|---|---|
| `door` | A decorative plate over the card: `open` for welcomes and good news, `shut` for failures and expired links. Hidden in forced-colors mode |
| `kicker` | A short line over the heading. Pulp for good news, plain for failures, none for consent, deletion or account text |
| `wide` | A wider card, for the signed-in account page |
| `style` | Extra CSS for that page |
| `siteUrl` | Origin for the masthead and footer links (the local callback page points them at the hosted site) |

`handshake()` draws the consent screen's app-and-mark row. The door plates are `brand/door-open.svg` and `brand/door-shut.svg`, generated by `npm run brand`.

The page CSP allows inline styles and embedded images and fonts only. The local callback page can't assume a deep link back to the agent, so it tells the person to return to their app; its help links go to the hosted site.

## Checking changes

1. Run `npm run design:check`, `npm test` and `npm run typecheck`.
2. Run `node scripts/design-preview.ts` and open `http://127.0.0.1:8799`. It binds to loopback, uses in-memory profiles and offline fixtures, and loads the real MCP App resource over JSON-RPC. It also serves the standalone pages: consent, local sign-in results, invites, imports and admin.
3. Click **Run browser checks**. The matrix covers each surface at narrow and wide inline sizes in light and dark, with complete, theme-only, background-only, hostile and absent host inputs, and repeats at 200% text. It checks opaque backgrounds, render errors, contrast, visibility, target size, nesting, focus, image filters and `rem` shrinkage.
4. Use **Theme-only switch** and **Reset inputs** to check theme updates. Keyboard through cards and metadata. Screenshots supplement the measurements; they don't replace them.

The preview doesn't prove behavior in a real host, OS high-contrast modes or assistive technology. Check those by hand before a release; see [host compatibility](host-compatibility.md#certifying-a-host).
