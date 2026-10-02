# Scroll, paging, end states, new-content indicators, and feed accessibility (for MCPortal "river")

Research date: 2026-10-02. Older findings are labeled with their dates.

## Q1. Infinite scroll vs pagination vs "load more": findability, satisfaction, footer access, return-to-position

### Takeaway
The evidence points the same way across studies from 2012 to 2024: a user-triggered "load more" (optionally with a bit of lazy-loading first) is the safest default for lists people come back to or look things up in. Pure infinite scroll suits only goal-less browsing, and it consistently hurts refinding, footer access, and return-to-position. Google's 2024 retreat from continuous scroll is the largest recent real-world data point for "load more" over auto-load.

### Cited Findings
- **NN/g (Tim Neusesser, 4 Sep 2022)**: infinite scroll works for "homogeneous content streams where users browse without specific goals" (social, news, entertainment). Avoid it when users need to find something specific, compare items that are far apart, or only check the top results. — [NN/g, Infinite Scrolling: When to Use It, When to Avoid It](https://www.nngroup.com/articles/infinite-scrolling-tips/)
- NN/g lists six documented infinite-scroll problems: (1) content is hard to refind because there are no landmarks; (2) an "illusion of completeness" when nothing loads and there's no indicator; (3) users can't reach the footer; (4) accessibility barriers (keyboard users tab through endless content; it notes the ARIA `feed` role as a newer mitigation); (5) heavier page load for mobile and low-bandwidth users; (6) poor SEO. — [NN/g](https://www.nngroup.com/articles/infinite-scrolling-tips/)
- NN/g on return-to-position: sites often lose scroll position during "pogo sticking" (open an item, press Back), so users land "at the top of the list, having to scroll down through screenfuls and screenfuls of already seen content." — [NN/g](https://www.nngroup.com/articles/infinite-scrolling-tips/)
- NN/g alternatives: a **Load More button** fixes footer access, the illusion of completeness, and bandwidth issues, at the cost of one click per batch. **Infinite scroll with page markers** adds landmarks that help refinding, but it doesn't fix footer access, and users find it unfamiliar. NN/g concludes "There is no solution that is overall superior." — [NN/g](https://www.nngroup.com/articles/infinite-scrolling-tips/)
- **Baymard Institute via Smashing Magazine (Christian Holst, 1 Mar 2016)**, from large-scale e-commerce usability testing:
  - Users saw pagination as slow and rarely used the numbered links, mostly just Next/Prev.
  - With infinite scroll, users looked at more products but paid less attention to each.
  - Footer problem: the footer flashes into view for "a second or two" before the next batch loads and pushes it away.
  - "Load more" gave "probably the smallest cognitive load possible for on-demand loading": users browsed more than with pagination and still examined items closely. — [Smashing Magazine / Baymard](https://www.smashingmagazine.com/2016/03/pagination-infinite-scrolling-load-more-buttons/)
- Baymard's recommended batch sizes (2016):
  - Category lists: show 10–30 items, lazy-load more, then switch to a "Load more" button after 50–100 items.
  - Search results: 25–75 items first.
  - Mobile: 15–30 items, then "Load more", with each batch loaded all at once (no lazy-loading). — [Smashing / Baymard](https://www.smashingmagazine.com/2016/03/pagination-infinite-scrolling-load-more-buttons/)
- Baymard (2016): over 90% of tested sites with "Load more" broke the Back button. Baymard recommends `history.pushState()` so users return to their exact position. — [Smashing / Baymard](https://www.smashingmagazine.com/2016/03/pagination-infinite-scrolling-load-more-buttons/)
- A secondary source says Baymard's 2024–2025 updates still prefer "Load more" and call infinite scroll "generally unhelpful". I could not verify this in Baymard's primary text, so treat it as unconfirmed. — [Meilisearch blog summary](https://www.meilisearch.com/blog/pagination-vs-infinite-scroll-vs-load-more)
- **Etsy (talk by Dan McKinley, 30 Nov 2012; write-up 6 Jan 2013)**:
  - Infinite scroll on search results cut clicks on results and items favorited from those pages.
  - Users relied less on search, although overall purchases did not drop.
  - Etsy tested the two underlying hypotheses separately. "More results per page" turned out to be wrong. Artificially slowing search did not significantly reduce engagement. McKinley said he didn't know why infinite scroll failed. — [danwin.com](https://danwin.com/2013/01/infinite-scroll-fail-etsy/); [McKinley slides](https://www.slideshare.net/danmckinley/design-for-continuous-experimentation)
- **Google Search timeline**:
  - Continuous scroll launched on mobile in Oct 2021 and on desktop in Dec 2022.
  - Google began removing it on desktop on 25 Jun 2024, and later on mobile.
  - Desktop went back to a numbered pagination bar. Mobile got a "More results" button.
  - Google's reasons were to serve results faster "instead of automatically loading results that users haven't explicitly requested", and that auto-loading had not led to significantly higher satisfaction. — [Wordtracker](https://www.wordtracker.com/blog/search-news/google-drops-continuous-scroll-in-search-results); [Tom's Guide](https://www.tomsguide.com/computing/search-engines/google-confirms-a-major-change-to-search-that-undoes-a-2-year-old-decision); [8MS](https://8ms.com/blog/2024/google-reverts-to-pagination-and-phases-out-continuous-scroll)

### Inferences
- The river is a reading stream that people return to, and it has a "seen" boundary. That makes it closer to Etsy/Google search (refinding matters) than to a goal-less TikTok feed. Explicit "10 more" buttons inline match the strongest evidence (Baymard 2016, Google 2024).
- MCPortal's batch of 10 is at the low end of Baymard's mobile range (15–30). For a dense text feed in a chat column, 10–20 is defensible, because each tap also grows the chat transcript. Consider making the batch size adapt to card density.
- Fullscreen auto-load near the end is the Baymard hybrid ("lazy-load, then button"). Cap auto-loads, for example at 2–3 pages or about 50 items, then fall back to a button. That keeps the end line and footer reachable and avoids Baymard's footer-flash problem.
- Return-to-position matters more than the paging choice itself. Persist the reader position as an item ID (like Mastodon's `last_read_id`, see Q3), not as a pixel offset, because the chat transcript reflows around the iframe.

### Gaps
- I did not find Baymard's current (2024–2026) primary article on load more vs infinite scroll; the statement above relies on a secondary summary.
- I found no Discourse-specific engineering or UX data on its infinite topic stream with progress/timeline scrubber and "last read" position. It is still a relevant precedent (topic timeline plus jump-to-last-read), but unsourced here.
- Google published no satisfaction or engagement numbers for the 2022–2024 continuous-scroll experiment, only the qualitative "not significantly higher satisfaction".

## Q2. "Caught up" end states, stopping cues, and regulatory pressure on infinite scroll (2018–2026)

### Takeaway
"You're all caught up" began in 2018 as Instagram's "time well spent" answer to criticism of its algorithmic feed. Since then, stopping cues have moved from ethics talking points to regulatory remedies. In 2026 the EU Commission preliminarily found TikTok (Feb) and Meta (Jul) in breach of the DSA, explicitly citing infinite scroll, and pushed for it to be off by default. A finite river with a visible end line is now on the right side of where regulators are heading, not just a nice touch.

### Cited Findings
- **Instagram "You're All Caught Up"**:
  - Tested with a limited group in May 2018 and launched 2 Jul 2018 on iOS and Android.
  - It appears once you've seen every post from the **last 48 hours (two days)**.
  - Rationale: the 2016 switch away from chronological order made it hard to tell new posts from seen ones. — [Instagram announcement](https://about.instagram.com/blog/announcements/introducing-youre-all-caught-up-in-feed); [9to5Mac, 2 Jul 2018](https://9to5mac.com/2018/07/02/instagram-youre-all-caught-up-feature/); [MacRumors](https://www.macrumors.com/2018/07/02/instagram-all-caught-up-launches/)
- TechCrunch (21 May 2018) called it Instagram's first "time well spent" feature. NBC (2018) placed it in a broader screen-time-limit movement, after CEO Kevin Systrom publicly talked about taking responsibility for online addiction. — [TechCrunch](https://techcrunch.com/2018/05/21/scroll-responsibly/); [NBC News](https://www.nbcnews.com/tech/tech-news/instagram-s-caught-joins-movement-set-limit-screentime-n890771)
- **Stopping cues (Center for Humane Technology framing)**:
  - Aza Raskin, who invented infinite scroll and co-founded CHT, has said he regrets it.
  - The argument: your brain doesn't stop to ask "do I want to continue?" without a stopping cue, and removing that cue is how infinite scroll keeps people engaged. — [Aza Raskin, Wikipedia](https://en.wikipedia.org/wiki/Aza_Raskin); [Center for Humane Technology, Wikipedia](https://en.wikipedia.org/wiki/Center_for_Humane_Technology)
  - These are secondary sources; a primary CHT page was not fetched.
- **EU DSA enforcement (2026)**:
  - **6 Feb 2026**: the Commission preliminarily found TikTok in breach of the DSA over "infinite scroll, autoplay, push notifications and highly personalised recommender systems". It said TikTok must redesign, for example by disabling infinite scroll over time and adding screen-time breaks, including at night. The EP Think Tank calls this the first enforcement action aimed at platform architecture rather than illegal content. — [EP Think Tank, 6 May 2026](https://epthinktank.eu/2026/05/06/addictive-design-on-online-platforms/)
  - **10 Jul 2026**: the Commission issued preliminary findings that Instagram and Facebook violate the DSA through infinite scroll, autoplay, push notifications, and engagement-optimized recommendations. Reported remedies include **turning off infinite scroll and autoplay by default (opt-in)** and in-app break mechanisms. The maximum fine is 6% of global revenue (about $12B). — [Tech Times, 11 Jul 2026](https://www.techtimes.com/articles/320180/20260711/eu-charges-meta-addictive-design-infinite-scroll-violates-dsa-health-rules.htm)
  - These are preliminary findings, not final decisions; TikTok called them "entirely meritless" (same source).
- **EU Digital Fairness Act (DFA)**:
  - A proposal is expected in late 2026. Reported scope covers dark patterns and addictive design, explicitly naming infinite scroll, autoplay, notifications, and streaks. — [OpSec Insider](https://opsecinsider.com/eu-digital-fairness-act/); [MediaNama, May 2026](https://www.medianama.com/2026/05/223-eu-social-media-giants-new-law-addictive-design/)
  - The European Parliament resolution on addictive design dates from Dec 2023. — [EP Think Tank](https://epthinktank.eu/2026/05/06/addictive-design-on-online-platforms/)
- **New York SAFE for Kids Act**:
  - Signed 20 Jun 2024. It restricts algorithmically personalized ("addictive") feeds and overnight notifications for under-18s without verifiable parental consent.
  - An "addictive feed" is one where content is "recommended, selected or prioritized" based on information persistently tied to the user or device.
  - The AG published final rules on **28 Jul 2026**. — [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/new-york-attorney-general-releases-final-rules-for-safe-for-kids-act); [NY Governor](https://www.governor.ny.gov/news/governor-hochul-and-attorney-general-james-announce-final-safe-kids-act-rules-protect-children); [Wikipedia](https://en.wikipedia.org/wiki/SAFE_For_Kids_Act)
- **UK**:
  - Ofcom's Protection of Children Codes were published 24 Apr 2025 and in force from 25 Jul 2025, with 40 measures.
  - They focus on "safer feeds" (filtering harmful content) and age checks rather than banning infinite scroll.
  - Ofcom's research recorded children and parents naming infinite scroll, autoplay, and streaks as time-extending features. — [Ofcom](https://www.ofcom.org.uk/online-safety/protecting-children/new-rules-for-a-safer-generation-of-children-online); [Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2025/04/rd-ofcom-publishes-osa-childrens-safety-codes-of-practice)
- **US litigation**: the EP Think Tank mentions a March 2026 US jury verdict against Meta and YouTube for addictive design, with modest damages (it cites $6M). NPR covered "two landmark social media verdicts" on 28 Mar 2026. — [EP Think Tank](https://epthinktank.eu/2026/05/06/addictive-design-on-online-platforms/); [NPR, 28 Mar 2026](https://www.npr.org/2026/03/28/nx-s1-5762945/how-will-two-landmark-social-media-verdicts-reshape-how-we-use-this-technology)
  - The NPR page timed out, so I could not verify the details. Treat the specifics as unconfirmed.

### Inferences
- MCPortal's river is chronological and follow-based, which is not "addictive feed" personalization under the NY SAFE definition. It is also finite inline, with no auto-load. That makes it structurally aligned with the remedies regulators are pushing (default-off infinite scroll, real stopping cues).
- The fullscreen auto-load should stay modest and end clearly at the "caught up" or end line, so the product doesn't recreate the feature regulators are targeting. This also fits the "reading platform" positioning.
- Instagram's version counts as "caught up" after a 48-hour window, then keeps showing older or suggested posts below the marker, and was criticized as a soft cue. MCPortal's divider between unseen and seen, followed by a hard end line, is a stronger and more honest version. The end line should say what's actually true (for example "That's everything from your 34 sources since Tuesday") rather than invite more scrolling.

### Gaps
- I found no published Instagram outcome data (time spent, retention) on "You're All Caught Up". Later reports that suggested posts were appended below the marker (around 2020) were not fetched.
- I found no sourced material on how Tumblr, Bluesky, Mastodon, or Threads present end of feed. From general knowledge, Mastodon timelines simply run out with no special "caught up" state, and Threads and Bluesky Discover backfill with algorithmic content. This needs verification.
- A primary CHT "stopping cues" page and any US state bills beyond New York (for example California SB 976 and its litigation status) were not covered.

## Q3. New-content indicators and position memory (and why not to insert above the reader)

### Takeaway
Mature clients agree that **the reader's position belongs to the reader**: new items are counted in a pill or bar, the user chooses when to load them, and position syncs as an item ID (Mastodon markers). Auto-inserting above the viewport causes the "tweet vanished mid-read" problem Twitter fixed, and it counts as an unexpected layout shift (CLS).

### Cited Findings
- **Twitter (web)**: the timeline stopped auto-refreshing because tweets "would often disappear from view mid-read". New tweets now wait behind a clickable counter bar at the top. When there are many new tweets, a "Load more Tweets" gap marker separates new from old. — [TechCrunch](https://techcrunch.com/?p=2234280) (date not confirmed on fetch; summary via search); [zeno.zone, "Playing catch-up with the Twitter app"](https://zeno.zone/blog/twitter-scroll-back)
- **Mastodon markers API** (since v3.0.0):
  - `GET/POST /api/v1/markers` save and restore position for the `home` and `notifications` timelines.
  - Each marker stores `last_read_id`, `version`, and `updated_at`.
  - Concurrent stale writes return `409 Conflict`, which lets multiple clients (web, Ivory, Ice Cubes, etc.) share one reading position. — [Mastodon docs](https://docs.joinmastodon.org/methods/markers/)
- **Bluesky**:
  - App v1.8.0 shipped "Refresh without losing your scroll position".
  - Users have filed issues asking the app to remember the read position on the Following feed ("the feed position is sacred", only the user should move it) and for a "don't scroll with load new" option.
  - A 2025-era bug reset the feed to the top after zooming an image on iOS. — [bsky.app post](https://bsky.app/profile/bsky.app/post/3kt3yutyyd72p); [social-app #4107](https://github.com/bluesky-social/social-app/issues/4107); [#976](https://github.com/bluesky-social/social-app/issues/976); [#10031](https://github.com/bluesky-social/social-app/issues/10031)
- **CLS (web.dev)**:
  - CLS measures unexpected layout shifts; "good" is ≤0.1 at p75.
  - Shifts within 500 ms of a discrete user input (`hadRecentInput`) are excluded. Continuous gestures such as scrolling do not qualify.
  - Reserving space and having shifts follow user actions is acceptable; unexpected insertions are not. — [web.dev CLS](https://web.dev/articles/cls)
  - Content injected above the reader by a background poll is exactly the "unexpected shift" CLS penalizes. Inserting it on a click of the "N new" pill is excluded input-driven shift.

### Inferences
- The planned "4 new since you started" pill that never reshuffles the screen matches Twitter's fix, Bluesky user expectations, and CLS rules. On click, either insert the new items above and scroll to them on purpose, or (simpler inside a host-scrolled iframe) re-render the river with the new items at the top and move the "caught up" divider.
- Store reading state server-side as a Mastodon-style marker: `last_read_id` plus a version for optimistic concurrency. That way the inline view, fullscreen view, and future clients share one position, and 409-style conflicts handle two chat windows open at once.
- The "caught up" divider is effectively a visible marker. Keep it anchored to an item ID so it doesn't drift as the river reloads.

### Gaps
- No sources were fetched for the **Slack "New messages" red line** or jump-to-unread behavior, **Ivory or Ice Cubes** unread-count and position-sync specifics, or **Reeder or Tapestry** position memory. These are commonly cited precedents, but I have no citable detail here.
- The exact date of Twitter's switch to a manual "show new tweets" bar was not confirmed from the primary source.
- I did not get a primary source on the X/Bluesky "new posts" pill's visual or interaction specs (for example, whether tapping it scrolls to top or inserts in place).

## Q4. Accessibility of feeds (ARIA feed role, WCAG 2.2, announcements, focus, motion)

### Takeaway
Use `role="feed"` with `<article>` children carrying `aria-posinset` and `aria-setsize` (`-1` if unknown), and set `aria-busy` during loads. "Load more" needs deliberate focus management, best done as the BBC GEL pattern: a focusable separator announcing "Items 11 to 20". Never let new-item counts or auto-updates interrupt the reader without a way to pause them (WCAG 2.2.2).

### Cited Findings
- **WAI-ARIA APG Feed pattern**:
  - Keyboard: **Page Down / Page Up** move focus between articles; **Ctrl+End** jumps to the first element after the feed; **Ctrl+Home** to the first element before it.
  - The APG notes that "providing easily discoverable keyboard interface documentation is especially important" because there are no established conventions.
  - Properties: the feed is labeled via `aria-labelledby`/`aria-label`; each article has `aria-posinset` and `aria-setsize` (`-1` when the total is unknown) and should have `aria-describedby` pointing at its main content; set `aria-busy="true"` while adding or removing articles, then `false`.
  - The contract: the page scrolls to keep the focused article visible and loads or removes articles as needed, while the screen reader's reading mode drives navigation and can trigger loads. — [W3C WAI-ARIA APG, Feed Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)
- **WCAG 2.2.2 Pause, Stop, Hide**: "For any auto-updating information that (1) starts automatically and (2) is presented in parallel with other content, there is a mechanism for the user to pause, stop, or hide it or to control the frequency of the update..."
  - Auto-updating explicitly includes news-style updates.
  - Unlike moving content, there is no 5-second exemption for auto-updating content. — [W3C Understanding 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- **NN/g (2022)**: with infinite scroll, keyboard users tab through excessive content to reach anything after the feed, and screen readers may see only the first chunk. — [NN/g](https://www.nngroup.com/articles/infinite-scrolling-tips/)
- **BBC GEL "Load more"**:
  - On activation, "Loading, please wait" goes into a live region.
  - New results are introduced by a `role="separator"` element that **receives focus** and announces the range, for example "Results 6 to 12", so the new items are next in focus order.
  - The spinner sits above the button, and the live region is emptied afterward.
  - The button sits at the foot of the loaded list and can be tabbed past.
  - Without JavaScript, it falls back to numbered pagination links. — [BBC GEL Load more](https://bbc.github.io/gel/components/load-more/)
- Other implementation write-ups:
  - Dynamically loaded content does not move focus, which can disorient non-visual users.
  - "Load more" inserts the new content before the button, which is counter-intuitive for keyboard and AT users.
  - Recommended fixes: move focus to the start of the new content and use `aria-live="polite"` for counts. — [Aleksandr Hovhannisyan, Managing Keyboard Focus for Load-More Buttons](https://www.aleksandrhovhannisyan.com/blog/load-more-button-focus/); [Alessio Carnevale, An accessible "Load more"](https://medium.com/@alessio.carnevale/an-accessible-load-more-implementation-b55c07603bd8); [Connekt / Ajax Load More](https://connekthq.com/accessibility-and-ajax-load-more/)

### Inferences
- Concrete markup for the river:
  - `<section role="feed" aria-label="River" aria-busy>` containing `<article aria-posinset aria-setsize=-1 aria-labelledby=title aria-describedby=excerpt>`.
  - The "You're caught up" divider is a `role="separator"` with text, and is not an article.
  - The end line is a separator or heading, followed by a real element after the feed so Ctrl+End has somewhere to land.
- On a "10 more" click: set `aria-busy=true`, announce "Loading" politely, append the items, then move focus to a separator reading "Items 11–20 of your river" with `tabindex=-1`, and set `aria-busy=false`.
- The "N new" pill should be a real button. Update its count through a polite live region at most occasionally, or only on change thresholds, so it isn't chatty. Polling for new items is auto-updating content under WCAG 2.2.2, so provide a way to pause or stop it (or poll only on open or focus).
- When expanding a collapsed card ("read more" in place), keep focus on the toggle, use `aria-expanded`, and don't move focus into the content. This follows the standard disclosure pattern; I didn't fetch a source for it.
- Reduced motion: gate any smooth scroll-to-new and any divider or pill animations behind `prefers-reduced-motion: no-preference`.
- 2.4.3 Focus Order and 2.1.1 Keyboard: inline mode has no internal scroller, so normal Tab and article navigation reaches everything. The main risk is fullscreen auto-load trapping keyboard users before the end line. Stop auto-loading on keyboard focus, or after a cap.

### Gaps
- I did not fetch the WCAG 2.4.3 or 2.1.1 Understanding docs, or an authoritative source on reaching the footer under infinite scroll (for example Deque or the A11y Project). The NN/g statement is the only sourced footer claim.
- I found no current (2025–2026) screen-reader support data for `role="feed"` across NVDA, JAWS, and VoiceOver (for example whether Page Up/Down is actually implemented). Treat AT support as uneven until tested.
- No source on `prefers-reduced-motion` specifically for feeds.

## Q5. Embedded/iframe contexts: nested scrolling, scroll chaining, overscroll-behavior, MCP Apps sizing

### Takeaway
Inline MCP Apps views are meant to grow to their content height: the host scrolls, and the view reports its size. Nested scrollers inside a chat iframe fight the host's scrolling. `overscroll-behavior` can only contain chaining when set on the iframe document's `html` and `body`, not on the `<iframe>`. Claude.ai's real-world sizing (as of an open issue from Feb 2026) reads DOM height directly, so a river that grows through "10 more" must update its document height explicitly.

### Cited Findings
- **MCP Apps spec (2026-01-26)**:
  - Display modes are `inline` (default), `fullscreen`, and `pip`, requested via `ui/request-display-mode`; the host may grant a different mode.
  - Container dimensions are either **fixed** (`height`: the host controls size and the view fills it) or **flexible** (`maxHeight`: the view controls size up to the max), or unbounded if omitted.
  - Views send `ui/notifications/size-changed` (width and height in pixels, typically via ResizeObserver). "Hosts MUST listen for size-changed notifications... and update the iframe dimensions accordingly."
  - The spec says nothing explicit about internal scrolling. — [ext-apps spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- **Claude.ai behavior (anthropics/claude-ai-mcp issue #69, opened 27 Feb 2026, open when fetched)**:
  - Claude.ai ignores `ui/notifications/size-changed` and reads the iframe's `documentElement` height from the DOM.
  - ResizeObserver-based sizing done before render can lock the iframe at the pre-render height.
  - Workaround: after rendering, set `document.documentElement.style.height = app.scrollHeight + "px"`, and use a fixed `min-height` instead of `100vh` (which becomes circular inside an auto-sized iframe). — [GitHub issue #69](https://github.com/anthropics/claude-ai-mcp/issues/69)
- Goose desktop reportedly shrank MCP apps on resize and never grew them back. — [block/goose #6818](https://github.com/block/goose/issues/6818)
- **overscroll-behavior (MDN)**:
  - Scroll chaining means scrolling propagates to an ancestor scroll container.
  - `contain` stops chaining but keeps bounce; `none` stops both.
  - It applies only to scroll containers. "Since an iframe is not a scroll container, setting this property on an iframe has no effect". To control chaining from an iframe, set it on both `html` and `body` of the iframe document. — [MDN overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior)

### Inferences
- The inline river should have no internal `overflow: auto` region, as already planned. Every "10 more" or pill click changes document height, so re-assert height using both the spec path (size-changed) and the Claude.ai workaround (explicit `documentElement` height after render).
- If a host gives a fixed height inline (some do), the river is forced into an internal scroller. In that case set `overscroll-behavior: contain` on `html` and `body` so reaching the end doesn't scroll the chat unexpectedly. Otherwise prefer `auto`, so the iframe's top and bottom hand scrolling back to the chat naturally.
- Scroll-position restore inside the iframe is mostly meaningless inline, because the host owns the scroll offset. Position memory has to be semantic (the `last_read_id` marker plus the "caught up" divider), and "jump to where I left off" should render from the marker rather than scroll to it.
- Fullscreen is the one mode where the view probably owns scrolling. That is where the APG feed keyboard contract (Page Up/Down) and capped auto-load make sense.
- Large inline growth costs the chat transcript. A hard cap on inline batches (for example 3 × 10, then "Open full river" to go fullscreen) keeps the chat usable. This is design judgment, not sourced evidence.

### Gaps
- I found no published host guidance from Anthropic or OpenAI on maximum inline iframe height, nested scrolling policy, or recommended "load more" behavior inside chat-embedded apps (ChatGPT Apps SDK docs were not fetched).
- No sources on whether Claude or ChatGPT preserve iframe state or height when a chat is reloaded, which affects whether loaded batches survive a page refresh.
