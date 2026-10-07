/**
 * Where shares, relations and reports are kept: the SocialStore interface and the
 * one-document store used by tests and local servers. Postgres has its own in
 * src/db/social.ts. Stores only store; the rules live in Social (social.ts), which
 * re-exports this module.
 */
import { DOCUMENT_MAX_AGE_MS, memoryPersistence, SharedDocument } from './lib/document.ts';
import type { AuthPersistence } from './auth/store.ts';
import { AppError } from './lib/errors.ts';
import type { PageQuery, Relation, Report, Share } from './social.ts';

/** Storage only; no rules. */
export interface SocialStore {
  addShare(share: Share): Promise<void>;
  getShare(id: string): Promise<Share | undefined>;
  deleteShare(accountId: string, id: string): Promise<boolean>;
  setHidden(id: string, hiddenAt: string | null): Promise<boolean>;
  /** Newest first. */
  sharesBy(accountIds: string[], query: PageQuery & { includeHidden?: boolean }): Promise<Share[]>;
  countShares(accountId: string): Promise<number>;
  /** Reblogs of one original, newest first, hidden ones left out (detached ones kept: Social decides). */
  reblogsOf(rootId: string, query: PageQuery): Promise<Share[]>;
  /** How many reblogs each original has, leaving out hidden and detached ones. Originals without any are absent. */
  countReblogs(rootIds: string[]): Promise<Map<string, number>>;
  /** The account's own reblog of each original it reblogged: original id -> reblog id. */
  reblogsBy(accountId: string, rootIds: string[]): Promise<Map<string, string>>;
  /** Set (or with null, clear) a post's reblog rule or detached time. False when there's no such post. */
  updateShare(id: string, change: { reblogs?: Share['reblogs'] | null; detachedAt?: string | null }): Promise<boolean>;
  /** a follows/mutes/blocks b, or a Space-link note (Relation). */
  relate(relation: Relation, a: string, b: string): Promise<boolean>;
  unrelate(relation: Relation, a: string, b: string): Promise<boolean>;
  /** Everyone a follows/mutes/blocks. */
  outgoing(relation: Relation, a: string): Promise<string[]>;
  /** Everyone who follows/mutes/blocks b. */
  incoming(relation: Relation, b: string): Promise<string[]>;
  addReport(report: Report): Promise<void>;
  reports(status?: Report['status'], limit?: number): Promise<Report[]>;
  /** All reports filed by this account, including resolved ones. Export only. */
  reportsFiled(accountId: string): Promise<Report[]>;
  resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined>;
  /**
   * Account deletion: their shares and relations go. Reports they filed stay, without
   * their name (and, once resolved, without the reason they gave: admins still need it
   * to act on an open one). Reports about them or their shares no longer name them, and
   * open ones are resolved: there's nothing left to act on.
   */
  forget(accountId: string, at: string): Promise<void>;
  /** Retention: resolved reports go once they were resolved before `resolvedBefore`. */
  purgeReports(resolvedBefore: string): Promise<number>;
}

/** What a deleted account is called in the reports that outlast it. */
export const DELETED_ID = 'deleted';
export const DELETED_RESOLUTION = 'The account was deleted';

/** A page size from a query: its limit, clamped. */
export const limitOf = (q: PageQuery, fallback = 30, max = 100) => Math.min(max, Math.max(1, Math.round(Number(q.limit) || fallback)));

interface Doc {
  shares: Share[];
  relations: Record<Relation, Array<[string, string, string]>>;   // [a, b, at]
  reports: Report[];
}

/** One document (memory, or a file / Postgres row via persistence). For tests and local servers. */
export class DocumentSocialStore implements SocialStore {
  private doc: SharedDocument<Doc>;

  /** Without persistence, the document lives in memory. */
  constructor(persistence: AuthPersistence = memoryPersistence()) {
    this.doc = new SharedDocument<Doc>(persistence, 'social', (d) => ({
      shares: d.shares ?? [],
      relations: { follows: [], mutes: [], blocks: [], intros: [], joins: [], ...d.relations },
      reports: d.reports ?? [],
    }), { maxAgeMs: DOCUMENT_MAX_AGE_MS });
  }

  private load(): Promise<Doc> {
    return this.doc.get();
  }

  private write<T>(change: (doc: Doc) => T): Promise<T> {
    return this.doc.update(change);
  }

  async addShare(share: Share): Promise<void> {
    await this.write((d) => {
      const root = share.reblogOf?.root;
      if (root && d.shares.some((s) => s.accountId === share.accountId && s.reblogOf?.root === root)) throw new AppError('conflict', 'You already reblogged it');
      d.shares.unshift(structuredClone(share));
    });
  }

  async getShare(id: string): Promise<Share | undefined> {
    return structuredClone((await this.load()).shares.find((s) => s.id === id));
  }

  deleteShare(accountId: string, id: string): Promise<boolean> {
    return this.write((d) => {
      const before = d.shares.length;
      d.shares = d.shares.filter((s) => !(s.id === id && s.accountId === accountId));
      return d.shares.length < before;
    });
  }

  setHidden(id: string, hiddenAt: string | null): Promise<boolean> {
    return this.write((d) => {
      const share = d.shares.find((s) => s.id === id);
      if (!share) return false;
      if (hiddenAt) share.hiddenAt = hiddenAt;
      else delete share.hiddenAt;
      return true;
    });
  }

  async sharesBy(accountIds: string[], query: PageQuery & { includeHidden?: boolean }): Promise<Share[]> {
    const ids = new Set(accountIds);
    return structuredClone((await this.load()).shares
      .filter((s) => ids.has(s.accountId) && (query.includeHidden || !s.hiddenAt) && (!query.before || s.createdAt < query.before || (s.createdAt === query.before && Boolean(query.beforeId) && s.id < query.beforeId!)))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limitOf(query)));
  }

  async countShares(accountId: string): Promise<number> {
    return (await this.load()).shares.filter((s) => s.accountId === accountId).length;
  }

  async reblogsOf(rootId: string, query: PageQuery): Promise<Share[]> {
    return structuredClone((await this.load()).shares
      .filter((s) => s.reblogOf?.root === rootId && !s.hiddenAt && (!query.before || s.createdAt < query.before))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, limitOf(query)));
  }

  async countReblogs(rootIds: string[]): Promise<Map<string, number>> {
    const ids = new Set(rootIds);
    const counts = new Map<string, number>();
    for (const s of (await this.load()).shares) {
      const root = s.reblogOf?.root;
      if (root && ids.has(root) && !s.hiddenAt && !s.detachedAt) counts.set(root, (counts.get(root) ?? 0) + 1);
    }
    return counts;
  }

  async reblogsBy(accountId: string, rootIds: string[]): Promise<Map<string, string>> {
    const ids = new Set(rootIds);
    return new Map((await this.load()).shares.filter((s) => s.accountId === accountId && s.reblogOf && ids.has(s.reblogOf.root)).map((s) => [s.reblogOf!.root, s.id]));
  }

  updateShare(id: string, change: { reblogs?: Share['reblogs'] | null; detachedAt?: string | null }): Promise<boolean> {
    return this.write((d) => {
      const share = d.shares.find((s) => s.id === id);
      if (!share) return false;
      for (const key of ['reblogs', 'detachedAt'] as const) {
        const value = change[key];
        if (value === null) delete share[key];
        else if (value !== undefined) Object.assign(share, { [key]: value });
      }
      return true;
    });
  }

  relate(relation: Relation, a: string, b: string): Promise<boolean> {
    return this.write((d) => {
      if (d.relations[relation].some(([x, y]) => x === a && y === b)) return false;
      d.relations[relation].push([a, b, new Date().toISOString()]);
      return true;
    });
  }

  unrelate(relation: Relation, a: string, b: string): Promise<boolean> {
    return this.write((d) => {
      const before = d.relations[relation].length;
      d.relations[relation] = d.relations[relation].filter(([x, y]) => !(x === a && y === b));
      return d.relations[relation].length < before;
    });
  }

  async outgoing(relation: Relation, a: string): Promise<string[]> {
    return (await this.load()).relations[relation].filter(([x]) => x === a).map(([, y]) => y);
  }

  async incoming(relation: Relation, b: string): Promise<string[]> {
    return (await this.load()).relations[relation].filter(([, y]) => y === b).map(([x]) => x);
  }

  async addReport(report: Report): Promise<void> {
    await this.write((d) => { d.reports.unshift(structuredClone(report)); });
  }

  async reports(status?: Report['status'], limit = 100): Promise<Report[]> {
    return structuredClone((await this.load()).reports.filter((r) => !status || r.status === status).slice(0, limit));
  }

  async reportsFiled(accountId: string): Promise<Report[]> {
    return structuredClone((await this.load()).reports.filter((r) => r.reporterId === accountId));
  }

  resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined> {
    return this.write((d) => {
      const report = d.reports.find((r) => r.id === id);
      if (!report) return undefined;
      Object.assign(report, { status: 'resolved', resolvedAt: at, resolvedBy: by, resolution });
      return structuredClone(report);
    });
  }

  async forget(accountId: string, at: string): Promise<void> {
    await this.write((d) => {
      const theirShares = new Set(d.shares.filter((s) => s.accountId === accountId).map((s) => s.id));
      d.shares = d.shares.filter((s) => s.accountId !== accountId);
      for (const r of Object.keys(d.relations) as Relation[]) d.relations[r] = d.relations[r].filter(([a, b]) => a !== accountId && b !== accountId);
      for (const report of d.reports) {
        if (report.reporterId === accountId) {
          report.reporterId = DELETED_ID;
          if (report.status === 'resolved') report.reason = '';
        }
        const about = report.targetKind === 'profile' ? report.targetId === accountId : theirShares.has(report.targetId);
        if (!about) continue;
        report.targetId = DELETED_ID;
        if (report.status === 'open') Object.assign(report, { status: 'resolved', resolvedAt: at, resolvedBy: 'system', resolution: DELETED_RESOLUTION });
      }
    });
  }

  purgeReports(resolvedBefore: string): Promise<number> {
    return this.write((d) => {
      const before = d.reports.length;
      d.reports = d.reports.filter((r) => !(r.status === 'resolved' && r.resolvedAt && r.resolvedAt < resolvedBefore));
      return before - d.reports.length;
    });
  }
}
