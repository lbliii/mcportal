# MCPortal brand

<picture><source media="(prefers-color-scheme: dark)" srcset="lockup-on-dark.svg"><img src="lockup.svg" alt="MCPortal" height="56"></picture>

**Your liminal webspace.**

MCPortal looks like a mid-century sci-fi paperback: flat inks on cream paper, halftone dots, a keyline slightly off register, and portals everywhere. The same language runs from the logo to the fallback art on cards without pictures (`src/ui/art.js`). Tokens, components and page shells are in the [design system](../docs/reference/design-system.md).

## Files

`npm run brand` (`scripts/brand.ts`) generates everything here from one set of geometry and the Jost outlines. To change a file, change the script and re-run it; never edit the SVGs by hand. A test fails if they drift.

| File | Use |
|---|---|
| `mark.svg` | The Portal mark with its print texture, for 64px and up |
| `mark-small.svg` | The Portal mark for small sizes: no texture, heavier lines. Favicons and the MCP server icon |
| `app-icon.svg` | Full-bleed square for platforms that round corners themselves (Apple touch icon, 512px icon) |
| `mark-line.svg` | The Line mark: the UI icon-set version (24px grid, 1.75 strokes), one colour plus the moon |
| `wordmark.svg`, `wordmark-on-dark.svg` | MCPORTAL on light and on dark backgrounds |
| `lockup.svg`, `lockup-on-dark.svg` | Mark and wordmark side by side, for headers |
| `lockup-stacked.svg` | Mark above wordmark, for square spaces |
| `social-card.svg` | The 1200×630 link preview (served as `/site/og.png`) |
| `readme-hero.svg`, `readme-hero.png` | The 1280×640 README banner; the PNG is the GitHub social preview (Settings → Social preview) |
| `hero.svg` | The landing page's night sky, inlined into the page. Its classes are hooks for the page's opening animation; the door leaf stays invisible unless the page animates it |
| `door-open.svg`, `door-shut.svg` | The decorative plate over a standalone page's card: a lit door with the moon in it for welcomes and good news, a dark one for errors and expired links |
| `fonts/` | Jost Bold and Medium (SIL Open Font License, `fonts/OFL.txt`), used to draw outlines |

The script also writes what the public pages serve (`src/site/`): the favicon and app icons, the social card as a PNG, the lockup for dark backgrounds and a copy of Jost Bold. It also draws the workspace icons (`src/ui/brand/icons.js`).

## Marks

- **Portal** is the primary mark: a door with an orbit passing behind and in front of it, and a moon in the doorway. Keep its rounded-square plate; don't recolour the parts or remove the ring.
- **Line** belongs with the UI icons. It takes the text colour; only the moon keeps its brick.
- Give the mark clear space of at least a quarter of its width on every side.

## Icons

The workspace's icons are drawn by the same script (`src/ui/brand/icons.js`), on the Line mark's 24-unit grid with its 1.75 stroke, round caps and joins. Rounded corners use a radius of 3. Where an icon has a frame, it borrows from the mark: columns are two doorways, the bookmark and the "open original" frame have arched tops, a space is someone's doorway, refresh runs around a tilted orbit, and the feed icon's dot is the moon's size. Icons are one colour (currentColor); the brick moon belongs to the mark alone.
Reading navigation adds a doorway for Room, a shelf/search lens for Recall, stacked papers for Topic desks, paired arched pages for Compare, a clock/check for Catch-up, a plus/minus page for Changes, and a calendar with a moon-sized date dot for Upcoming. Labels accompany these on wide screens; compact navigation keeps accessible names and tooltips.

- Give the mark clear space of at least a quarter of its width on every side.

## Wordmark

Jost Bold, all caps, tracked 0.08em: **MC** in ink and **PORTAL** in teal. On dark backgrounds, MC is paper and PORTAL is mustard. Never retype it in a font: use the outlines.

## Type

Headings on the public pages are Jost Bold, served by MCPortal itself (never a font CDN), with Futura as the fallback. Body text is the system sans. The room uses the host's fonts so it sits naturally in a chat.

## Colour

The house ink set, "atomic":

| | Hex | Use |
|---|---|---|
| Paper | `#F2E6CF` | Backgrounds, and MC on dark |
| Teal | `#2A8C82` | The mark's plate, and PORTAL on light |
| Mustard | `#E0A526` | The orbit, and PORTAL on dark |
| Ink | `#1F2A36` | The door, MC on light, dark backgrounds |
| Brick | `#C4452C` | The moon: the one warm accent |

The fallback art uses seven more ink sets in the same spirit (see `src/ui/art.js`). In the room, each feed's colour is the lead ink of its art's set, and your own portals use the house inks (Saved mustard, Clips teal, Following brick, Pinned ink). The room's accent is a deeper teal, `#1D6B63`, so white text on it stays readable; on dark it's `#5FB0A4` with ink text.

## Voice

Portals, doors, thresholds and transmissions: a little mysterious and a little 90s ("webspace"), always followed by a plain sentence that says what MCPortal does. MCPortal works in any MCP agent, so copy talks about "your agent" rather than one host.

In the room the voice is pulp: the colourful language of a 1950s sci-fi paperback. The machinery talks sci-fi (transmissions, signals, frequencies, the ether), your own actions talk fantasy (summon, conjure, materialize), and good news gets an exclamation mark ("It's alive!"). Keep the flourish to a few words, and let a plain sentence carry the facts and the next step, especially in errors. Some things stay plain: tooltips and accessible labels, which lead with the action; anything about deleting, blocking, reporting, accounts or privacy; and the text MCPortal sends to the model.
