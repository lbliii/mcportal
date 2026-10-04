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
