/** Tokenless, bounded Shopify catalogue reads. Store text is always untrusted. */
import { AppError, upstreamStatus } from '../lib/errors.ts';
import { assertPublicUrl } from '../lib/safe-fetch.ts';
import { clean } from '../lib/text.ts';
import type { Fetcher } from '../types.ts';

export const SHOPIFY_VERSION = '2026-10';
export const SHOP_LIMITS = { products: 100, pageSize: 10, pages: 10, variants: 10, bytes: 1_000_000 } as const;
export interface StoreScope { collection?: string; salesOnly?: boolean }
export interface ProductVariant { id: string; title: string; amount: string; currency: string; available: boolean; compareAt?: string }
export interface ProductObservation {
  id: string; title: string; url: string; createdAt: string;
  image?: string; observedAt?: string; variants: ProductVariant[]; variantsPartial: boolean;
}
export interface StoreCollection {
  origin: string; name: string; products: ProductObservation[];
  partial: boolean; pages: number; collectionTitle?: string; observedAt?: string;
}

export function storeOrigin(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048) throw new AppError('invalid_argument', 'Supply the store’s HTTPS address.');
  const u = assertPublicUrl(input);
  if (u.protocol !== 'https:' || u.port || u.search || u.hash) throw new AppError('invalid_argument', 'Supply an HTTPS store address without a port, query or fragment.');
  return u.origin;
}
export function storeScope(raw: unknown): StoreScope {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('invalid_argument', 'Store scope must be an object.');
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !['collection', 'salesOnly'].includes(k))) throw new AppError('invalid_argument', 'Store scope accepts collection and salesOnly.');
  if (r.collection !== undefined && (typeof r.collection !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(r.collection))) throw new AppError('invalid_argument', 'Collection must be the handle from the store’s /collections/handle address.');
  if (r.salesOnly !== undefined && typeof r.salesOnly !== 'boolean') throw new AppError('invalid_argument', 'salesOnly must be a boolean.');
  return { ...(r.collection ? { collection: r.collection as string } : {}), ...(r.salesOnly === true ? { salesOnly: true } : {}) };
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function amount(v: unknown): string | undefined {
  return typeof v === 'string' && /^\d{1,12}(?:\.\d{1,4})?$/.test(v) ? v : undefined;
}
const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;
const gid = (v: unknown, kind: string) => typeof v === 'string' && new RegExp(`^gid://shopify/${kind}/[0-9]{1,24}$`).test(v) ? v : undefined;

export function normalizeProduct(raw: unknown, origin: string): ProductObservation | undefined {
  const p = object(raw), id = gid(p.id, 'Product'), createdAt = timestamp(p.createdAt);
  const title = clean(p.title, 200);
  if (!id || !title || !createdAt || typeof p.handle !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,200}$/.test(p.handle)) return undefined;
  const v = object(p.variants);
  const nodes = Array.isArray(v.nodes) ? v.nodes.slice(0, SHOP_LIMITS.variants) : [];
  const variants: ProductVariant[] = [];
  const seen = new Set<string>();
  for (const rawVariant of nodes) {
    const item = object(rawVariant), price = object(item.price), compare = object(item.compareAtPrice);
    const variantId = gid(item.id, 'ProductVariant'), value = amount(price.amount);
    if (!variantId || seen.has(variantId) || !value || typeof price.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(price.currencyCode) || typeof item.availableForSale !== 'boolean') continue;
    seen.add(variantId);
    const compareAt = compare.currencyCode === price.currencyCode ? amount(compare.amount) : undefined;
    variants.push({ id: variantId, title: clean(item.title, 100) || 'Default', amount: value, currency: price.currencyCode, available: item.availableForSale, ...(compareAt ? { compareAt } : {}) });
  }
  if (!variants.length) return undefined;
  let image: string | undefined;
  try { const url = assertPublicUrl(String(object(p.featuredImage).url ?? '')); if (url.protocol === 'https:') image = url.href; } catch { /* no valid image */ }
  return { id, title, createdAt, url: `${origin}/products/${p.handle}`, ...(image ? { image } : {}), variants, variantsPartial: object(v.pageInfo).hasNextPage !== false || variants.length !== nodes.length || (Array.isArray(v.nodes) && v.nodes.length > SHOP_LIMITS.variants), ...(timestamp(p.observedAt) ? { observedAt: timestamp(p.observedAt)! } : {}) };
}

/** RFC-style matching for the small robots policy needed by the catalogue reader. */
export function robotsAllows(text: string, path: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; pattern: string }> }> = [];
  let group: typeof groups[number] | undefined;
  let hasRules = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line.split('#')[0] ?? '');
    if (!match) continue;
    const field = match[1]!.trim().toLowerCase(), value = match[2]!;
    if (field === 'user-agent') {
      if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && (field === 'allow' || field === 'disallow')) {
      hasRules = true; if (value) group.rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  const specific = groups.filter(g => g.agents.includes('mcportal'));
  const relevant = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  let best = -1, allowed = true;
  for (const rule of relevant.flatMap(g => g.rules)) {
    const regex = '^' + rule.pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$');
    if (!new RegExp(regex).test(path)) continue;
    const length = rule.pattern.replace(/[*$]/g, '').length;
    if (length > best || length === best && rule.allow) { best = length; allowed = rule.allow; }
  }
  return allowed;
}

export async function collectShopify(originInput: string, scopeInput: StoreScope, fetcher: Fetcher): Promise<StoreCollection> {
  const origin = storeOrigin(originInput), scope = storeScope(scopeInput);
  const endpointPath = `/api/${SHOPIFY_VERSION}/graphql.json`;
  const robots = await fetcher(`${origin}/robots.txt`, { maxBytes: 512_000, maxRedirects: 3, timeoutMs: 10_000 });
  if (robots.status !== 404 && robots.status !== 410) {
    if (robots.status !== 200 || robots.truncated) throw new AppError('unavailable', 'The store’s fetch policy could not be checked. Try again later.');
    if (!robotsAllows(robots.text, endpointPath)) throw new AppError('fetch_blocked', 'This store does not allow MCPortal to read its catalogue.');
  }
  const productFields = `nodes { id title handle createdAt featuredImage { url } variants(first: ${SHOP_LIMITS.variants}) { nodes { id title availableForSale price { amount currencyCode } compareAtPrice { amount currencyCode } } pageInfo { hasNextPage } } } pageInfo { hasNextPage endCursor }`;
  const connection = `products(first: ${SHOP_LIMITS.pageSize}, after: $after, sortKey: ${scope.collection ? 'CREATED' : 'CREATED_AT'}, reverse: true) { ${productFields} }`;
  const query = scope.collection
    ? `query Catalogue($after: String, $handle: String!) { shop { name } collection(handle: $handle) { title ${connection} } }`
    : `query Catalogue($after: String) { shop { name } ${connection} }`;
  const products = new Map<string, ProductObservation>();
  let after: string | null = null, pages = 0, partial = false, name = new URL(origin).hostname, collectionTitle: string | undefined;
  do {
    const res = await fetcher(origin + endpointPath, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables: { after, ...(scope.collection ? { handle: scope.collection } : {}) } }), maxBytes: SHOP_LIMITS.bytes, maxRedirects: 0, timeoutMs: 10_000 });
    if (res.status !== 200) { if ([401,403,404].includes(res.status)) throw new AppError('unavailable', 'This store does not expose a supported public Shopify catalogue.'); throw upstreamStatus('Shopify catalogue', res.status); }
    let raw: unknown;
    try { raw = JSON.parse(res.text); } catch { throw new AppError('upstream_error', 'The store returned an unreadable catalogue.'); }
    const envelope = object(raw);
    if (res.truncated || (envelope.errors !== undefined && (!Array.isArray(envelope.errors) || envelope.errors.length > 0))) throw new AppError('upstream_error', 'The store could not return its public catalogue.');
    const data = object(envelope.data);
    name = clean(object(data.shop).name, 100) || name;
    const parent = scope.collection ? object(data.collection) : data;
    if (scope.collection && data.collection === null) throw new AppError('not_found', 'That store collection was not found.');
    if (scope.collection) collectionTitle = clean(parent.title, 100) || scope.collection;
    const catalogue = object(parent.products);
    if (!Array.isArray(catalogue.nodes) || catalogue.nodes.length > SHOP_LIMITS.pageSize || typeof object(catalogue.pageInfo).hasNextPage !== 'boolean') throw new AppError('upstream_error', 'The store returned an unsupported catalogue.');
    for (const node of catalogue.nodes) { const product = normalizeProduct(node, origin); if (product) products.set(product.id, product); else partial = true; }
    pages++;
    const next = object(catalogue.pageInfo);
    if (!next.hasNextPage) break;
    if (pages >= SHOP_LIMITS.pages) { partial = true; break; }
    if (typeof next.endCursor !== 'string' || next.endCursor.length > 1024 || next.endCursor === after || !next.endCursor) throw new AppError('upstream_error', 'The store returned invalid catalogue pagination.');
    after = next.endCursor;
  } while (pages < SHOP_LIMITS.pages);
  return { origin, name, products: [...products.values()], partial, pages, ...(collectionTitle ? { collectionTitle } : {}) };
}
