# AI-Native / Agentic News and Feed Curation Products: Demand and Outcomes (research as of 2026-09-30)

## ChatGPT Pulse: adoption, reception, availability, outcome

### Takeaway
Pulse launched on 2025-09-25 as a Pro-only ($200/mo) mobile preview. It reached the web for Pro on 2025-10-29 and never shipped to Plus. OpenAI announced its retirement on 2026-06-17, about 9 months after launch, and folded it into "scheduled tasks." OpenAI's stated lesson was that proactive briefings work best when they are "personalised, action-oriented, and steerable by the user." That points away from opaque AI-chosen feeds and toward user-directed recurring briefs, which is closer to MCPortal's "tell the agent what panels you want" model.

### Cited Findings
- Launched as a preview for Pro users on mobile. It was a new tab that did proactive research overnight and delivered personalized updates from chats, feedback and connected apps like Calendar/Gmail — [OpenAI: Introducing ChatGPT Pulse](https://openai.com/index/introducing-chatgpt-pulse/); [TechCrunch, 2025-09-25](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs)
- Delivered about 5–10 briefs per day. It was explicitly designed to get users to open ChatGPT first thing in the morning. OpenAI said it wanted to bring Pulse to all users, with Plus "soon," but first needed to make it more efficient (compute cost) — [TechCrunch](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs)
- Cards were only available that day unless the user saved them. Pulse came to the web for Pro on 2025-10-29. There is no release note confirming Plus/Business/Enterprise ever got it — [justinmckelvey.com (secondary, citing OpenAI release notes)](https://justinmckelvey.com/blog/chatgpt-pulse); [BleepingComputer](https://www.bleepingcomputer.com/news/artificial-intelligence/chatgpt-pulse-is-coming-to-the-web-but-no-word-on-free-or-plus-roll-out/)
- Reception was mixed. The HN launch thread included criticism that AI-initiated messaging felt obnoxious, and there were privacy concerns about how much data it accessed. Connectors were off by default and there was an "Allow proactive activity" toggle — [AlternativeTo summary](https://alternativeto.net/news/2025/9/openai-launches-chatgpt-pulse-in-preview-to-proactively-do-your-daily-research) (secondary aggregator; sentiment claims not quantified)
- Retirement was announced on 2026-06-17 alongside the scheduled tasks rollout. Pro users kept Pulse for 14 more days. OpenAI said it "observed strong engagement with tasks within the Pulse interface" and learned that proactive experiences are most useful when "personalised, action-oriented, and steerable by the user" — [Digit](https://www.digit.in/news/general/openai-is-retiring-chatgpt-pulse-and-replacing-it-with-scheduled-tasks-here-is-why.html); [IT Brief](https://itbrief.com.au/story/openai-expands-chatgpt-scheduled-tasks-with-new-hub)
- Release note wording: "Pulse is being sunset as proactive updates move into scheduled tasks." Scheduled tasks (with a daily-brief template) are available on Free, Go, Plus, Pro, Business and Enterprise with different limits — [justinmckelvey.com](https://justinmckelvey.com/blog/chatgpt-pulse)

### Inferences
- The largest consumer AI player built exactly an "AI decides what you should read each morning" feed and killed it in under a year without ever taking it off the $200 tier. That suggests high inference cost plus unclear retention for a feed the AI curates on its own.
- The replacement is user-specified recurring jobs. This supports a model where the user explicitly composes sources and panels (MCPortal's approach) over a black-box proactive feed.
- It is also a competitive risk: "daily briefing" is now a commodity built into ChatGPT (scheduled tasks) and Gemini (Daily Brief), so MCPortal's differentiation has to come from persistent, source-transparent panels and publishing, not from the briefing itself.

### Gaps
- OpenAI published no usage, DAU or retention numbers for Pulse. There was no quantified sentiment data. I did not directly read the HN thread.

## Perplexity Discover / Comet, Google Discover / CC / Gemini Daily Brief

### Takeaway
AI browsers and assistant briefings drew big waitlists and got distributed free. Google moved from a Labs email-briefing experiment (CC, Dec 2025) to Gemini Daily Brief (I/O 2026), later free for US users. Big platforms are giving away briefings, mostly centered on inbox and calendar rather than curated web sources.

### Cited Findings
- Comet launched in 2025 for Max ($200/mo) only, then became free worldwide on 2025-10-02. Perplexity said "millions" had joined the waitlist and called it "the most sought-after AI product of the year." Max users got a new background assistant — [CNBC, 2025-10-02](https://www.cnbc.com/2025/10/02/perplexity-ai-comet-browser-free-.html); [Perplexity blog](https://www.perplexity.ai/hub/blog/comet-is-now-available-to-everyone-worldwide); [TechCrunch](https://techcrunch.com/2025/10/02/perplexitys-comet-ai-browser-now-free-max-users-get-new-background-assistant/?sidebar=a)
- Comet iOS reportedly hit #3 on the US App Store within 48 hours of its March 2026 launch. The Perplexity-wide figure of 100M+ MAU (Sacra, Apr 2026) is for all products, not Comet alone — [index.dev (secondary)](https://www.index.dev/blog/perplexity-statistics); [Wikipedia: Comet](https://en.wikipedia.org/wiki/Comet_(browser))
- Google Labs "CC" (Dec 2025, US/Canada waitlist) was an agent that emailed a "Your Day Ahead" briefing each morning from Gmail, Calendar, Drive and the web, and users could reply to it — [Google blog](https://blog.google/technology/google-labs/cc-ai-agent/); [Chrome Unboxed](https://chromeunboxed.com/googles-new-cc-ai-agent-wants-to-be-your-morning-executive-assistant/)
- Gemini Daily Brief launched at Google I/O 2026 for AI Plus/Pro/Ultra in the US. It is a morning digest from Gmail, Calendar and tasks. It later rolled out to free US users. Google says CC informed it — [The Next Web](https://thenextweb.com/news/google-gemini-app-daily-brief-redesign-io-2026); [Chrome Unboxed](https://chromeunboxed.com/google-is-rolling-out-gemini-daily-brief-to-free-users-dropping-the-paid-ai-requirement/); [Google blog](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/); [The Rundown](https://www.therundown.ai/tools/cc)
- Android Central reported signs of a Daily Brief "Tuning" feature, meaning user steering of the digest — [Android Central](https://www.androidcentral.com/apps-software/ai/daily-brief-tuning-could-be-what-google-has-planned-next-for-geminis-morning-digest)

### Inferences
- Both OpenAI (tasks) and Google ("Tuning") are converging on steerable briefings, which is further evidence that user control matters.
- Free, bundled briefings from platforms with inbox access make a standalone "daily AI brief" a weak wedge. MCPortal's niche is better framed as a source-level feed workspace for technical and enthusiast users (HN/GitHub/RSS/YouTube), which inbox-centric briefs don't cover well.

### Gaps
- I found no Comet-specific DAU/MAU or retention numbers, and no data on Perplexity Discover feed engagement. There were no usage numbers for Gemini Daily Brief. I did not research Google Discover's AI summaries specifically.

## Arc → Dia (Browser Company / Atlassian), Opera Neon, other AI browsers

### Takeaway
Arc was stopped (maintenance mode, May 2025) because it was "too different, too much to learn, for too little reward." Its power features were used by a tiny minority. The company pivoted to the AI browser Dia and was sold to Atlassian for $610M cash (announced 2025-09-04), which has since repositioned Dia as an enterprise product ("Dia for Work"). Opera Neon launched at $19.99/mo on 2025-09-30 and switched to a free download plus a paid plan in Aug 2026.

### Cited Findings
- Josh Miller's letter to Arc members: for most people Arc was too different, with too many new things to learn for too little reward, and many "core" features were used by only a tiny minority — [9to5Mac, 2025-05-27](https://9to5mac.com/2025/05/27/mac-browser-arc-being-discontinued-in-favor-of-new-dia-app/); [Android Authority](https://www.androidauthority.com/arc-browser-development-ends-3561650/); [gHacks](https://www.ghacks.net/2025/05/27/arc-browser-has-been-discontinued-but-the-companys-building-a-new-browser-dia/)
- Atlassian agreed to acquire The Browser Company for $610M in cash (2025-09-04). It runs independently and continues Dia. OpenAI and Perplexity reportedly also looked at acquiring it — [CNBC](https://www.cnbc.com/2025/09/04/atlassian-the-browser-company-deal.html); [TechCrunch](https://techcrunch.com/2025/09/04/atlassian-to-buy-arc-developer-the-browser-company-for-610m); [SEC press release](https://www.sec.gov/Archives/edgar/data/1650372/000165037225000040/ex991pressrelease.htm)
- In H1 2026, Atlassian repositioned Dia as "Dia for Work." In March 2026 it added Slack, Notion, Google Calendar, Gmail and Amplitude integrations. 97% of Atlassian staff reportedly use Dia internally. Mike Cannon-Brookes: "We're building a doer, not a browser" (Sept 2026) — [Wikipedia: Dia](https://en.wikipedia.org/wiki/Dia_(web_browser)); [PiunikaWeb, 2026-09-29](https://piunikaweb.com/2026/09/29/dia-browser-doer-not-a-browser-mike-cannon-brookes/)
- Opera Neon: paid launch on 2025-09-30 at $19.99/mo with waitlist invites. Public early access came on 2025-12-11. In Aug 2026 it became a free download with a $19.90/mo Standard plan — [MacRumors](https://www.macrumors.com/2025/09/30/opera-ai-browser-neon-launch/); [Opera press](https://press.opera.com/2025/12/11/opera-opens-public-access-to-opera-neon-its-experimental-agentic-ai-browser/); [ToolChase (secondary, for the Aug 2026 change)](https://toolchase.com/tool/opera-neon/)

### Inferences
- Arc's lesson applies directly to MCPortal: a novel workspace metaphor carries a "novelty tax," and power features that enthusiasts love may be used by very few people. Starter packs and zero-learning defaults (already in recent commits) are the right mitigation.
- Consumer AI browsers moved toward either free distribution (Comet, Neon) or enterprise monetization (Dia). Paid consumer AI browsing has not held up on its own.

### Gaps
- There are no public Dia or Neon user counts. Neon's pricing reversal was confirmed only by a secondary review site.

## Artifact (2023–2024), Particle, Meco, Readwise/Feedly/Inoreader

### Takeaway
Artifact had famous founders and good AI personalization but stalled at about 444k lifetime downloads. It shut down in Jan 2024 because the "market opportunity isn't big enough," and its tech was sold to Yahoo (closed 2024-03-29). Particle (AI multi-source story summaries) is still going with about $15M raised. The durable businesses are paid RSS and read-later tools with AI add-ons (Feedly Leo, Inoreader, Readwise Ghostreader). The Pocket shutdown (July 2025) caused a measurable surge in signups for them.

### Cited Findings
- Artifact: launched Feb 2023. About 444k downloads in total, about 100k of them near launch, and only about 12k new installs in Oct 2023. The US was 44% of downloads and no other country was above 4%. SmartNews had about 2M downloads in the same period — [TechCrunch, 2024-01-18](https://techcrunch.com/2024/01/18/why-artifact-from-instagrams-founders-failed-shut-down/)
- Systrom: "We have built something that a core group of users love, but we have concluded that the market opportunity isn't big enough to warrant continued investment in this way" (2024-01-12) — [Mediagazer](https://mediagazer.com/240112/p14); [TechCrunch](https://techcrunch.com/2024/01/12/instagram-co-founders-news-aggregation-startup-artifact-to-shut-down)
- Feature creep diluted the core value: link sharing, text posts, place recommendations, AI image generation. Chatbots and search now deliver news summaries without a separate app — [TechCrunch](https://techcrunch.com/2024/01/18/why-artifact-from-instagrams-founders-failed-shut-down/)
- Yahoo acquired Artifact (announced 2024-04-02, closed 2024-03-29, terms undisclosed) to integrate its personalization into Yahoo News — [Yahoo Inc.](https://www.yahooinc.com/press/yahoo-announces-the-acquisition-of-artifact-the-news-discovery-platform-created-by-instagram-cofounders-kevin-systrom-and-mike-krieger); [TechCrunch](https://techcrunch.com/2024/04/02/yahoo-acquiring-instagram-co-founders-ai-powered-news-artifact/)
- Particle (ex-Twitter founders Sara Beykpour and Marcel Molina): $4.4M seed plus an ~$11M Series A (June 2024, led by Lightspeed, with Axel Springer), about $15M total. Public app launch Nov 2024. It topped the App Store Magazines & Newspapers category for several days. Web launch came in May 2025, followed by Android and Particle+ — [Maginative](https://www.maginative.com/article/particle-raises-10-9m-for-its-ai-powered-news-platform/); [TechCrunch, 2024-11-12](https://techcrunch.com/2024/11/12/particle-launches-an-ai-news-app-to-help-publishers-instead-of-just-stealing-their-work); [TechCrunch, 2025-05-06](https://techcrunch.com/2025/05/06/particle-brings-its-ai-powered-news-reader-to-the-web); [Wisp review (secondary)](https://wisp.news/blog/particle-review/)
- Meco: a newsletter reader (it pulls newsletters out of Gmail) with AI summaries and AI audio roundups. Meco PRO costs $3.99/mo or $34.99/yr — [Meco docs](https://docs.meco.app/docs/meco-pro/overview); [meco.app](https://meco.app/)
- Pocket shut down on 2025-07-08, with data deleted on 2025-10-08. Omnivore shut down in Nov 2024 after ElevenLabs acqui-hired its team — [9to5Mac](https://9to5mac.com/2025/05/22/mozilla-announces-shutdown-of-pocket/); [gHacks](https://www.ghacks.net/2025/05/23/mozilla-to-shut-down-pocket-in-july-2025-fakespot-is-closing-too/)
- Readwise Reader's user base reportedly roughly quadrupled from June to Aug 2025 after Pocket's shutdown. Reeder, NetNewsWire, Inoreader and Feedly also saw signup bumps, and Feedbin trial signups doubled. Feedly has about 15M users. Paid tiers: Feedly Pro about $60/yr, Inoreader Pro $90/yr, Readwise Reader $119.88/yr. Feedly Leo and Inoreader AI add prioritization and summaries on paid tiers. Ghostreader summarizes, defines and answers questions — [LabHub blog (secondary; figures not traced to primary)](https://labhub.hopto.org/blog/culture/2026-05-16-rss-readers-read-later-2026-reeder-netnewswire-inoreader-feedbin-miniflux-freshrss-karakeep-deep-dive?lang=en); [Readless pricing comparison](https://www.readless.app/blog/readwise-vs-feedly-vs-inoreader-pricing-2026)

### Inferences
- An AI-personalized general news feed looks like a small, crowded market (Artifact, Pulse). The steadier demand is from enthusiasts who pick their own sources and pay $60–120/yr for power reading tools. That profile matches MCPortal's HN/GitHub/RSS/YouTube audience better than mass-market news.
- Read-later shutdowns (Pocket, Omnivore) create displaced users who care about data portability. Saved items plus export could be a real acquisition hook.
- Artifact's feature creep is a warning for MCPortal to keep publishing as a tight extension of curation, not a social network.

### Gaps
- I found no Particle MAU/retention, no Meco funding or user counts, and no primary source for the Readwise "4x" claim or Feedly's 15M figure.

## Evidence for agent-composed dashboards/briefings vs. novelty churn

### Takeaway
The pattern is strong waitlist and launch spikes followed by stalling or retirement: Artifact's downloads fell from about 100k at launch to about 12k/month, Pulse was retired in 9 months, Arc hit the "novelty tax," and Neon and Comet dropped their paywalls. The surviving pattern is user-steered recurring tasks and user-chosen sources. I found no public data showing sustained retention for AI-composed personal dashboards specifically.

### Cited Findings
- Artifact's launch spike then decay (100k near launch vs 12k new installs in Oct 2023) — [TechCrunch](https://techcrunch.com/2024/01/18/why-artifact-from-instagrams-founders-failed-shut-down/)
- OpenAI saw "strong engagement with tasks within the Pulse interface," and that finding drove the move to user-steered scheduled tasks — [Digit](https://www.digit.in/news/general/openai-is-retiring-chatgpt-pulse-and-replacing-it-with-scheduled-tasks-here-is-why.html)
- Arc: users were unwilling to relearn browsing, and core features were used by a tiny minority — [9to5Mac](https://9to5mac.com/2025/05/27/mac-browser-arc-being-discontinued-in-favor-of-new-dia-app/)
- Comet had "millions" on its waitlist yet still went free within about 3 months of its paid launch — [CNBC](https://www.cnbc.com/2025/10/02/perplexity-ai-comet-browser-free-.html)

### Inferences
- MCPortal should design for retention after the novelty wears off: a portal that is persistent and useful without re-prompting, reader view, and saved items. It should not rely on a "wow" first build.
- Running inside Claude/ChatGPT via MCP avoids the "switch your browser/app" cost that hurt Arc, but it depends on host distribution and on the user opening the host daily.

### Gaps
- There is no public cohort or retention data for any product in this category.

## Curation-as-publishing demand (Substack, Are.na, linkblogs, Refind)

### Takeaway
There is strong demand for curator-led publishing when there is a person or voice attached. Substack had 5M paid subscriptions (Mar 2025) out of about 35M active. I found no strong, citable evidence of demand for tools that turn curation into publishing (Refind, Are.na metrics) in 2024–2026.

### Cited Findings
- Substack reached 5M paid subscriptions in March 2025, up from 4M a few months earlier and about 100k in July 2020. It has about 35M active subscriptions and 50k+ monetizing publications. More than 50 newsletters earn over $1M/yr, per a co-founder — [Tubefilter, 2025-03-12](https://www.tubefilter.com/2025/03/12/substack-five-million-paid-subscribers-journalist-reporter-newsletter/); [Backlinko](https://backlinko.com/substack-users); [Blog Herald](https://blogherald.com/blog-platforms-tools/a-more-than-50-newsletters-on-substack-are-now-earning-over-a-million-dollars-a-year-according-to-the-platforms-own-co-founder-a-milestone-that-didnt-exist-five-years-ago/)
- There are signs Substack's paid growth is slowing, per commentary — [Simon Owens](https://simonowens.substack.com/p/is-substacks-subscription-growth)

### Inferences
- The value in curation-publishing comes from the curator's audience and voice. The tool is secondary. A "publish public page + Atom feed" feature is cheap to build and fits RSS power users, but it is unlikely to drive acquisition by itself. It is better positioned as a retention and sharing loop (a curated page that brings in new users).

### Gaps
- My Are.na searches returned nothing relevant (no funding or member data found). I did not research Refind or linkblog tools (Pinboard, Raindrop public collections) because of the tool-call budget. There is no data on how many curated-link newsletters exist or earn money.
