# Independent reader holdouts

All fixture prose, credits, metadata, and `.example` destinations are invented. The structures represent common newsroom, scientific article, and API documentation templates beyond the original 12-source audit. No publisher rules or host-specific assertions are required by these tests.

Source-shape references consulted October 3, 2026:

- [NASA Science rich article](https://science.nasa.gov/missions/webb/nasas-webb-hubble-combine-to-create-most-colorful-view-of-universe/): figures, caption/credit context, multiple story sections.
- [The Guardian article](https://www.theguardian.com/food/2026/oct/03/nitrite-free-bacon-sales-consumers-health-risks): article header, deck, embedded related components and ordinary prose links.
- [Ars Technica roundup](https://arstechnica.com/science/2026/10/research-roundup-6-cool-science-stories-we-almost-missed-6/): sectioned long-form content and publisher components.
- [MDN API reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map): code, tables, nested examples and related guidance in docs mode.

The fixtures combine these general structural patterns with adversarial preservation controls. They are not snapshots of publisher HTML, and do not claim those four pages use every tested attribute or unusual list number. Deterministic tests assert survival of distinct editorial markers, absence of explicit widget markers, and preservation of authored semantics; they do not compare brittle live paragraphs.

The live script records whole-response tag/container hints and extraction quality flags. A lower block/word count is not evidence of better extraction. `manualCompletenessVerified: false` is intentional until source-to-reader comparison is performed.
