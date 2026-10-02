# HCI Evidence on Grid Layouts, Zoomable Interfaces, and Scrolling Ergonomics (for an inline "room" dashboard in AI chat apps)

Context: a multi-feed reading dashboard ("room") rendered as an iframe inside AI chat apps (inline width ~380-760px, host chat scrolls vertically, optional fullscreen). Current design: horizontally scrolling lane of columns, each column scrolling vertically.

## Grid vs list, and masonry layouts: scanning, comprehension, selection

### Takeaway
Lists beat grids for text-heavy items and for comparison; image grids only pay off when items are visually distinguishable and thumbnails are large enough to matter. Masonry is good for casual visual browsing but bad for comparison, scanning order, and keyboard/screen-reader order. Bederson's ZUI work makes the same point: people scan 1D lists better than 2D layouts unless the 2D layout is a strict grid.

### Cited Findings
- NN/g (Harley) remote unmoderated test of mobile category navigation: text menus took less vertical space and showed more options at once. Image grids usually showed only **~4 items per screen**. One grid needed **4 screen-lengths** of scrolling where a competitor's text list needed 1. Scroll fatigue made users settle early: one West Elm user looked at only **2 of 42** categories before choosing. Images helped only when options were visually nuanced (e.g., duvet cover vs coverlet) and the images were big enough. Recommendation: text for broad, diverse choices and image grids for fine-grained visual differentiation. — [NN/g, Image grids vs text lists](https://www.nngroup.com/articles/image-vs-list-mobile-navigation/)
- NN/g eyetracking: "zigzag" alternating image-text layouts made users stumble while scanning. Pages where text and imagery were vertically aligned were scanned efficiently. — [NN/g, Zigzag layouts](https://www.nngroup.com/articles/zigzag-page-layout/)
- NN/g: a standard vertical list is more scannable than cards because element positions are fixed and predictable for the eye. — [NN/g, Cards component](https://www.nngroup.com/articles/cards-component/) (via search summary)
- Baymard: for spec-driven products, use "List View", which has room for more attributes. Grid view gives up space to thumbnails. In Baymard's B2B testing, the layout choice "significantly impacted" performance when it got in the way of comparing attributes. **23%** of benchmarked sites still use grid for spec-driven products. Baymard does recommend grids/quick views for visually driven products. — [Baymard, product tables](https://baymard.com/blog/use-product-tables-for-desktop-product-listings); [Baymard, product list research](https://baymard.com/research/ecommerce-product-lists); [Baymard, quick views for visual products](https://baymard.com/blog/mobile-desktop-quick-views)
- Bederson (ZUI guidelines, 2011): "people are not as good at scanning 2D designs as 1D layouts – unless the layout is highly structured." A 1D list only requires remembering the current item and the scan direction. "In 2D, however, for any layout except for a grid, there is the potential for a much heavier load on short-term memory." — [Bederson 2011, The promise of zoomable user interfaces](http://www.cs.umd.edu/~bederson/images/pubs_pdfs/2011_-_BIT_-_Promise_of_ZUIs.pdf)
- Masonry (CSS `display: grid-lanes`, shipped in Safari 26.4; behind flags elsewhere): items are placed to balance column heights, so visual order often differs from DOM order. Manuel Matuzović argues this will likely fail **WCAG 2.4.3 Focus Order**. Affected users: keyboard users, screen-magnifier users, and blind users working alongside sighted colleagues. `reading-flow` is behind flags in Chromium and does not yet apply to grid-lanes. His advice is to raise `flow-tolerance` or fall back to regular grids. — [Matuzović 2026, Grid Lanes accessibility](https://matuzo.at/blog/2026/grid-lanes-accessibility); [CSS-Tricks, Masonry is now grid-lanes](https://css-tricks.com/masonry-layout-is-now-grid-lanes/)
- `flow-tolerance` (default 1em) treats near-ties in column height as ties, so placement follows reading order more closely. With zero tolerance, an item can jump to a far lane just to sit 2px higher. — [Field Guide to Grid Lanes](https://master.dev/blog/the-field-guide-to-grid-lanes/) (secondary/blog source)
- Practitioner view (secondary, not empirical): masonry's ragged edge suits visual browsing such as Pinterest boards and portfolios, but it is "genuinely worse for comparison tasks". — [artofstyleframe blog](https://artofstyleframe.com/blog/card-based-ui-layouts-grids-masonry-feeds/)

### Inferences
- Most items in a reading room are text: headlines, sources, timestamps. The evidence favors list-like columns (1D) inside each portal over masonry or tile grids. Image-tile grids make sense only for visually driven portals (photo, video, art feeds).
- Masonry across portals would scramble reading order and focus order, and it gets worse as items load or update. If a mixed-height layout is needed, prefer fixed columns with DOM order = column order.
- At 380px inline width, a grid would show very few items per screen (compare NN/g's ~4 per screen), which raises scroll cost. A compact text list is the density-efficient choice.

### Gaps
- I found no rigorous peer-reviewed study that directly measures masonry vs uniform grid on scanning time or comprehension. The claims above are practitioner opinion plus general scanning research.
- Baymard's exact effect sizes for grid vs list are paywalled. Only qualitative statements and the 23% benchmark figure were accessible.

## Visual hierarchy in feeds: lead items, scanning patterns, newspaper/bento conventions

### Takeaway
Users scan a page by its headings, in a layer-cake pattern, when headings are distinct and descriptive. With no hierarchy they fall back on the less efficient F-pattern. Attention drops off sharply below the first screenful, so what sits at the top of the room (and of each portal) gets most of the attention.

### Cited Findings
- NN/g: the layer-cake pattern means fixations land mostly on headings and subheadings, with occasional dips into body text. It is "by far the most effective way to scan pages" (other than reading everything). Recommendations: make subheadings visually distinct but not ad-like, put important words first, chunk content with borders, backgrounds, or whitespace, and apply the pattern to cards and mixed-media pages. — [NN/g, Layer-cake pattern](https://www.nngroup.com/articles/layer-cake-pattern-scanning/)
- NN/g: the F-pattern shows up when there are no subheadings or bullets. Users fixate on the starts of lines and the top of the page. It is common when users have low commitment, and it is inefficient. — [NN/g, F-shaped pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/); [NN/g, Text scanning patterns](https://www.nngroup.com/articles/text-scanning-patterns-eyetracking/)
- NN/g: scanning patterns adapt to the task at hand. — [NN/g, Scanning patterns optimized for task](https://www.nngroup.com/articles/eyetracking-tasks-efficient-scanning/)
- NN/g 2018 eyetracking (120 participants, 1920×1080): **57%** of viewing time went to the first screenful, **17%** to the second, and **74%** to the first two screenfuls (up to 2160px). The rest was a long tail. In 2010 the first screenful got 80%. — [NN/g, Scrolling and attention](https://www.nngroup.com/articles/scrolling-and-attention/)
- OpenAI Apps SDK carousel guidance limits each item to about 2 lines of metadata ("three lines max"), with at most one optional CTA per card. — [OpenAI Apps SDK UI guidelines](https://developers.openai.com/apps-sdk/concepts/ui-guidelines)

### Inferences
- Each portal header works as a "layer" heading, and item headlines are the scan targets. Keep headlines first, bold, and front-loaded, and keep meta (source, time) secondary and short.
- A single "lead"/featured item per portal, or a room-level "highlights" strip at the top, fits the first-screen attention concentration. Inline at ~600px tall, the first screenful is all most users will look at closely.

### Gaps
- I found no peer-reviewed evidence on "bento" grids or newspaper front-page size variation in digital feeds. The convention rests on tradition and practitioner writing, not usability studies. The front-page and size-variation conventions were not researched in depth here.

## Spatial memory: stable positions vs reflowing layouts

### Takeaway
Spatial memory forms with stable positions plus repetition. It lasts (months) and is fuzzy (users remember a neighborhood, not an exact spot). Adaptive or reflowing layouts break it. Stable "zoomed-out" overviews where items keep fixed positions outperform pan/zoom alternatives for revisitation.

### Cited Findings
- Data Mountain (Robertson, Czerwinski et al., UIST 1998): users placed web-page thumbnails freely on an inclined 2.5D plane. The paper reports "statistically reliable advantages" over IE4 Favorites for storage and retrieval: faster retrieval (especially with thumbnail and "All" cues), fewer incorrect retrievals, and fewer failed trials. — [Robertson et al. 1998, Data Mountain (PDF)](https://www.microsoft.com/en-us/research/wp-content/uploads/1998/01/p153-robertson.pdf)
- Follow-up (Czerwinski, van Dantzich, Robertson, Hoffman 1999): users who had not seen their layouts for several months still retrieved pages without significantly slower times. — reported in [ResearchGate/Semantic Scholar summaries of Data Mountain work](https://www.researchgate.net/publication/2454995_Data_Mountain_Using_Spatial_Memory_for_Document_Management) and [Cockburn & McKenzie CHI 2002](https://faculty.washington.edu/aragon/classes/hcde511/s12/readings/cockburn-chi02.pdf)
- Cockburn & McKenzie (2002/2004): adding a 3D dimension does not help spatial memory. On-screen 2D and 3D were not significantly different, and with physical models, memory for 2D was reliably better than for 3D. — [Cockburn & McKenzie, Evaluating spatial memory in 2D and 3D](https://www.sciencedirect.com/science/article/abs/pii/S1071581904000096)
- Cockburn, Gutwin & Alexander (CHI 2006), space-filling thumbnails: only two views, fully zoomed in for reading and fully zoomed out with all pages tiled at **stable locations** in one window, with no panning. This let users "quickly form and exploit their spatial memory" and "significantly outperform[ed]" other panning, zooming, and overview+detail interfaces, particularly for revisiting pages. — [Cockburn, Karlson & Bederson 2008 survey, §4.4 and §7.1.1](https://faculty.cc.gatech.edu/~stasko/7450/Papers/cockburn-surveys08.pdf)
- Hornbæk et al. 2002 (in the same survey): spatial recall was *better* after using the interface *without* an overview. — [Cockburn et al. 2008](https://faculty.cc.gatech.edu/~stasko/7450/Papers/cockburn-surveys08.pdf)
- Scarr, Cockburn & Gutwin (Foundations and Trends in HCI, 2013): a monograph synthesizing psychology and HCI evidence that spatial memory lets users retrieve items "with little effort" and without visual search. It reviews interfaces that support it (space-multiplexed command and navigation displays such as CommandMaps) and ones that disrupt it (spatial distortion, some large-data techniques). — [Scarr et al. 2013](https://dl.acm.org/doi/abs/10.1561/1100000046). Related: CommandMaps flatten hierarchies into a stable spatial layout, and "spatially consistent interfaces" keep items in predictable places even when the window bounds change. — [ACM: Exploiting spatial memory for command interfaces](https://dl.acm.org/doi/10.1145/2468356.2468711)
- Findlater & McGrenere (CHI 2004, n=27): split menus whose top 4 items were static were **significantly faster** than adaptive menus (which reordered by frequency/recency). User-adaptable menus were not significantly different from static ones (under some orderings) and were the most preferred. — [Findlater & McGrenere 2004](https://dl.acm.org/doi/10.1145/985692.985704)
- NN/g, spatial memory guidance: spatial memory is "fuzzy" (neighborhood-level, not street-address-level) and needs both a stable UI and repeated practice. Avoid adaptive rearrangement. Scaling a layout, which preserves relative positions, is better than reflowing it. Supplement location with labels, thumbnails, color, and badges, and use broad, shallow hierarchies and overviews. — [NN/g, Spatial memory](https://www.nngroup.com/articles/spatial-memory/)
- Bederson ZUI guideline "Use consistent layout": "once an object is placed in space, it should not move." This conflicts with "meaningful layout" when the data changes. PhotoMesa is cited as meaningful but "no consistency at all". — [Bederson 2011](http://www.cs.umd.edu/~bederson/images/pubs_pdfs/2011_-_BIT_-_Promise_of_ZUIs.pdf)

### Inferences
- Portal positions inside a room should be user-arranged (adaptable) and should never reorder automatically by activity or unread count. Use badges or highlights to signal "new" rather than moving portals. This matches the Findlater result and NN/g guidance.
- When the container width changes (inline at 380px vs 760px vs fullscreen), keep portal order and relative arrangement constant, and prefer scaling or fewer visible columns over wholesale reflow into a different 2D arrangement. A row-major reflow (e.g., 3 columns → 2) moves portals to new rows and erodes location memory.
- The space-filling-thumbnails result supports a discrete two-level design. One level is a stable "room overview" where every portal sits in a fixed tile with no panning. The other is a "portal detail" view for reading. This likely beats a continuous pan/zoom canvas or a horizontally scrolling lane for revisitation.

### Gaps
- I found no published study specifically on Apple's stable home-screen grid as spatial-memory evidence. That claim is common in design writing but went unverified here.
- I did not retrieve the exact Data Mountain retrieval times (seconds) or the Cockburn 2006 effect sizes. Only directional "reliably/significantly faster" statements were confirmed.

## Zoomable user interfaces, semantic zoom, overview+detail, focus+context

### Takeaway
ZUIs (Pad, Pad++, Raskin's vision) succeeded only narrowly: maps, photos, document zoom. They fail as a general organizing principle because they load short-term memory, let users get lost ("desert fog"), and don't scale. They work best with a constrained, grid-like, breadth-over-depth layout, objects that are recognizable when small, short animated transitions, and simple navigation that can't get lost, such as click-to-zoom-in plus a zoom-out button. Discrete levels with stable positions outperform free continuous zoom for revisiting.

### Cited Findings
- Bederson (2011), reflecting on Pad (Perlin & Fox), Pad++ (Bederson, Hollan, Perlin et al. 1996), and Jazz/Piccolo. The broad vision of zooming as an organizing principle (e.g., Raskin's *Humane Interface*) "has not happened". Successes like Google Maps, Microsoft Word, and the iPhone are "substantial" but "much narrower than originally envisioned". — [Bederson 2011](http://www.cs.umd.edu/~bederson/images/pubs_pdfs/2011_-_BIT_-_Promise_of_ZUIs.pdf)
- Why ZUIs are hard (Bederson 2011, Table 2):
  - They place "a heavy load on short-term memory to remember where in space you just were and where things are".
  - Visual overviews of any complexity still require significant visual search.
  - Animation is double-edged: if the user misses it, they lose the link between views. ZUIs also "make some people feel physically sick".
  - They don't scale: they work with up to about **100 screens** of information and become problematic at **1000+**.
  - Arbitrary aspect ratios defeat structured 2D layouts.
  — [Bederson 2011](http://www.cs.umd.edu/~bederson/images/pubs_pdfs/2011_-_BIT_-_Promise_of_ZUIs.pdf)
- Bederson's ZUI design guidelines (§3.2):
  1. Support overview tasks; ZUIs are "typically not good at helping users simply get the best answer".
  2. Be cautious about zooming as the *primary* interface unless the data is fundamentally spatial. Build hybrids with search and facets.
  3. Use ZUIs only when the data has a small visual representation. "Photos are good, purely textual documents are bad."
  4. Handle dynamic data without blocking.
  5. Semantic zoom must keep the same aspect ratio or bounding box, or neighbors overlap when zoomed out.
  6. Use a meaningful layout.
  7. Use a consistent layout; objects shouldn't move.
  8. Use a scannable layout (a grid).
  9. Prefer breadth over depth: same-size objects, not many nested levels (SpaceTree is the example).
  10. Use small data sets, or partition them.
  11. Keep navigation simple and consistent, with no way to get lost in Desert Fog. He notes inconsistent zoom-in and zoom-out gestures across apps.
  Constrained navigation (click an object to zoom in, a button to zoom out) makes it "impossible to get lost, but also giving less control." — [Bederson 2011](http://www.cs.umd.edu/~bederson/images/pubs_pdfs/2011_-_BIT_-_Promise_of_ZUIs.pdf)
- Animation evidence (Klein & Bederson 2005, scrolling animation at 0, 100, 300, and 500ms): with 500ms animations, reading errors dropped **54%**. With 300ms animations, reading task time dropped **3%** and counting task time **24%**. The benefit held even after counting animation time. Formatted documents with visual landmarks performed better overall. Bederson & Boltman (1999) found animated zoom helps users form a spatial model. — [Bederson 2011](http://www.cs.umd.edu/~bederson/images/pubs_pdfs/2011_-_BIT_-_Promise_of_ZUIs.pdf); [Cockburn et al. 2008](https://faculty.cc.gatech.edu/~stasko/7450/Papers/cockburn-surveys08.pdf)
- Cockburn, Karlson & Bederson (ACM Computing Surveys 41(1), 2008), conclusions:
  - "None of these approaches is ideal."
  - Overview+detail is often preferred, and for document comprehension "no alternative has been found more effective". It costs screen space plus the effort of integrating two views, which can be offset by letting users toggle the overview.
  - Zooming "is easy to do badly". Abrupt discrete zoom levels force users to reorient; Cockburn & Savage 2003: "had to reorient themselves with each zoom action." Animation "can dramatically reduce the cognitive load" if its duration is tuned.
  - Concurrent, one-handed pan+zoom control beats serial control.
  - Distortion-based focus+context (fisheye) impairs relative spatial judgments and target acquisition. Fisheye menus are inferior to hierarchical menus (Hornbæk & Hertzum 2007).
  — [Cockburn, Karlson & Bederson 2008 (PDF)](https://faculty.cc.gatech.edu/~stasko/7450/Papers/cockburn-surveys08.pdf); [Microsoft Research listing](https://www.microsoft.com/en-us/research/publication/a-review-of-overviewdetail-zooming-and-focuscontext-interfaces/)
- Hornbæk et al. 2002 (map navigation): adding an overview to a *semantic*-zoom interface **increased** task completion time, because semantic zoom made the overview redundant. Without semantic zoom there was no difference. Users still *preferred* the overview because it helped orientation. Switching between overview and detail "required mental effort and time." — [Cockburn et al. 2008 §7.2.2](https://faculty.cc.gatech.edu/~stasko/7450/Papers/cockburn-surveys08.pdf); [Hornbæk, Bederson & Plaisant PDF](http://www.cs.umd.edu/~bederson/images/pubs_pdfs/p362-hornbaek.pdf)
- Hornbæk & Frøkjær 2003 (in the survey): fisheye text views let documents be read faster than overview+detail, but comprehension was better with overview+detail. Both beat flat text. — [Cockburn et al. 2008](https://faculty.cc.gatech.edu/~stasko/7450/Papers/cockburn-surveys08.pdf)
- Motion sensitivity: WCAG 2.3.3 Animation from Interactions (AAA) requires that interaction-triggered motion can be disabled unless it is essential. Zooming and parallax transitions are named examples. Typical implementation is `prefers-reduced-motion`. — [W3C-derived explainer, Stark](https://www.getstark.co/wcag-explained/operable/seizures-and-physical-reactions/animation-from-interactions/); [AAArdvark](https://aaardvarkaccessibility.com/wcag-plain-english/2-3-3-animation-from-interactions/). One secondary source claims vestibular disorders affect ~35% of adults over 40; that figure was not verified against a primary source. — [testparty.ai](https://testparty.ai/blog/wcag-animation-interactions-guide)

### Inferences
- The room's content (text headlines) is exactly what Bederson calls bad for ZUIs: "purely textual documents are bad". Continuous zoom to an unreadable "zoomed-out" room would need semantic zoom, meaning a portal shrinks to a name, an unread count, and maybe a favicon or cover image, all inside the same bounding box.
- The evidence favors a **discrete two-or-three-level semantic zoom**: room overview (fixed tiles with names, counts, and one lead headline), portal (list), and item (reader). Use short (~200-300ms) animated transitions with an obvious "back/zoom out" control. Free pan/zoom canvases bring desert-fog and gesture conflicts with the host page's scroll, especially inside an iframe.
- Honor `prefers-reduced-motion` for any zoom transition.

### Gaps
- I found no peer-reviewed evaluations of modern infinite canvases (Muse, tldraw, Figma, Apple Freeform) for reading or revisitation tasks. Evidence there is anecdotal and product marketing.
- No primary research on Prezi-induced motion sickness turned up. The critique is widespread in practitioner writing but unverified here. Bederson's "some people feel physically sick" is the best primary-author statement found.
- Raskin's *The Humane Interface* ZUI chapter was not retrieved directly; it is referenced only through Bederson 2011.

## Scrolling: nested scroll containers, horizontal scrolling, snapping, embedded widgets

### Takeaway
Horizontal scrolling on desktop has poor discoverability and high interaction cost; it is acceptable only for secondary content and with visible controls. Nested scroll regions inside a scrolling page create scroll traps and accessibility losses. The OpenAI Apps SDK explicitly forbids nested scrolling in inline cards. A horizontal lane of vertically scrolling columns inside a vertically scrolling chat is two levels of nesting in two axes, the worst case on all three counts.

### Cited Findings
- NN/g on horizontal scrolling: desktop users don't expect it, and "even strong cues such as arrows frequently remain unnoticed". Horizontal scrollbars cost a lot of interaction (precise mouse control in a narrow target). Hidden content has weak information scent. Acceptable uses are secondary content and stacked category shelves. Recommendations: always offer an alternative path, show progress (pagination or scrollbars), and keep arrows visible at all times, not just on hover, with keyboard support. — [NN/g, Horizontal scrolling](https://www.nngroup.com/articles/horizontal-scrolling/)
- Nested scroll accessibility: when main content scrolls inside a nested node, users lose keyboard navigation to start/end, page-by-page jumps, overscroll, and some native gestures. Recommendations: limit the size and number of scroll areas, delineate them clearly with a border or background, and for embedded maps-like widgets, only capture scroll after the user clicks into them. — [Buttondown/Access-Ability, Nested scroll bars](https://buttondown.com/access-ability/archive/nested-scroll-bars-are-the-one-of-the-biggest/); [CU Boulder a11y, Nested content scrolls](https://a11y.colorado.edu/node/284); [gotbahn, Nested scroll area impact](https://gotbahn.com/nested-scroll-area-impact-on-performance-and-accessibility)
- Scroll chaining: when an inner scroller hits its end, the wheel continues into the ancestor. `overscroll-behavior: contain` stops chaining but only applies to actual scroll containers. — [MDN overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior); [Ben Nadel](https://www.bennadel.com/blog/3698-using-css-overscroll-behavior-to-prevent-scrolling-of-parent-containers-from-within-overflow-containers.htm)
- OpenAI Apps SDK UI guidelines, inline display:
  - Inline cards: "No nested scrolling. Cards should auto fit their content and prevent internal scrolling." Also "No deep navigation or multiple views within a card", and at most two primary actions at the bottom.
  - Inline carousels: "Keep to 3–8 items per carousel."
  - Card height can expand to match content "up to the height of the mobile display area".
  - Fullscreen is for "rich tasks that cannot be reduced to a single card".
  - PiP stays fixed at the top on scroll.
  — [OpenAI Apps SDK UI guidelines](https://developers.openai.com/apps-sdk/concepts/ui-guidelines)
- MCP Apps spec (ext-apps, 2026-01-26), `HostContext.containerDimensions`. Each axis is fixed (`height`/`width`: host controls, view fills), flexible (`maxHeight`/`maxWidth`: view sizes to content up to the max), or unbounded (omitted). With flexible dimensions, hosts MUST listen for `ui/notifications/size-changed` and resize the iframe. The SDK sends these automatically via ResizeObserver (`autoResize` default, debounced). The spec example uses `{ "width": 400, "maxHeight": 600 }` inline. Display modes are `inline` | `fullscreen` | `pip`. Views MUST declare `appCapabilities.availableDisplayModes` and check host `availableDisplayModes` before calling `ui/request-display-mode`. Hosts announce mode changes via `ui/notifications/host-context-changed`. — [MCP ext-apps spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx); [sunpeak, MCP Apps layout](https://sunpeak.ai/docs/mcp-apps/layout)
- Per the spec's semantics (sunpeak summary), when content exceeds `maxHeight` the view should "scroll or paginate internally". — [sunpeak docs](https://sunpeak.ai/docs/mcp-apps/layout)

### Inferences
- The current inline design breaks the OpenAI "no nested scrolling" rule twice: a horizontal lane plus vertical column scrollers inside a vertically scrolling chat. It also hits NN/g's horizontal-scroll discoverability problem, especially for mouse-wheel desktop users who can't easily scroll sideways.
- Inline: render a non-scrolling, auto-height summary sized to content (fit within roughly 600px max height, or the host's `maxHeight`). For example, a room overview of portal tiles, each with its top 2-3 headlines and a count, with paging ("next 5") instead of internal scroll. Escalate to `fullscreen` (via `ui/request-display-mode`) for the multi-column, scroll-heavy reading experience. Inside fullscreen, one scroll axis per region, columns with `overscroll-behavior: contain`, and visible prev/next column controls are defensible.
- If any inline horizontal scrolling remains, it should follow carousel rules: 3-8 items, persistent visible arrows, a position indicator, keyboard support, and scroll-snap. It should also be secondary (not the only way to reach portals).
- Host `maxHeight` may be absent (unbounded) or differ by host. Design for "content sizes itself" and avoid assuming a fixed height.

### Gaps
- I found no controlled study with numbers on scroll-trap error rates or on mouse-wheel vs trackpad horizontal-scroll discoverability. NN/g's findings are qualitative.
- Claude-specific (claude.ai artifacts and MCP Apps host) published inline height limits and nested-scroll guidance were not found. Only the generic MCP Apps spec and OpenAI guidelines were confirmed. The OpenAI guidelines page was fetched without exact pixel limits; it states the height rule only relative to the "mobile display area".
- Scroll-snapping usability evidence (CSS `scroll-snap-type`) was not found in empirical form.

## Density and touch targets

### Takeaway
WCAG 2.2 AA sets a 24×24 CSS px floor (or 24px spacing). Platform guidance is larger: Apple 44pt, Material 48dp, WCAG AAA 44px. Compact density is appropriate for data-rich views as long as touch targets keep their minimum hit area.

### Cited Findings
- WCAG 2.2 SC 2.5.8 Target Size (Minimum, AA): targets at least **24×24 CSS px**. Exceptions: undersized targets with 24px spacing to adjacent targets, inline text links, user-agent-determined controls, and essential presentations. SC 2.5.5 (AAA) asks for **44×44**. Apple HIG says **44pt**; Material says **48dp**. — [wcag22aa.org, Target size](https://wcag22aa.org/new-criteria/target-size/); [Silktide 2.5.8](https://silktide.com/accessibility-guide/the-wcag-standard/2-5/input-modalities/2-5-8-target-size-minimum/)
- Material density scale: 0 is default, and each negative step (-1, -2, -3) reduces component height by **4dp**. Compact density suits data-rich apps (tables, long forms) because it shows more relational context. Apply density consistently across components, not in isolation. "No matter the density, all touch targets should be at least 48px." -4 breaks some components (chips). — [Material 2, Applying density](https://m2.material.io/design/layout/applying-density.html); [Material blog, density on the web](https://m3.material.io/blog/material-density-web)
- Cloudscape (AWS) also ships "comfortable" and "compact" content-density modes as a user preference. — [Cloudscape, Content density](https://cloudscape.design/foundation/visual-foundation/content-density/)

### Inferences
- At 380px inline on mobile, list rows can be visually compact (~32-36px text rows) if each row's tap area is ≥44px tall, or rows are full-width links with ≥24px spacing. Small icon actions (save, open) need ≥24px boxes and should preferably sit in a 44px hit area.
- A user-selectable compact/comfortable toggle has precedent (Material, Cloudscape) and suits a reading dashboard. Default to compact inline (where there is little space) and comfortable in fullscreen, or let the user choose.

### Gaps
- Apple HIG and Material primary pages were not fetched directly. The 44pt and 48dp figures come from secondary summaries consistent with long-standing published guidance.
- I found no evidence specific to target sizing inside chat-embedded iframes, such as how host zoom or scaling affects CSS px.
