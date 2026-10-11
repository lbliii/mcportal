/**
 * Tool-call counters for this process, for the admin page: calls, outcomes, error
 * codes and timings per tool since the server started. In memory and per instance;
 * the logs (one tool.call event per call) are the durable record.
 */
import type { Logger, Traffic } from './log.ts';

export const ACTIVITY_INTERVAL_MS = 5 * 60_000;

export interface ToolStats {
  calls: number;
  /** By outcome: ok, error, invalid, denied, limited, crashed. */
  outcomes: Record<string, number>;
  /** Failed calls by error code. */
  codes: Record<string, number>;
  totalMs: number;
  maxMs: number;
}

export class ToolMetrics {
  private tools = new Map<string, ToolStats>();
  private activity = new Map<string, { tool: string; traffic: Traffic; calls: number; errors: number; totalMs: number; maxMs: number }>();
  private connections = new Map<string, { host: string; traffic: Traffic; count: number }>();
  private now: () => number;
  private windowStart: number;
  readonly since: number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.since = now();
    this.windowStart = this.since;
  }

  record(tool: string, outcome: string, ms: number, code?: string, traffic: Traffic = 'local'): void {
    let s = this.tools.get(tool);
    if (!s) {
      s = { calls: 0, outcomes: {}, codes: {}, totalMs: 0, maxMs: 0 };
      this.tools.set(tool, s);
    }
    s.calls++;
    s.outcomes[outcome] = (s.outcomes[outcome] ?? 0) + 1;
    if (code) s.codes[code] = (s.codes[code] ?? 0) + 1;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    const key = `${tool}:${traffic}`;
    const activity = this.activity.get(key) ?? { tool, traffic, calls: 0, errors: 0, totalMs: 0, maxMs: 0 };
    activity.calls++;
    if (outcome !== 'ok') activity.errors++;
    activity.totalMs += ms;
    activity.maxMs = Math.max(activity.maxMs, ms);
    this.activity.set(key, activity);
  }

  recordConnection(host: string, traffic: Traffic): void {
    const key = `${host}:${traffic}`;
    const connection = this.connections.get(key) ?? { host, traffic, count: 0 };
    connection.count++;
    this.connections.set(key, connection);
  }

  /** Interval deltas, never lifetime counters; quiet windows emit nothing. No account ids. */
  flushActivity(log: Logger): void {
    const now = this.now();
    const windowMs = Math.max(0, now - this.windowStart);
    for (const connection of this.connections.values()) log.info('protocol.connections', { ...connection, windowMs });
    for (const { totalMs, ...activity } of this.activity.values()) {
      log.info('activity.calls', { ...activity, windowMs, avgMs: Math.round(totalMs / activity.calls), errorRate: activity.errors / activity.calls });
    }
    this.connections.clear();
    this.activity.clear();
    this.windowStart = now;
  }

  /** Per tool, busiest first, with the average time in ms. */
  snapshot(): { since: string; tools: Array<ToolStats & { tool: string; avgMs: number }> } {
    const tools = [...this.tools].map(([tool, s]) => ({ tool, ...structuredClone(s), avgMs: Math.round(s.totalMs / s.calls) }));
    return { since: new Date(this.since).toISOString(), tools: tools.sort((a, b) => b.calls - a.calls) };
  }
}
