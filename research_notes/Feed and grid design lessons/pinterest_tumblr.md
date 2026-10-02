# Pinterest and Tumblr: Lessons on Feed and Grid Layout Design

Scope note: the brief allowed about 15 tool calls. Primary sources (Pinterest Engineering on Medium, Tumblr staff and engineering blogs, Gestalt docs) are marked [primary]. Press is marked [press]. Creator and SEO blogs are marked [third-party] and their claims should not be treated as confirmed platform specs. Fast Company's "definitive history" of Pinterest returned HTTP 403, so its details come only through search-result summaries.

## Pinterest: masonry grid origin, card treatment, feed mechanics, and criticisms

### Takeaway
Pinterest's grid was designed for visual browsing: images are the card, columns have a fixed width, and heights vary. Over time Pinterest stripped text out of feed cards (it moved to closeups), swapped the chronological following feed for a ranked "smart feed" (2014-2015), and added modules or carousels because, in its own engineers' words, the plain grid "limits our ability to provide more context." The masonry grid has no linear reading order. Users strongly resisted changes that removed their own curation or their chronological view of people they follow.

### Cited Findings

**Origin and rationale**
- Co-founder Evan Sharp, a Columbia architecture student who had worked in Facebook product design, designed and coded Pinterest and its grid for the March 2010 launch. He wanted to organize thousands of photos and architectural drawings online. [Wikipedia: Evan Sharp](https://en.wikipedia.org/wiki/Evan_Sharp); [Designer Founders](https://designerfounders.com/evan-sharp)
- Reported via search summary of Fast Company: in 2009 Sharp designed a "liquid" image grid that adapts to any screen size. The team spent months refining text placement, borders and the column width (reported as 192px per image). Sharp is quoted as saying "The grid was everything." I could not open the article (403), so treat the 192px figure as reported, not verified. [Fast Company, definitive history of Pinterest](https://www.fastcompany.com/90952216/pinterest-definitive-history-visual-social-media)
- Sharp, on what architecture taught him: "Architecture school made me see the web in a similar way and to understand how people use different kinds of web space in different ways, and for different purposes." [Archinect interview](https://archinect.com/features/article/39788357/working-out-of-the-box-pinterest-co-founder-evan-sharp)

**Masonry mechanics (Gestalt design system) [primary]**
- Pinterest's Gestalt `Masonry` component "creates a deterministic grid layout, positioning items based on available vertical space." It includes virtualization, server rendering and infinite-scroll support. [Gestalt Masonry README](https://github.com/pinterest/gestalt/blob/master/packages/gestalt/src/Masonry/README.md); [Gestalt web overview](https://gestalt.pinterest.systems/web/overview)
- How it works: items are rendered offscreen, their heights are measured, positions are computed, then items are painted. This repeats continuously as new items are fetched during scrolling. [Gestalt Masonry README](https://github.com/pinterest/gestalt/blob/master/packages/gestalt/src/Masonry/README.md)
- Masonry "knows nothing about its items." For that reason item heights cannot change after the first render. A height change would cause overlaps or gaps. [Gestalt Masonry README](https://github.com/pinterest/gestalt/blob/master/packages/gestalt/src/Masonry/README.md)
- The `fullWidthLayout` option uses flexible column widths that expand or shrink to fill the container. [Gestalt Masonry README](https://github.com/pinterest/gestalt/blob/master/packages/gestalt/src/Masonry/README.md)

**Pin sizing and aspect-ratio limits**
- Commonly cited: 2:3 (1000x1500) is the recommended pin ratio. Pins taller than about 2:3 are truncated in the feed and shown in full only on closeup. These figures come from creator and SEO blogs [third-party], which attribute them to Pinterest guidance. I did not find the official help-center page in this pass. [Louise Myers](https://louisem.com/228434/pinterest-pin-size); [WP Tasty](https://www.wptasty.com/pinterest-image-sizes); [SocialRails](https://socialrails.com/blog/pinterest-pin-size-dimensions-guide)
- [third-party, unverified] One guide says the 2:3 feed truncation started in 2023. Another says pins render about 236px wide in a two-column mobile feed. [Pixpipe](https://pixpipe.app/en/guides/pinterest-pin-size); [search summary of pin-size guides](https://postfa.st/sizes/pinterest/pin)
- Rich Pin descriptions were removed from feeds as part of a simplification push and now appear only in closeups. This is the "image-first card, text on closeup" split. [Tailwind blog](https://www.tailwindapp.com/blog/what-you-need-to-know-about-pinterests-activity-changes) [third-party]

**Closeups and feed ranking [primary]**
- Pinnability (March 20, 2015) is Pinterest's set of ML models for the home feed. It predicts likes, repins, closeup clicks, clickthroughs, comments and hides. Before Pinnability the home feed was chronological, so "a low-relevance Pin could very well appear before a high-relevance one." In A/B testing, home-feed repinner count rose "more than 20 percent," with gains in total repins and clickthroughs. [Pinnability](https://medium.com/pinterest-engineering/pinnability-machine-learning-in-the-home-feed-64be2074bf60)
- The smart feed rested on three principles: "Different sources of Pins should be mixed together at different rates"; lower-quality pins can be held back for later sessions; and "Pins should be arranged in the order of best-first rather than newest-first." Its sources were repins from people you follow, Related Pins, and followed interests. Each source fed a scored pool, and pins were served in "chunks." No metrics were published. [Building a smarter home feed](https://medium.com/pinterest-engineering/building-a-smarter-home-feed-ad1918fdfbe3)
- Modules: "The grid limits our ability to provide more context on the recommendations as well as show new topics." Pinterest added carousel and landing-page modules. They are placed by "skip-slot blending," meaning a module only replaces a pin slot when its predicted utility beats the pin it would displace, and repeated low-engagement modules are fatigued (suppressed). No A/B numbers were given. [Module Relevance on Home Feed](https://medium.com/pinterest-engineering/module-relevance-on-homefeed-ae76f8b545b2)
- Lightweight scoring on candidate generators raised total saves and closeups by 2-3%. [Unified Lightweight Scoring](https://medium.com/pinterest-engineering/pinterest-home-feed-unified-lightweight-scoring-a-two-tower-approach-b3143ac70b55)
- Related Pins has its own engineering line, including a post on keeping recommendations fresh. [Keeping Related Pins fresh](https://medium.com/pinterest-engineering/keeping-related-pins-fresh-6b0e2876d7e)

**Redesign backlash and criticisms**
- March 2012 redesign: boards changed from thumbnail grids to one featured image with three small tiles. Users complained that this "effectively deletes" their curation work, that the new header wasted space, and that fonts were inconsistent. More than 400 negative comments asked for "the option to choose between layouts," and Pinterest stayed silent. [TechCrunch, 2012](https://techcrunch.com/2012/03/21/it-wasnt-broke-but-pinterest-fixed-it-now-users-hate-it/) [press]
- Users missed "the good old days when your Pinterest feed actually had pins in from the people you follow circa 2014." Pinterest later added a chronological "Following" feed. [Fall for DIY](https://fallfordiy.com/blog/2016/09/19/how-to-get-back-to-the-good-old-days-of-pinterest/); [Cool Mom Picks, 2015](https://coolmompicks.com/blog/2015/02/27/pinterest-feed-changes-how-to-see-what-you-want); [MarTech](https://martech.org/with-pinnability-pinterests-home-feed-is-no-longer-chronological/) [press/third-party]
- Reading order (commentary): CSS-column masonry fills down the first column before the next, which "kills the reading order." In a latest-first feed the second-newest item ends up halfway down the next column. Masonry suits mood or visual browsing but is worse for comparison. CSS Grid Level 3 `masonry` keeps left-to-right DOM order. [Art of Styleframe](https://artofstyleframe.com/blog/card-based-ui-layouts-grids-masonry-feeds/); [DEV: Masonry with CSS Grid](https://dev.to/nickbenksim/masonry-layout-with-css-grid-2n76) [third-party]
- The claim that NN/g found list views often beat card views for comparison tasks comes from a secondary summary. I did not open the original NN/g article. [Art of Styleframe summary](https://artofstyleframe.com/blog/card-based-ui-layouts-grids-masonry-feeds/)

### Inferences
- Pinterest's grid works because every card is about the same thing (an image) and the user's job is to recognize, not read. A multi-source reading room has text-heavy, mixed items, so its job is closer to reading and comparing. Masonry's lack of reading order and ragged edges cost more there.
- The "image in feed, text in closeup" split matches a "card in room, full read in portal or detail" split. Feed cards should stay small and uniform, and depth should open one level down.
- Gestalt's fixed-height-after-render rule is a useful engineering constraint for an embedded widget: settle card heights before layout, for example by capping or truncating aspect ratio like Pinterest's 2:3, so cards don't jump inside a chat iframe.
- Pinterest's "skip-slot" rule is a good discipline for an agent-curated room: only insert an agent module (digest, highlights) where it beats the organic item it displaces, and fatigue modules the user ignores.
- At 380px, a two-column masonry gives roughly 180px columns, below Pinterest's reported 192px design unit. That argues for a single column in the narrow chat view and multiple columns only in fullscreen. This is inference, not a Pinterest finding.

### Gaps
- I could not open the official Pinterest help or creative-spec page for the 2:3 limit or truncation behavior; the claims are third-party.
- I found no published Pinterest A/B results on grid density, column count or card chrome such as text under pins. The engineering metrics found are about ranking.
- I could not verify the 192px column width or full Sharp quotes (Fast Company 403).
- I did not find a Pinterest-authored retrospective on infinite scroll.
- I did not find the exact date of the "Following" tab launch.

## Tumblr: dashboard, post types, NPF, reblogs, algorithmic dashboard, redesign backlash

### Takeaway
Tumblr's dashboard is a single column where the reblog chain is the main visual unit. Its biggest fights have been over chronology (Best Stuff First, 2017, kept as a toggle), over how reblog chains look (2015 flattening, 2026 notes split), and over Twitter-like chrome (2023 left nav). The 2026 reblog-notes change was reversed in under two days after more than 100k complaints. The pattern: users accept new structure behind a toggle, but reject changes that break the conversation unit or hide its reach.

### Cited Findings

**Post types to NPF [primary]**
- Legacy Tumblr stored seven post types (text, photo, video, audio, quote, chat, link) in different database columns and structures. NPF (Neue Post Format, from 2018, via `?npf=true` in the API) replaces them with JSON arrays of typed content blocks (text with subtypes such as "quirky," image/GIF, location, with links, video, polls and more planned). Blocks can be mixed in one post, and a separate `layout` field handles arrangements such as rows for image sets. Stated reasons: HTML "was intended for the browser, long before the concept of mobile apps existed"; JSON is faster to process, safer and portable across web, iOS and Android. [Tumblr Engineering: NPF announcement](https://engineering.tumblr.com/post/179149527679/new-public-api-and-neue-post-format-documentation); [NPF spec](https://www.tumblr.com/docs/npf)
- Per the NPF spec and community writeups, a single "post type" no longer means much when one post mixes blocks. The editor removed the step of picking a post type first. Users first read this as Tumblr removing post types, even though the add-photo and add-link buttons stayed in the composer. [NPF spec](https://www.tumblr.com/docs/npf); [Unwrapping Tumblr](https://unwrapping.tumblr.com/post/828200234855366656); [WIP staff Q&A on legacy editor](https://wip.tumblr.com/post/715588800148045824/is-there-any-possibility-of-keeping-the-legacy)

**Reblog chain rendering**
- September 2015: Tumblr replaced nested blockquote indents with a flat list of comments that "showcase all comments as equals, not buried under an impossible stack of blockquote indents." Avatar and username moved above each comment, which also shortened long chains. Deep nesting had squeezed line length, especially on mobile. Some users still revolted. [TechCrunch, 2015](https://techcrunch.com/2015/09/02/tumblr-finally-makes-reblogs-more-readable-especially-on-mobile-devices) [press]; [Tumblr Support: On reblogs](https://support.tumblr.com/post/129738931057/on-reblogs) [primary]; [The Digital Reader](https://the-digital-reader.com/2015/09/02/tumblr-fixes-reblog-quirk-and-its-users-are-revolting) [press]
- March 17, 2026: Tumblr split reblog notes so each reblog in a chain got its own likes, reblogs and replies, with the stated aim to "give contributors the recognition they deserve." Reported fallout:
  - More than 100,000 complaints through the feedback system.
  - More than 28,000 mostly negative comments on the staff post.
  - Complaints that it looked like X, Bluesky or Threads.
  - One creator's post fell from 152,372 visible notes to 2 comments, 1,107 reblogs and 1,673 likes.

  Tumblr reversed the change on March 18, 2026, saying "we also should have communicated this differently," and promised to co-design future changes with users. [PiunikaWeb](https://piunikaweb.com/2026/03/18/tumblr-reverses-reblog-notes-update-backlash/); [Daily Planet DC](https://dailyplanetdc.com/2026/03/17/why-tumblr-users-are-opposing-the-new-reblog-notes-feature/); [Abijita](https://www.abijita.com/tumblr-reverses-reblog-changes-after-strong-user-backlash/); [The Verge on X](https://x.com/verge/status/2033927139612090737); [Tumblr Support, March 2026](https://support.tumblr.com/post/812622447606104064) [press/primary mix; the numbers come from secondary outlets]

**Chronological vs "Best Stuff First"**
- October 2017: Tumblr staff announced "Best Stuff First moves the best stuff on your dashboard... right up to the top," aimed at people who follow many blogs. It rolled out on iOS and Android, on by default. [Staff: Best stuff first](https://www.tumblr.com/staff/166540346380/best-stuff-first) [primary]; [Wikipedia: Tumblr](https://en.wikipedia.org/wiki/Tumblr)
- Users widely shared "turn it off" instructions, saying it scrambled dashboard order and hurt discoverability for small artists. [Esselle](https://esselley.tumblr.com/post/166575308058/how-to-turn-off-tumblrs-new-best-stuff-first); [user post on out-of-order dashboard](https://www.tumblr.com/pynkhues/627112614608125952/tumblr-introduced-out-of-order-best-stuff-first) [user commentary]
- In a later core-strategy post, staff wrote that they are "not getting rid of the reverse-chronological dashboard" and that users can toggle off Best Stuff First. They named the core problem as "Tumblr is not easy to use." Strategy goals: discovery for new users, consistent quality content, easier conversation, creator support, return visits. [Staff: Core Product Strategy](https://www.tumblr.com/staff/722502027705565184/hi-folks-there-seems-to-be-a-lot-of) [primary]; [Help: Dashboard Preferences](https://help.tumblr.com/hc/en-us/articles/115013590547-Dashboard-Preferences); [Help: How Tumblr Recommends Content](https://help.tumblr.com/how-tumblr-recommends-content/)

**2023 Twitter-like web layout**
- August 2023, after about a month of testing with some users: navigation moved to a left rail like X's, compose moved to the bottom left, and nav icons got text labels. Tumblr's rationale: "When adding something new to Tumblr in the past, we'd simply add a new icon to our navigation with little further explanation." Users reacted badly ("OHHHH TUMBLR CHANGED TO LOOK LIKE TWITTER. NOT GOOD"). There was no rollback. Tumblr said it was considering a collapsible nav and better large-screen layouts. [TechCrunch, 2023](https://techcrunch.com/2023/08/17/tumblr-is-rolling-out-a-new-web-interface-and-it-looks-a-lot-like-x-formerly-twitter) [press]; [TechRadar](https://www.techradar.com/computing/social-media/tumblr-changes-its-desktop-layout-now-resembles-twitter-but-without-all-the-drama); [Hypebeast](https://hypebeast.com/2023/8/tumblr-twitter-like-user-interface-update-info)
- Users built "dashboard unfucker" userscripts to undo "the twitterification of tumblr's dashboard." [GitHub: dashboard-unfucker](https://github.com/Forget-About-Me2/dashboard-unfucker); [enchanted-sword fork](https://github.com/enchanted-sword/dashboard-unfucker)
- Context: the CEO disclosed in 2023 that Tumblr loses about $30M a year, which helps explain the pressure to change. [TechCrunch, 2023](https://techcrunch.com/2023/08/17/tumblr-is-rolling-out-a-new-web-interface-and-it-looks-a-lot-like-x-formerly-twitter)
- 2014 precedent: a TechCrunch piece covered users protesting an image-size change that "broke GIFs and photosets," a layout change that hit content shaped for the old dimensions. I only saw the headline. [TechCrunch](https://techcrunch.com/?p=1078658)

### Inferences
- Tumblr shows that a single column with distinct post shapes works for mixed-media reading streams. The post type was mainly a rendering and authoring device, and NPF kept the visual variety while unifying the data model. A room can likewise use one card schema made of blocks and still render shapes per source (quote, link, image, text).
- Chronology is a trust contract. Both platforms kept or restored a chronological view after ranking. For a personal reading room, "latest" should be the default or one tap away. Agent ranking or highlights belong in a clearly labeled separate lane, as Pinterest did with modules and Tumblr with the Best Stuff First toggle.
- Users defend the unit of meaning: Tumblr's reblog chain with its total notes, Pinterest's hand-curated board grid. Changes that fragment that unit or hide its context get reversed. In a room, the equivalent units are the portal (source) and the item's provenance. Agent curation should not hide where an item came from.
- Users are bothered by chrome that looks like a competitor (left rail, X look) separately from whether the change is useful. Tumblr's reason for labeled nav was reasonable, but it lost on identity. That argues for keeping the room's own visual identity rather than borrowing generic social-feed chrome.
- Ship big layout changes behind a toggle and communicate them first. Both 2012 Pinterest and 2026 Tumblr made silence or poor communication a big part of the backlash.

### Gaps
- I did not find Tumblr engineering or staff posts with metrics (A/B results) for Best Stuff First, the 2023 nav, or the 2026 reblog change.
- I did not cover Tumblr's 2024-2025 work in depth: the WordPress backend migration (announced 2024, later paused per press), the "For You"/"Following" tabs, and default changes. Search did not surface them in budget.
- I could not confirm whether the 2023 left-nav layout was later made collapsible or optional.
- I only partly checked the exact date of the staff core-strategy post (its post ID suggests mid-2023).
- I did not fetch the 2015 Tumblr Support "On reblogs" text directly; I relied on the TechCrunch summary for its quotes.

## Lessons that transfer to a small, personal, agent-curated reading room (narrow chat column, ~380-760px)

### Takeaway
Use a single column in narrow views. Settle card heights before layout. Keep feed cards light and push depth to a detail view. Keep a chronological view, and label agent curation as a separate lane. Never hide an item's source or context.

### Cited Findings
- Image-first, uniform-width cards scale on Pinterest because text is removed from the feed and shown on closeup. [Tailwind](https://www.tailwindapp.com/blog/what-you-need-to-know-about-pinterests-activity-changes); [Pinnability, which counts closeup as an engagement signal](https://medium.com/pinterest-engineering/pinnability-machine-learning-in-the-home-feed-64be2074bf60)
- Plain grids can't carry context. Pinterest added modules and blended them only where they beat displaced items. [Module Relevance](https://medium.com/pinterest-engineering/module-relevance-on-homefeed-ae76f8b545b2)
- Masonry needs heights fixed before placement. [Gestalt Masonry](https://github.com/pinterest/gestalt/blob/master/packages/gestalt/src/Masonry/README.md)
- Masonry breaks reading order. [Art of Styleframe](https://artofstyleframe.com/blog/card-based-ui-layouts-grids-masonry-feeds/)
- Nested indentation breaks on narrow screens; Tumblr flattened reblog chains for mobile readability. [TechCrunch, 2015](https://techcrunch.com/2015/09/02/tumblr-finally-makes-reblogs-more-readable-especially-on-mobile-devices)
- Chronological fallbacks kept users: Tumblr's Best Stuff First toggle and Pinterest's Following feed. [Tumblr staff](https://www.tumblr.com/staff/722502027705565184/hi-folks-there-seems-to-be-a-lot-of); [Fall for DIY](https://fallfordiy.com/blog/2016/09/19/how-to-get-back-to-the-good-old-days-of-pinterest/)
- Fragmenting a content unit and its reach metrics caused a reversal within two days. [PiunikaWeb](https://piunikaweb.com/2026/03/18/tumblr-reverses-reblog-notes-update-backlash/)

### Inferences
- At 380px use one column. Never nest more than one level, for example a quoted source inside a card. Consider two columns (masonry with left-to-right order, or plain rows) only in fullscreen at about 760px or wider.
- Cap media height, as Pinterest does with its 2:3-style truncation, so cards are predictable and there is no layout shift in the chat iframe. Put full content in the portal or detail view (the "closeup").
- Keep visual distinction per source or type, like Tumblr post shapes, on top of one block-based card schema, like NPF.
- Agent sections ("What's new," highlights, digests) should work like Pinterest modules: clearly bounded, inserted only when they earn the slot, and suppressed when ignored. A plain chronological per-portal view should stay available.
- A small personal room doesn't need infinite scroll. Both platforms' endless feeds serve engagement metrics a ~$5/mo reading product doesn't share. A finite, "caught up" style view fits better. This is my inference; no source here tests it.

### Gaps
- None of the sources tested layouts at chat-embedded widths. The width-specific recommendations above are inference.
