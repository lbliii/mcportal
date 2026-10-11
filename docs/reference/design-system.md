# Design system

MCPortal has a modular design system in plain CSS and typed JavaScript, with no runtime framework dependency. The room and development catalogue execute the same components. Generated tokens, component contracts and drift checks make the compact direction enforceable. The brand (marks, wordmark, inks and voice) is in [brand/README.md](../../brand/README.md).

## Direction

Make the room the starting point, keep its chrome compact, and reveal optional work in context. Density should free space for content, not create more choices.

- **Global navigation:** Room and Library, with occasional destinations under More. Settings contains persisted preferences (layout, reading defaults, account). Do not add a top-level tab for every capability.
- **Contextual controls:** Source display options live with the open source; Compare appears with selected material; reading tools live with the reader. Keep a control's position stable when it becomes active. Reveal secondary controls on hover **and keyboard focus**, with a touch path, only when their discovery is nonessential.
- **Symbols and writing:** Use familiar action icons with an accessible name and fast hint. Keep short text for ambiguous destinations, commitments and errors. Avoid redundant room titles, category kickers and explanatory labels. A tooltip does not replace a field label, error message or the selected value.
- **Compact application chrome:** Start with 24px small actions, 28px controls, 32px fields, 4–8px gaps and 12px panel padding. Use minimum heights for text controls so larger text can grow. Primary, danger, selected and busy variants keep the same geometry.
- **Comfortable content:** Reading measure, article typography, cover art and public landing/consent pages have different jobs. Do not halve everything. Bigger controls need a reason (touch, input, consequential public-page action), not just a new component.
- **Reuse before adding:** Compose the shared primitives, then use semantic roles. Use a primitive scale token for a one-off local spacing choice. Introduce a new semantic token only when several components share the same purpose. SVG coordinates, illustrations and editorial geometry remain local.

### Compact task contracts

- `uiScreenHeader`: 18px title, optional named back icon, wrapping action group. Keep task instructions at the field or empty state; omit decorative kickers and slogans.
- `uiSplitPane`: main and supporting content stack when their available width or text scale requires it. Avoid page-width breakpoints that leave embedded panes too narrow.
- `uiSearchRow`: search keeps at least 16rem when available; adjacent actions wrap before the input becomes unusable.
- `uiResultRow`: one title action, independent selection, metadata and at most two excerpt lines. Full content, match explanation and reading actions belong in the preview.
- Checkbox/radio glyphs stay 14px. The containing label provides the 28px default or 44px coarse-pointer target. Do not enlarge the glyph to the target size.
- Space appearance and visibility live behind **Customize**. The mounted editor preserves drafts as the preview updates; a failed preview refresh retries the read without repeating the save. The Space's authored title and cover keep their editorial scale.

Product CSS may place these patterns but cannot redefine their internal density. Source checks protect their named classes; browser tests check the resulting layout, including inherited styles.

### Architecture and adoption

Dependencies flow in one direction: **foundations → primitives → patterns → product views**. Components receive labels, values and callbacks; product views own tool calls, persistence and navigation. The independently type-checked catalogue has no room state.

| Layer | Implementation and adoption |
|---|---|
| Foundations | `design/tokens.json`, generated palettes, shared base preferences and host theme normalization |
| Primitives | `src/ui/design/components/`: buttons, icon actions, fields, toggles, tabs, pills, disclosures, dialogs, menus and delegated tooltips |
| Patterns | `src/ui/design/patterns.js` / `.css` and `document.css`: action groups, settings rows, metadata, cards, feedback, trays, navigation, paging, compact task headings, responsive panes, search rows, result rows and reading content |
| Product views | `src/ui/room/`: room, reading layouts, account and optional activities; controls compose the layers above |
| Catalogue | `/controls`: production scripts, actual factory examples, contracts, light/dark, coarse targets and 200% text |

Reading settings use the shared row/toggle pattern. Settings and both navigation menus use shared overlay behavior. Ordinary account, Library, collection and watch actions use typed buttons; native room controls share uiControl, and mutation forms share validation, progress and error behavior. Collection and watch cards use the shared article/action structure. Item layouts share metadata composition and save/original/share actions. Library, collections and watches use shared feedback states.

Specialized reading layouts, evidence panes, source pickers and Space editors still own their composition. All dynamic room input, select and textarea creation goes through uiControl; mutation forms use uiForm. Space customization has a product coordinator shared by its form and instant preferences, so their writes serialize and a failed preview read cannot repeat a committed mutation. Admin invitations use the same modules. Search keeps its request-generation and cancellation behavior, including replacement source searches while an older request is pending. Their existing raw buttons are bounded by the per-file migration inventory in [`design/legacy-controls.json`](../../design/legacy-controls.json). New ordinary actions use the factories; lower the allowance when migrating existing ones. The inventory is a count guard, not proof that every local override is appropriate. Public pages retain script-free semantic HTML and shared CSS. Editorial geometry and brand art are intentional local compositions.

### Coverage and adversarial review

[`design/inventory.json`](../../design/inventory.json) is the coverage inventory, rendered directly in the live catalogue. Every family records its definition, variants, states, keyboard behavior, implementation evidence and follow-up. The build rejects incomplete entries, missing source files and registered components absent from the inventory. Inventory prose is included only in the catalogue, not the production room.

The October 2026 pass covers **40 families: 30 shared, 6 local, 4 reserved**. “Shared” identifies a reusable implementation, not complete migration of every caller. “Local” identifies a defined product composition with remaining adoption work. “Reserved” identifies a possible future need, not a component that exists today.

| Finding | Resolution |
|---|---|
| Catch up and other actions inherited an underlined `.link-btn` style | Retire that class; use quiet compact buttons. Fix quiet hover/pressed feedback. Reject the retired class in the build. Preserve underlined reading links. |
| Comparison tabs had click handling but no composite keyboard behavior | Shared tabs with one tab stop, arrows/Home/End, manual activation and named panels. Wide comparisons become named regions; narrowing preserves the focused source. |
| Pills conflated information and interaction | Passive `uiBadge` and interactive `uiChip` have separate contracts. Chip labels and dimensions stay stable when selected. |
| Disclosure spacing and markers varied across flows | Shared native details/summary; optional named groups provide exclusive accordions. Reader, docs, Library, collection setup, imports and watch settings use it. |
| Selection trays and drawers lacked distinct definitions | A tray is an inline action group; a drawer is a modal placement variant. Clearing selected material restores focus. |
| Document styles, navigation and paging were unregistered | Shared document CSS, destination links and previous/next pager; explicit separation between compact chrome and comfortable content. |
| A catalogue of implemented components hid absent families | Inventory includes all current families and reserved composites, with source evidence and follow-ups. |

#### Choose by behavior

| Job | Component and rule |
|---|---|
| Perform an action | `uiButton`; quiet for low emphasis, never an underlined pseudo-link |
| Open a destination | `uiNavLink` in application navigation; an ordinary underlined anchor in prose |
| Switch local panels | `uiTabs`; global Room/Library navigation is not a tablist |
| Choose one preference | `uiChoiceGroup` or native select; layout previews remain product-owned |
| Report status/tag | `uiBadge`; no focus stop or click handler |
| Toggle a selection/filter | `uiChip`; stable name, `aria-pressed`, visible checkmark |
| Reveal optional content | `uiDisclosure`; independent by default, common `name` for exclusive accordion sections |
| Offer short actions | `uiMenu`; forms and rich content require a different pattern |
| Contain a modal task | `uiDialog`, `modal` or `drawer`; focus containment and restoration |
| Offer contextual actions | `uiTray`; stays in document flow and does not trap focus |
| Read articles/docs | `.ui-document`, with compact navigation and toolbars outside the content |

These semantics follow the [WAI-ARIA tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [button](https://www.w3.org/WAI/ARIA/apg/patterns/button/) and [disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) patterns. The choice to avoid underlined interface actions is MCPortal's visual policy, not a claim that links are prohibited in applications.

#### Remaining gaps

Forms, rich popovers and toast/progress lifecycles now have shared implementations and production consumers. Product search owns timing/cancellation; inline reader panels retain their selection lifecycle. Reading forms, avatars/media, lane pagination and editorial layouts intentionally compose shared controls without becoming generic widgets.

No reusable command palette, combobox, tree, editable data grid, custom calendar or slider is claimed. Native fields cover today's needs. Introduce a composite only with a real product use, complete interaction contract, live example and behavioral regression tests. Vertical/closable tabs, removable chips and nonmodal drawers likewise require a new supported variant rather than an ad hoc class.

For every new component or variant, review: default/hover/focus/active; selected or expanded state; disabled/busy/error states where meaningful; accessible naming; keyboard and touch paths; focus after dismissal/removal; long labels; 320px width and 200% text; light/dark/forced colors/reduced motion; and whether its visible label adds information. This is a review matrix, not a requirement to invent nonsensical states for passive content.

## Files

| File | Role |
|---|---|
| [`design/tokens.json`](../../design/tokens.json) | The source of truth for every token |
| [`scripts/design.ts`](../../scripts/design.ts) | Validates the tokens and generates the files below |
| `src/ui/design/tokens.css` | Generated CSS custom properties, inlined into the room |
| `src/ui/design/palettes.js` | Generated light and dark palettes for the theme controller |
| `src/design/generated.ts` | Generated exports for the web pages and brand script |
| `design/components.json` | Component purposes, lifecycle, supported options, examples and ordered module lists |
| `design/inventory.json` | Coverage, definitions, variants, states, keyboard behavior, evidence and remaining work for 38 families |
| `src/ui/design/components/` | Owned CSS/JS modules for each primitive |
| `src/ui/design/patterns.js` / `.css` | Compositions shared across product flows |
| `src/ui/design/primitives.css` / `contracts.js` | Generated CSS bundle and typed option contracts; do not edit |
| `src/ui/design/catalogue.js` | Live examples, independently checked without product state |
| `scripts/design-controls.ts` | Live catalogue of the shipped primitives at `/controls` in the design preview |
| `src/ui/design/theme.js` | The theme controller: maps host inputs onto tokens |
| `src/ui/web-brand.css`, `src/web-brand.ts` | The standalone pages' masthead, card, footer and embedded font |

Run `npm run design` after editing tokens, the component registry, component modules or catalogue examples, and commit the generated files. `npm run design:check` and the test suite fail if they drift. The same check rejects undefined static `var(--mp-…)` references in source CSS and inline styles. Runtime properties must have a CSS declaration or a literal `setProperty()` assignment; dynamically constructed names and selector scope still need review. The server runs from a checkout with no build step.

### Token format

`tokens.json` uses a validated subset of the [DTCG 2025.10 format](https://www.designtokens.org/tr/2025.10/format/): opaque sRGB colors, dimensions, durations, numbers, font weights, font families, strings, and whole-value `{group.token}` references. Every token states its `$type`. Composite tokens, inherited types and external references aren't supported. The generator rejects missing references, cycles, mismatched types, duplicate CSS names and unsafe values.

Common-to-common aliases remain CSS `var()` references so root preference overrides propagate. Palette and brand exports are resolved values for contrast calculations and artwork.

Token paths become CSS names with an `--mp-` prefix, in kebab case: `action.onPrimary` becomes `--mp-action-on-primary`.

## Token layers

| Layer | Tokens | Use |
|---|---|---|
| Brand | `brand-paper`, `ink`, `teal`, `mustard`, `brick` | Artwork and public-page print identity; app controls use semantic roles |
| Primitives | `space-*`, `radius-*`, `font-*`, `type-*`, `weight-*`, `line-*`, `duration-*`, `ease-*`, `layer-*` | Sizing, type, spacing, motion, stacking |
| Semantic | `surface-*`, `text-*`, `border-*`, `action-*`, `focus-ring`, `status-*`, `source-*` | Functional meaning, with light and dark values |
| Component | `control-*`, `icon-*`, `toolbar-*`, `panel-*`, `tooltip-*`, `reader-*`, `portal-*`, `card-*` | Control targets, reading measure, room dimensions |
| Web | `web-*` | The standalone pages' paper-and-ink palette |

Some geometry stays local on purpose: SVG coordinates, photo overlays, display type, print shadows and masonry sizes.

## Scales

| Group | Values |
|---|---|
| Space | 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40 px |
| Radius | `xs` 4, `sm` 6, `control` 8, `card` 10, `lg` 12 px |
| Control | `minimum` 24, `height` 28, `field-height` 32, `touch` 44 px; padding 4px × 8px |
| Toolbar | `padding-block` 6, `padding-inline` 12 px; about 41px high in a single desktop row |
| Panel | `padding` 12, `section-gap` 16, `width` 320 px |
| Tooltip | `delay` 150ms, `dismiss-delay` 120ms, `offset` 4, `inset` 8 px |
| Icon | `small` 14, `normal` 16 px; `micro` 12 only for metadata; stroke 1.75 |
| Motion | `duration-fast` 150 ms, `duration-feedback` 200 ms, `ease-standard` ease-out |
| Toast | `duration` 6000ms, `max-duration` 20000ms; reading time scales with message length within these limits; errors have no timer |
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

Use the typed factories for interactive room code. `design/components.json` generates the supported option unions and runtime registry; unsupported variants, unknown icons and empty accessible names fail immediately. Fields keep native input behavior.

| API | Contract |
|---|---|
| `uiButton({label, emphasis, size, ...})` | `neutral` / `primary` / `danger` / `quiet`; `compact` / `default`; optional icon, pressed, disabled, busy, type and click callback |
| `uiBusy(button, boolean)` | Prevent duplicate submission, preserve the label/geometry and restore the prior disabled state; pair with `finally` |
| `iconButton(icon, label, onClick, options)` | Required accessible name; shared hint; 24px default or `{size:'default'}` for 28px; 14/16px glyphs |
| `uiControl(tag, attrs, ...children)` | Typed native input/select/textarea with the shared field class; product supplies a label or wraps it in uiField |
| `uiForm(form, {submit, onSubmit, pendingMessage?, validate?})` | Native validation and optional custom validation before locking, associated field errors, duplicate guard, pending progress, locked controls with original disabled states restored, persistent server error and retained draft; returns run/setError/destroy |
| `uiChoiceGroup({label, value, choices, name?, onChange?})` | Named native segmented radios; returns element and inputs; arrow and Space behavior stays native |
| `uiPopover(panel, trigger, options?)` | Named nonmodal rich content, initial focus, normal Tab/radio keys, Escape/outside dismissal, viewport placement and resize/scroll updates; returns open/close/destroy |
| `uiToasts(region)` | Returns show(message, info/success/error) and destroy; 3 visible, FIFO queue, deduplication, named dismissal; errors persist, confirmations pause on hover/focus/hidden documents |
| `uiProgress({label, value?, max?, message?})` / `uiSkeleton({lines?})` | Native named progress; omitted value is indeterminate, zero is real zero; static decorative skeleton needs surrounding loading status |
| `uiField(control, {label, hint?, hiddenLabel?})` | Returns `element`, original typed `control`, label, hint, error and `setError(message?)`; preserves existing descriptions |
| `uiToggle({label, checked, onChange, hint?})` | Native checkbox in a compact settings row; keyboard and label-click behavior included |
| `uiDialog(panel, {trigger, closeButton, onOpen?, onClose?})` | Named native modal, Tab wrapping, Escape, focus return and `open/close/destroy` methods; product owns content |
| `uiMenu(panel, trigger)` | Named native popover; arrows, Home/End, first-letter navigation, disabled-item skipping, Tab/outside/Escape dismissal and viewport positioning |
| `uiToolbar({label}, ...children)` | Wrapping named action group; ordinary Tab order (does not claim ARIA toolbar arrow behavior) |
| `uiSettingsRow(control, {label, hint?})` | Field contract in a compact label/value row; no additional category heading |
| `uiMetadata(options, ...children)` / `uiMetadataAction(options)` | Wrapping secondary information and named 24px actions with 12px glyphs |
| `uiCard({title, description?, meta?, actions?, children?})` | Article with a heading and independent actions; never an interactive wrapper containing buttons |
| `uiFeedback({kind, message, title?, action?})` | `empty` / `loading` / `error` / `info` / `success`; appropriate alert/status roles; recovery action optional |
| `uiTabs({label, items, overviewAbove?})` | Returns element/list/panels, select and destroy; items provide label/panel/disabled. Horizontal manual tabs become named regions above an optional component width. Disconnect with destroy when explicitly disposing a mounted instance. |
| `uiDisclosure({label, open?, name?, meta?}, ...children)` | Native details; common name for exclusive sections; a decorative chevron and optional metadata |
| `uiBadge({label, tone?})` | Passive pill: neutral, accent, success, warning or error; no interaction |
| `uiChip({label, selected?, disabled?, onChange?})` | Returns element/setSelected; stable label and geometry with an announced pressed state |
| `uiTray({label, hidden?}, ...children)` | Named sticky action group in normal flow; caller owns visibility and focus after removal |
| `uiNavLink({label, href, current?, onClick?})` | Real destination anchor; current-page state, compact target and no prose underline |
| `uiPager({previous?, next?})` | Named document navigation; each destination has label/onClick; absent ends omitted |
| `.ui-document` | Shared article/docs typography, code, tables, quotations, media and underlined content references |

Adding a setting means binding a shared control to product state:

```js
const details = uiToggle({
  label: 'Show source details',
  checked: profile.showDetails,
  onChange: value => savePreference(value),
});
container.append(details.element);
```

The product callback owns asynchronous persistence and any rollback. The component owns label association, target size, keyboard behavior, focus styling and theme roles. Do not add a new component-specific size or tooltip timer.

For script-free pages, use the corresponding `.btn`, `.ib`, `.mi` and `.field` CSS contracts with native markup and real labels. The room hydrates `data-icon` from the generated house icons; script-free pages must include the SVG itself.

### Ownership and lifecycle

The maintainer changing a component owns its contract, catalogue examples and regression checks in the same PR. Introduce shared APIs as `preview`; promote to `stable` once used by a production view and covered for relevant states and interactions. Stable means supported in this codebase, not certified against every host or assistive technology. `deprecated` requires a named replacement and migration guidance; do not remove it while consumers remain.

A new variant must add a registry option, implementation, real catalogue example and meaningful coverage. Adding a new component also requires its module in the registry and production includes. Product components cannot import room state or tool transport into the shared layers. Exceptions to the migration inventory need a concrete product reason; do not raise limits to bypass the factories.

`npm run check` verifies generated output, undefined token references, component boundaries, strict option types, the shrinking raw-button allowance, rejection of raw dynamic native fields/progress and toolbar roles without a composite keyboard contract, shared-pattern geometry ownership and browser behavior. Shared modules and catalogue are independently type-checked; the room is checked against the same sources. Browser checks exercise names, invalid options, field error associations, state geometry, menu navigation, modal focus, tooltips, touch, themes and narrow 200% text. Native host and screen-reader checks remain a release responsibility.


| Surface | Contract |
|---|---|
| Welcome packs | Opaque canvas; selected state shown by border and icon; all text visible without hover |
| Toolbar and icon actions | Familiar actions use symbols with accessible names and fast tooltips; ambiguous destinations keep short labels; visible focus and pressed state |
| Portal rows and shelf cards | One button opens the content; metadata links and save/share actions are separate; no nested controls |
| Metadata | Secondary text stays readable in hover and selected states; save is always visible |
| Add-source sheet and composers | Real inputs and placeholders; control borders; disabled feedback |
| Reader and docs | Shared measure and type; code and tables scroll on their own; contents drawer adapts to the container |
| Clips and shares | Same text and control roles; source accents do not replace functional colors |
| Spaces | Functional editor controls use shared sizes; the published composition uses its chosen paper/ink pair and decorative accents |
| Account, sign-in, admin | Shared primitives; destructive actions use the danger pair |

Shared rules, in `primitives.css`:

- Controls are at least 24px, 44px on coarse pointers.
- Focus is a 2px outline with a 2px offset. Selection never relies on hue alone.
- Essential actions remain discoverable without hover; optional secondary actions may appear on hover/focus with a direct touch path. Destination links use Enter; action buttons use Enter and Space.
- Room icon hints appear after 150ms of mouse hover or immediately on keyboard focus. They remain hoverable, dismiss with Escape, and stay inside the viewport and active dialog. Touch activates controls directly; essential instructions stay visible in the opened panel.
- Increased contrast strengthens secondary text and borders. Forced colors use system colors. Reduced motion removes transitions, including scripted scrolling.
- Layouts wrap. Container queries add to viewport fallbacks rather than replace them.

### Form, overlay and feedback decisions

- Mutation forms keep drafts on failure, put server errors at the form, and associate native constraint messages with the relevant field. Editing clears that field error. Async submission locks controls until resolution and restores their prior disabled states. Native form behavior and associated descriptions follow [WAI form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/).
- Live search remains interruptible and owns its request generation checks. Instant preference controls own persistence and rollback; these are not submit forms. Script-free account uploads and confirmation pages retain native POST/validation with shared CSS and server-rendered outcomes.
- Quick reblog is a rich, **nonmodal dialog**, with a visible close control and native audience radios. It is not a menu: arrows change radio selection, Tab can leave, outside interaction dismisses without stealing focus, and Escape returns to the trigger. uiMenu remains for lists of actions. Do not set aria-modal on content that leaves the surrounding page interactive; see [APG dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- Ordinary confirmations use polite status; failures use alerts, stay until dismissed, and never steal focus on arrival. Recovery actions remain inline beside the task. Toasts mount in an active modal when emitted there, and return to the page on close. Queueing avoids replacing an unread message. This follows [WAI status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- Progress exposes actual value/maximum only when known. Indeterminate work has a readable status and no fabricated percentage. Skeletons are static and aria-hidden, including under reduced motion. Complete and failed tasks replace pending indicators rather than leaving stale busy state.

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

1. Run `npm run check` (type checks, generated-file and token-reference checks, and tests).
2. Run `node scripts/design-preview.ts` and open `http://127.0.0.1:8799`. It binds to loopback, uses in-memory profiles and offline fixtures, and loads the real MCP App resource over JSON-RPC. It also serves the standalone pages: consent, local sign-in results, invites, imports and admin.
3. Open **Controls** (`/controls`) for the shared variants, theme, touch-target preview and 200% text. Then click **Run browser checks** in the room host. Its current matrix covers 23 room and optional-task views, including populated Library, collections, comparisons, catch-up, watches, owner Space and open customization/settings/find panels at 360px and 760px in light and 1000px in dark, with complete, theme-only, background-only, hostile and absent host inputs, and repeats at 200% text. Standalone pages are linked for manual review; they are not in that matrix. It checks opaque backgrounds, render errors, contrast, visibility, target size, nesting, focus, image filters, `rem` shrinkage, compact heading/row density, checkbox glyph size and usable field widths. `test/compact-ui-browser.test.ts` exercises the same optional-task fixtures at 360/760/1000px and 100/200% text, plus real coarse-pointer emulation. These are synthetic host fixtures, not certification of native host apps.
4. Use **Theme-only switch** and **Reset inputs** to check theme updates. Keyboard through cards and metadata. Screenshots supplement the measurements; they don't replace them.

The preview doesn't prove behavior in a real host, OS high-contrast modes or assistive technology. Check those by hand before a release; see [host compatibility](host-compatibility.md#certifying-a-host).
