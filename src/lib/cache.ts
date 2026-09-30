/**
 * Tiny in-memory TTL cache. Each source declares a freshness policy (seconds),
 * so a workspace can be reopened without hitting upstream APIs every time.
 */
interface Entry {
  value: unknown;
  storedAt: number;
  expiresAt: number;
}

export interface Cached<T> {
  value: T;
  cached: boolean;
  fetchedAt: string;
}

export class TtlCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  private maxEntries: number;
  now: () => number;

  constructor(maxEntries = 500, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  async get<T>(key: string, ttlSeconds: number, load: () => Promise<T>, force = false): Promise<Cached<T>> {
    const hit = this.entries.get(key);
    if (!force && hit && hit.expiresAt > this.now()) {
      return { value: hit.value as T, cached: true, fetchedAt: new Date(hit.storedAt).toISOString() };
    }
    let pending = this.inflight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load();
      this.inflight.set(key, pending);
    }
    try {
      const value = await pending;
      const storedAt = this.now();
      this.entries.set(key, { value, storedAt, expiresAt: storedAt + ttlSeconds * 1000 });
      this.evict();
      return { value, cached: false, fetchedAt: new Date(storedAt).toISOString() };
    } finally {
      this.inflight.delete(key);
    }
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
