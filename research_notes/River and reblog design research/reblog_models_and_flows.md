# Reblog / repost / boost / quote-post UX: models, flows, and social dynamics

Scope note: researched 2026-10-02. Platform history is labeled by date. Every bullet in "Cited Findings" has a source. Things I could not verify are listed under "Gaps". This is not a substitute for a hands-on audit of each app's current UI.

---

## 1. Tumblr: reblog model, trails, controls, and the March 2026 notes change

### Takeaway
Tumblr's reblog makes a **copy**: it saves the post and its whole trail onto the reblogger's blog. It does not store a live reference. Because of that, edits and deletes of the original never reach existing reblogs, and every reblog in the chain feeds one shared note count. In March 2026 Tumblr tried giving each reblog its own notes. Users read this as taking credit away from original posters, and Tumblr reversed it in about 30 hours. The lesson for MCPortal: on a Tumblr-style platform, the shared note count is how original posters get credit.

### Cited Findings
**Storage model (copy, not reference)**
- Tumblr copies the trail content into each reblog instead of referencing the earlier posts. The stated reason: with references, "loading a reblog could go from just one query to several queries", and some trails hold thousands of posts. Copying keeps it to "just one per post" query, so dashboard loads stay predictable. — [Tumblr Engineering, "How Reblogs Work"](https://www.tumblr.com/engineering/189455858864/how-reblogs-work)
- Old format (before NPF): the trail was nested HTML blockquotes inside each post's body. NPF (Neue Post Format, public API docs published 2018) stores the trail as a JSON array from the root post down to the parent post. It holds "an immutable reference to each blog and post in the trail, instead of just the unreliable post URL", which fixed trails that broke when a blog was renamed. — [Tumblr Engineering, "How Reblogs Work"](https://www.tumblr.com/engineering/189455858864/how-reblogs-work); [NPF spec](https://www.tumblr.com/docs/npf); [Tumblr Engineering: NPF docs announcement](https://engineering.tumblr.com/post/179080448939/new-public-api-and-neue-post-format-documentation)
- NPF `trail` is optional. It is present "if a post is a reblog and the user kept the trail attached", and it runs oldest (root) to newest (parent). — [NPF spec](https://www.tumblr.com/docs/npf)

**Edits and deletes**
- An edit changes only the original and any reblogs made after the edit. A reblog "froze" the content at the moment it was made, and that includes the trail content. — [Tumblr Engineering Q&A on edits](https://www.tumblr.com/engineering/189457776594/about-the-how-reblogs-work-post-i-apologize)
- Reblogs are copies, so deleting the original post, or the whole blog, does not remove existing reblogs. They "can continue being reblogged indefinitely." You cannot edit earlier entries in a trail. You can remove everything after the original caption, but not the original caption itself. — [Tumblr Engineering Q&A](https://www.tumblr.com/engineering/189457776594/about-the-how-reblogs-work-post-i-apologize); [Tumblr Help: Reblogs](https://help.tumblr.com/knowledge-base/reblogs/)
- Trail readability redesign (Sept 2015): TechCrunch covered it as "Tumblr finally makes reblogs more readable especially on mobile devices." I saw only the search snippet, not the article. — [TechCrunch, 2015-09-02](https://techcrunch.com/2015/09/02/tumblr-finally-makes-reblogs-more-readable-especially-on-mobile-devices)

**Reblog controls (June 2022)**
- Rollout began June 2022 on web and iOS. In the editor's settings cog, "Reblog Control" offers "Anyone (on Tumblr)" or "No One". "No one" still lets users @-tagged in the post reblog it. The setting can be changed after publishing. — [Tumblr "Introducing: Reblog Controls" (unwrapping)](https://unwrapping.tumblr.com/post/686005440496173056/reblog-controls); summarized in [Medium](https://medium.com/@sthomason/tumblr-is-adding-a-feature-to-disable-reblogs-of-posts-9c5061402562)

**March 2026 notes change and reversal**
- 2026-03-16: Tumblr shipped "Reblogs in a chain now get their own notes." Each reblog started at zero notes and acted as a new post. Before, notes from across the whole chain added up on one shared count, so a small creator's post could gather hundreds of thousands of notes. — [Plagiarism Today, 2026-04-16](https://www.plagiarismtoday.com/2026/04/16/tumblrs-30-hour-attribution-riot/); [MetaFilter thread](https://www.metafilter.com/212561/Reblogs-in-a-chain-now-get-their-own-notes)
- Stated rationale: "to give credit to reblogs that add a significant amount to the original post." Plagiarism Today speculates that the real aim was to reward large-audience users. That is the outlet's opinion, not something Tumblr said. — [Plagiarism Today](https://www.plagiarismtoday.com/2026/04/16/tumblrs-30-hour-attribution-riot/)
- Objection: the old system "rewards original posters and encourages a type of conversation that can be organically branched." Users said the change made Tumblr look like other networks. — [Plagiarism Today](https://www.plagiarismtoday.com/2026/04/16/tumblrs-30-hour-attribution-riot/)
- Scale: reported as more than 100,000 complaints through the feedback system and more than 28,000 comments on the staff post. One example post dropped from 152,372 notes to about 2.8k interactions in the new view. — [PiunikaWeb, 2026-03-17](https://piunikaweb.com/2026/03/17/tumblr-users-slam-new-reblog-ui-update-own-notes/); [Daily Planet DC, 2026-03-17](https://dailyplanetdc.com/2026/03/17/why-tumblr-users-are-opposing-the-new-reblog-notes-feature/). The reversal post passed 300,000 notes. — [Plagiarism Today](https://www.plagiarismtoday.com/2026/04/16/tumblrs-30-hour-attribution-riot/)
- Reversal: Tumblr reversed within about 30 hours ("less than two days" per PiunikaWeb), saying "We're reversing the change" and admitting it "should have communicated this differently." It also said "We still believe there's a better version of how reblogs can work." — [PiunikaWeb, 2026-03-18](https://piunikaweb.com/2026/03/18/tumblr-reverses-reblog-notes-update-backlash/); [Plagiarism Today](https://www.plagiarismtoday.com/2026/04/16/tumblrs-30-hour-attribution-riot/); [Tumblr Support changelog, March 2026](https://support.tumblr.com/post/812622447606104064)

### Inferences
- The two lessons from Tumblr pull in opposite directions. Copying is fast and keeps trails alive after deletion (resilient). It also means an author can never retract content, and corrections never reach existing copies. For MCPortal, a hybrid seems better: reference the original (so deletes and edits propagate and authors keep control) and keep a light snapshot only as a tombstone fallback.
- Pooling engagement on the root, or at least clearly crediting the root author, is a strong community expectation among Tumblr-literate users. If MCPortal is "Tumblr-like", reblog counts and notifications should credit the original sharer. Per-reblog counts can exist as a secondary metric.
- The rollout failure was partly about process: an unannounced change to attribution. For a small community, changes to attribution semantics deserve advance notice.

### Gaps
- I did not verify the exact 2015 trail visuals (avatar-per-entry layout, "reblogged from X" header vs "Source: Y" footer) from a primary Tumblr post. The TechCrunch 2015 link is cited from its search title only.
- Not researched with sources: the queue and its scheduling limits, tags-on-reblog culture (tags staying private to the reblogger), trail collapsing ("show more" on long trails), and how the notes view splits reblogs-with-additions from plain reblogs.

---

## 2. Twitter/X: retweet vs quote tweet, the 2020 nudges, and dunking

### Takeaway
Twitter launched quote tweets ("Retweet with comment") in April 2015. In October 2020 it changed the retweet button to open a quote composer by default. Total sharing fell about 20%, but most of the added quotes were one-word filler, so Twitter reverted in December 2020. The "read before you retweet" prompt measurably raised article opens. In short: friction cuts volume, but forcing commentary does not produce real context.

### Cited Findings
- 2015-04-06: Twitter launched "Retweet with comment", embedding the original tweet so commentary no longer had to fit around it within 140 characters. Announcement: "Say more with revamped quote Tweet!" It had been in testing since the previous summer. — [TechCrunch, 2015-04-06](https://techcrunch.com/2015/04/06/retweetception/); [BuzzFeed News](https://www.buzzfeednews.com/article/ellencushing/you-can-now-retweet-with-comment-on-twitter)
- Oct–Dec 2020 (US election): the retweet button defaulted to a quote-tweet prompt. Twitter's December 2020 post reported a **20% decrease in retweets plus quote tweets** while it ran. The added quotes did not add context: **45% of additional quote tweets were a single word and 70% were under 25 characters**. Twitter reverted. — [MacRumors, 2020-12-17](https://www.macrumors.com/2020/12/17/twitter-removes-quote-tweet-prompt/); [Engadget](https://www.engadget.com/twitter-ends-quote-tweet-experiment-retweets-003202686.html)
- "Read before you retweet" (Android test June 2020, expanded to all users Sept 2020): people shown the prompt **opened articles 40% more often**, and the share of people opening an article before retweeting **rose 33%**. Some people chose not to retweet after reading. — [Engadget](https://www.engadget.com/twitter-prompt-read-article-before-tweeting-191907421.html); [TechCrunch, 2020-09-24](https://techcrunch.com/2020/09/24/twitter-read-before-retweet)
- Quote-tweet dynamics have academic coverage. One review summarizes more than 30 studies and pushes back on some "quote tweets are mostly dunks" myths. An ACM paper compares framing by reply vs by quote. — [PLOS "Absolutely Maybe", 2023](https://absolutelymaybe.plos.org/2023/01/12/quote-tweeting-over-30-studies-dispel-some-myths/); [ACM, "To Reply or to Quote"](https://dl.acm.org/doi/10.1145/3625680). For the opinion side, see the essay "Quote Tweets Have Turned Us All Into Jerks" — [OneZero](https://onezero.medium.com/quote-tweets-have-turned-us-all-into-jerks-d5776c807942)

### Inferences
- A one-tap plain reblog plus an *optional* note is better supported by evidence than a mandatory note. Forced notes give you "this" and "lol", not context.
- A lightweight "you haven't opened this link" nudge fits MCPortal's reading identity and has a measured effect. MCPortal can tell whether the user opened the item in the reader.

### Gaps
- I did not fetch Twitter's original December 2020 blog post. Figures are as reported by MacRumors and Engadget. I recall a figure of roughly a 26% rise in quote tweets but did not verify it, so it is excluded.
- Undo-retweet flow details, current X behavior (2023–2026), and quantitative studies of "ratio"/dunking were not researched with sources.

---

## 3. Mastodon: boosts without quotes, then consent-based quotes (2025)

### Takeaway
For years Mastodon had plain boosts only. Eugen Rochko said quoting "inevitably adds toxicity," because it invites performing for your audience instead of talking with the other person. Mastodon 4.5 (Nov 2025) added quotes on a **consent** basis: authors choose per post who may quote them, can remove their post from someone's quote, and followers-only posts can't be quoted.

### Cited Findings
- Rochko (2018) said he made "a deliberate choice against a quoting feature because it inevitably adds toxicity to people's behaviours." His argument: people quote when they should reply, which makes them speak at an audience ("performative"), and quoting even to ridicule bad posts gives those posts more reach. — [Eugen Rochko on mastodon.social](https://mastodon.social/@Gargron/99662106175542726); follow-up [toot](https://mastodon.social/@Gargron/99662175401624353)
- Later (Jan 2023 toots) he was softer: if Mastodon did add quotes, it would be something users could control. — [Rochko toot](https://mastodon.social/@Gargron/109623891328707089); [Rochko toot](https://mastodon.social/@Gargron/109623910323239777)
- Announcement (Sept 2025): Mastodon framed the design as prioritizing "safety and mental health – not just on engagement." Authors can disable quoting by default or per post. Followers-only and private posts can't be quoted by anyone but the author. Authors are notified when quoted and can remove their post from a quote through the Options menu. Changing a post's quote setting blocks future quotes but does not remove existing ones. Blocking stops a repeat offender. — [Mastodon blog, "Introducing quote posts"](https://blog.joinmastodon.org/2025/09/introducing-quote-posts/)
- Per-post setting options: "Anyone," "Followers only," or "Just me." Quote posts themselves can be public, followers-only, or "quiet public," which keeps them out of search, trends, and public timelines. — [fedi.tips](https://fedi.tips/why-cant-i-quote-other-posts-in-mastodon/); [Yahoo/Engadget syndication](https://finance.yahoo.com/news/mastodon-rolls-quote-posts-protections-153853227.html)
- Protocol: Mastodon wrote a "consent-respecting quote posts" spec, FEP-044f, so other Fediverse servers can follow the same approval rules. — [Mastodon blog](https://blog.joinmastodon.org/2025/09/introducing-quote-posts/)
- Timeline: enabled on mastodon.social and mastodon.online in Sept 2025. 4.5 RC1 in Oct 2025. Mastodon 4.5.0 released 2025-11-06. — [Mastodon blog](https://blog.joinmastodon.org/2025/09/introducing-quote-posts/); [AlternativeTo, Oct 2025](https://alternativeto.net/news/2025/10/mastodon-4-5-rc1-adds-quote-post-authoring-async-reply-fetching-and-http-message-signatures); [Dataconomy, 2025-11-07](https://dataconomy.com/2025/11/07/mastodon-adds-quote-posts-in-major-4-5-update-with-built-in-safeguards/)

### Inferences
- Mastodon's model fits a small, safety-conscious community like MCPortal's. Copy these defaults: a per-user default plus a per-post override for who may reblog-with-note, author removal of their item from someone's reblog, notification on reblog, and no resharing of followers-only content.
- "Quiet public" is a useful idea for MCPortal: a reblog can go to followers without entering discovery or trending surfaces.

### Gaps
- No sourced data on how often quotes are used, or on how much authors detach or remove since 4.5. No measured reception beyond press coverage.

---

## 4. Bluesky: repost, quote, detach and disable, "via" attribution

### Takeaway
Bluesky has plain reposts and quote posts. In August 2024 (v1.90) it added quote detaching and per-post interaction settings to cut down on dogpiling. In 2025 it added a `via` field on repost records and notifications for likes and reposts of *your reposts*. Together these let curators in the middle of a chain get credit, which is close to Tumblr's "reblogged from".

### Cited Findings
- 2024-08-28 (v1.90) "anti-toxicity" release: users can view all quote posts of their post and "detach your original post from someone's quote post," to keep control of a thread and limit "dog-piling and other forms of harassment." "Like blocks, quote post removals are public data." Bluesky also said "quote posts are often used to correct misinformation too," and pointed to a future Community Notes–like feature. — [Bluesky blog, 2024-08-28](https://bsky.social/about/blog/08-28-2024-anti-toxicity-features); [TechCrunch, 2024-08-28](https://techcrunch.com/2024/08/28/bluesky-adds-anti-toxicity-tools-and-aims-to-integrate-a-community-notes-like-feature-in-the-future/)
- The same release included per-post interaction settings covering who can reply and whether the post can be quoted, plus hide replies, temporary mute words, priority notification filters, and blocks applied to lists. — summary list in [Threads post citing the Bluesky blog](https://www.threads.com/@fenarinarsa/post/C_OT7XauUDA); [AlternativeTo](https://alternativeto.net/news/2024/8/bluesky-introduces-new-anti-toxic-features-including-reply-hiding-and-notification-filters)
- July 2025 notification update: new notification types "Likes of your reposts" and "Reposts of your reposts" ("see how far your shared content travels"). Each notification type can be set to everyone, people you follow, or no one. — [Bluesky blog, 2025-07-02](https://bsky.social/about/blog/07-02-2025-more-notification-control); [TechCrunch, 2025-07-07](https://techcrunch.com/2025/07/07/bluesky-users-can-customize-their-notifications-including-activity-alerts-from-their-favorite-accounts/)
- Protocol: `app.bsky.feed.repost` (and likes) gained an optional `via` strongRef that points to the repost through which the user found the subject. This lets AppViews credit intermediate reposters and trace repost chains. It was added after launch (atproto issue #3882 is referenced). There is a related proposal for an `attribution` field on posts and embeds. — [hypercerts lexicon issue #255 describing the mirrored Bluesky schema](https://github.com/hypercerts-org/hypercerts-lexicon/issues/255); [atproto issue #3562](https://github.com/bluesky-social/atproto/issues/3562)

### Inferences
- The `via` pattern maps directly onto MCPortal's need for attribution to who you got it from. Store `root_item`, `via_share` (the immediate parent), and the reblogger as separate fields. Show "via @X" in the UI and credit both the root and the via user in notifications.
- Detaching is a cheap, effective safety valve, and it is easier to build when reblogs reference the original instead of copying it.

### Gaps
- I did not verify the exact ship date or UI of "via" in the Bluesky app, the "Reposted by X" feed header, or whether Bluesky collapses duplicate reposts of the same post in Following.

---

## 5. Other models: Threads, Cohost, Pinterest, Are.na, Substack Notes, Glass

### Takeaway
The alternatives fall along a spectrum. At one end are amplification tools (Threads repost and quote, Substack restack-with-comment, which counts as your own new note). At the other are curation tools (Pinterest "Save," Are.na "Connect"), where resharing means filing something into your own collection, not broadcasting. The curation model is the one that matches a reading app.

### Cited Findings
- **Threads**: separate Repost and Quote actions under one repost icon ("Repost a thread to share it with your community, or quote a post to add commentary"). Quote controls (Nov 2024) let authors limit quotes and replies to followers. "Markup" quoting lets users annotate someone else's post. Users can hide like, repost, and quote counts, and a per-post menu controls who can quote or repost. Users can also hide reposts from their feed. — [Threads official post on repost vs quote](https://www.threads.com/@threads/post/DCPzAdqRBoH); [Threads on Markup](https://www.threads.com/@threads/post/DFYVYVVRgFy); [Threads on hiding counts](https://www.threads.com/@threads/post/DG3uum6yqxt/to-hide-the-number-of-likes-views-reposts-and-quotes-on-posts-from-other-profile?hl=en); [TechCrunch, 2024-04-25 (quote controls teased)](https://techcrunch.com/2024/04/25/threads-launches-a-mute-feature-for-words-teases-controls-for-quote-posts/embed/); [Meta newsroom, Mar 2025](https://about.fb.com/news/2025/03/new-threads-features-more-personalized-experience-you-control/). Dates for count-hiding (Nov 2025) and the composer quote shortcut (Dec 2025) come from a search-engine summary only.
- **Cohost** (Tumblr-like, with a "share" that could add content): announced shutdown in Sept 2024, read-only from 2024-10-01, offline 2024-12-31. Causes cited were funding and burnout. Expenses rose while revenue fell, and a major revenue feature (Cohost Plus/creator payments) was disrupted by Stripe. — [Cohost staff post (Wayback)](https://cohost.org/staff/post/7611443-cohost-to-shut-down); [Tedium postmortem, 2024-09-12](https://tedium.co/2024/09/12/cohost-social-networking-postmortem/); [Wikipedia: Cohost](https://en.wikipedia.org/wiki/Cohost); [Michael Tsai](https://mjtsai.com/blog/2024/09/23/cohost-to-shut-down/)
- **Pinterest**: on 2016-06-02 the "Pin it" button became "Save" ("repins" became "saves"). The reasons were international clarity (the board-and-pin metaphor doesn't carry over to markets like Japan) and intuitiveness. In tests the rename produced **8% more saves**. — [Forbes, 2016-06-02](https://www.forbes.com/sites/kathleenchaykowski/2016/06/02/pinterest-renames-pin-it-button-as-save/); [VentureBeat](https://venturebeat.com/social/pinterest-replaces-pin-it-button-with-save)
- **Are.na**: no likes. Users "Connect" a block into one of their own channels. A block's connections show where else it has been filed, and it gains its own trail through Are.na. There is no algorithm, no recommendations, and no ads. — [Are.na Help: Connections](https://help.are.na/docs/getting-started/connections); [Pratt IXD critique, Feb 2025](https://ixd.prattsi.org/2025/02/design-critique-are-na-ios-app/); [Wikipedia: Are.na](https://en.wikipedia.org/wiki/Are.na)
- **Substack Notes**: there is a plain "restack" and a "restack with comment" (a quote). Practitioner guides say a restack with comment is delivered as the restacker's own new note, so impressions and follows go to the restacker. Substack's own guide covers collaboration on Notes. — [WriteStack guide](https://www.writestack.io/blog/substack-restacks-guide); [Substack "Notes collaboration & growth guide"](https://on.substack.com/p/notes-collaboration-growth-guide)

### Inferences
- MCPortal already has "save" and "clip". A reblog could be framed as "save to my shelf, publicly, with a note": Pinterest/Are.na-style curation that also appears in followers' river. That fits a reading platform better than an amplification button, and Pinterest's rename data suggests that "save" wording reduces hesitation.
- Cohost's lesson for a $5/mo solo-founder app is about business, not UX: don't depend on one payment processor for your main revenue feature, and keep costs small.

### Gaps
- **Glass** (photo app) was not researched. I found no sources on its resharing model.
- Not covered: Cohost's specific share UX, and whether shares stacked like Tumblr trails.

---

## 6. Flows: compose, audience, undo, author controls, notifications, dedupe, propagation

### Takeaway
The main platforms now converge on a common pattern:
1. One tap on the reshare icon opens a small menu: plain reshare, or reshare with a note.
2. Optional per-post author controls decide who may quote or reshare.
3. The author can detach or remove their post from someone's reshare after the fact.
4. Notifications are granular and filterable, and can credit middle-of-chain curators.

Deleting the original propagates only on reference-based systems (Mastodon, Bluesky). On copy-based Tumblr it does not.

### Cited Findings
- **Entry point**: Threads, Substack, and Bluesky all put plain repost and quote behind one icon. On Threads, tapping the repost icon offers repost, quote, and "Markup." — [Threads](https://www.threads.com/@threads/post/DFYVYVVRgFy); [WriteStack](https://www.writestack.io/blog/substack-restacks-guide)
- **Forcing the compose sheet** reduced sharing about 20% and did not add meaningful context (Twitter 2020). — [MacRumors](https://www.macrumors.com/2020/12/17/twitter-removes-quote-tweet-prompt/)
- **Author pre-controls**: Tumblr Reblog Control ("Anyone"/"No One", editable after posting) — [Tumblr](https://unwrapping.tumblr.com/post/686005440496173056/reblog-controls); Mastodon per-post quote policy (Anyone / Followers / Just me) with a per-user default — [Mastodon blog](https://blog.joinmastodon.org/2025/09/introducing-quote-posts/); Threads followers-only quotes — [TechCrunch](https://techcrunch.com/2024/04/25/threads-launches-a-mute-feature-for-words-teases-controls-for-quote-posts/embed/); Bluesky per-post quote toggle — [AlternativeTo](https://alternativeto.net/news/2024/8/bluesky-introduces-new-anti-toxic-features-including-reply-hiding-and-notification-filters)
- **Author post-controls**: Mastodon remove-from-quote — [Mastodon blog](https://blog.joinmastodon.org/2025/09/introducing-quote-posts/); Bluesky detach, publicly recorded — [Bluesky blog](https://bsky.social/about/blog/08-28-2024-anti-toxicity-features). With Tumblr's block-after-posting, a blocked user still cannot reblog a "No One" post. — [Tumblr](https://unwrapping.tumblr.com/post/686005440496173056/reblog-controls)
- **Notifications**: Bluesky lets users choose everyone / follows / no one for each type, including "reposts of your reposts." — [Bluesky blog](https://bsky.social/about/blog/07-02-2025-more-notification-control)
- **Edit and delete propagation**: Tumblr reblogs are frozen copies, so edits don't propagate and deletes leave reblogs alive. — [Tumblr Engineering](https://www.tumblr.com/engineering/189457776594/about-the-how-reblogs-work-post-i-apologize). Changing Mastodon's quote setting affects only future quotes. — [Mastodon blog](https://blog.joinmastodon.org/2025/09/introducing-quote-posts/)
- **Hiding reshares from a feed**: Threads lets users hide reposts. — [Threads user post](https://www.threads.com/@jeremyjenkins_/post/DEkeU6soLkN)

### Inferences
Proposed MCPortal flow. This is a synthesis of the findings above, not something I found as-is.
1. **Reblog**: one tap on Reblog opens a small sheet with the note field focused but optional. A single "Reblog" button posts it whether or not a note was written. Optionally, if the user hasn't opened the item, show "You haven't read this yet — open first?"
2. **Attribution**: the stored record holds `root`, `via` (the share the user saw it in), and the user. Render "via @X · originally shared by @Y."
3. **Audience**: reblogs inherit the original's maximum audience. A followers-only share can't be reblogged beyond followers, or at all, following Mastodon.
4. **Author controls**: a per-share "Who can reblog: Anyone / Followers / Nobody" with an account default, plus "Remove my post from this reblog."
5. **Undo and delete**: un-reblog removes it from followers' rivers. Because the reblog references the original, deleting the original turns it into a tombstone ("original removed by author"), and a snapshot of the reblogger's own note survives.
6. **Notifications**: batch them ("@A and 4 others reblogged your clip"), credit both root and via, and give the user per-type audience filters.
7. **River dedupe**: when several follows reblog the same item, show one card with "Reblogged by A, B, and 2 more." Also suppress items the user already saw or saved.

### Gaps
- I found no primary-source documentation of how any platform dedupes the same item reshared by several follows in a home feed (for example, Tumblr's "reblogged by N people you follow" or Bluesky's handling). The rule in step 7 is a design suggestion, not a sourced finding.
- Notification batching thresholds and timing on these platforms were not researched.
- Link rot in long-lived reblog chains: no data found.

---

## 7. Research on virality and reshare friction

### Takeaway
Across Facebook's internal research, WhatsApp's forward limits, and Twitter's prompts, the evidence agrees: friction at deeper reshare hops sharply cuts misinformation and viral cascades, while barely affecting first-hop sharing among people who know each other. Reshare depth is the variable to control.

### Cited Findings
- **Facebook "Deep Reshares and Misinformation" (spring 2019, from the 2021 Haugen leak)**: content at reshare depth 2 or more was about **4x** as likely to be misinformation, rising to as much as **10x** at higher depths. In India, people encountering deep reshares were **20x** more likely to see misinformation. An April 2019 internal report estimated that controls on deep reshares would cut political misinformation in links by **25%** and halve photos containing political misinformation. The proposed fix was friction after the first share, or blocking sharing after one hop. Reporting says Facebook did not broadly adopt it. — [The Conversation via TechXplore, Dec 2021](https://techxplore.com/news/2021-12-facebook-harmless-leaked-documents-misinformation.html); [Social Media Today](https://www.socialmediatoday.com/news/internal-research-from-facebook-shows-that-re-shares-can-significantly-ampl/609614/); [OneZero, "The Case to Reform the Share Button"](https://onezero.medium.com/the-case-to-reform-the-share-button-according-to-facebooks-own-research-ed2073720564)
- **WhatsApp**: a 2018–2019 limit of 5 chats per forward cut forwards **25%** globally. On 2020-04-07, "frequently forwarded" messages were limited to one chat at a time, which cut highly forwarded messages **70%** within about three weeks. — [TechCrunch, 2020-04-27](https://techcrunch.com/2020/04/27/whatsapps-new-limit-cuts-virality-of-highly-forwarded-messages-by-70); [TechCrunch, 2020-04-07](https://techcrunch.com/2020/04/07/whatsapp-rolls-out-new-limit-on-message-forwards/)
- **Twitter read-before-RT (2020)**: article opens +40%, and opening before retweeting +33%. — [Engadget](https://www.engadget.com/twitter-prompt-read-article-before-tweeting-191907421.html)
- **Twitter quote nudge (2020)**: sharing −20%, with low-quality added commentary. — [MacRumors](https://www.macrumors.com/2020/12/17/twitter-removes-quote-tweet-prompt/)
- **Pinterest wording (2016)**: "Save" instead of "Pin it" raised saves 8%. Copy changes alone move behavior. — [Forbes](https://www.forbes.com/sites/kathleenchaykowski/2016/06/02/pinterest-renames-pin-it-button-as-save/)

### Inferences
- For a small reading community, a plain rule fits: keep the "via" chain, but in the river show only depth 1 from people you follow. You see a follow's reblog. You do not see a stranger's reblog of a follow-of-follow's reblog. Consider adding friction, such as a required open or read, from depth 2 onward. This follows Facebook's depth finding at almost no cost to normal use.
- Abuse vectors to design for: dogpiling through quote-with-note (mitigations: detach, followers-only reblog, notification filters), reblogging content from a user who later blocks you (Tumblr blocks future reblogs, so check blocks at reblog time and on render), and harassment notes that reach the original author (mute and block should suppress those notifications).

### Gaps
- No peer-reviewed causal study of Tumblr reblog dynamics or Mastodon/Bluesky quote-detach effects was found in this pass.
- Facebook's own published or academic follow-ups on reshare-depth interventions after 2021 were not found.
