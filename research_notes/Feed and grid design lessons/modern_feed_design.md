# Modern Feed, Reading and Dashboard Design (2024-2026)

Research date: 2026-10-02. About 17 tool calls (searches plus 2 full-page fetches). Most product facts come from search-result snippets of primary or reputable press sources; the only pages read in full were the Kagi blog and TechCrunch's Artifact post-mortem. Source quality is marked where it matters. Bento-grid material comes mostly from SEO and agency blogs and should be treated as commentary.

## Bento grid trend: what it is, why it works, when it fails

### Takeaway
A bento grid is a modular, asymmetric card layout with mixed tile sizes. Apple's product marketing popularized it in 2022-2023, and SaaS marketing sites adopted it widely. It works by putting a few big tiles first and letting the reader scan the rest in any order. It fails for uniform, data-dense scanning (feeds, dashboards with many similar items), on mobile when it collapses to a single column, and for accessibility when the visual order and DOM order diverge.

### Cited Findings
- Definition: modular, asymmetric boxes named after Japanese lunchboxes. The trend "exploded in 2022-2023 after Apple used it prominently for the iPhone 14 and MacBook feature breakdowns" (commentary, agency blog) — [SaaSFrame](https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide); [freeCodeCamp](https://www.freecodecamp.org/news/bento-grids-in-web-design/)
- Why it works (commentary): each card can be scanned on its own, and asymmetric sizing creates hierarchy without sequential reading. Attention goes to the largest tile first, then to neighbors ("cognitive chunking") — [SaaSFrame](https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide); [Peerlist](https://peerlist.io/kashpatel/articles/why-are-bento-grids-a-new-trend-in-uidesign)
- Claim that "67% of the top 100 SaaS products on ProductHunt" use bento layouts and that they "convert better". This is an unsourced marketing statistic and should be treated as unverified — [SaaSFrame](https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide)
- When it fails: bento suits feature showcases and marketing pages, but "they do not work for data-dense product dashboards, as the asymmetric card pattern conflicts with the uniform data scanning behaviour users need" (commentary) — [rajeshrnair.com](https://rajeshrnair.com/blog/design/ui-ux/ui-design-trends-2026-bento-grids-glassmorphism.html)
- Accessibility: the visual reading order can differ from DOM order, which risks failing WCAG 2.1 SC 1.3.2 (Meaningful Sequence) — [Inkbot Design](https://inkbotdesign.com/bento-grid-design/); [lueurexterne](https://blog.lueurexterne.com/en/blog/bento-grid-in-web-design-creating-modern-modular-layouts/)
- Mobile: bento is "not inherently responsive". On a single column it loses the bento effect unless card heights vary — [Inkbot Design](https://inkbotdesign.com/bento-grid-design/); [SaaSFrame](https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide)
- Overuse makes layouts look generic, and dense grids invite choice paralysis — [freeCodeCamp](https://www.freecodecamp.org/news/bento-grids-in-web-design/); [outcomelabs](https://outcomelabs.com/do-you-like-bento-grids/)

### Inferences
- For a multi-source "room", bento fits the top layer: a few portals at mixed sizes, with one hero portal. Inside a portal the list of items should stay uniform (list or column), because that is where the "uniform scanning" failure applies.
- Bento's real logic is "size encodes importance". If the user's agent ranks portals or items, tile size could be driven by rank, which makes the grid itself an explanation of priority. This also resembles a newspaper front page, where story size and placement signal editorial weight, so it fits the print art direction better than glossy Apple-style rounded tiles do.
- Keep DOM order equal to rank order, so screen readers and keyboard users get the same hierarchy.

### Gaps
- No rigorous usability research (for example NN/g) on bento grids turned up. All "why it works" claims are practitioner commentary.
- I did not verify the status of bento.me. From memory, Linktree acquired it in 2023 and later announced a shutdown; this is unconfirmed.
- I did not find primary write-ups on Linear or Vercel marketing bento usage.

## Products: layouts, hierarchy, and "why you're seeing this"

### Takeaway
The products that feel current in 2024-2026 organize around stories or syntheses rather than raw links: Particle, Arc Search "Browse for me", Perplexity Discover, Google Discover AI summaries, and Kagi News. They let users steer the algorithm in plain language (Threads "Dear Algo") or choose among many algorithms (Bluesky custom feeds). They also label provenance explicitly through stacked source logos, cited sources, and "shown because of" labels. Artifact's 2024 shutdown shows that AI summarization alone was not a durable moat, and that feature sprawl hurt it.

### Cited Findings
**Arc / Arc Search / Dia (The Browser Company)**
- Arc Search launched on iOS on Jan 28, 2024. "Browse for me" reads at least six pages and builds a new custom web page with sections, summaries and source links. Navigation is swipe-based — [TechCrunch](https://techcrunch.com/2024/01/28/arcs-new-iphone-browser-wants-to-be-your-search-companion); [Arc blog](https://arc.net/blog/arc-search); [Freethink](https://www.freethink.com/consumer-tech/arc-search-app)
- Later 2024 updates added a list format for list-shaped queries such as "pizza in Washington DC" — [Arc Search release notes](https://resources.arc.net/hc/en-us/articles/23528454620311-Arc-Search-for-iOS-Release-Notes); [Freethink](https://www.freethink.com/consumer-tech/arc-search-app)
- The "pinch-to-summarize" feature was called "clever, but often misses the mark" (reviewer commentary) — [TechCrunch](https://techcrunch.com/2024/02/23/arc-browsers-new-ai-powered-pinch-to-summarize-feature-is-clever-but-often-miss-the-mark/)
- Dia was announced in December 2024 as Arc's AI-first successor. Arc moved to maintenance mode in 2025, and Atlassian agreed to acquire The Browser Company for about $610M (announced Sept 4, 2025), positioning Dia as "the AI browser for work" — [CNBC](https://www.cnbc.com/2025/09/04/atlassian-the-browser-company-deal.html); [TechCrunch](https://techcrunch.com/2025/09/04/atlassian-to-buy-arc-developer-the-browser-company-for-610m/); [Atlassian](https://www.atlassian.com/blog/announcements/atlassian-acquires-the-browser-company); [Wikipedia: Dia](https://en.wikipedia.org/wiki/Dia_(web_browser))
- The "May 2025 maintenance mode" date and the "March 2026 Slack/Notion integrations" come from secondary aggregator snippets and are not verified against primary sources — [superchargebrowser](https://www.superchargebrowser.com/library/arc-browser-status-2026/)

**Perplexity Discover**
- In Sept 2024 Perplexity relaunched Discover as personalized by interests and language ("Your interests. Your language. Your feed, personalized."). It has topic tabs (Top, Tech & Science, Finance, Arts & Culture, Sports, Entertainment), and some entries offer text-to-speech playback — [Perplexity on X](https://x.com/perplexity_ai/status/1834672028982690298); [AlternativeTo](https://alternativeto.net/news/2024/9/perplexity-ai-launches-personalized-discover-feed); [TestingCatalog](https://www.testingcatalog.com/perplexity-plans-web-release-of-updated-discover-feed-with-more-topics/)

**Bluesky custom feeds**
- Feed generators are third-party services on the AT Protocol. They return only a list of post IDs, and the client "hydrates" them, so the feed algorithm is decoupled from rendering and data — [Bluesky docs](https://docs.bsky.app/docs/starter-templates/custom-feeds); [Bluesky blog](https://bsky.social/about/blog/7-27-2023-custom-feeds)
- Bluesky framed this as "algorithmic choice" versus a "black box". By Oct 2024 it reported 70k+ feeds, with examples such as mutuals-only, official-news-orgs, and an event feed for Hurricane Milton — [Bluesky on Threads](https://www.threads.com/@bluesky_social/post/DA_aVAcvr9T); [Engadget](https://www.engadget.com/bluesky-now-lets-you-choose-your-own-algorithm-183824105.html)

**Threads**
- Feb 2025: custom feeds became shareable — [AlternativeTo](https://alternativeto.net/news/2025/2/threads-launches-new-feature-for-sharing-your-custom-feeds-with-anyone)
- "Dear Algo" was tested in Dec 2025 and launched Feb 2026 (US, UK, AU, NZ). Users post a natural-language request about what they want to see more or less of, and it adjusts the feed for three days. Others can repost a request to adopt it, and posts shown because of a request carry a label explaining why — [TechCrunch](https://techcrunch.com/2026/02/11/threads-new-dear-algo-ai-feature-lets-you-personalize-your-feed/); [Dataconomy](https://dataconomy.com/2025/12/05/threads-tests-dear-algo-feature-to-let-users-tune-their-feeds/)
- Instagram launched a comparable "Your Algorithm" control in Dec 2025 (secondary report) — [TechCrunch](https://techcrunch.com/2026/02/11/threads-new-dear-algo-ai-feature-lets-you-personalize-your-feed/)

**Artifact (Feb 2023 to Jan 2024)**
- Kevin Systrom announced the shutdown on Jan 12, 2024, saying "the market opportunity isn't big enough to warrant continued investment" — [Mediagazer](https://mediagazer.com/240112/p14); [Wikipedia](https://en.wikipedia.org/wiki/Artifact_(app))
- TechCrunch analysis, citing app-intelligence data: about 444k lifetime downloads (about 100k at debut), falling to about 12k a month by Oct 2023, with 44% from the US. SmartNews had about 2M downloads over the same period. Repeated pivots (link posts, text posts, places, AI images) muddied the product. AI chatbots that summarize news reduced the need to click. The company was self-funded in the "single-digit millions" (analysis and commentary layered on third-party data) — [TechCrunch](https://techcrunch.com/2024/01/18/why-artifact-from-instagrams-founders-failed-shut-down/)

**Particle**
- Launched Nov 2024 by ex-Twitter staff Sara Beykpour and Marcel Molina. It is organized around stories rather than articles. AI summaries offer adjustable styles, contrasting viewpoints with political-leaning context, and Q&A. It shows prominent source links and has publisher partnerships (Reuters, The Atlantic, Fortune, TIME, and others), with $15.3M raised — [Twipe](https://www.twipemobile.com/particle-a-user-focused-ai-news-experience/); [ETCentric](https://www.etcentric.org/particle-launches-ai-news-app-that-summarizes-in-quick-hits/); [Tomorrow's Publisher](https://tomorrowspublisher.today/content-creation/particle-launches-ai-news-reader-web-version/)

**Google Discover**
- In July 2025, Discover (Google app, iOS and Android, US) added AI summaries. Stacked publisher logos sit at the top-left with an AI summary citing them, and the summary expands to show the linked articles — [TechCrunch](https://techcrunch.com/2025/07/15/google-discover-adds-ai-summaries-threatening-publishers-with-further-traffic-declines); [Search Engine Land](https://searchengineland.com/google-discover-ai-summaries-search-whats-new-sports-feed-463318)
- In Dec 2025 Google began piloting AI article overviews with partner publishers (Guardian, Washington Post, El País, Der Spiegel, and others) — [PPC Land](https://ppc.land/google-tests-ai-article-summaries-for-select-publishers-amid-traffic-concerns/)
- Publisher-impact figures ("up to 60% traffic loss", "77% of summaries default to YouTube") come from industry blogs and are unverified — [DesignRush](https://news.designrush.com/google-ai-summaries-discover-traffic-drop); [PPC Land](https://ppc.land/google-discover-feeds-users-ai-and-youtube-while-publishers-watch-traffic-vanish/)

**Readwise Reader**
- The Feed has a TikTok-style vertical swipe triage UI: swipe up to advance (which marks the item seen), save for later, or tap to read. Readwise says this allows triaging 100-200 items a day. The "Daily Digest" serves "an appetizer of new items followed by a main course of previously saved items". Ghostreader is an LLM reading copilot that is aware of reading position — [Readwise blog](https://blog.readwise.io/the-next-chapter-of-reader-public-beta/)

**Are.na / Cosmos / mymind (curation spaces)**
- These are positioned as calm alternatives to Pinterest: no ads, no likes, no algorithm, and human curation (Are.na). Cosmos uses "Clusters" and filters AI-generated imagery. mymind is a private visual space with search over your own saves (secondary, listicle-quality sources) — [Creative Bloq](https://www.creativebloq.com/creative-inspiration/the-best-pinterest-alternatives-in-2026); [Creative Bloq on Cosmos](https://www.creativebloq.com/design/social-media/how-to-use-cosmos-a-beginners-guide-to-the-social-media-platform-made-for-creatives); [talkbitz](https://talkbitz.com/pinterest-alternatives/)

### Inferences
- The dominant 2024-2026 pattern is "synthesis card plus visible sources": stacked logos (Google Discover), cited sources (Kagi, Arc), and multi-perspective clusters (Particle). For a room where the user's own agent ranks items, a "why this" line plus the source marks is the native equivalent.
- Threads "Dear Algo" (natural-language steering with expiry and a "shown because" label) maps directly onto an agent-in-chat model. The user tells their agent in chat what to boost, and the room labels the items that the instruction affected. MCPortal arguably gets this for free because the chat is the control surface.
- Bluesky's ID-list feed generator shows that ranking can be decoupled from rendering. The agent returns ordered IDs and reasons, and the server or widget renders them. This suggests an architecture in which the agent emits ranking metadata rather than HTML.
- Artifact lesson: AI summaries and headline rewriting were not enough, and sprawl into social features hurt. This supports keeping "light social" secondary.
- Arc's "pinch-to-summarize misses the mark" critique suggests AI summaries need provenance and an easy route to the original.

### Gaps
- Not researched due to the tool-call budget: Apple News+ (layout and hierarchy changes 2024-2026), Substack app, Matter, Kagi Small Web, Fabric, and Dia's current UI patterns. No findings to report for these.
- No primary source covers how Perplexity Discover cards are laid out visually (hero card plus grid is my recollection, unverified).
- Particle's specific UI terms, such as any "Opposite Sides" feature name, could not be confirmed.

## AI-curated feeds: explanations, control, trust; editions vs infinite feeds; calm tech

### Takeaway
"Edition" formats with a defined end are re-emerging, led by Kagi News (published once a day, "five minutes", "No endless scrolling") and Readwise's Daily Digest. User control is moving from opaque engagement ranking toward explicit choice (Bluesky), natural-language steering with labels (Threads), and stated topic and language preferences (Perplexity). Trust signals come from citations, community-curated source lists, and privacy stances.

### Cited Findings
- Kagi News launched in Sept 2025 (web, iOS, Android; free, no account). It publishes once daily around noon UTC to create "a natural endpoint to news consumption", turning news "from an endless habit into a contained ritual", with "everything important in just five minutes. No endless scrolling." — [Kagi blog](https://blog.kagi.com/kagi-news)
- Kagi News chooses diversity over personalization: it aims to "expose readers to the full spectrum of global perspectives". Its source list is "open source and community-curated" on GitHub. Users can reorder categories and set story counts. It does not track or profile readers — [Kagi blog](https://blog.kagi.com/kagi-news); [Nieman Lab](https://www.niemanlab.org/2025/10/kagi-news-is-an-ai-powered-app-for-keeping-up-with-the-world/); [MacSparky](https://www.macsparky.com/blog/2025/10/kagi-news-a-news-site-that-respects-your-time/)
- Readwise Daily Digest is an edition: new items plus resurfaced saved items each morning — [Readwise blog](https://blog.readwise.io/the-next-chapter-of-reader-public-beta/)
- Threads "Dear Algo" adds "why you're seeing this" labels on posts shown because of a request, and the effect expires after 3 days. Commentators asked whether it combats or encourages doomscrolling (commentary) — [TechCrunch](https://techcrunch.com/2026/02/11/threads-new-dear-algo-ai-feature-lets-you-personalize-your-feed/); [AI Magazine](https://aimagazine.com/news/meta-introduces-ai-powered-dear-algo)
- Bluesky contrasts "algorithmic choice" with a "black box algorithm that leaves users guessing" (company framing) — [Bluesky blog](https://bsky.social/about/blog/7-27-2023-custom-feeds)
- Are.na is framed as the "slow-web" answer to Pinterest, with no algorithm, ads or likes (commentary) — [talkbitz](https://talkbitz.com/pinterest-alternatives/)

### Inferences
- An "edition" (today's room, a front page with an end state such as "you're caught up") is well supported by 2025-26 precedent. It also pairs naturally with the existing what's-new and seen-sets feature in this repo.
- Trust patterns worth copying: cite sources on every synthesized line, make the source list user-visible and editable (like Kagi's public source list), label agent-driven placement, and let instructions expire or be visible and undoable (Dear Algo's 3-day window).
- Tension to design for: Kagi deliberately avoids personalization to avoid filter bubbles, while an agent-ranked room is maximally personal. A "from outside your usual" slot or a perspectives cluster could offset this.

### Gaps
- No academic or UX research was gathered on the effectiveness of AI feed explanations (for example, studies of "why am I seeing this" UIs).
- I did not search for specific calm-technology or anti-infinite-scroll movement sources from 2024-26 (for example the Center for Humane Technology or slow-web essays). The claims above rest on product framing only.

## Editorial/print-inspired digital design that feels modern

### Takeaway
Typography-led editorial layouts (oversized headlines, serif revival, disciplined grids, monochrome palettes) and a brutalist revival are recognized 2025-26 trends. The sources found are mostly trend blogs, though, so this section is thin.

### Cited Findings
- In 2025 typography "no longer accompanies design but guides and structures it". Serif fonts are back in digital headlines (trend commentary) — [Elias Studio](https://www.elias.studio/en/blog/post/les-meilleures-tendances-de-webdesign-en-2025); [Todaymade](https://www.todaymade.com/blog/typography-trends)
- Bloomberg-style type-driven heroes: massive headlines set tight against the viewport edge, with "everything else gets out of the way" (commentary) — [brainy.ink](https://brainy.ink/paper/brutalist-web-design-2026)
- Editorial grid web design uses monochrome palettes, controlled typography, and modular systems that keep long articles coherent. Serif headlines with disciplined spacing evoke museum and cultural-magazine publications — [Tubik](https://tubikstudio.com/blog/media-editorial-website-design/)
- Brutalist revival: broken grids, asymmetric compositions and extreme fonts, while keeping readability — [Elias Studio](https://www.elias.studio/en/blog/post/les-meilleures-tendances-de-webdesign-en-2025); [brainy.ink](https://brainy.ink/paper/brutalist-web-design-2026)

### Inferences
- What reads as modern rather than retro: a strict column grid with hairline rules, hierarchy carried by type scale (one huge headline, then small caps or kickers), restrained color, and plenty of whitespace. Print texture (halftone, paper grain) should be used sparingly. The newspaper front page is a form of bento where size and position equal editorial weight, which lets the room's agent-ranked hierarchy read as "edition" rather than "dashboard".
- Folio-style metadata (edition date, "No. 42", section kickers, datelines) fits the "Your liminal webspace" pulp voice and naturally signals an edition with an end.

### Gaps
- No authoritative design-publication sources were found (It's Nice That, Sidebar, Smashing, CSS-Tricks) on newspaper-grid web design 2024-26, and no named case studies (for example The Browser Company's blog, The Verge's 2022 redesign, or NYT/Guardian front-page systems). These would need follow-up research.

## Motion: View Transitions API for spatial zoom/hierarchy navigation

### Takeaway
Same-document view transitions have been Baseline (all major engines) since Firefox 144 on Oct 14, 2025. Cross-document (MPA) transitions work in Chromium 126+ and Safari 18.2+, with Firefox lagging. Shared elements matched by `view-transition-name` morph between states, which is the core primitive for "zoom from room to portal to item" spatial navigation.

### Cited Findings
- Same-document view transitions became Baseline Newly available with Firefox 144 (Oct 14, 2025). That release added `document.startViewTransition()`, `view-transition-name`, `view-transition-class`, and `view-transition-name: match-element`. Firefox's initial implementation lacks view transition types, so a helper is recommended for progressive enhancement — [web.dev](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available); [web.dev Oct 2025](https://web.dev/blog/web-platform-10-2025?hl=en)
- View Transitions was an Interop 2025 focus area — [WebKit Interop 2025 review](https://webkit.org/blog/17808/interop-2025-review/)
- Cross-document transitions are opt-in via `@view-transition { navigation: auto; }` on both pages. Support: Chrome/Edge 126+ and Safari 18.2+; Firefox partial or none — [caniuse](https://caniuse.com/cross-document-view-transitions); [Chrome for Developers](https://developer.chrome.com/docs/web-platform/view-transitions)
- Shared-element morphs require the same `view-transition-name` on the element in both states; otherwise the result is a cross-fade — [Chrome for Developers](https://developer.chrome.com/docs/web-platform/view-transitions)
- 2026 additions such as the `:active-view-transition` selector are discussed in practitioner write-ups — [brainstormsandraves](https://brainstormsandraves.com/css/view-transitions-2026/)

### Inferences
- In an MCP-app widget (an iframe inside Claude, ChatGPT or Codex), navigation is almost certainly same-document, which is now Baseline. Wrap state changes (room to portal zoom, portal to item reader) in `startViewTransition` and give the card, title and source mark a shared `view-transition-name`, so the clicked tile grows into the reader. Use `match-element` or `view-transition-class` for lists of many items.
- Feature-detect and fall back to an instant swap, and respect `prefers-reduced-motion`.

### Gaps
- I did not verify whether host chat apps' iframe sandboxes or CSP affect the View Transitions API. This needs empirical testing in each host.
- No design write-ups were found on using view transitions specifically for zoom or spatial navigation metaphors (as opposed to page transitions).
