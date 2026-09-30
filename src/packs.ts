/**
 * Starter packs: a first room for a new user, picked by interest. Every source
 * here was resolved with find_source and checked live (loads, recent, pictures
 * where possible), from a laptop and from the Railway server; each pack leads
 * with a picture-rich source. Some sources treat cloud servers differently: no
 * Reddit (rate-limits servers, 429), no nasa.gov (429 from Railway), and
 * www.dezeen.com (the bare domain returns 403 to servers). The docs pack's sources were
 * resolved with scripts/docs-probe.ts, which reads each table of contents and two pages.
 */
import type { PortalSpec } from './profile.ts';

export interface StarterPack {
  id: string;
  label: string;
  blurb: string;
  portals: PortalSpec[];
}

const yt = (id: string, channel: string, title: string): PortalSpec => ({ id, source: 'rss', title, config: { url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`, limit: 10 } });
const feed = (id: string, url: string, title: string): PortalSpec => ({ id, source: 'rss', title, config: { url, limit: 10 } });
/** A docs portal with its table of contents already found, so it opens without probing the site. */
const docs = (id: string, url: string, kind: 'llms' | 'sphinx', toc: string, title: string): PortalSpec => ({ id, source: 'docs', title, config: { url, toc: { kind, url: toc }, limit: 30 } });

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'developer',
    label: 'Developer',
    blurb: 'What engineers are shipping and arguing about',
    portals: [
      yt('fireship', 'UCsBjURrPoezykLs9EqgamOA', 'Fireship'),
      { id: 'hn-top', source: 'hn', title: 'Hacker News', config: { feed: 'top', limit: 12 } },
      feed('github-blog', 'https://github.blog/feed/', 'The GitHub Blog'),
      feed('lobsters', 'https://lobste.rs/rss', 'Lobsters'),
    ],
  },
  {
    id: 'docs',
    label: 'Developer docs',
    blurb: 'The docs you use, without the clutter',
    portals: [
      docs('stripe-docs', 'https://docs.stripe.com', 'llms', 'https://docs.stripe.com/llms.txt', 'Stripe'),
      docs('railway-docs', 'https://docs.railway.com', 'llms', 'https://docs.railway.com/llms.txt', 'Railway'),
      docs('python-docs', 'https://docs.python.org/3', 'sphinx', 'https://docs.python.org/3/objects.inv', 'Python'),
      docs('nextjs-docs', 'https://nextjs.org/docs', 'llms', 'https://nextjs.org/docs/llms.txt', 'Next.js'),
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    blurb: 'Models, papers and people building with them',
    portals: [
      yt('two-minute-papers', 'UCbfYPyITQ-7l4upoX8nvctg', 'Two Minute Papers'),
      feed('simonw', 'https://simonwillison.net/atom/everything/', "Simon Willison's Weblog"),
      feed('latent-space', 'https://www.latent.space/feed', 'Latent Space'),
      feed('hugging-face', 'https://huggingface.co/blog/feed.xml', 'Hugging Face'),
    ],
  },
  {
    id: 'news',
    label: 'News',
    blurb: 'World headlines from a few steady sources',
    portals: [
      feed('bbc-world', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'BBC World'),
      feed('guardian-world', 'https://www.theguardian.com/world/rss', 'The Guardian'),
      feed('npr-news', 'https://feeds.npr.org/1001/rss.xml', 'NPR News'),
      feed('google-news', 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', 'Google News'),
    ],
  },
  {
    id: 'gaming',
    label: 'Video games',
    blurb: 'Releases, reviews and how games are made',
    portals: [
      yt('gmtk', 'UCqJ-Xo29CKyLTjn6z2XwYAw', "Game Maker's Toolkit"),
      feed('polygon', 'https://polygon.com/feed', 'Polygon'),
      feed('rps', 'https://www.rockpapershotgun.com/feed', 'Rock Paper Shotgun'),
      feed('kotaku', 'https://kotaku.com/feed', 'Kotaku'),
    ],
  },
  {
    id: 'art',
    label: 'Art & design',
    blurb: 'Visual art, illustration, architecture and design',
    portals: [
      feed('colossal', 'https://www.thisiscolossal.com/feed/', 'Colossal'),
      yt('proko', 'UClM2LuQ1q5WEc23462tQzBg', 'Proko'),
      feed('dezeen', 'https://www.dezeen.com/feed/', 'Dezeen'),
      feed('its-nice-that', 'http://feeds2.feedburner.com/itsnicethat/SlXC', "It's Nice That"),
    ],
  },
  {
    id: 'science',
    label: 'Science',
    blurb: 'Space, physics, biology, explained well',
    portals: [
      yt('kurzgesagt', 'UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt'),
      yt('veritasium', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium'),
      feed('quanta', 'https://www.quantamagazine.org/feed/', 'Quanta Magazine'),
      feed('science-news', 'https://www.sciencenews.org/feed', 'Science News'),
    ],
  },
  {
    id: 'music',
    label: 'Music',
    blurb: 'New releases, live sessions and music news',
    portals: [
      yt('npr-music', 'UC4eYXhJI4-7wSWc8UNRwD4A', 'NPR Music'),
      feed('bandcamp-daily', 'https://daily.bandcamp.com/feed', 'Bandcamp Daily'),
      feed('pitchfork', 'https://pitchfork.com/feed/feed-news/rss', 'Pitchfork'),
      feed('stereogum', 'https://stereogum.com/feed', 'Stereogum'),
    ],
  },
  {
    id: 'film',
    label: 'Film & TV',
    blurb: 'Trailers, reviews and film essays',
    portals: [
      yt('patrick-willems', 'UCF1fG3gT44nGTPU2sVLoFWg', 'Patrick (H) Willems'),
      feed('slashfilm', 'https://www.slashfilm.com/category/news/feed/', '/Film'),
      feed('collider', 'https://collider.com/feed', 'Collider'),
      feed('indiewire', 'https://www.indiewire.com/feed/rss/', 'IndieWire'),
    ],
  },
];

export const MAX_PACKS = 4;

/** For the welcome screen and the model: no configs, just what each pack is. */
export function packSummaries(): Array<{ id: string; label: string; blurb: string; sources: string[] }> {
  return STARTER_PACKS.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb, sources: p.portals.map((s) => s.title ?? s.id) }));
}
