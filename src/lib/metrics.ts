/**
 * Tool-call counters for this process, for the admin page: calls, outcomes, error
 * codes and timings per tool since the server started. In memory and per instance;
 * the logs (one tool.call event per call) are the durable record.
 */
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
  readonly since: number;

  constructor(now: () => number = Date.now) {
    this.since = now();
  }

  record(tool: string, outcome: string, ms: number, code?: string): void {
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
  }

  /** Per tool, busiest first, with the average time in ms. */
  snapshot(): { since: string; tools: Array<ToolStats & { tool: string; avgMs: number }> } {
    const tools = [...this.tools].map(([tool, s]) => ({ tool, ...structuredClone(s), avgMs: Math.round(s.totalMs / s.calls) }));
    return { since: new Date(this.since).toISOString(), tools: tools.sort((a, b) => b.calls - a.calls) };
  }
}
