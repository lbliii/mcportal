# Demand for personalized dashboards, start pages, and RSS/feed readers

Research date: 2026-09-30. Data from before 2024 is marked [OLDER]. GitHub star counts were pulled live from the GitHub API on 2026-09-30.

## 1. User numbers, revenue, funding, and pricing for incumbents, plus GitHub stars for self-hosted dashboards

### Takeaway
Public numbers are thin: every consumer feed and start-page company here is small, bootstrapped, or indie. Feedly's estimated ARR is about $7M and Momentum's is about $1M. The self-hosted "feeds dashboard" category, though, shows unusually strong developer pull. Glance went from creation in April 2024 to about 37k GitHub stars by September 2026. That puts it above Homepage (about 33k), Dashy (about 27k), and FreshRSS (about 16k, a 14-year-old project). Glance is the closest existing analog to MCPortal's "panels from sources I choose."

### Cited Findings
**Commercial feed readers and start pages**
- Feedly: estimated $7.3M ARR in 2025, listed as bootstrapped. This is a third-party estimate and is not audited. — [GetLatka](https://getlatka.com/companies/feedly.com)
- Feedly: about 66 employees as of 2026 (search-snippet summary of the same aggregator profiles). — [GetLatka](https://getlatka.com/companies/feedly.com); [PitchBook profile](https://pitchbook.com/profiles/company/100045-36)
- Feedly pricing: Pro is $6/mo or $60/yr and Pro+ is $12/mo. The free tier allows up to 100 sources. — [LabHub 2026 roundup](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en). This is a secondary source; Feedly's own pricing page would not render when fetched.
- Inoreader Pro: $7.50/mo billed annually ($90/yr) or $9.99/mo billed monthly. It includes 1M "Intelligence" (AI) tokens a month and hourly feed refresh. Inoreader has a separate Enterprise tier. — [Readless summary of Inoreader pricing](https://www.readless.app/blog/inoreader-pricing-2026); [Inoreader pricing](https://www.inoreader.com/pricing); [Inoreader enterprise](https://www.inoreader.com/pricing/enterprise)
- Inoreader free tier: up to 150 sources. — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en)
- Other feed-reader price points (2026 roundup):
  - Feedbin: $5/mo or $50/yr, paid only
  - NewsBlur Premium: $36/yr
  - Reeder (new): $1/mo or $10/yr
  - Reeder 5: about $15 on macOS, $5 on iOS

  — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en)
- Readwise Reader: $9.99/mo or $99.99/yr. — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en); [TechCrunch](https://techcrunch.com/2026/08/14/read-it-later-app-pocket-is-shutting-down-here-are-the-best-alternatives/)
- Momentum (new-tab dashboard):
  - $83K MRR, about $996K ARR, profitable, 1 founder. Figures dated June 13, 2024.
  - Pro plan is $4.95/mo or $39.95/yr.

  — [Starter Story](https://www.starterstory.com/stories/momentum-dashboard-breakdown)
- Conflicting Momentum figures:
  - GetLatka reports "Momentum hit $13.5M revenue with a 120 person team in 2025." This is very likely a different company named "Momentum" (slug `momentum-1`), so do not use it. — [GetLatka](https://getlatka.com/companies/momentum-1)
  - Owler/ZoomInfo-style estimates put Momentum Dashboard at about $435K revenue with 5 employees. — [Owler](https://www.owler.com/company/momentumdash)
  - "Over 3 million active users" appears in a search summary but was not traced to a primary Momentum source.
- Bonjourr (open-source minimalist new-tab page):
  - The Chrome extension passed 200,000 users in September 2024, and search summaries cite 300,000+ Chrome Web Store users.
  - It is built by two independent developers with no ads or investors.
  - GitHub: victrme/Bonjourr has 2,090 stars (GitHub API, 2026-09-30).

  — [Bonjourr site](https://bonjourr.fr/); [Chrome Web Store](https://chromewebstore.google.com/detail/bonjourr-%C2%B7-minimalist-new/dlnejlppicbjfcfcedcflplfjajinajd)
- Tabliss: joelshepherd/tabliss has 2,782 stars (GitHub API, 2026-09-30). I found no user numbers.
- Netvibes (Dassault Systèmes), the classic iGoogle-style widget dashboard:
  - Dassault announced in April 2025 that the standalone Netvibes.com service would retire on June 2, 2025.
  - The reasons given, per a secondary source, were changing market conditions, a declining user base, and rising maintenance costs.

  — [DashDork](https://dashdork.com/blog/netvibes-shutdown-alternatives/); [The Point](https://www.thepoint.online/netvibes-retiring-no-great-free-alternatives/); [Netvibes Wikipedia](https://en.wikipedia.org/wiki/Netvibes)
- Start.me published a blog post courting displaced Netvibes users. I found no public user or revenue numbers for Start.me. — [Start.me blog](https://blog.start.me/netvibes-alternative/)
- iGoogle was discontinued on November 1, 2013 [OLDER]. Alternatives still listed include start.me, Protopage, Netvibes (now dead), Feedly, igHome, and Symbaloo. — [iGoogle Wikipedia](https://en.wikipedia.org/wiki/IGoogle); [AlternativeTo](https://alternativeto.net/software/igoogle)

**Open-source and self-hosted readers and dashboards: GitHub stars, pulled live 2026-09-30**

| Repo | Stars | Created | Note |
|---|---|---|---|
| glanceapp/glance ("self-hosted dashboard that puts all your feeds in one place") | 37,278 | 2024-04-27 | About 37k stars in about 29 months. Release assets downloaded about 69k times (sum of `download_count`). Most installs are via Docker, so this undercounts. |
| gethomepage/homepage | 32,923 | 2022-08 | Service/homelab dashboard |
| karakeep-app/karakeep (read-later/bookmarks, formerly Hoarder) | 29,365 | 2024-02 | Fast growth, same period as the Pocket and Omnivore deaths |
| lissy93/dashy | 26,599 | 2021-02 | |
| FreshRSS/FreshRSS | 16,187 | 2012-10 | |
| wallabag/wallabag | 12,991 | 2013-04 | |
| Ranchero-Software/NetNewsWire | 10,435 | 2017-05 | Free, open-source Mac/iOS app |
| miniflux/v2 | 9,760 | 2017-11 | |
| homarr-labs/homarr (new repo, v1 rewrite) | 4,919 | 2023-12 | Understates Homarr: the older ajnart/homarr repo held most of its historical stars. I did not check that repo. |

— Source for the table: GitHub REST API (`api.github.com/repos/<owner>/<repo>`)

- In the 2025 selfh.st Self-Host User Survey (4,081 responses), respondents named favorite software in free text (3,678 responses across 340 apps). Of more than 300 apps named:
  - FreshRSS ranked #10 (52 mentions).
  - Homepage ranked #16 (29).
  - Miniflux ranked #20 (27).
  - Glance ranked #24 (24).
  - Karakeep ranked #25 (22).
  - For scale, Home Assistant had 588 and Jellyfin 522.

  — [selfh.st 2025 results](https://selfh.st/survey/2025-results/); [raw JSON](https://github.com/selfhst/cdn/blob/main/assets/surveys/annual/2025-results.json)
- The Glance "Show HN" post (May 14, 2024) got 211 points and 35 comments. — [HN 40357611](https://news.ycombinator.com/item?id=40357611)

### Inferences
- Glance's growth, about 37k stars in 2.4 years and passing Homepage and Dashy, is the strongest demand signal found for the specific MCPortal concept: panels of RSS, subreddits, YouTube, GitHub releases, HN, and so on. Stars measure developer interest, not paying users.
- The consumer "widget start page" business looks structurally weak. Netvibes closed in 2025, iGoogle closed in 2013, and Momentum is about $1M ARR. Survivors are either indie or niche, or they are pivoting to B2B (Feedly toward threat intelligence and market intelligence, Inoreader toward Enterprise and AI tokens).
- Feed readers monetize at roughly $5–$12/month. AI features (Inoreader's "Intelligence" tokens, Readwise's Ghostreader) are now bundled into the top tiers, so "AI plus feeds" is an expected feature rather than a differentiator by itself.

### Gaps
- No primary-source user counts for 2024–2026 for Feedly, Inoreader, Start.me, Tabliss, or Netvibes at shutdown. Feedly's older "15M users" type claims were not verified, so they are excluded.
- No funding rounds were found for any of these companies in 2024–2026. Feedly is described as bootstrapped.
- Miniflux has a hosted paid plan, and NetNewsWire is free with no revenue; exact Miniflux hosted pricing was not verified.
- Homarr's legacy-repo star count and historical star growth curves (for example from star-history) were not retrieved.

## 2. Market size estimates for RSS readers and start pages, and how credible they are

### Takeaway
Syndicated reports put the RSS reader market at about $320–450M in 2024/2025, growing about 7–7.5% a year to about $570–800M by 2031–2033. None of them shows its methodology publicly. They look like templated "report mill" output and should not be relied on.

### Cited Findings
- Verified Market Research: $322.2M in 2025, projected $568.4M by 2033, 7.4% CAGR. — [VMR](https://www.verifiedmarketresearch.com/product/really-simple-syndication-rss-reader-market/)
- Congruence Market Insights ("RSS Reader Apps"): $420.4M in 2025, projected $727.7M by 2033, 7.1% CAGR. — [Congruence](https://www.congruencemarketinsights.com/report/rss-reader-apps-market)
- Market Research Intellect: $450M in 2024, projected $800M by 2033, 7.5% CAGR. — [MRI](https://www.marketresearchintellect.com/product/global-really-simple-syndication-rss-reader-market-size-and-forecast/)
- An openPR press release reports $800M by 2031 at 7.5% CAGR and names Feedly, Inoreader, and NewsBlur as key players. — [openPR](https://www.openpr.com/news/4219419/global-really-simple-syndication-rss-reader-market-set-to-reach)
- The claim that "RSS adoption surged 34% year-over-year among professionals" appears in search-engine summaries of 2026 blog content. I found no primary source, and the LabHub roundup it was attributed to does not contain it. — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en)

### Inferences
- Bottom-up sanity check: the largest player, Feedly, has an estimated ARR of about $7M. Even if Inoreader, Readwise, Feedbin, NewsBlur, Reeder, and others were each several million, the consumer RSS reader software market would plausibly be in the tens of millions of dollars, not $300–450M. The top-down figures probably include enterprise media-monitoring and threat-intel spend, or are simply inflated. Treat them as low credibility.
- I found no credible standalone market-size figure for "start pages" or new-tab dashboards.

### Gaps
- No methodology disclosure was found for any syndicated report.
- No analyst estimate from a top-tier firm (Gartner, IDC) was found for this category.

## 3. Reddit and Hacker News threads from 2023–2026: what people ask for and complain about

### Takeaway
HN discussions show a steady, enthusiast-level interest in RSS and personal dashboards. What people consistently ask for:
- Extensibility and hackability
- One page for all their sources
- Simple deployment
- Freedom from algorithmic feeds

The complaints are closed platforms and API costs (Reddit, X, Instagram), feeds that are hard to discover, and maintenance breakage. Some vocal users are skeptical of AI summarization replacing feeds.

### Cited Findings
- Glance Show HN (May 2024, 211 points):
  - Praise for the preset layout: "The preconfigured page they provide as an example is almost exactly like I would want it to be configured."
  - Complaints: "Closed Web keeps data and users on their platform. Or an insanely expensive api, cough reddit…" and "I'll get it set up just so, then some api changes etc."
  - Requests: single-binary or PHP deployment rather than Docker, and a shared data-collection API that multiple frontends could use.

  — [HN 40357611](https://news.ycombinator.com/item?id=40357611)
- "Ask HN: What is must in a personal dashboard app?" (Nov 2024, very low engagement: 2 points, 1 comment). The one answer said extensibility is essential: "If it was not extensible, it would have faded into uselessness and abandonment as I lacked the time to maintain it." The user runs the dashboard as their new-tab page. — [HN 42185095](https://news.ycombinator.com/item?id=42185095)
- "Ask HN: Is RSS Still Alive?" (about Dec 2025, 13 points, 12 comments):
  - Users say RSS is their primary way to follow sites, including YouTube, blogs, podcasts, and GitHub.
  - Complaint: feeds exist but aren't advertised, so they are hard to discover.
  - Some are skeptical of AI curation, for example "You can't replace a pipe with a concierge," and dismissing AI summaries as "half-assed hallucination."
  - Walled gardens (Instagram, X) withhold feeds.

  — [HN 46309919](https://news.ycombinator.com/item?id=46309919)
- Recurring recommendation threads:
  - "Ask HN: Which RSS reader do you use?" (Jan 2025) — [HN 42746682](https://news.ycombinator.com/item?id=42746682)
  - "Ask HN: Recommendations for RSS Reader" (Mar 2024; posters want open-source, free, cross-device sync) — [HN 39613637](https://news.ycombinator.com/item?id=39613637)
  - "Show me your RSS feed subscriptions" (Dec 2023) — [HN 38478378](https://news.ycombinator.com/item?id=38478378)
- A Show HN for a personalized HN feed that "learns from your favorites" (2025) shows developers building personal filtered feeds. — [HN 45349668](https://news.ycombinator.com/item?id=45349668)
- A Jan 2026 Show HN built a single RSS feed of the most popular HN bloggers. — [HN 46602227](https://news.ycombinator.com/item?id=46602227)
- Older threads show the same demand going back years [OLDER]: "Ask HN: How do you build your personal start page?" (2021) and "Ask HN: Personal Dashboard?" (2020). Posters wanted self-hosted widgets pulling RSS, CalDAV, mail, and bank data. — [HN 29414763](https://news.ycombinator.com/item?id=29414763); [HN 22344099](https://news.ycombinator.com/item?id=22344099)
- A 2024 HN comment named Netvibes as one mature, still-usable alternative. Netvibes was retired a year later. — [HN 39494893](https://news.ycombinator.com/item?id=39494893)
- Mainstream tech press covers Glance positively, as "puts all my feeds on one page" and "already set as my web browser's home page." — [XDA](https://www.xda-developers.com/glance-self-hosted-dashboard/); [XDA](https://www.xda-developers.com/glance-is-a-beautiful-self-hosted-dashboard-that-ive-already-set-as-my-web-browsers-home-page/)
- PC Gamer (2026) ran "Kill the algorithm in your head: Let's set up RSS readers…", showing that anti-algorithm framing has reached mainstream outlets. — [PC Gamer](https://www.pcgamer.com/software/kill-the-algorithm-in-your-head-lets-set-up-rss-readers-and-get-news-we-actually-want-in-2026/)

### Inferences
- MCPortal's "agent composes the dashboard" pitch speaks directly to the most-cited pain in these threads: setup and configuration upkeep ("set it up just so, then API changes"). Glance and Homepage both require hand-edited YAML config files. The preset layout was also the most-praised part of Glance, which supports starter packs.
- There is a vocal segment that distrusts AI summaries. A "clean source panels plus reader view" positioning (AI arranges, doesn't rewrite) probably fits that audience better than "AI digests."
- Dashboards that depend on Reddit or X face API-cost and access risk.

### Gaps
- Reddit threads (r/rss, r/selfhosted, r/productivity) could not be fetched directly in this session. Findings rely on HN, and Reddit sentiment is unverified here.
- No quantitative thread counts or trend data (for example, "iGoogle alternative" search volume) were gathered.

## 4. RSS revival or decline narrative, 2024–2026, and where Pocket and Omnivore users went

### Takeaway
2024–2025 brought a wave of shutdowns:
- Omnivore: November 2024
- Netvibes: June 2025
- Pocket: July 2025
- Tiny Tiny RSS: its developer took it offline

These closures pushed users toward paid incumbents such as Readwise Reader, whose user base roughly quadrupled in June–August 2025 per its own announcements (relayed secondhand), and toward self-hosted tools (Karakeep, Wallabag). Press frames RSS as "back," but the hard evidence is anecdotal signup bumps, not market-wide usage data.

### Cited Findings
- Pocket:
  - Mozilla announced on May 22, 2025 that Pocket would close on July 8, 2025. Exports were available until October 8, 2025, then accounts were deleted.
  - Pocket had 17M users and 1B saves as of September 2015 [OLDER]. Mozilla acquired it in February 2017.

  — [Wikipedia: Pocket](https://en.wikipedia.org/wiki/Pocket_(service)); [Michael Tsai](https://mjtsai.com/blog/2025/05/22/shutting-down-pocket/)
- Mozilla's stated reason was that "the way people are browsing the web is changing." — [TechCrunch](https://techcrunch.com/2026/08/14/read-it-later-app-pocket-is-shutting-down-here-are-the-best-alternatives/) (article date shown as Aug 14, 2026, likely an updated version of a 2025 piece)
- TechCrunch lists these Pocket alternatives with prices:

  | App | Price |
  |---|---|
  | Matter | $79.99/yr |
  | Instapaper | $59.99/yr |
  | Raindrop.io | $33/yr |
  | Readwise Reader | $9.99/mo |
  | Wallabag hosted | €11/yr |
  | Karakeep, Readeck, Obsidian Web Clipper | Free |

  — [TechCrunch](https://techcrunch.com/2026/08/14/read-it-later-app-pocket-is-shutting-down-here-are-the-best-alternatives/)
- Readwise Reader's user base "roughly quadrupled in June through August" 2025, "per Readwise Reader's own announcements." This is relayed by a secondary blog; I did not find the primary Readwise post. — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en)
- Search-engine summaries claim that some Pocket leavers also quit algorithmic feeds, lifting signups at Reeder, NetNewsWire, Inoreader, and Feedly, and that "Feedbin … doubled its trial signups." I could not verify these in any primary source, and the LabHub page does not contain the Feedbin claim. Treat as unverified. — [Feedbin blog](https://feedbin.com/blog) (no confirming post found)
- Commentators describe three lanes for post-Pocket tools: AI-native (Readwise Reader, Burn 451), self-hosted (Wallabag, Karakeep), and premium design-focused (Matter, GoodLinks). Instapaper and Raindrop.io are also cited as common landing spots. These are vendor and SEO blogs, so the source quality is low. — [Burn451](https://www.burn451.cloud/concepts/pocket-alternative); [Medium/Bongarts](https://medium.com/@mariusbongarts/pocket-shuts-down-in-july-2025-the-10-best-alternatives-f9420e2b6d99)
- Omnivore:
  - Free and open-source read-later app. ElevenLabs acqui-hired the team in late October 2024, and the service shut down on November 15, 2024. The export deadline was about November 30, 2024.
  - It reportedly had "500K+ users," per a secondary blog.

  — [Gleamr](https://gleamr.io/blog/omnivore-shut-down-alternatives); [Marqly](https://www.marqly.com/alternatives/omnivore)
- Omnivore passed 10k GitHub stars in spring 2024. Karakeep, created in February 2024, is now at 29k stars (GitHub API), consistent with a migration toward self-hosting. — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en); GitHub API
- The "RSS reader market in 2026 looks nothing like it did even two years ago" framing: Pocket shut down, Omnivore was acqui-hired, and Tiny Tiny RSS went offline. The ecosystem is described as "small but very pluralistic." — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en)
- Revival pieces:
  - "No, RSS isn't dead!" (May 2025) — [Andrew Blackman](https://andrewblackman.net/2025/05/no-rss-isnt-dead/)
  - PC Gamer, 2026 — [PC Gamer](https://www.pcgamer.com/software/kill-the-algorithm-in-your-head-lets-set-up-rss-readers-and-get-news-we-actually-want-in-2026/)

### Inferences
- The "revival" is real as a narrative and as churn between tools. But the clearest structural fact is that big companies keep exiting: Google (2013), Mozilla/Pocket (2025), and Dassault/Netvibes (2025). Users land at small indies or self-host. Risk for MCPortal: this audience has been burned repeatedly and values data export and portability. That favors an open, portable design such as OPML import/export.
- The Pocket and Netvibes closures in mid-2025 left displaced users with bookmarks and dashboards to move. That points to import (OPML, Pocket CSV) as an onboarding wedge.

### Gaps
- No primary-source numbers were found for the size of Pocket's user base in 2025 or for how many users each alternative absorbed.
- No independent usage or traffic time series (for example Similarweb trends for Feedly and Inoreader over 2023–2026) was gathered. [Similarweb](https://www.similarweb.com/website/feedly.com/) exists but was not fetched.

## 5. Willingness to pay: which segments pay and at what price

### Takeaway
People pay for feeds and reading in a narrow band: about $3–$10/month for consumers, roughly $30–$100/year. Power readers and researchers pay the most (Readwise at $9.99/mo). A large free and open-source alternative (NetNewsWire, FreshRSS, Miniflux, Glance, Bonjourr, Karakeep) caps consumer pricing, and the developer and self-hoster segment in particular expects free. Real money tends to come from teams and enterprise (Feedly's market and threat intelligence tiers, Inoreader Enterprise).

### Cited Findings
- Consumer price anchors, 2025–2026:

  | Product | Price |
  |---|---|
  | Reeder | $10/yr |
  | NewsBlur | $36/yr |
  | Momentum Pro | $39.95/yr |
  | Feedbin | $50/yr |
  | Feedly Pro | $60/yr |
  | Inoreader Pro | $90/yr |
  | Readwise | $99.99/yr |
  | Matter | $79.99/yr |
  | Instapaper | $59.99/yr |
  | Raindrop | $33/yr |

  — [LabHub](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en); [TechCrunch](https://techcrunch.com/2026/08/14/read-it-later-app-pocket-is-shutting-down-here-are-the-best-alternatives/); [Starter Story](https://www.starterstory.com/stories/momentum-dashboard-breakdown)
- Momentum reached about $1M ARR at $3.33–$4.95/mo (2024), with a one-founder operation, suggesting a small paying base on a large free funnel. — [Starter Story](https://www.starterstory.com/stories/momentum-dashboard-breakdown)
- Inoreader bundles AI usage (1M tokens a month) into Pro and sells an Enterprise tier. — [Readless summary of Inoreader pricing](https://www.readless.app/blog/inoreader-pricing-2026); [Inoreader enterprise](https://www.inoreader.com/pricing/enterprise)
- Omnivore never charged, and its free model ended in an acqui-hire and shutdown. — [Gleamr](https://gleamr.io/blog/omnivore-shut-down-alternatives)
- Bonjourr explicitly has no ads or investors, and HN posters asking for readers prefer "open-source, free" options. — [Bonjourr](https://bonjourr.fr/); [HN 39613637](https://news.ycombinator.com/item?id=39613637)

### Inferences
- Groups most likely to pay:
  - Knowledge workers and researchers who already pay for Readwise-style tools, at about $8–10/mo.
  - Teams or professionals doing market or competitive monitoring (Feedly's pivot).
- Developers and self-hosters are the loudest demand signal (GitHub stars) but the weakest payers.
- Because MCPortal runs inside AI chat hosts that users already pay for, a standalone subscription must clear a high bar. Free or open-source with a paid hosted or team tier matches the category norm.

### Gaps
- No public conversion rates (free to paid) were found for any feed reader or start page.
- No survey data on willingness to pay specifically for AI-composed dashboards.
