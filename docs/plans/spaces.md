# Plan: Spaces that feel like someone's

**Status:** proposed 2026-10-07. Mockups: [`design/mockups/space-covers.html`](../../design/mockups/space-covers.html), which needs a local static server because it loads `src/ui/art.js` and the brand fonts. This is the "A room that feels yours" item on the [roadmap](README.md), applied to Spaces. It builds on public profiles (`src/public-profiles.ts`), the Space view (`src/ui/room/social.js`), Space links (`src/space-links.ts`) and the paperback art engine (`src/ui/art.js`).

## Where we are

A Space ([social](../explanation/social.md#spaces-and-handles)) has a title, a handle, a bio, follower and post counts, "Sources I read" and a grid of posts. The only personal choice is an accent colour, one of eight web colours (`ACCENTS`) mapped to hexes in `social.js`. They aren't the brand's inks, and they only colour a 4px rule above the title.

So a Space doesn't look like MCPortal and doesn't look like its owner. Every Space is the same page in a different shade of blue.

## The idea: the Space is the owner's paperback

MCPortal's look is a mid-century sci-fi paperback: flat inks on paper, halftone, a keyline slightly off register. A Space is where a person gets their own cover in that style. **MCPortal is the publisher**: it supplies the paper, the inks, the press and the imprint. **The owner is the author**: they choose the cover, the format and what goes on it.

That's the MySpace lesson, kept and corrected. People loved MySpace because their page felt like theirs. Pages turned ugly, slow and unsafe because "theirs" meant any HTML and CSS. A print shop sits in between: a small set of plates the owner combines. Every combination is legible, accessible and recognisably MCPortal.

Three **formats** draw the same Space. The owner picks one:

| Format | What it is | Best at |
|---|---|---|
| **Paperback** (default) | A cover band, the title set over it, a pinned post, then posts beside a column of sources, travelers and stamps | Reading; closest to the landing page |
| **Magazine** | A pulp masthead ("Vol. II · No. 42"), the newest post as the cover story, the rest as "In this issue" | Personality; people who post a lot |
| **Patch** | A round mission patch, the handle as a call sign, stamps, and tabs for posts, sources and travelers | Compact; reads well as a chat card |

"Format" is deliberate. In MCPortal's vocabulary, *layout* arranges portals in a room and *view* renders a portal, so a Space gets the publishing word.

## Principles

1. **Choices, never code.** Owners pick from named options: ink set, motif, format, pinned post. No user HTML, CSS, fonts, colours or images reach the page. (This already holds for accents; it stays true.)
2. **Beautiful before anyone touches it.** A new Space gets a cover seeded at random when the handle is claimed, so no two Spaces look alike, even if the owner never opens the print shop.
3. **One engine, everywhere.** The room, the chat card, the patch avatar, the Space link page and its link preview all draw covers with `art.js`. A cover is a few numbers (ink, motif, seed), never a stored image.
4. **Formats are additive.** As with room layouts, switching formats never changes or loses anything. Every format draws every field it can, and a field one format doesn't show is kept, not dropped.
5. **Every combination passes.** Text and controls meet WCAG AA in every ink set, in light and dark, and a test enforces it. Covers are decoration (`aria-hidden`) and give way to forced-colours mode.
6. **Status without scoreboards.** Like pooled reblog credit, a Space shows no rankings and no per-post leaderboards. Stamps mark what someone did ("Brought 3 aboard"), not how they compare. Owner-only stats stay owner-only.
7. **The agent can dress it.** "Make my Space feel like a 70s Moebius comic" is a normal request. The agent maps it to options through `set_public_profile` and says what it chose. It never writes a bio or a "transmitting on" line the user hasn't approved, the same rule as share notes.
8. **The privacy line doesn't move without a decision.** Today a logged-out visitor to `/@handle` sees only the handle. Anything more on that page or in its link preview is opt-in (see [Space links](#5-space-links-and-link-previews)).

## The data

All fields live on `PublicProfile`, which is already one document (a file locally, a Postgres row hosted), so there's **no schema migration**. New fields are optional, and an absent field means the default.

```ts
interface PublicProfile {
  // ...existing fields...
  /** The cover: three numbers art.js turns into a scene. Set at handle claim. */
  cover?: { ink: InkName; motif: MotifName; seed: number };
  /** Which format draws the Space. Absent: paperback. */
  format?: 'paperback' | 'magazine' | 'patch';
  /** "Transmitting on": up to 4 short topics, each up to 24 characters. */
  frequency?: string[];
  /** One of the owner's own posts, shown first. Dropped if the post is removed. */
  pinnedShareId?: string;
  /** Fellow travelers: up to 6 handles the owner chose to feature. */
  travelers?: string[];
  /** Stamps the owner chose to hide. Stamps themselves are computed, never stored. */
  hiddenStamps?: StampName[];
}
```

- **Ink sets replace accents.** The eight `art.js` sets (atomic, space age, pulp, olive drab, pink moon, mars, mission, harbor) move into a shared module that both `art.js` and the server read, so their names and colours are written down once. Stored `accent` values map to the nearest ink set on read (blue → mission, teal → atomic, green → olive drab, amber → harbor, orange → space age, rose → pink moon, violet → pink moon, slate → mission), and `set_public_profile` stops accepting `accent` when this ships, matching the vocabulary rename's no-aliases rule. Existing exports stay importable, since import maps `accent` the same way.
- **The seed is random and stored, not derived.** Hashing the handle would change the cover whenever the handle changes. Hashing the account ID would put a function of a private ID in public. Existing profiles get a random seed the first time they're read and saved after this ships.
- **Re-roll** picks a new seed. Ink and motif stay put.
- **Export** (`src/portability.ts`) gains every new field. `EXPORT_VERSION` goes up by one.

`open_space` returns the new fields. Post authors in `SharedItem.author` gain `cover`, the three small values the patch avatar needs, and nothing else.

## Phases

Each phase ships on its own and leaves Spaces better than before.

### 1. Covers and inks (paperback only)

- `profile.cover`, ink sets as a shared module, accent migration, random seed at handle claim and backfill on read.
- The Space view becomes the **paperback** format: cover band, the title pressed off register in the darkest ink, bio, follow row, posts, sources, and the **imprint** at the foot ("An MCPortal paperback · mcportal.lol/@ana").
- The whole Space takes its colours from the ink set, not just the top rule. Dark mode swaps the paper for the darkest ink, as the room's thumbnails already do.
- **The print shop:** in your own Space, a bar with ink, motif and Re-roll. It calls `set_public_profile` the way the Listed button does today. Changes save at once and can be undone the same way.
- `set_public_profile` takes `ink`, `motif` and `reroll: true`. Its description says it's how to dress a Space.
- **Test:** every ink set × light and dark passes AA for body text, muted text and the primary button. The test fails if a new ink set doesn't.

### 2. Formats and the patch avatar

- **Magazine** and **patch** formats, and `format` on the profile, the print shop and `set_public_profile`.
- **Narrow widths.** The inline card is often under 600px wide. Formats respond to the reader's width (container queries), not the window: the paperback's side column moves below the posts, the magazine's masthead stacks and its cover story sits above "In this issue", and the patch is already narrow. Each format is checked inline, in fullscreen and in dark mode in Claude, ChatGPT and VS Code before release, like the river was.
- **The patch avatar.** The cover, cropped round, appears beside handles wherever a person is the subject: the Space, People portal cards, the Lobby, river context rows ("@ana shared"), the reblogger list, Following items and the "came in through" strip. It isn't shown in running text or in every byline, where it would be noise. SVGs are cached by handle and seed within a render.
- Visitors see the owner's format. There's no visitor switch: the format is the owner's expression.

### 3. Pinned post, "transmitting on", fellow travelers

- **Pinned post:** "Now transmitting". Pinned from the post's own menu in your Space, or by the agent with `pinnedShareId`. Only your own post (a share or a reblog) can be pinned. Removing the post unpins it.
- **Transmitting on:** up to four topics. It's what a visitor reads first, so the agent may suggest topics from what the owner shares and features, but it saves only what the user approves.
- **Fellow travelers:** up to six people the owner features, unranked and in the owner's order. It's a public statement by the owner, so:
  - Only people with a handle who are **listed** can be featured: being listed is already the consent to being discoverable.
  - Featuring someone doesn't notify them. They can see it on the owner's Space, and blocking the owner removes them.
  - It is never derived from follows, which stay private ([finding people](finding-people.md#principles)).
  - `find_people` can count "featured by people you follow" only if we decide to: see open questions.

### 4. Stamps

Stamps are computed from facts MCPortal already has, shown as small printed marks, and hideable by their owner. Never stored claims, never purchasable, never ranked.

| Stamp | Earned by | Needs |
|---|---|---|
| **Charter traveler** | An account made before open sign-up (2026-10-07) | `accounts.createdAt` |
| **Brought N aboard** | 1, 3, 10 people joined through your Space link | A lasting count: today a `joins` relation is deleted once it's been said, so add a counter beside it |
| **Signal keeper** | Shared in 10 different weeks | The owner's shares |
| **Vol. II, III…** | Years since the Space was made; the magazine prints it in the masthead | `profile.createdAt` |

More stamps come only with a reason, and each one gets this table's test: is it a thing the person did, not a rank?

### 5. Space links and link previews

**The page.** `/@handle` today shows the handle only, before sign-in. The page runs no scripts, but it can carry inline SVG, so the server draws the cover with the same `art.js` (loaded the way the tests already load it, with `vm`). Proposal, needing your decision:

- Default: the cover art and the handle. The art reveals nothing: it's three random numbers.
- Opt-in, in the print shop: "Show my Space title on my link". The bio and posts stay sign-in only.

**The preview.** Slack, Discord, iMessage and X need a PNG `og:image`, and they don't render SVG. Options:

| Option | Cost | Preview |
|---|---|---|
| **A. Prerendered set** (recommended) | 40 PNGs (8 inks × 5 motifs), rendered once at build time by a dev-only script and shipped in `src/site/` | The owner's ink and motif in one fixed composition. The handle and title appear in `og:title`, not in the image |
| B. Rasterize per Space | A runtime dependency (`@resvg/resvg-js`, native/wasm), plus caching | Exact cover, title plate in the image |
| C. Our own rasterizer | A small SVG-to-PNG renderer for the shapes `art.js` uses | Exact cover; real code to maintain |

A keeps the server dependency-free and gets 90% of the effect. Moving to B later changes only the image URL.

## What this doesn't do

- No custom CSS, HTML, fonts, uploaded backgrounds or music.
- No guestbook or comment wall. It would need moderation tools we don't have.
- No visitor-side theming. A visitor's dark or light preference applies; their taste in formats doesn't.
- No public web pages beyond the Space link bridge. Publishing stays native.

## Docs to update as phases ship

- [Social](../explanation/social.md): the Spaces section gets covers, formats, the print shop, travelers and stamps.
- [Tools](../reference/tools.md): `set_public_profile` and `open_space`.
- [Data](../reference/data.md): the new profile fields and the export version.
- The privacy page (`/privacy`, in `src/site.ts`), if a Space link shows more than the handle.

## Open questions

1. **What a Space link shows logged out:** the handle only (today), art and handle, or art, handle and an opt-in title?
2. **Link previews:** prerendered set (A), a rasterizer dependency (B) or our own (C)?
3. **Travelers and discovery:** may `find_people` say "featured by @ana" when the user follows @ana? It's the owner's public choice, but it's the first signal that passes through who someone follows.
4. **Avatars without a Space:** someone with a handle has a cover, but a ghost-mode or handle-less account doesn't appear socially, so nothing is needed today. Confirm once federation or groups arrive.
5. **More inks or motifs later:** adding sets is cheap, but each needs the contrast test and keeps covers recognisably MCPortal. Who curates them, and how often?
