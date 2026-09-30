# MCP Apps / ChatGPT Apps SDK Ecosystem as a Consumer Distribution Channel

Research date: 2026-09-30. Dates attached to each finding. Some figures come from third-party trackers and blogs, not primary sources; that is flagged where it applies.

## 1. MCP Apps extension status and host support; OpenAI Apps SDK and the ChatGPT app/plugin directory

### Takeaway
The standard is in place and supported by several hosts. MCP Apps (SEP-1865) went live in Claude, VS Code, and Goose on 2026-01-26, and ChatGPT implements it too. ChatGPT's directory has grown to about 2,000–2,300 listed apps (4,000+ "connected apps" by OpenAI's Sept 2026 count), and in July 2026 it was renamed the "Plugin Directory." Usage is thin outside the big-brand apps. Developers complain about review friction, bugs, no usage analytics, and poor discoverability.

### Cited Findings
- On 2026-01-26 Anthropic launched MCP Apps in Claude: interactive UI (charts, forms, dashboards) rendered in the chat through sandboxed iframes with pre-declared HTML templates and host-managed approval of tool calls. The spec is SEP-1865, derived from MCP-UI and the OpenAI Apps SDK, and was first proposed in November 2025. — [The Register, 2026-01-26](https://theregister.com/2026/01/26/claude_mcp_apps_arrives)
- Launch partners in Claude were Amplitude, Asana, Box, Canva, Clay, Figma, Hex, monday.com, and Slack, with Salesforce "coming soon." Other hosts: Goose, VS Code, ChatGPT. — [The Register](https://theregister.com/2026/01/26/claude_mcp_apps_arrives); [Alpic](https://alpic.ai/blog/mcp-apps-goes-official-claude-chatgpt-support)
- Cross-host gaps (July 2026): ChatGPT implements the MCP Apps standard and recommends the standard `ui/*` bridge methods, but VS Code does not support the fullscreen or PiP display modes. Some SDK functions (tool calling from the UI, file and checkout helpers) were not supported everywhere. — [sunpeak cross-host testing, Jul 2026](https://sunpeak.ai/blogs/cross-host-testing-mcp-apps/); [WorkOS](https://workos.com/blog/building-mcp-apps-inside-claude-chatgpt)
- GitHub adoption of the SDKs (checked 2026-09-30): modelcontextprotocol/ext-apps (official MCP Apps spec + SDK) has 2,886 stars and was last pushed 2026-09-25. MCP-UI-Org/mcp-ui has 5,187 stars. openai/openai-apps-sdk-examples has 2,351 stars. — GitHub API (`gh api repos/...`)
- OpenAI Apps SDK: announced at DevDay on 2025-10-06 as a preview built on MCP. Launch partners were Booking.com, Canva, Coursera, Figma, Expedia, Spotify, and Zillow. Pitched as reaching "800M" ChatGPT users. — [OpenAI](https://openai.com/index/introducing-apps-in-chatgpt/); [IntuitionLabs](https://intuitionlabs.ai/articles/openai-devday-2025-announcements)
- App submissions and a public App Directory opened in December 2025. — [OpenAI "Developers can now submit apps"](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/); [VentureBeat](https://venturebeat.com/technology/openai-now-accepting-chatgpt-app-submissions-from-third-party-devs-launches); [HN thread](https://news.ycombinator.com/item?id=46306456)
- 2026-07-09: ChatGPT "apps" were renamed "plugins" and the App Directory became the Plugin Directory, shared by ChatGPT and Codex. "A plugin can include skills, apps, and app templates." OpenAI also announced plans to retire custom GPTs into plugins in September. — [usecarly](https://www.usecarly.com/blog/chatgpt-plugins/); [gradually.ai](https://www.gradually.ai/en/chatgpt-plugins/); [dragapp](https://www.dragapp.com/blog/what-happened-to-chatgpt-plugins/) (secondary sources; I did not fetch the primary OpenAI post)
- 2026-09-29 DevDay: ChatGPT has 1.2B weekly users. OpenAI announced in-conversation app suggestions, "Sign in with ChatGPT" (16 launch partners), app-like interactive panels in plugins, an enterprise app marketplace (30+ partners), "Dots" agents, and improved plugin review and submission tracking. The "connected apps ecosystem" is 4,000+ apps. There was no billing or rev-share system comparable to an app store. — [TechCrunch, 2026-09-29](https://techcrunch.com/2026/09/29/openais-latest-features-take-direct-aim-at-the-app-store-model/)
- Directory counts over time. Different methods give different numbers:
  - About 900 ChatGPT apps vs. about 353 Claude connectors ([Modern Retail, 2026-05-01](https://www.modernretail.co/technology/retailers-are-rushing-to-build-ai-apps-its-unclear-if-shoppers-will-use-them/))
  - 1,624 apps on 2026-07-02 ([Phiture / search snippet](https://phiture.com/asostack/chat-gpt-app-directory/))
  - 2,049 apps (anonymous, union of 89 countries), about 1,735–1,895 per country, and about 500 more visible only when logged in, per an August 2026 harvest ([Nicolas Sitter census](https://www.nicolassitter.com/research/mcp-apps-census-2026))
  - 2,289 apps from 2,007 developers in August 2026, 392 of which also ship a Claude connector ([Node8](https://node8.ai/ai-connectors/chatgpt/))
  - One GitHub list catalogs 330 "verified" apps ([awesome-chatgpt-apps](https://github.com/rdmgator12/awesome-chatgpt-apps))
- ChatGPT category mix (Sitter census, Aug 2026): Business & operations 399, Productivity 382, Travel 228, Finance 211, Developer tools 126, across 11 categories. The US sees 150 country-exclusive apps (Expedia, Uber, Skyscanner). — [Sitter](https://www.nicolassitter.com/research/mcp-apps-census-2026)
- An editorial rank of 123 tracked apps (2026-07-16) gave a mean score of 74/100 and no app a score of 90 or above. Top apps: Canva 88, Wolfram 87, GitHub 86. 79% have a free plan. Only 7% were fully verified. — [ChatGPTAppsRank](https://chatgptappsrank.com/state-of-chatgpt-apps-2026)
- Developer complaints (May 2026): a tedious approval process, a buggy coding system, and **no usage data**. Alpic's chief of staff said: "Adoption and conversion are pretty low… People don't even know that there are apps in the ChatGPT store." An analyst said: "There's no visible success story of any of these apps being a meaningful driver." OpenAI replied: "We're still early… the developer experience needs to improve." — [Modern Retail, 2026-05-01](https://www.modernretail.co/technology/retailers-are-rushing-to-build-ai-apps-its-unclear-if-shoppers-will-use-them/)
- Structural discoverability problem: users have to know an app exists, find it, install or connect it, and then invoke it. Otherwise growth depends on ChatGPT choosing to suggest the app. — [Modern Retail](https://www.modernretail.co/technology/retailers-are-rushing-to-build-ai-apps-its-unclear-if-shoppers-will-use-them/); [Tedix discoverability guide](https://blog.tedix.dev/posts/chatgpt-app-discoverability-guide/); [OpenAI community thread on metadata](https://community.openai.com/t/chatgpt-apps-metada-for-discoverability/1371136)

### Inferences
- The shared standard means a single MCPortal build can target Claude, ChatGPT, VS Code, and Goose. Minor per-host display-mode differences still need testing.
- In-conversation app suggestions (announced 2026-09-29) are likely the most important distribution lever still to come. Listed apps with clear metadata could get model-driven discovery. Custom (unlisted) connectors will not.
- The rename to "plugins" and the bundling of skills and apps suggests OpenAI is still iterating on the product surface. Expect churn in listing requirements.

### Gaps
- OpenAI has published no per-app install or usage numbers, and has not said what share of ChatGPT users use any app.
- I did not fetch the primary OpenAI "plugins" announcement, so the date comes from secondary sources.

## 2. Claude connector directory: listing, review, discovery; admin restrictions

### Takeaway
Anthropic reviews directory submissions for auth, scopes, privacy, and tool annotations. Submissions must come from a Team or Enterprise org, and MCP Apps listings need screenshots. Directory listings can be suggested by Claude; custom connectors never are. Free users get one custom connector. On Team and Enterprise, only Owners can add connectors, which blocks self-serve installs inside restricted orgs (consistent with MCPortal's own experience).

### Cited Findings
- "The difference between directory and custom connectors is review, discoverability, and distribution. Custom connectors are never suggested." — [Claude docs: directory vs custom](https://claude.com/docs/connectors/building/directory-vs-custom)
- Submission (Aug 2026 guide):
  - You need a Team or Enterprise org with Directory management access. Individual accounts cannot submit.
  - Tools need titles and `readOnlyHint` or `destructiveHint`. Descriptions must not "tell Claude to promote your service."
  - Supported auth: OAuth with DCR, CIMD, Anthropic-held credentials, static headers (beta), or no auth.
  - MCP App submissions need 3–5 PNG screenshots, each at least 1000px wide, paired with the prompts that produced them and tested at 320px+ mobile width.
  - Review time depends on the queue; escalate to mcp-review@anthropic.com.
  - Listings enter as "community" connectors. Anthropic may pick notable ones for "verified" functional review.
  - Tool updates don't require resubmission. The slug is permanent.
  - Source: [sunpeak, 2026-08-13](https://sunpeak.ai/blogs/claude-connector-directory-submission/)
- Reviewers look at the auth flow, requested scopes, privacy behavior, tool descriptions, write actions, and the test account. — [sunpeak](https://sunpeak.ai/blogs/claude-connector-directory-submission/) via search summary
- Directory size: 1,375 Claude connectors (768 community, 598 partner, 9 Anthropic). 584 were added in July 2026 alone. The median connector ships 11 tools. — [Sitter census, Aug 2026](https://www.nicolassitter.com/research/mcp-apps-census-2026). Compare about 353 in May 2026 ([Modern Retail](https://www.modernretail.co/technology/retailers-are-rushing-to-build-ai-apps-its-unclear-if-shoppers-will-use-them/)).
- Custom connectors are available on Free, Pro, Max, Team, and Enterprise, but "Free users are limited to one custom connector."
  - On Team and Enterprise, "only Owners can add them," and members can only connect to connectors the Owner has approved.
  - Pro and Max users can add custom connectors themselves.
  - Admins can disable specific interactive-connector tool calls under Organization settings > Connectors.
  - Source: [Claude Help Center](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp); [Claude connectors help](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)

### Inferences
- For MCPortal, getting listed in the directory is the main lever for discovery in Claude. As a custom connector it cannot be suggested, and enterprise users at locked-down orgs (e.g. NVIDIA) cannot add it themselves.
- Submitting requires a Team or Enterprise org, which is a practical hurdle for an indie developer.
- A Free user's single custom-connector slot is a scarce resource, so a consumer feed app competes with every other connector for it.

### Gaps
- No public data on Claude connector review time, approval rate, or usage and installs per connector.
- I could not confirm MCP Apps rendering on Claude mobile.

## 3. Evidence of consumer MCP app traction, categories, and monetization

### Takeaway
There is little hard evidence of consumer traction. The directories are dominated by business and productivity apps. Brand consumer apps (Spotify, Zillow, Canva, Booking, Expedia, Instacart) lead mainly because of their existing user bases, and none have published in-ChatGPT usage. Monetization is weak: Instant Checkout was killed on 2026-03-05, digital goods and subscriptions are not supported in ChatGPT, and there is no rev share. The working model is "discover in AI, transact on your own site."

### Cited Findings
- On 2026-03-05 OpenAI discontinued Instant Checkout (launched September 2025 with ACP) because it wasn't converting. Walmart reportedly measured in-ChatGPT checkout converting about 3× worse than a click-through, while ChatGPT drove about 2× the new-customer rate. OpenAI moved commerce into merchant apps (Instacart, Booking.com). — [Forbes/Goldberg, 2026-03-10](https://www.forbes.com/sites/jasongoldberg/2026/03/10/why-openais-checkout-retreat-spells-trouble-for-its-commerce-strategy/); [Enterprise DNA](https://enterprisedna.co/resources/news/openai-agentic-commerce-protocol-walmart-sparky/); [digitalapplied](https://www.digitalapplied.com/blog/ai-agentic-commerce-discover-in-ai-buy-on-site-2026) (the Walmart figures come from secondary sources)
- Current OpenAI Apps SDK monetization docs:
  - External checkout (the recommended route) and checkout with saved payment methods.
  - "Embedded checkout" in private beta for select marketplace partners.
  - Approval "limited to... physical goods purchases."
  - Digital goods and subscriptions are not covered.
  - Source: [OpenAI Apps SDK Monetization](https://developers.openai.com/apps-sdk/build/monetization)
- At launch, OpenAI said selling digital goods and subscriptions wasn't allowed yet and that it was "exploring" monetization. — [WebFX summary](https://www.webfx.com/blog/ai/chatgpt-apps/); [OpenAI community thread](https://community.openai.com/t/chatgpt-app-monetization-apps-sdk/1372343/4)
- 2026-09-29: no billing or rev-share system was announced. The only money mechanism mentioned was enterprise customers applying OpenAI commitments toward approved partner software. — [TechCrunch](https://techcrunch.com/2026/09/29/openais-latest-features-take-direct-aim-at-the-app-store-model/)
- About 10% of ChatGPT apps are shopping-related, and 500+ apps were added in May 2026. Adoption and conversion are "pretty low." — [Modern Retail](https://www.modernretail.co/technology/retailers-are-rushing-to-build-ai-apps-its-unclear-if-shoppers-will-use-them/)
- Consumer-leaning categories: Travel is the #3 shelf in ChatGPT with 228 apps, versus only 24 travel connectors in Claude. Two-thirds of listed travel servers in registries "cannot be reached at all." — [Sitter](https://www.nicolassitter.com/research/mcp-apps-census-2026). ChatGPTAppsRank puts 46% of its tracked apps in "Lifestyle." — [ChatGPTAppsRank](https://chatgptappsrank.com/state-of-chatgpt-apps-2026)
- Scale of the host audiences: ChatGPT had 900M WAU in February 2026 (OpenAI) and 1.2B weekly users by 2026-09-29. — [TechCrunch](https://techcrunch.com/2026/09/29/openais-latest-features-take-direct-aim-at-the-app-store-model/); [DemandSage](https://www.demandsage.com/chatgpt-statistics/)

### Inferences
- A free consumer news dashboard fits the typical app profile (79% of ranked apps have a free plan). Revenue would have to come off-platform: a web subscription, or a Pro tier unlocked through the MCPortal account and OAuth.
- No published success story exists for a non-brand consumer MCP app. The main value of an indie consumer MCP app so far is being present in a channel that may open up (through in-chat suggestions), not proven demand.

### Gaps
- No install or MAU figures for any individual ChatGPT app or Claude connector.
- I found nothing on paid consumer MCP apps or subscriptions sold inside hosts.
- I found no news or reader app with reported in-chat traction.

## 4. MCP server counts, registries, and developer sentiment on discoverability and the long tail

### Takeaway
There are tens of thousands of MCP servers, most of them long-tail developer tools from solo developers with little quality signal. The official registry holds about 37.7K unique server names. Aggregate counts vary widely (7K to 133K) depending on deduplication. Discoverability and trust are widely named as the bottleneck, and "MCP is dead / a fad" debates were running in 2026.

### Cited Findings
- Official MCP Registry (registry.modelcontextprotocol.io): I paged the full `/v0/servers` API on 2026-09-30 and got **126,489 entries (all versions) and 37,728 unique server names**. The registry launched in preview on 2025-09-08. — [Registry API](https://registry.modelcontextprotocol.io/v0/servers) (own count); [GitHub registry repo](https://github.com/modelcontextprotocol/registry), 7,303 stars
- Other registries (July 2026): Glama about 37,800, mcp.so about 10,000+, Smithery about 6,000+, PulseMCP about 1,200 curated. — [ThinkNEO, 2026-07-14](https://thinkneo.ai/blog/mcp-registries-compared-20260714). This conflicts with PulseMCP's own page, which says "18,240+" servers ([PulseMCP](https://www.pulsemcp.com/servers)), so the gap may be curated vs. total.
- MCP Toplist: 132,896 servers across the Official Registry, Glama, Smithery, mcp.so, and PulseMCP combined as of 2026-09-21 (not deduplicated). — [mcptoplist](https://mcptoplist.com/)
- A deduplication study found 22,561 distinct servers.
  - Dev tools are 46% of the categorized servers.
  - About 36% have poor metadata.
  - Only 93 (0.4%) have any uptime or behavioral data.
  - By count, the ecosystem is "mostly solo devs."
  - The page shows a 2025-06-04 date, which may be wrong given the scale; treat the timing as uncertain.
  - Source: [dev.to/vdineshk](https://dev.to/vdineshk/i-deduplicated-every-mcp-registry-into-one-index-heres-what-22561-servers-actually-look-like-2og6)
- Registry and store misalignment: in travel, only 29 servers overlap between 392 registry servers and 253 store apps (5% of the union). — [Sitter](https://www.nicolassitter.com/research/mcp-apps-census-2026)
- Sentiment:
  - The OpenAI lead for the App Store, Codex plugins, and MCP (HN user mxstbr, about June 2026) said "practically ~every company on the planet is building an MCP server."
  - HN commenters pushed back that MCP duplicates OpenAPI and CLIs and adds maintenance burden. — [HN 48330710](https://news.ycombinator.com/item?id=48330710); [HN "MCP is a fad"](https://news.ycombinator.com/item?id=46552254); [HackerNoon "MCP Was Declared Dead" 2026-08-30](https://hackernoon.com/9-28-2026-techbeat)

### Inferences
- Listing in open registries does little for consumer discovery. The host-curated directories (ChatGPT Plugin Directory, Claude Directory) are where consumers can actually find apps, and they are about 2K and 1.4K apps, far smaller than the 37K+ registry long tail.

### Gaps
- No registry publishes installs or usage. Glama and Smithery show some usage counters that I did not check per server.

## 5. Similar and competing MCP servers (feeds, news, readers, dashboards)

### Takeaway
The RSS and news MCP space is crowded but tiny. Every open-source RSS or HN MCP server I found has fewer than about 80 stars, and none of them ship an MCP Apps UI; they are text tools. The strongest adjacent player is Readwise's official MCP, which reaches Claude, ChatGPT, and Cursor. Feedly's official MCP targets threat intelligence, not consumer reading. I found no dashboard-style consumer feed MCP App with notable adoption.

### Cited Findings
GitHub stars as of 2026-09-30 (GitHub API):

| Project | Stars | Last push | Notes |
|---|---|---|---|
| [readwiseio/readwise-mcp](https://github.com/readwiseio/readwise-mcp) | 151 | 2026-03-14 | Official Readwise MCP (highlights + Reader docs), remote at mcp2.readwise.io; works in Claude, ChatGPT, Cursor ([Readwise docs](https://docs.readwise.io/tools/mcp), [readwise.io/mcp](https://readwise.io/mcp)) |
| [erithwik/mcp-hn](https://github.com/erithwik/mcp-hn) | 76 | 2025-07-14 | Hacker News MCP |
| [pskill9/hn-server](https://github.com/pskill9/hn-server) | 40 | 2024-12-31 | HN MCP |
| [richardwooding/feed-mcp](https://github.com/richardwooding/feed-mcp) | 36 | 2026-09-29 | RSS/Atom/JSON feeds |
| [pedramamini/RSSidian](https://github.com/pedramamini/RSSidian) | 36 | 2026-02-04 | RSS ingest + summarize to markdown |
| [veithly/rss-mcp](https://github.com/veithly/rss-mcp) | 35 | 2025-12-12 | RSS/Atom + RSSHub |
| [buhe/mcp_rss](https://github.com/buhe/mcp_rss) | 27 | 2026-02-18 | RSS |
| [imprvhub/mcp-rss-aggregator](https://github.com/imprvhub/mcp-rss-aggregator) | 27 | 2026-09-27 | RSS aggregation for Claude Desktop |
| [devabdultech/hn-mcp](https://github.com/devabdultech/hn-mcp) | 19 | 2025-04-05 | HN |
| [dindicoelho/Inoreader-MCP](https://github.com/dindicoelho/Inoreader-MCP) | 19 | 2025-09-07 | Community Inoreader |
| [seiji/inoreader-mcp-server](https://github.com/seiji/inoreader-mcp-server) | 9 | 2026-06-04 | Community Inoreader (Bun) |
| [wei/hn-mcp-server](https://github.com/wei/hn-mcp-server) | 7 | 2025-10-13 | HN via Algolia |
| [lionkiii/rss-feeds-mcp](https://github.com/lionkiii/rss-feeds-mcp) | 4 | 2026-07-28 | RSS, no API keys |
| [GaryRogers/rss-reader-mcp](https://github.com/GaryRogers/rss-reader-mcp) | 2 | 2025-11-14 | RSS |
| [ni-c/freshrss-mcp](https://github.com/ni-c/freshrss-mcp) | 1 | 2026-09-28 | FreshRSS self-hosted |

- Feedly: the official "Feedly Threat Graph MCP Server" (16 tools) is aimed at cyber threat intelligence, not general reading. — [Feedly](https://feedly.com/new-features/posts/feedly-mcp-server-automate-cti-workflows-with-claude-and-the-feedly-threat-graph); [Feedly docs](https://docs.feedly.com/category/819-mcp-server). There are community Feedly MCPs ([LobeHub c0ffee0wl](https://lobehub.com/mcp/c0ffee0wl-feedly-mcp-server), [Glama fredrsat](https://glama.ai/mcp/servers/fredrsat/feedly-mcp)), and Zapier offers Feedly and Inoreader MCP actions ([Zapier Feedly](https://zapier.com/mcp/feedly), [Zapier Inoreader](https://zapier.com/mcp/inoreader)).
- Inoreader has no official MCP; there are only community servers and Zapier. — [PulseMCP Inoreader listing](https://www.pulsemcp.com/servers/dindicoelho-inoreader); [mcpmarket](https://mcpmarket.com/server/inoreader)
- The official MCP Registry has about 248 unique names matching rss/feed/news/hacker/readwise/inoreader (own count on 2026-09-30). This includes false positives such as "feedback" tools. Examples:
  - News and feed servers: `com.rssatlas/rss-atlas`, `com.newsmcp/newsmcp`, `ai.b77/google-news`, `ai.smithery/kwp-lab-rss-reader-mcp`, `com.mcpscores/feed-reader`, `co.kymac.feeds/feed-digest`, `com.agentnewsstand/agent-newsstand`, `app.newsmind/mcp`, `com.newscatcherapi/catchall`, `com.ranovam/hacker-news-scraper`.
  - About 20 `com.a2awire/data-*-news` feeds, including a Hacker News front page feed.
  - Source: [Registry API](https://registry.modelcontextprotocol.io/v0/servers)

### Inferences
- Among open-source feed/news MCPs, none has meaningful adoption (all under 200 stars) and none offers an interactive dashboard UI. MCPortal's MCP Apps dashboard is differentiated on UI, but the low stars also signal weak demand for "news in chat" as a developer-built category.
- Readwise (an established consumer reading brand with an official remote MCP) is the closest serious comparable. It suggests incumbent reader apps will add MCP to their existing products rather than cede the space.

### Gaps
- I did not check whether the ChatGPT Plugin Directory or Claude Directory contain news/RSS dashboard apps (e.g. publisher apps) or their ranking.
- I found no installs or usage data for any feed or news MCP.
- The Smithery and Glama usage counters for these servers were not checked.
