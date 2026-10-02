# Card anatomy in stream UIs (attribution, reblog headers, media, truncation, actions, density)

Scope note: about 25 tool calls (searches and fetches), as of 2026-10-02. Several primary pages could not be fetched: Material 3 site (renders client-side), docs.bsky.app (TLS error), X/Twitter engineering blog (403), CNN (451), and Feedly help (404). Where that happened I used a secondary source or listed the item under Gaps. Items not verified in this session are in Gaps, even where they are widely believed.

## 1. How products present source, attribution, timestamps and media (Tumblr, Reddit, Mastodon, Bluesky, X, HN, readers, Discover)

### Takeaway
Every product puts provenance in a single compact line above or below the title. The data model separates "who made it" from "how it reached you": Tumblr's reblog trail, Bluesky's feed "reason", and Mastodon's boost wrapper all do this. Two systems are converging on a dedicated, styled header component instead of plain prepended text. Mastodon did this in Sept 2026, and Tumblr ran a header experiment in Aug 2023. HN is the minimal baseline: title, domain, then a single subtext line.

### Cited Findings
**Tumblr (NPF)**
- NPF post = `content` blocks + `layout` objects + `trail`. Layout types are `rows`, `carousel` (display mode), `condensed` (deprecated) and `ask`. In `rows`, "The width of each element within the row is determined by however many blocks are in the row." — [Tumblr NPF spec](https://www.tumblr.com/docs/npf)
- Reblog trail items each carry `post` (`id`, `timestamp`, `is_commercial`), `blog` (short blog info), `content`, `layout`. They are ordered oldest root post → newest parent. — [Tumblr NPF spec](https://www.tumblr.com/docs/npf)
- "Broken" trail items (deleted or unavailable source) have no post ID, but they keep a `broken_blog_name` string plus their content and layout. The client must still render an attribution header for content whose source is gone. — [Tumblr NPF spec](https://www.tumblr.com/docs/npf)
- Attribution objects by type:
  - `post`: url, post id, blog.
  - `link`: url.
  - `blog`: used for asks and reblog origins.
  - `app`: for embeds. Fields are `url`, `app_name`, `display_text` (e.g. "Listen on Bandcamp") and `logo`.

  Source: [Tumblr NPF spec](https://www.tumblr.com/docs/npf)
- Image media objects list multiple sizes "widest-first", with `width`/`height`. When dimensions are unknown the default is 540×405 and `original_dimensions_missing` is set. GIFs carry a static `poster` frame. — [Tumblr NPF spec](https://www.tumblr.com/docs/npf)
- Aug 22 2023 experiment: it changed the post header to "reduce the redundancy of avatars in reblogs, save some vertical space by moving recommendation labels around, afford more room for badges". On desktop it "removes the floating avatars and makes posts full width". — [Changes on Tumblr, 2023-08-22](https://changes.tumblr.com/post/726375529346973696/tuesday-august-22nd-2023)
- Jun 2023: clicking the reblogged-from blog name in the header now goes to that blog, not to its reblog. Nov 2023: each reblog-trail item header got its own meatball menu (report, block, copy permalink). — [search summary of changes.tumblr.com 2023 posts](https://changes.tumblr.com/post/719036393883598848/friday-june-2nd-2023); [Tumblr support, Nov 7 2023](https://support.tumblr.com/post/733358258142707712)

**Reddit**
- The 2018 redesign (April 2018, first major redesign in over a decade) introduced three views:
  - Card: "Facebook newsfeed"-like, with media inline.
  - Classic: thumbnail and title list, like old Reddit.
  - Compact: "just the headlines in a list".

  Users switch views from a menu at the top of the page. — [Malay Mail/AFP 2018-04-04](https://www.malaymail.com/amp/news/tech/gadgets/2018/04/04/something-for-everyone-reddit-redesign-comes-with-three-viewing-options/1614355); [The Canadian Techie 2018](https://thecanadiantechie.com/2018/04/04/reddit-is-rolling-out-a-major-redesign/)

**Mastodon**
- Mastodon 4.3 (Oct 2024) refreshed iconography and colour, improved link previews, and added hover cards on names (peek at a profile, follow or unfollow). — [Mastodon blog: 4.3](https://blog.joinmastodon.org/2024/10/mastodon-4.3/)
- PR #40555, "Status redesign: Boosts and replies" (merged Sept 16 2026), replaces the old prepended "X boosted" text with a dedicated Boost UI component and a reply "prepend". It adds background styling and fetches missing data for the header. It is labelled as v5.0 foundation work. A follow-up, PR #40811, fixes the header and ARIA. — [mastodon PR #40555](https://github.com/mastodon/mastodon/pull/40555); [PR #40811](https://github.com/mastodon/mastodon/pull/40811)
- Preview cards are generated asynchronously for the first link in a status, only when the status has no media attachments. The source can be oEmbed (not "rich"), OpenGraph, or twitter:player. Images must be under 2 MB (default). A card is not refreshed for 14 days. Many third-party apps ignore embeds and show "picture + metadata text". — [box464: Mastodon preview card display logic](https://box464.com/posts/mastodon-preview-cards/)

**Bluesky**
- `app.bsky.embed.images`:
  - Up to 4 images per post (`maxLength` 4), each with `alt` ("Alt text description of the image, for accessibility") and an optional `aspectRatio`.
  - Image blobs can be up to 2,000,000 bytes.
  - The view returns `thumb` and `fullsize` CDN URLs.

  Source: [atproto lexicon images.json](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/images.json)
- External (link card) embed fields: `uri`, `title`, `description`, `thumb` blob. — [search summary of docs.bsky.app Posts guide](https://docs.bsky.app/docs/advanced-guides/posts)
- Link card thumbnails were "unusually tall", which clipped text-heavy OG images. Issue #2555 proposed Facebook's 1.91:1 (1200×630), and PR #2577 closed it as implemented (early 2024). — [social-app issue #2555](https://github.com/bluesky-social/social-app/issues/2555)

**X/Twitter**
- After the July 2023 rebrand, "retweet" became "repost". Counts sit next to their buttons in the timeline. — [Wikipedia: Tweet](https://en.wikipedia.org/wiki/Tweet_(social_media)); [List of features on X](https://en.wikipedia.org/wiki/List_of_features_on_X)

**Hacker News (observed 2026-10-02)**
- Row = rank, upvote arrow, title link, (domain). The subtext line holds points, "by" user, age, hide, and the comment count. Example: "Court agrees with EFF: Utah's VPN law demands a technical impossibility" (eff.org), 271 points by hn_acker 6 hours ago, 123 comments. 30 stories per page. — [news.ycombinator.com](https://news.ycombinator.com/)

**Readers**
- Readwise Reader: the "Feed" section is transitory and holds pushed items (RSS, newsletters). The mobile Feed UI shows documents as cards that are marked seen as you scroll. It is "TikTok-inspired": swipe up to advance, swipe down to go back, save for later, tap to read. Feed items are not auto-summarized by Ghostreader unless the user adds their own OpenAI key. — [Readwise docs: Feed](https://docs.readwise.io/reader/docs/faqs/feed); [search summary](https://blog.readwise.io/p/f8c0f71c-fe5f-4025-af57-f9f65c53fed7/)
- Tapestry (Iconfactory) merges Bluesky, Mastodon, RSS, YouTube and podcasts into one chronological timeline with "no algorithm". 1.3 added an in-app Text Size setting. 2.0 (Sept 2026) added composing and replying, polls, in-app Bluesky quote posts, better animated GIFs and avatars, and better timeline swipes. — [Iconfactory blog, Tapestry 2.0](https://blog.iconfactory.com/2026/09/iconfactory-tapestry-2-0-what-youve-always-wanted/); [How-To Geek](https://www.howtogeek.com/tapestry-timeline-app-release/)

**Google Discover**
- Image guidance for publishers: at least 1200 px wide, more than 300,000 total pixels, 16:9, and enabled via `max-image-preview:large`. Select the image with schema.org or `og:image`. Avoid logos and text-heavy images. — [Google Search Central: Discover](https://developers.google.com/search/docs/appearance/google-discover)

### Inferences
- MCPortal's from-line (source dot + source title + time) matches the HN and Reddit pattern: the source sits next to the title, not in a heavy header. That suits a reader.
- Tumblr's `broken_blog_name` is a useful precedent. Keep a plain-text source name in the item record so the from-line survives a deleted feed or user.
- Mastodon moving boosts from text into a styled component (2026) suggests that social context deserves its own row, with its own small styling, above the author/source line.

### Gaps
- Apple News, Feedly, Inoreader, Reeder, Feedbin and Threads card anatomy: no primary docs were fetched (Feedly help returned 404). No reliable measurements were found.
- Reddit "shreddit" (2023–2025 web rewrite) card changes: no primary source found.
- Exact pixel sizes of avatars and fonts in X, Bluesky or Mastodon headers: not found in primary sources.

## 2. Where social context goes ("X reposted", "Because you follow", "Suggested") and how it is styled

### Takeaway
Across Tumblr, Mastodon and X, social context sits on its own line above the author line. It uses smaller, muted text and often a small icon. Recommendation labels ("Suggested") compete for the same slot, so Tumblr moved them around to save vertical space.

### Cited Findings
- Mastodon: a boost or reply prepend sits above the status. As of Sept 2026 it is a dedicated component with background styling, replacing prepended text. — [mastodon PR #40555](https://github.com/mastodon/mastodon/pull/40555)
- Tumblr: the header carries the reblogged-from blog name (clickable to the blog) and recommendation labels, and Tumblr has experimented with moving these to save vertical space. — [Changes on Tumblr 2023-08-22](https://changes.tumblr.com/post/726375529346973696/tuesday-august-22nd-2023)
- In Tumblr NPF, each trail item has its own blog header, so attribution is repeated for each layer of a reblog chain. Since Nov 2023 each layer has its own overflow menu. — [Tumblr NPF spec](https://www.tumblr.com/docs/npf); [Tumblr support Nov 2023](https://support.tumblr.com/post/733358258142707712)

### Inferences
- For MCPortal, "@handle shared" behaves like a repost reason and belongs on a muted line above the source line. "Also on Hacker News" is secondary provenance and fits better after the time, or as a small tail on the from-line.
- The agent's "Why this" note works like "Suggested" or "Because you follow". Tumblr's experience suggests keeping it compact, not as another header row.

### Gaps
- X's and Threads' exact "reposted"/"liked" social-context styling is not documented in primary sources found (a search returned only scraper and wiki pages).
- NN/g social-proof articles were not retrieved.

## 3. Media rules: aspect ratios, cropping, link cards, video and lazy loading, alt text

### Takeaway
The industry moved away from algorithmic cropping toward showing images at their native aspect ratio. Twitter removed its saliency crop in 2021, and Bluesky stores an `aspectRatio` with each image. Link cards have settled on 1.91:1 (1200×630), while Google Discover asks for 16:9 at 1200 px or wider. Alt text is a first-class field.

### Cited Findings
- Twitter launched its saliency crop in 2018. It scored regions using eye-tracking-trained models and centred the crop on the highest score. Its own study found a 4% bias toward white over Black individuals (7% for women, 2% for men). In March 2021 Twitter tested showing standard aspect ratio photos uncropped on iOS and Android, rolled it out to everyone in May 2021, and removed the algorithm. Authors also get a preview of how the post will look. Rumman Chowdhury: "how to crop an image is a decision best made by people." — [The National 2021](https://www.thenationalnews.com/lifestyle/2021/08/10/twitter-image-cropping-algorithm-found-to-discriminate-against-several-groups-of-people/); [ABC News 2021](https://abcnews.com/Business/twitter-scraps-image-cropping-algorithm-allegations-racial-bias/story?id=77801064); [arXiv 2105.08667](https://arxiv.org/pdf/2105.08667)
- Bluesky images carry an optional `aspectRatio`, which lets clients reserve layout space before the image loads. There are up to 4 images, each up to 2 MB. — [atproto images.json](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/images.json)
- Bluesky link-card thumbnails use 1.91:1, after a 2024 fix to an overly tall crop. — [social-app #2555](https://github.com/bluesky-social/social-app/issues/2555)
- Mastodon shows a link card only when a post has no media attachments, and only for the first link. — [box464](https://box464.com/posts/mastodon-preview-cards/)
- Tumblr: carousel mode is "a horizontally paging view where each block occupies 100% of the width". Only image blocks can be in multi-item carousel rows. Media sizes are listed widest-first, and GIFs have a `poster` frame for a static first paint. — [Tumblr NPF spec](https://www.tumblr.com/docs/npf)
- Google Discover: 1200 px or wider, 16:9, `max-image-preview:large`. Avoid logos and text-heavy images. — [Google Discover docs](https://developers.google.com/search/docs/appearance/google-discover)
- Mastodon web hotkeys include **h** to show or hide media and **e** to open media. Hiding media is a user-level control. — [fedi.tips](https://fedi.tips/using-mastodon-through-a-keyboard/)

### Inferences
- For a ~640px column, RSS/HN/GitHub items will mostly have only `og:image`. Rendering it at 1.91:1 (about 640×335) matches what publishers design for, so text-heavy OG images won't be clipped badly. Full-bleed 16:9 (640×360) is close.
- Store width and height or an aspect ratio, as Bluesky and Tumblr do, to avoid layout shift. A GIF-style poster frame is a good default for animated media.
- Skip the image when it is a site logo (Discover's guidance). The source dot already covers branding.

### Gaps
- No primary source fetched on video autoplay rules or lazy-loading thresholds for these products.
- No primary source on how Bluesky or Mastodon display an "ALT" badge in the UI. Only the lexicon field is confirmed.
- No source on X's current maximum in-feed image height or the crop for extreme ratios.

## 4. Text truncation, "read more", hierarchy, reading width

### Takeaway
Tumblr implements "keep reading" at the data level (`truncate_after`, an index of the last visible block), not with CSS line clamps. Body text should be held to 50–75 characters per line (about 70ch / 34em). WCAG 1.4.8 caps it at 80 characters.

### Cited Findings
- Tumblr `rows` layout `truncate_after` = index of the last block shown before read-more. It "can be the starting block but not the ending block". The deprecated `condensed` layout did the same with a `blocks` array. — [Tumblr NPF spec](https://www.tumblr.com/docs/npf)
- Optimal line length is 50–75 characters. Descriptions wider than 80 cpl were skipped 41% more often than those at 60–70. WCAG 1.4.8 says 80 characters or fewer (40 for CJK). Implement with `max-width` of about 70ch or 34em. Related readable-text spacing: line height 1.5, paragraph spacing 2em. — [Baymard: Line length readability](https://baymard.com/blog/line-length-readability)
- People with dyslexia may benefit from about 45–50 characters per line. — [search summary citing line-length sources](https://baymard.com/blog/line-length-readability) (secondary; not confirmed on the Baymard page itself)
- Mastodon hotkey **x** shows or hides text behind a content warning, which is another per-post collapse mechanism. — [fedi.tips](https://fedi.tips/using-mastodon-through-a-keyboard/)

### Inferences
- With a 640px column, body text at about 17–18px lands near 70–75 cpl. The summary should probably be set slightly larger, or the text column inset (about 34em), to stay inside 50–75. A 4-line summary clamp is then roughly 250–300 characters, about the length of a typical RSS description.
- Truncating at a block boundary, as Tumblr does, suits the agent's "Why this" note and multi-paragraph shares. A CSS `line-clamp` suits plain summaries.

### Gaps
- No source on Reddit's or Feedly's title and summary line clamps or font sizes.

## 5. Action row conventions, hit targets, overflow menus, keyboard shortcuts

### Takeaway
Social apps order the action row as reply → repost/boost → like/favourite (→ share/bookmark/overflow), with counts next to their icons. Reader and aggregator apps replace this with points, comments, save and open. j/k navigation plus single-letter action keys is the standard keyboard model.

### Cited Findings
- Mastodon web hotkeys:
  - Navigation: **j/k** (or arrows) move between posts, **Enter/o** opens, **p** opens the author's profile, **1–9** focus a column.
  - Actions: **r** reply, **b** boost, **f** favourite, **m** mention.
  - Media and content warnings: **e** opens media, **h** hides media, **x** toggles the CW.
  - Go-to: **g+h**, **g+n** and similar.
  - **?** opens the hotkey guide.

  Source: [fedi.tips](https://fedi.tips/using-mastodon-through-a-keyboard/); [Mastodon issue #3034](https://github.com/tootsuite/mastodon/issues/3034)
- X: like, repost and reply counts appear beside their buttons in the timeline. — [Wikipedia: Tweet](https://en.wikipedia.org/wiki/Tweet_(social_media))
- HN keeps its actions in the subtext line as text links (points, hide, comments). There are no icons. — [news.ycombinator.com](https://news.ycombinator.com/)
- Tumblr added an overflow (meatball) menu to each reblog-trail item header in Nov 2023: report, block, copy permalink. — [Tumblr support](https://support.tumblr.com/post/733358258142707712)
- Readwise Reader Feed: swipe up or down to advance or go back, plus a save-for-later action. Advancing marks the item seen. — [Readwise docs: Feed](https://docs.readwise.io/reader/docs/faqs/feed)

### Inferences
- MCPortal's planned row (points/comments, open original, save, share, later reblog) mirrors HN's subtext plus reader actions. Suggested keys, following Mastodon: j/k to move, o/Enter to open the original, s to save, b for reblog later, with ? for help.
- Put rarely used per-item actions (mute source, copy link, report) in an overflow menu, as Tumblr does.

### Gaps
- Tumblr dashboard j/k, Feedbin and Reeder shortcut lists were not retrieved.
- Hit-target minimums were not verified this session: Apple HIG's 44×44pt and WCAG 2.5.8's 24×24 CSS px are widely cited but should be confirmed before use.

## 6. Density modes and per-source density

### Takeaway
Reddit's three-mode split (Card / Classic / Compact, 2018) is the canonical density model: media-forward, thumbnail list, headline-only. Readers show the same split as a layout menu. In this research, only Reddit and Tumblr-style layouts were confirmed from sources. Per-source density remains unverified.

### Cited Findings
- Reddit 2018: Card (media inline), Classic (thumbnail and title, like old Reddit), Compact (headlines only), switchable from a top menu. — [Malay Mail 2018](https://www.malaymail.com/amp/news/tech/gadgets/2018/04/04/something-for-everyone-reddit-redesign-comes-with-three-viewing-options/1614355); [Fox News 2018](https://www.foxnews.com/tech/reddit-refurbishes-its-bland-style-adds-an-endless-scroll-new-view-options)
- Tapestry exposes in-app text size (1.3). No density setting was found in its docs or blog. — [How-To Geek](https://www.howtogeek.com/tapestry-timeline-app-release/); [Tapestry 2.0 blog](https://blog.iconfactory.com/2026/09/iconfactory-tapestry-2-0-what-youve-always-wanted/)
- Readwise Reader offers two densities for the same Feed: a list and a full-screen card mode. — [Readwise docs: Feed](https://docs.readwise.io/reader/docs/faqs/feed)

### Inferences
- A merged river could map Reddit's three modes onto MCPortal: "post" form (card), a classic row with a small picture, and a compact row with from-line and title only. Per-source density would let noisy sources (subreddits, GitHub releases) default to compact.

### Gaps
- Feedly layouts (Title-only / Magazine / Cards / Article) and whether they apply per feed: the help page returned 404, so this is unverified.
- Inoreader view modes and Mastodon web density settings: not retrieved.

## 7. Design-system references (Material 3, HIG, Atlassian/Primer, NN/g)

### Takeaway
Material's card spec is the most concrete: 16dp content padding, 8dp margins, and three variants (elevated 1dp, filled, outlined with a 1dp stroke). NN/g defines a card as a contained summary that links to more detail. That matches the river's "post" form, but a single-column stream is closer to a list than a card grid.

### Cited Findings
- Material Components (Android) Card:
  - Anatomy: container, headline, subhead, supporting text, image, buttons.
  - Types: Elevated (1dp resting, 2dp dragged), Filled (0dp, 8dp dragged), Outlined (0dp, 1dp stroke, 8dp dragged).
  - Sizing: content padding 16dp, recommended mobile margin 8dp, corner radius `shapeAppearanceCornerMedium`.

  Source: [material-components-android Card.md](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/components/Card.md)
- NN/g, via a secondary summary: cards group related information, present a summary that links to details, resemble physical cards, and allow flexible layout. They are "a snapshot-like display intended to encourage users to click to view more details". NN/g also has a "Card View vs. List View" piece. — [NN/g video: Card vs List](https://www.nngroup.com/videos/card-view-vs-list-view/); [Berkeley DAP: accessible card patterns](https://dap.berkeley.edu/web-a11y-basics/accessible-card-ui-component-patterns)

### Inferences
- For a vintage pulp print look, Material's "outlined" variant (a 1dp rule, no shadow) is closest to print: think rules between columns, not floating paper. A 16px inner padding gives a reasonable baseline.
- In a single column, separating items with rules (list-like) instead of boxed cards saves vertical space. This matches Tumblr's 2023 move to full-width posts without floating avatars.

### Gaps
- The m3.material.io card page renders client-side and could not be read. The M3 "medium" corner value (commonly 12dp) is unconfirmed here.
- Apple HIG, Atlassian and Primer activity-feed or timeline components were not retrieved.
