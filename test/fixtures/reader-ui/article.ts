import type { Article } from '../../../src/types.ts';

/** Invented article exercising renderer contracts independently of HTML extraction. */
export const article: Article = {
  url: 'https://reader.example.com/field-notes', title: 'Field notes from the coast', byline: 'Sam Author',
  publishedAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z', wordCount: 1800,
  provenance: { source: 'reader', endpoint: 'https://reader.example.com/field-notes', fetchedAt: '2026-10-01T12:00:00Z', cached: false, ttlSeconds: 0 },
  blocks: [
    { type: 'h', text: 'Preparation', id: 'preparation', level: 2 },
    { type: 'p', text: 'A coastal view', figure: { url: 'https://images.example.com/coast.png', alt: 'Coastal cliffs', caption: 'The northern cliffs at dawn.', credit: 'Photo: Sam Author', width: 1200, height: 800 } },
    { type: 'p', text: 'Mixed marks and authored breaks', spans: [{ text: 'Emphasized linked code', code: true, strong: true, em: true, href: 'https://example.com/reference' }, { text: 'Second line', breakBefore: true }, { text: 'Unsafe link remains text', href: 'javascript:alert(1)' }] },
    { type: 'li', text: 'First numbered item', ordered: true, listId: 'outer', listStart: 4 },
    { type: 'li', text: 'Nested selected passage is easy to find.', level: 1, listId: 'inner' },
    { type: 'li', text: 'Nested second item', level: 1, listId: 'inner' },
    { type: 'li', text: 'Explicit ninth item', ordered: true, listId: 'outer', value: 9 },
    { type: 'li', text: 'A separate numbered group', ordered: true, listId: 'second', listStart: 2 },
    { type: 'quote', text: 'First paragraph in the same quotation.', quoteId: 'quote-a' },
    { type: 'quote', text: 'Second paragraph in the same quotation.', quoteId: 'quote-a' },
    { type: 'quote', text: 'A separate adjacent quotation.', quoteId: 'quote-b' },
    { type: 'p', text: 'Watch the coastal film', media: { kind: 'video', url: 'https://example.com/coastal-film', label: 'Watch the coastal film' } },
    { type: 'p', text: 'Spotify · Bandcamp', spans: [{ text: 'Spotify', href: 'https://open.spotify.com/album/example' }, { text: ' · ' }, { text: 'Bandcamp', href: 'https://artist.bandcamp.com/album/example' }] },
    ...Array.from({ length: 40 }, (_, i) => ({ type: 'p' as const, text: `Field note ${i + 1}. We followed the path along the coast and recorded the rocks, water, weather and birds. These observations preserve an ordinary paragraph rhythm and give the article enough length for navigation and reading progress.` })),
    { type: 'h', text: 'Observations', id: 'repeated', level: 2 },
    { type: 'p', text: 'An observation at the second heading.' },
    { type: 'h', text: 'Closing notes', id: 'repeated', level: 2 },
    { type: 'p', text: 'A final image', figure: { url: 'https://images.example.com/unavailable.png', caption: 'The final coastal photograph.' } },
    { type: 'p', text: 'Closing paragraph preserved in full.' },
  ],
};

/** List-item paragraphs and parent tails retain their containing item identity. */
export const continuationArticle: Article = { ...article, wordCount: 120, blocks: [
  { type: 'h', text: 'Continuation notes', id: 'continuations', level: 2 },
  { type: 'li', text: 'Parent lead.', ordered: true, listId: 'outer', listStart: 3, value: 3 },
  { type: 'p', text: 'Second paragraph in the parent item.', level: 0, ordered: true, listId: 'outer', listStart: 3, value: 3 },
  { type: 'li', text: 'Nested lead.', level: 1, listId: 'inner' },
  { type: 'p', text: 'Nested second paragraph selected for discussion.', level: 1, listId: 'inner' },
  { type: 'p', text: 'Parent tail after the nested list.', level: 0, ordered: true, listId: 'outer', listStart: 3, value: 3 },
  { type: 'li', text: 'Next numbered parent.', ordered: true, listId: 'outer', listStart: 3, value: 4 },
  { type: 'p', text: 'Paragraph in the next numbered parent.', level: 0, ordered: true, listId: 'outer', listStart: 3, value: 4 },
  { type: 'p', text: 'An ordinary paragraph outside the list.' },
  { type: 'li', text: 'A fresh numbered group.', ordered: true, listId: 'fresh', listStart: 2, value: 2 },
  { type: 'p', text: 'Unmatched continuation metadata remains visible as prose.', level: 0, listId: 'unmatched' },
] };

/** Explicit item identity separates media-first siblings, including repeated numbering. */
export const mediaListArticle: Article = { ...article, wordCount: 100, blocks: [
  { type: 'h', text: 'Media in lists', id: 'media-lists', level: 2 },
  { type: 'p', text: 'First item image', listId: 'ordered', listItemId: 'o1', level: 0, ordered: true, listStart: 3, value: 3, figure: { url: 'https://images.example.com/first.png', alt: 'First item image' } },
  { type: 'p', text: 'First item tail.', listId: 'ordered', listItemId: 'o1', level: 0, ordered: true, value: 3 },
  { type: 'p', text: 'Video in another item', listId: 'ordered', listItemId: 'o2', level: 0, ordered: true, listStart: 3, value: 3, media: { url: 'https://example.com/video', kind: 'video', label: 'Video in another item' } },
  { type: 'p', text: 'Second item tail.', listId: 'ordered', listItemId: 'o2', level: 0, ordered: true, value: 3 },
  { type: 'li', text: 'Third numbered item.', listId: 'ordered', listItemId: 'o3', ordered: true, listStart: 3, value: 4 },
  { type: 'p', text: 'Image following text', listId: 'ordered', listItemId: 'o3', level: 0, ordered: true, value: 4, figure: { url: 'https://images.example.com/third.png' } },
  { type: 'p', text: 'Ordinary prose between lists.' },
  { type: 'li', text: 'First unordered item.', listId: 'unordered', listItemId: 'u1' },
  { type: 'p', text: 'Second unordered item image', listId: 'unordered', listItemId: 'u2', level: 0, figure: { url: 'https://images.example.com/second.png' } },
  { type: 'p', text: 'Second unordered item tail.', listId: 'unordered', listItemId: 'u2', level: 0 },
  { type: 'p', text: 'A figure-only unordered item', listId: 'unordered', listItemId: 'u3', level: 0, figure: { url: 'https://images.example.com/only.png' } },
  { type: 'li', text: 'Fourth unordered item.', listId: 'unordered', listItemId: 'u4' },
  { type: 'p', text: 'Fourth item tail.', listId: 'unordered', listItemId: 'u4', level: 0 },
  { type: 'p', text: 'Ordinary prose after all lists.' },
] };
