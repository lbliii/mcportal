# Plan: shops, following the brands you like

**Status:** proposed 2026-10-06. Nothing built. Built on [the rally engine](rally.md), which supplies the watch list, `watch`/`unwatch`, collection, the diff and handing back. This plan covers only what's specific to shopping. Proposed as the engine's **first kind** because Shopify needs no key, no location and no provider agreement.

## Two intents, two kinds

"I follow this brand" means one of two things:

| Intent | Example | Kind | Portal |
|---|---|---|---|
| **Follow a store** | "Keep me posted on what Aesop releases" | `store` | **Shop:** new arrivals, sales and restocks as product cards |
| **Watch a product** | "Tell me if this jacket drops below $200 or comes back in medium" | `product` | **Watching:** only changes to things you named |

A store is close to a feed. A single product isn't a feed at all: nothing is new until it changes.

## The rally, for a store

1. **You:** "Add Aesop to MCPortal."
2. **Agent → MCPortal:** the agent finds the brand's official store URL (a web search if it needs one) and calls `watch` with `kind: 'store'`.
3. **MCPortal resolves:** it detects the platform and previews the store, writing nothing: "aesop.com, a Shopify store. 140 products; newest added 6 days ago." Plus the latest four, with pictures.
4. **The agent asks one question:** "Everything new, or just skincare, or only sales?" That becomes the watch's scope and keeps a 500-product catalogue out of your room.
5. **Confirm:** the watch is saved and a Shop portal appears, or an existing one gains this store. The first collection is a baseline: the latest few show as "latest", not 140 items as "new".
6. **MCPortal holds it:** it checks daily. Product cards show the picture, name, price and stock, with a **new**, **price drop** or **back** badge.
7. **The return:** when asked (or on a scheduled task), the agent hears "3 new in skincare, 1 price drop" and judges: "the cleanser you said you were running out of is 20% off."
8. **A better next rally:** what you save or dismiss tells the agent which categories matter.

## The rally, for a product

1. **You:** "Watch this jacket for me," with a link, or one the agent found.
2. **MCPortal resolves** the product and its variants: "Arc'teryx Beta Jacket, $450. Sizes S–XL; M is sold out."
3. **The agent asks what matters:** "Any price drop, or under a price? Just size M?" Your size can be saved as a private preference for next time.
4. **MCPortal watches** only that product. Nothing appears until something changes.
5. **The return:** "Back in M, and $315." The agent tells you; MCPortal never buys.

## Where product data comes from

Checked 2026-10-06. Revalidate before turning anything on.

| Platform | Access | Verdict |
|---|---|---|
| **Shopify** | No key. Every storefront serves `/products.json`, `/collections/<handle>/products.json` and `/products/<handle>.json`, and Atom feeds at `/collections/<handle>.atom` | **First provider.** Huge coverage of direct-to-consumer brands, structured JSON with variants, prices, compare-at prices and availability |
| **WooCommerce** | No key. The Store API at `/wp-json/wc/store/v1/products` is public and read-only by design | **Second provider** |
| **Etsy** | Free API key; active listings by shop (`/v3/application/shops/{id}/listings/active`) | Third provider, after reading Etsy's API terms |
| **Product data in pages** | schema.org `Product` and `Offer` blocks: price, currency, availability | **Product watches on almost any site,** via the shared structured-data reader in [rally.md](rally.md) |
| **Amazon, big retailers** (Nike, Target and the like) | Amazon's product API is tied to its affiliate program; big retailers block automated fetching | **Unsupported.** Say so plainly rather than half-work |

Shopify's storefront JSON is public and widely used, but it isn't a documented, versioned API. The adapter must be defensive, respect each store's robots.txt, and fall back to the Atom feed or page data when the JSON is turned off.

## Agent-facing surfaces: MCP, UCP and llms.txt

Checked 2026-10-06. Shops are ahead of every other kind here: stores now publish surfaces meant for agents.

| Surface | What it is | Use in MCPortal |
|---|---|---|
| **UCP manifest** (`/.well-known/ucp`) | The Universal Commerce Protocol, an open standard from Shopify and Google (January 2026), backed by Etsy, Target, Walmart, Salesforce Commerce and others. The manifest declares a store's capabilities and how to reach them (REST or MCP) | **The first rung of resolve.** One adapter for any UCP store, not only Shopify |
| **Shopify Storefront MCP** (`/api/mcp`) | Every Shopify store's own MCP server, no login. Tools include `search_catalog`, `lookup_catalog` and `get_product`, following UCP | Resolve and preview: find the products and collections a user means |
| **Shopify `llms.txt`, `llms-full.txt`, `agents.md`** | Served automatically by every Shopify store: name, policies, sitemap, discovery endpoints; the full version lists products with prices and options | Store name, policies and links for the preview; a fallback catalogue |
| **Shopify Catalog MCP** | A cross-store search over Shopify merchants | Could turn a brand name into the right store. Who may use it is unconfirmed; check before relying on it |
| **WooCommerce MCP** (10.9) | Store owners managing their own products and orders, behind their login | **Not for following a store.** Its public Store API is the right surface |
| **Etsy Dev MCP** | Explains Etsy's API; reads no shops | Not a data source |

**The user's agent is the shopper's agent.** These surfaces exist for exactly the agent the user is already talking to. So the rally splits cleanly:

- **The agent shops.** When its host gives it commerce tools (a store's MCP, Shopify's catalog, UCP), the agent finds the store and product, checks live stock and price, and hands MCPortal a confirmed identity: the store origin, the product and variant ids, the UCP manifest it used. That is the legitimate use those servers are built for: a person's agent, in that person's session.
- **MCPortal watches.** A store's MCP answers "what's true right now" but can't remember that you care, check for weeks, or notice a price drop. MCPortal does that with cheap, polite plain-HTTP reads (`/products.json`, the Store API), shared across users.
- **The agent confirms.** When MCPortal reports a finding, the agent can recheck it live through the store's own tools before telling you ("back in M at $315, confirmed just now"), and take you to the store. MCPortal's snapshot is a lead; the store's agent surface is the source of truth at the moment it matters.

**MCPortal never pretends to be a shopper's agent.** It doesn't call store MCP servers for collection: those tools are built for shoppers' sessions, sit behind bot protection, and their terms for a recurring service are unreviewed. It may read the public `/.well-known/ucp` manifest and `llms.txt` while resolving, when the user's agent has no commerce tools of its own. Any store text, through either path, is third-party and fenced like any page.

## Resolving a store: the ladder

**First choice: the agent already resolved it.** If the user's agent used its own commerce tools, `watch` accepts the identity it found (store origin, product and variant ids) and MCPortal only checks it can collect that store over plain HTTP.

Otherwise, like the [docs portal](docs-portal.md)'s source ladder, MCPortal tries the most standard, most structured source first and stops at the first that works:

1. **`/.well-known/ucp`:** the manifest says which platform and capabilities the store has.
2. **Shopify:** `/products.json` (detected from response headers and its shape).
3. **WooCommerce:** the Store API under `/wp-json/wc/store/v1/`.
4. **`llms.txt` / `llms-full.txt`:** name, policies and links; a catalogue when nothing above exists.
5. **Product data in pages.**
6. Otherwise, explain that the store can't be watched.

The rung that worked is saved with the watch, so collection doesn't repeat the ladder each time. A store that later stops serving it is re-resolved and the change shown in provenance.

## What counts as news (the kind rules)

| Change | Store watch | Product watch |
|---|---|---|
| New product (in scope) | Yes, grouped per collection | n/a |
| Price drop, or a sale starting (compare-at price appears) | Yes, if the scope includes sales | Yes, or only under your threshold |
| Price rise | No | No |
| Back in stock (in your size, if set) | Only for saved products | Yes |
| Sold out | No | Yes, quietly |
| Removed from the store | No | Yes, marked gone |

Variants collapse into one product: a shirt in eight colours is one card, with the changed variant named.

## The `offer` item variant

Price and currency, the previous price when on sale, availability, a variant summary ("S–XL; M sold out"), and the store's own product link. Product pictures go through the existing thumbnail path. Shop portals default to the `gallery` view.

## Flood control

Stores drop dozens of products at once. Following the engine's grouping rule:

- **One card per drop:** "12 new in the Fall collection", which opens to the products.
- **A per-store cap per collection;** the rest stays one click away.
- **Scope first:** the agent sets a collection, product type or "sales only" when you add a store, and you can change it later.

## Rules specific to shops

- **No buying, carts, checkout or saved payment methods.** Every card links to the store's own page.
- **No affiliate or tracking parameters,** ever. This keeps MCPortal on the reader's side.
- **Preferences are private:** sizes and price thresholds are set in conversation, stored with the account, never shared.
- **Polite fetching:** daily freshness by default, paging capped, one shared cache per store across all users, the identifiable user agent, robots.txt respected.

## Phases

| Phase | What ships | Size |
|---|---|---|
| 1 | Store watches on Shopify (the agent's commerce tools resolve when it has them, else the ladder; collect via `/products.json`), the Shop portal, `offer` items, baseline and grouping (with [rally.md](rally.md) phase 0) | small to medium |
| 2 | Product watches: Shopify products first, then any site through page data; price thresholds and sizes | small to medium |
| 3 | WooCommerce stores, and any store with a UCP catalog | small |
| 4 | Etsy shops, after its terms are reviewed | small |

## Open questions (with the default we'd take)

1. **A brand without its own store** (sold only through retailers). Default: unsupported in phase 1; the agent says so.
2. **Currency and region:** stores show different prices by country. Default: the store's default currency, labelled; region-specific storefronts later, tied to the coarse location.
3. **Sharing a product:** reblogging "look what's on sale". Default: works like any saved item; no price claims beyond what the card shows, with the time it was seen.
4. **How often to check:** Default: daily for stores, every few hours for product watches with a threshold. Revisit with real usage and budgets.
5. **Newsletters and launch announcements:** many brands announce drops by email first. Default: out of scope; a store's blog feed (Shopify serves one at `/blogs/<handle>.atom`) can be a normal RSS portal.
6. **Should MCPortal ever call store MCP or UCP catalogs itself?** Default: no. The user's agent does the shopping; MCPortal reads plain HTTP. Revisit only if a provider offers terms for a recurring service.
7. **Hosts without commerce tools:** Default: the agent finds the store URL by web search and MCPortal's ladder resolves it. The live recheck is skipped and the card says when MCPortal last saw the price.
