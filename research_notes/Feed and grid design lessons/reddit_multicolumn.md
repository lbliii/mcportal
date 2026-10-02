# Reddit and Multi-Column / Multi-Feed Dashboard Products: Layout and Density Lessons

Scope: Reddit redesign (2018) and view modes; TweetDeck/X Pro; widget/portal start pages (iGoogle, Pageflakes, Netvibes) and Google Reader; Feedly, Flipboard, Artifact, Tapestry, Mastodon advanced UI, Windows Live Tiles, iOS widget stacks; cross-cutting unified-vs-columns. Research done 2026-10-02 with a capped tool budget (about 15 calls), so some items rely on secondary press. Primary-vs-secondary status is marked where relevant.

## Reddit: old.reddit vs the 2018 redesign (card / classic / compact), backlash, persistence, goals and results

### Takeaway
Reddit's 2018 redesign aimed at first-time visitors and engagement. It shipped three density modes (Card, Classic, Compact) because one density could not serve both newcomers and power users. Reddit reported 3-7x engagement gains to advertisers. Even so, old.reddit still gets tens of millions of visits a month eight years later, which shows how long a dense, text-first layout keeps its power users.

### Cited Findings
- **Stated goals (company/CEO):** CEO Steve Huffman called the old site a "dystopian Craigslist" that put off new users. The redesign launched April 2018 as the first major visual update in about a decade — [TechCrunch, 2017-11-01](https://techcrunch.com/2017/11/01/reddit-ceo-talks-taking-site-from-dystopian-craigslist-to-the-most-human-place-on-the-internet/?ncid=rss); [Wikipedia: Steve Huffman](https://en.wikipedia.org/wiki/Steve_Huffman)
- Goals reported by press: (1) a new code base so features could ship faster, since the code was "largely unchanged" for 12+ years; (2) make Reddit "more welcoming to new users" and make communities easier to find — [Digital Trends](https://www.digitaltrends.com/computing/reddit-redesign-launches-to-first-users/) / [Fox News syndication](https://www.foxnews.com/tech/reddit-refurbishes-its-bland-style-adds-an-endless-scroll-new-view-options)
- Huffman's metric goals: "decrease the bounce rate of first-time visitors" and raise time on site — [MarTech, 2018-08-06](https://martech.org/reddit-redesign-is-driving-higher-engagement-but-will-it-deliver-more-advertisers/)
- **Three views:** Card puts each post in its own card with some content expanded inline. Classic looks like the old site and "seems to be the favorite among existing users". Compact is "designed for scrolling through posts quickly". The redesign also added endless scroll — [Malay Mail / press, 2018-04-04](https://www.malaymail.com/amp/news/tech/gadgets/2018/04/04/something-for-everyone-reddit-redesign-comes-with-three-viewing-options/1614355); [Digital Trends](https://www.digitaltrends.com/computing/reddit-redesign-launches-to-first-users/)
- **Rollout:** first shown to about 1% of users. Early users could opt out via old.reddit.com — [Malay Mail](https://www.malaymail.com/amp/news/tech/gadgets/2018/04/04/something-for-everyone-reddit-redesign-comes-with-three-viewing-options/1614355); [TechRadar](https://www.techradar.com/news/reddit-redesign-rolls-out-to-a-random-group-of-hopefully-happy-users)
- **Reported results (company to advertisers, not independently audited):** Reddit's VP of brand partnerships cited "three to seven times better user engagement rates" on the redesign than on classic. Ad case studies: Audi 8x engagement, 11x comment rate, 17x vote rate; Black & Decker 3x CTR — [MarTech, 2018-08-06](https://martech.org/reddit-redesign-is-driving-higher-engagement-but-will-it-deliver-more-advertisers/). Note: these are ad-engagement figures framed for advertisers, not reader satisfaction.
- **Persistence (third-party traffic estimate):** old.reddit.com had about 84.8M visits in August 2026 with an average session of about 16.5 min, against about 1B visits for reddit.com. That puts old.reddit at roughly 8% of reddit.com visit volume — [Semrush overview for old.reddit.com](https://www.semrush.com/website/old.reddit.com/overview/); [Similarweb reddit.com](https://www.similarweb.com/website/reddit.com/) (estimates, figures surfaced via search snippet)
- Unreliable claim: "roughly 20-30% of desktop users still navigate directly to old.reddit.com every single day". The cited source is "community and analytics estimates (e.g., third-party browser extension telemetry and tech press commentary) (2024)", with no primary source — [RedCurate blog, 2026-08-02](https://redcurate.com/blog/old-reddit). Treat as unverified.
- Unverified: a search snippet claimed old.reddit "will be reserved for logged-in members who have used it in the past six months". The fetched RedCurate page did not say this; it said old Reddit works without login. Conflicting and unsourced, so not confirmed.
- **User sentiment (commentary):** a whole genre of "how to get old Reddit back" guides and redirect extensions still exists ("Old Reddit Redirect") — [AlternativeTo: Old Reddit Redirect](https://alternativeto.net/software/old-reddit-redirect/about/); [OutreachBee: Why do users want old Reddit back?](https://www.outreachbee.com/old-reddit-back/)

### Inferences
- Reddit's answer to density conflict was a **user-selectable density toggle** (card, classic, compact), not a single compromise. Card serves newcomers and visual content. Classic and compact serve scanners. A "room" in narrow chat frames should likely ship a compact/title-only default with a richer card mode.
- Old Reddit's staying power suggests that **power readers value rows per screen, visible score and comment counts, and small fixed-size thumbnails** over inline media expansion. Score works as a visual ranking cue in classic/compact (the left-side vote column).
- Engagement gains measured by advertisers don't show that a layout is better for scanning many sources. Card layouts lift per-item interaction but lower items per viewport.

### Gaps
- No official Reddit statement found on the share of users on old.reddit, or the share of users on each view mode.
- No primary Reddit post-mortem on redesign results beyond the 2018 advertiser-facing figures. r/redesign announcement posts were not fetched.
- Did not verify whether old.reddit access has actually been restricted in 2025-2026.

## TweetDeck / X Pro: column dashboards, who used them, how columns scaled, what happened

### Takeaway
TweetDeck was the archetype of the column dashboard: one column per query (timeline, mentions, lists, searches, hashtags, users). Professionals and media people were the main users. Twitter acquired it in 2011, gradually cut it back to the web, put it behind a paywall in 2023, and moved it to a $40/month tier in 2026. Columns are a power-user tool, not a mass-market default.

### Cited Findings
- Launched 2008-07-04 by Iain Dodsworth as an independent client. Twitter acquired it 2011-05-25 for about £25M (UberMedia was also bidding) — [Wikipedia: TweetDeck](https://en.wikipedia.org/wiki/TweetDeck)
- Design: "a series of customizable columns" showing timeline, mentions, DMs, lists, trends, favorites, search results, hashtags, or all posts by or to one user. It supported multiple accounts and scheduling — [Wikipedia](https://en.wikipedia.org/wiki/TweetDeck); [Euronews](https://www.euronews.com/next/2023/08/16/elon-musk-has-put-tweetdeck-behind-a-paywall-is-this-the-last-straw-for-twitter-users)
- Users: professional Twitter users and media professionals (Wikipedia's characterization) — [Wikipedia](https://en.wikipedia.org/wiki/TweetDeck)
- Platform contraction: mobile apps suspended May 2013; Windows app discontinued 2016-04-15; macOS app discontinued 2022-07-01. It ended up web-only — [Wikipedia](https://en.wikipedia.org/wiki/TweetDeck)
- July 2023: new TweetDeck forced on users, with verification/Premium required within 30 days. Paywall enforced by 2023-08-17; renamed X Pro — [9to5Mac, 2023-07-03](https://9to5mac.com/2023/07/03/twitter-charging-for-tweetdeck/); [Search Engine Land](https://searchengineland.com/tweetdeck-is-no-longer-free-430811); [Euronews](https://www.euronews.com/next/2023/08/16/elon-musk-has-put-tweetdeck-behind-a-paywall-is-this-the-last-straw-for-twitter-users)
- 2026-03-26: X Pro moved to Premium+ (about $40/month, about $395/year), up from the $8/month Premium bundle, without prior announcement. Reports say X's Nikita Bier hinted at a replacement product — [PiunikaWeb, 2026-03-27](https://piunikaweb.com/2026/03/27/x-pro-tweetdeck-locked-premium-plus-new-product-coming/); [Wikipedia](https://en.wikipedia.org/wiki/TweetDeck)

### Inferences
- The platform owner kept columns alive for monitoring-heavy professionals and later priced them as a premium feature. That suggests multi-column is valued but by a narrow segment. It fits well as an optional "fullscreen/power" layout, less well as the default in a 380-760px chat column.
- Columns scaled horizontally (side-scrolling past the viewport). That only works on wide desktop screens, which is consistent with the mobile apps being cut early.

### Gaps
- No published usage numbers for TweetDeck (DAU, columns per user) were found.
- No first-party design retrospective from the TweetDeck team was found within budget.

## Widget / portal dashboards: iGoogle, Pageflakes, Netvibes, My Yahoo, plus Google Reader

### Takeaway
AJAX start pages boomed from 2005 to 2007 and faded as browsing moved to mobile and to social/algorithmic feeds. Pageflakes died in 2012 from outages and stagnation, iGoogle closed in 2013, and Google Reader closed the same year with a "loyal but declining" following. All of them asked users to build and maintain the page themselves.

### Cited Findings
- iGoogle: shutdown announced 2012 and effective 2013-11-01. Google's stated rationale was that the market was centering on platforms like Chrome and Android, so a personalized web homepage mattered less — [Failory: iGoogle](https://www.failory.com/google/igoogle); [gHacks, 2013-11-01](https://www.ghacks.net/2013/11/01/goodbye-igoogle-time-come/); [Google Operating System blog, 2012-07](http://googlesystem.blogspot.com/2012/07/igoogle-will-be-discontinued.html)
- User backlash (sentiment): "Google Fans Revolt Over iGoogle Shutdown" — [Search Engine Roundtable](https://www.seroundtable.com/igoogle-sunset-revolt-15388.html)
- Pageflakes: AJAX start page similar to Netvibes, My Yahoo! and iGoogle, run 2005 to January 2012. Discontinued after several outages, lagging competition and stale development — [Wikipedia: Pageflakes](https://en.wikipedia.org/wiki/Pageflakes)
- AJAX start pages proliferated 2005-2007, then declined gradually as mobile replaced desktop — [Failory](https://www.failory.com/google/igoogle) (secondary)
- Google Reader: shutdown announced 2013-03-13, effective 2013-07-01. Official blog: "We know Reader has a devoted following who will be very sad to see it go" — [Official Google Reader Blog](http://googlereader.blogspot.com/2013/03/powering-down-google-reader.html). Press reported Google citing declining usage and a focus on fewer products — [CNN, 2013-03-14](https://www.cnn.com/2013/03/14/tech/web/google-reader-discontinued); [Wikipedia: Google Reader](https://en.wikipedia.org/wiki/Google_Reader)
- Feedly reported 500,000 new users within 48 hours of the Reader announcement and 3 million within two weeks — [Wikipedia: Google Reader](https://en.wikipedia.org/wiki/Google_Reader)

### Inferences
- The shared failure mode was **setup and maintenance effort**: users had to pick, arrange and prune widgets and feeds. When algorithmic feeds removed that work, casual users left and a devoted minority stayed. An AI-assembled room (agent builds and arranges portals) directly targets this historical weakness.
- The devoted minority is real and migrates quickly when a product dies (Feedly's surge). Export/import (OPML) matters for trust.

### Gaps
- No primary Netvibes or My Yahoo decline data found within budget. My Yahoo's later history (it was largely wound down in the 2010s) is unverified here.
- No quantitative iGoogle usage figures found.

## Feedly, Flipboard, Apple News, Artifact, Tapestry, Are.na, Mastodon advanced UI, Windows Live Tiles, iOS widgets

### Takeaway
Successful readers provide **multiple density modes chosen per source**: Feedly offers title-only, magazine, cards and full article, each set per feed. Skeuomorphic or novel layouts gave way to the web's native scroll: Flipboard's page flip, Mastodon's multi-column default and Windows Live Tiles were all demoted or dropped. Tapestry bet on a unified chronological timeline with soft-muting. Artifact shows that piling on features muddles a reader's purpose.

### Cited Findings
**Feedly**
- Official views: Title-only, Magazine, Cards, plus Compact/Comfortable density. Views can be set per source, per feed or per group — [Feedly Docs](https://docs.feedly.com/article/276-how-do-i-change-the-views-of-my-feeds-and-source)
- Title-only is "popular for scanning a high-volume feed" and suits readers who go through every article. Cards make the image dominant and suit visual collections such as food and design — [Feedly Docs via search summary](https://docs.feedly.com/article/276-how-do-i-change-the-views-of-my-feeds-and-source); [MakeUseOf review](https://www.makeuseof.com/tag/feedly-reviewed-what-makes-it-such-a-popular-google-reader-replacement/)

**Flipboard**
- 2010: the "Pages" layout engine turned web articles into iPad magazine pages. The flip gesture, modeled on train departure boards turned horizontal, was "the heart" of the app — [First Round Review](https://review.firstround.com/how-old-magazines-and-lamborghinis-inform-flipboards-design-process-and-approach/); [Flipboard Engineering: Layout for Web and Windows](https://about.flipboard.com/engineering/layout-in-flipboard-for-web-and-windows/)
- "Duplo" layout engine: a modular block-and-grid system that fits content into thousands of page layouts at every size, built for the web and Windows — [Flipboard Engineering](https://about.flipboard.com/engineering/layout-in-flipboard-for-web-and-windows/); [TechCrunch, 2014-03-23](https://techcrunch.com/2014/03/23/layout-in-flipboard-for-web-and-windows/)
- The 2013 web version's page flip was judged "out of whack with the way of the web", where scrolling is native, and Flipboard later moved toward scrolling — [Fast Company](https://www.fastcompany.com/3042156/how-flipboard-found-itself-on-the-web-by-letting-go-of-its-past) (page returned 403; claim via search summary); [TechPP, 2020-02-07 (commentary)](https://techpp.com/2020/02/07/the-app-blog-flippin-hell-is-flipboard-set-to-become-scrollboard/)

**Artifact (Systrom/Krieger, 2023-2024)**
- Launched 2023-01-31. Shutdown announced January 2024 because "the market opportunity isn't big enough to warrant continued investment" — [Artifact Medium post](https://medium.com/artifact-news/shutting-down-artifact-1e70de46d419); [Mediagazer](https://mediagazer.com/240112/p14)
- Analysis: it grew from an AI news reader into link posts, text posts, place recommendations and AI images, which "may have potentially confused users as to when or why they should use it". About 444K total downloads, with new installs down to about 12K/month by October 2023. Competitor SmartNews had about 2M — [TechCrunch, 2024-01-18](https://techcrunch.com/2024/01/18/why-artifact-from-instagrams-founders-failed-shut-down/) (data from app intelligence firms)

**Tapestry (Iconfactory)**
- Kickstarter launched January 2024 and raised more than $177K. The app launched 2025-02-04, combining RSS, YouTube, Bluesky, Mastodon, podcasts, Reddit, Tumblr, Micro.blog and GoComics "into unified feeds" — [TechCrunch, 2025-02-04](https://techcrunch.com/2025/02/04/team-behind-twitterrific-launches-a-multi-feed-app-called-tapestry/); [MacStories](https://www.macstories.net/news/the-iconfactory-launches-project-tapestry-a-kickstarter-campaign-to-create-a-universal-inbox-for-rss-social-media-and-more/); [iDownloadBlog](https://www.idownloadblog.com/2025/02/04/tapestry-app-social-feeds-bluesky-mastodon-youtube-rss/) ("unified chronologically sorted timeline")
- "Muffle" collapses matching items instead of hiding them. Mute rules also cover spoilers. Multiple custom feeds are a paid feature ($1.99/mo, $19.99/yr, $79.99 lifetime) — [TechCrunch, 2025-02-04](https://techcrunch.com/2025/02/04/team-behind-twitterrific-launches-a-multi-feed-app-called-tapestry/)
- Iconfactory followed up with a 2025 update post ("What's New? No Déjà Vu!") that by its title addresses showing new versus already-seen items. Content not fetched — [Iconfactory blog, 2025-04](https://blog.iconfactory.com/2025/04/tapestry-whats-new-no-deja-vu/)

**Mastodon advanced web interface**
- Multi-column TweetDeck-style was the original default. Version 2.9 (June 2019) added a single-column view, which became the default for new users, with multi-column kept as the opt-in "Advanced Web Interface" — [Wikipedia: Mastodon](https://en.wikipedia.org/wiki/Mastodon_(social_network)); [Fedi.Tips](https://social.growyourown.services/@FediTips/115452887632295450)
- Advanced mode allows unlimited columns, including pinned hashtag columns that combine, require or exclude tags — [Infosec.Exchange wiki](https://wiki.infosec.exchange/faq/read_discover/advanced_mode)

**Windows 8/10 Live Tiles**
- Removed from the Windows 11 Start menu (2021) in favor of static pinned icons plus a separate Widgets board. Press reported that few users customized tile layouts and called the feature niche — [Tom's Guide](https://tomsguide.com/news/windows-11-heres-all-the-features-microsoft-just-killed); [Windows Latest, 2021-06-16](https://www.windowslatest.com/2021/06/16/live-tiles-can-be-re-enabled-in-windows-11-if-you-really-love-them/); [Windows Central](https://www.windowscentral.com/why-microsoft-considering-pivot-away-live-tiles) (article body not retrievable; press commentary, not Microsoft data)
- User demand remained: a "Bring back live tiles" discussion exists on Microsoft's WindowsAppSDK GitHub — [GitHub discussion #427](https://github.com/microsoft/WindowsAppSDK/discussions/427)

**iOS widgets / Smart Stacks (iOS 14, 2020)**
- Fixed sizes: small about 169x169pt (one tap target), medium about 360x169pt, large about 360x376pt. Medium and large allow multiple deep links. Margins are 16pt for text and 8pt for content with backgrounds — [Adapptor design notes](https://www.adapptor.com.au/blog/designing-for-ios-14-home-screen-widgets); [Lunabee](https://lunabee-studio-dev.medium.com/widgets-ios-14-possibilities-design-good-practices-and-limitations-d40e566715af)
- Apple guidance (WWDC20 "Meet WidgetKit"): widgets should be glanceable, relevant and personalized, because people spend only moments on the Home Screen — [Apple WWDC20](https://developer.apple.com/videos/play/wwdc2020/10028/)
- Smart Stacks place several widgets in one slot (2x2, 2x4 or 4x4 icon cells) and rotate them automatically based on usage — [Screen Rant](https://screenrant.com/iphone-smart-stacks-widgets-home-screen/); [Gadget Hacks](https://ios.gadgethacks.com/how-to/add-ios-14s-new-smart-stack-widget-your-iphones-home-screen-0320441/)

### Inferences
- Flipboard, Mastodon and Windows all **demoted their most distinctive dense or novel layout** (page flip, multi-column default, live tiles) toward simpler scroll or static defaults, and kept the advanced mode as an opt-in where they kept it at all. Pattern: novel spatial layouts delight early adopters but don't survive as defaults.
- Fixed size tiers (iOS small/medium/large, Live Tile sizes) express hierarchy through size. A room could map portal importance to 1-3 size tiers instead of free-form sizing.
- Smart Stacks solve "too many widgets, too little space" by stacking and rotating within one slot, which is relevant to a narrow 380px frame (for example, tabbed or stacked portals).
- Tapestry's collapse-not-hide approach (Muffle) and its "what's new" work suggest that unified timelines need strong noise controls and seen-state to stay usable.

### Gaps
- Apple News and Are.na were not researched within budget. No sources gathered on Apple News layout or Are.na's block/channel grid.
- No Microsoft first-party statement on Live Tile usage numbers found. Tile sizes (small/medium/wide/large) not sourced here.
- No Tapestry usage or retention data found, and no founder quotes on why they chose unified over per-source.

## Cross-cutting: does mixing many sources in columns help or overwhelm? Unified timeline vs per-source columns

### Takeaway
The evidence points to a hybrid: a simple single-stream or single-column default for most users, with per-source columns as an opt-in power mode (Mastodon, TweetDeck/X Pro) and density chosen per source (Feedly, Reddit). Newer entrants such as Tapestry chose a unified chronological timeline with filtering, while column dashboards survived only as niche or paid power tools.

### Cited Findings
- Mastodon's switch to a single-column default for new users in 2019, with multi-column as opt-in — [Wikipedia: Mastodon](https://en.wikipedia.org/wiki/Mastodon_(social_network))
- TweetDeck/X Pro positioned as a paid professional tool (Premium, then Premium+ at about $40/month in 2026) — [PiunikaWeb](https://piunikaweb.com/2026/03/27/x-pro-tweetdeck-locked-premium-plus-new-product-coming/)
- Tapestry merges sources into "unified feeds" sorted chronologically, with multiple custom feeds as a paid upgrade (a middle ground: a few curated unified streams rather than one column per source) — [TechCrunch](https://techcrunch.com/2025/02/04/team-behind-twitterrific-launches-a-multi-feed-app-called-tapestry/); [iDownloadBlog](https://www.idownloadblog.com/2025/02/04/tapestry-app-social-feeds-bluesky-mastodon-youtube-rss/)
- Feedly lets density vary per source: title-only for high-volume feeds, cards for visual ones — [Feedly Docs](https://docs.feedly.com/article/276-how-do-i-change-the-views-of-my-feeds-and-source)
- Reddit offers a user-chosen density (card, classic, compact) over one mixed feed — [Digital Trends](https://www.digitaltrends.com/computing/reddit-redesign-launches-to-first-users/)
- Start pages that required manual arrangement declined (Pageflakes, iGoogle), and Live Tiles were dropped partly because few users customized them — [Wikipedia: Pageflakes](https://en.wikipedia.org/wiki/Pageflakes); [Tom's Guide](https://tomsguide.com/news/windows-11-heres-all-the-features-microsoft-just-killed)

### Inferences
- For a 380-760px chat-embedded room: at most one or two columns are practical. Likely defaults are a stacked or tabbed single column of portals, or one unified "what's new" stream, with side-by-side columns reserved for fullscreen.
- Per-source portals keep source identity and context (the TweetDeck and Mastodon hashtag-column value). A unified stream reduces scanning cost (Tapestry). Offering both views over the same subscriptions fits the evidence.
- Because manual curation and arrangement drove past churn, having an agent build and arrange the room is a real differentiator. The room should still stay legible when users don't maintain it (seen state, collapsing noisy portals).

### Gaps
- No controlled study or published A/B data comparing unified timelines with per-source columns for reading comprehension or overload was found.
- No usage data on how many columns TweetDeck or Mastodon advanced users actually configure.
