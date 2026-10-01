/**
 * Where shares, relations and reports are kept: the SocialStore interface and the
 * one-document store used by tests and local servers. Postgres has its own in
 * src/db/social.ts. Stores only store; the rules live in Social (social.ts), which
 * re-exports this module.
 */
import type { AuthPersistence } from './auth/store.ts';
import { readDocument } from './lib/document.ts';
import type { PageQuery, Relation, Report, Share } from './social.ts';
import { KeyedMutex } from './store.ts';

/** Storage only; no rules. */
export interface SocialStore {
  addShare(share: Share): Promise<void>;
  getShare(id: string): Promise<Share | undefined>;
  deleteShare(accountId: string, id: string): Promise<boolean>;
  setHidden(id: string, hiddenAt: string | null): Promise<boolean>;
  /** Newest first. */
  sharesBy(accountIds: string[], query: PageQuery & { includeHidden?: boolean }): Promise<Share[]>;
  countShares(accountId: string): Promise<number>;
  /** a follows/mutes/blocks b. */
  relate(relation: Relation, a: string, b: string): Promise<boolean>;
  unrelate(relation: Relation, a: string, b: string): Promise<boolean>;
  /** Everyone a follows/mutes/blocks. */
  outgoing(relation: Relation, a: string): Promise<string[]>;
  /** Everyone who follows/mutes/blocks b. */
  incoming(relation: Relation, b: string): Promise<string[]>;
  addReport(report: Report): Promise<void>;
  reports(status?: Report['status'], limit?: number): Promise<Report[]>;
  resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined>;
  /** Account deletion: their shares and relations go; reports they filed stay, anonymized. */
  forget(accountId: string): Promise<void>;
}

/** A page size from a query: its limit, clamped. */
export const limitOf = (q: PageQuery, fallback = 30, max = 100) => Math.min(max, Math.max(1, Math.round(Number(q.limit) || fallback)));

interface Doc {
  shares: Share[];
  relations: Record<Relation, Array<[string, string, string]>>;   // [a, b, at]
  reports: Report[];
}

/** One document (memory, or a file / Postgres row via persistence). For tests and local servers. */
export class DocumentSocialStore implements SocialStore {
  private persistence?: AuthPersistence;
  private doc: Doc | null = null;
  private mutex = new KeyedMutex();

  constructor(persistence?: AuthPersistence) {
    this.persistence = persistence;
  }

  private async load(): Promise<Doc> {
    if (this.doc) return this.doc;
    const parsed: Partial<Doc> = this.persistence ? await readDocument<Doc>(this.persistence, 'social') : {};
    this.doc = { shares: parsed.shares ?? [], relations: { follows: [], mutes: [], blocks: [], ...parsed.relations }, reports: parsed.reports ?? [] };
    return this.doc;
  }

  private write<T>(change: (doc: Doc) => T): Promise<T> {
    return this.mutex.run('social', async () => {
      const doc = await this.load();
      const result = change(doc);
      await this.persistence?.write(JSON.stringify(doc));
      return result;
    });
  }

  async addShare(share: Share): Promise<void> {
    await this.write((d) => { d.shares.unshift(structuredClone(share)); });
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
      .filter((s) => ids.has(s.accountId) && (query.includeHidden || !s.hiddenAt) && (!query.before || s.createdAt < query.before))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, limitOf(query)));
  }

  async countShares(accountId: string): Promise<number> {
    return (await this.load()).shares.filter((s) => s.accountId === accountId).length;
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

  resolveReport(id: string, by: string, resolution: string, at: string): Promise<Report | undefined> {
    return this.write((d) => {
      const report = d.reports.find((r) => r.id === id);
      if (!report) return undefined;
      Object.assign(report, { status: 'resolved', resolvedAt: at, resolvedBy: by, resolution });
      return structuredClone(report);
    });
  }

  async forget(accountId: string): Promise<void> {
    await this.write((d) => {
      d.shares = d.shares.filter((s) => s.accountId !== accountId);
      for (const r of Object.keys(d.relations) as Relation[]) d.relations[r] = d.relations[r].filter(([a, b]) => a !== accountId && b !== accountId);
      for (const report of d.reports) if (report.reporterId === accountId) report.reporterId = 'deleted';
    });
  }
}
