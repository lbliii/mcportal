/** Small async helpers. */

/** Run `work` over `items` with at most `limit` in flight, keeping the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map((item, j) => work(item, i + j)))));
  }
  return out;
}
