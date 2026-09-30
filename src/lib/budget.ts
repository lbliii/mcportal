/**
 * Per-user usage budget for the hosted server. Tools cost units roughly in
 * proportion to the outbound work they cause (find_source probes several URLs;
 * get_profile fetches nothing). Each user gets a per-minute burst allowance and a
 * daily allowance, and all users share a global daily cap so one busy day can't
 * run up the hosting bill. Fixed windows, in memory: one instance, resets on deploy.
 */

export interface BudgetLimits {
  perMinute: number;
  perDay: number;
  globalPerDay: number;
}

export const DEFAULT_LIMITS: BudgetLimits = { perMinute: 120, perDay: 3000, globalPerDay: 60_000 };

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Units for one call. Unknown tools cost 1. */
export function toolCost(name: string, args: Record<string, unknown>): number {
  switch (name) {
    case 'import_opml': return 20;
    case 'find_source': return 5;
    case 'open_workspace': return 3;
    case 'refresh_panel': case 'read_article': case 'read_source': case 'add_panel': return 2;
    case 'get_thumbnails': return 1 + Math.ceil((Array.isArray(args.urls) ? Math.min(args.urls.length, 24) : 0) / 8);
    default: return 1;
  }
}

interface Window { used: number; resetAt: number }

export type BudgetVerdict = { ok: true } | { ok: false; scope: 'minute' | 'day' | 'global'; retryAfterSeconds: number };

export class UsageBudget {
  private minute = new Map<string, Window>();
  private day = new Map<string, Window>();
  private global: Window = { used: 0, resetAt: 0 };
  limits: BudgetLimits;
  now: () => number;

  constructor(limits: Partial<BudgetLimits> = {}, now: () => number = Date.now) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = now;
  }

  private window(map: Map<string, Window>, key: string, span: number): Window {
    const now = this.now();
    let w = map.get(key);
    if (!w || w.resetAt <= now) {
      if (map.size > 50_000) map.clear();   // bounded; a clear only forgives usage
      w = { used: 0, resetAt: now + span };
      map.set(key, w);
    }
    return w;
  }

  /** Charge `cost` to `userId`, or refuse without charging anything. */
  take(userId: string, cost: number): BudgetVerdict {
    const now = this.now();
    if (this.global.resetAt <= now) this.global = { used: 0, resetAt: now + DAY };
    const m = this.window(this.minute, userId, MINUTE);
    const d = this.window(this.day, userId, DAY);
    const wait = (w: Window) => Math.max(1, Math.ceil((w.resetAt - now) / 1000));
    if (this.global.used + cost > this.limits.globalPerDay) return { ok: false, scope: 'global', retryAfterSeconds: wait(this.global) };
    if (d.used + cost > this.limits.perDay) return { ok: false, scope: 'day', retryAfterSeconds: wait(d) };
    if (m.used + cost > this.limits.perMinute) return { ok: false, scope: 'minute', retryAfterSeconds: wait(m) };
    m.used += cost;
    d.used += cost;
    this.global.used += cost;
    return { ok: true };
  }
}

export function budgetMessage(v: Exclude<BudgetVerdict, { ok: true }>): string {
  const when = v.retryAfterSeconds < 120 ? `${v.retryAfterSeconds} seconds` : `${Math.ceil(v.retryAfterSeconds / 3600)} hour(s)`;
  if (v.scope === 'minute') return `Slow down a little: MCPortal's per-minute limit was reached. Try again in ${when}.`;
  if (v.scope === 'day') return `Today's MCPortal usage limit was reached for this account. It resets in about ${when}.`;
  return `MCPortal is at its daily capacity for everyone. Try again in about ${when}.`;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv): Partial<BudgetLimits> {
  const n = (v: string | undefined) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  const out: Partial<BudgetLimits> = {};
  const perMinute = n(env.MCPORTAL_LIMIT_PER_MINUTE);
  const perDay = n(env.MCPORTAL_LIMIT_PER_DAY);
  const globalPerDay = n(env.MCPORTAL_LIMIT_GLOBAL_PER_DAY);
  if (perMinute) out.perMinute = perMinute;
  if (perDay) out.perDay = perDay;
  if (globalPerDay) out.globalPerDay = globalPerDay;
  return out;
}
