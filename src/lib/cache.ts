/**
 * In-memory TTL cache with a total size budget. Each source declares a
 * freshness policy (seconds); entries are also evicted oldest-first once the
 * approximate byte budget or entry count is exceeded, so agent-chosen URLs
 * can't grow memory without bound.
 */
interface Entry {
  value: unknown;
  storedAt: number;
  expiresAt: number;
  bytes: number;
}

export interface Cached<T> {
  value: T;
  cached: boolean;
  fetchedAt: string;
}

export class TtlCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  private bytes = 0;
  maxEntries: number;
  maxBytes: number;
  now: () => number;

  constructor(options: { maxEntries?: number; maxBytes?: number; now?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? 500;
    this.maxBytes = options.maxBytes ?? 48 * 1024 * 1024;
    this.now = options.now ?? Date.now;
  }

  get size(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
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
      this.set(key, { value, storedAt, expiresAt: storedAt + ttlSeconds * 1000, bytes: 2 * JSON.stringify(value ?? null).length });
      return { value, cached: false, fetchedAt: new Date(storedAt).toISOString() };
    } finally {
      this.inflight.delete(key);
    }
  }

  private set(key: string, entry: Entry): void {
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(key);
    }
    if (entry.bytes > this.maxBytes) return; // never cache something bigger than the whole budget
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const [oldestKey, oldest] = this.entries.entries().next().value as [string, Entry];
      this.entries.delete(oldestKey);
      this.bytes -= oldest.bytes;
    }
  }
}
