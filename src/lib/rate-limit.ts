/** A small in-memory rate limiter (OAuth endpoints: registration, sign-in, tokens). */

/** Fixed-window counters per key, bounded in size. */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private limit: number;
  private windowMs: number;
  private now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  take(key: string): boolean {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size > 10_000) this.windows.clear();
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count <= this.limit;
  }
}
