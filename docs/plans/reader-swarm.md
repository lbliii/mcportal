# Reader improvement workstreams

Base: `origin/main` at `1d6142755b0284adc49f5d33b3c1837f8c5fdf5c`.
The local unpublished River changes are outside this work.

| Workstream | Branch | Owned implementation |
| --- | --- | --- |
| Shared contracts and integration | `codex/reader-contracts` | Optional block/span/article fields, entity decoding, reader cache version, audit and plan |
| Extraction and metadata | `codex/reader-extraction` | HTML extraction and helpers, editorial/docs distinction, metadata, figures/media, extraction fixtures |
| Reader UI and continuity | `codex/reader-ui` | Reader rendering/styles, passage selection, reading resume and handoff traversal, browser fixtures |
| Independent qualification | `codex/reader-qualification` | Unseen structural fixtures, repeatable live audit CLI, qualification report |

Workers inherit the shared contract commit but edit disjoint files. Integration collects their reviewed commits and targets `main`. Worker PRs identify their shared dependency; the combined PR is the intended review candidate. Publication and deployment remain separate from this implementation.

The contract remains additive: legacy block types and plain text survive. Optional marks combine, lists carry group/item identity and start/value, quotations carry group identity, and figure/media metadata uses paragraph blocks with readable fallback text. Item identity distinguishes multiple paragraphs or media in one item from a new sibling, even in unordered lists or repeated ordered values. Dates are optional validated ISO strings. Existing saved reading fields remain compatible; UI traversal follows logical blocks after semantic grouping.

## Completion gates

- Generic extraction passes independently authored content-preservation controls, including editorial uses of words such as “share” and “related.”
- Docs retain code, tables, admonitions, and links.
- Real browser checks cover grouped content, narrow/light/dark/fullscreen views, lazy guarded images, outline actions, selection and resume.
- Integrated `npm run check` and adapter smoke checks pass; environment skips are recorded separately.
- Repeat the original 20-article audit and test unseen publisher structures. Record blocked fetches and unresolved structural failures explicitly.
- Draft PRs target `main`; no merge, release, or deployment is implied.
