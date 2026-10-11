/** Update discovery never downloads code or sends account/room data. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_VERSION } from './version.ts';
import { versionAtLeast } from './api/calls.ts';
import { SharedDocument, type DocumentPersistence } from './lib/document.ts';
import { atomicWrite } from './lib/files.ts';
import { AppError } from './lib/errors.ts';
import type { Fetcher } from './types.ts';
import type { ToolContext } from './tools/kit.ts';

export const RELEASE_HIGHLIGHTS = 'Simpler Room and Library navigation, compact controls, improved reading and search, and clearer upgrade guidance.';
export const UPDATE_INTERVAL_MS = 24 * 60 * 60_000;
const RETRY_MS = 15 * 60_000;
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
type Metadata = { minClientVersion: string; recommendedVersion: string };
type Preferences = { automatic?: boolean; dismissedVersion?: string };
type Stored = Preferences & { server?: string; metadata?: Metadata; checkedAt?: number; attemptedAt?: number; failed?: boolean };
export type UpdateStatus = {
  installedVersion: string;
  mode: 'local' | 'hosted';
  status: 'current' | 'unchecked' | 'unavailable' | 'update_available' | 'update_required';
  automatic: boolean;
  dismissed: boolean;
  stale: boolean;
  recommendedVersion?: string;
  minClientVersion?: string;
  checkedAt?: string;
  upgradeUrl: string;
  releaseNotesUrl: string;
  highlights: string;
};

function metadata(value: unknown): Metadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const m = value as Metadata;
  if (typeof m.minClientVersion !== 'string' || !VERSION.test(m.minClientVersion) || typeof m.recommendedVersion !== 'string' || !VERSION.test(m.recommendedVersion)) return undefined;
  if (!versionAtLeast(m.recommendedVersion, m.minClientVersion)) return undefined;
  return { minClientVersion: m.minClientVersion, recommendedVersion: m.recommendedVersion };
}

export function hostedUpdateStatus(server = 'https://mcportal.lol'): UpdateStatus {
  return { installedVersion: APP_VERSION, mode: 'hosted', status: 'current', automatic: true, dismissed: false, stale: false,
    upgradeUrl: `${server}/upgrade`, releaseNotesUrl: `https://github.com/lbliii/mcportal/releases/tag/v${APP_VERSION}`, highlights: RELEASE_HIGHLIGHTS };
}

/** One controller per local installation; preferences and last successful check survive process restarts. */
export class LocalUpdates {
  private doc: SharedDocument<Stored>;
  private pending: Promise<void> | undefined;
  private readonly installed: string;
  private readonly now: () => number;
  private readonly server: string;
  private readonly fetcher: Fetcher;

  constructor(options: { dataDir: string; server: string; fetcher: Fetcher; installedVersion?: string; now?: () => number; persistence?: DocumentPersistence }) {
    this.server = options.server;
    this.fetcher = options.fetcher;
    this.installed = options.installedVersion ?? APP_VERSION;
    this.now = options.now ?? Date.now;
    const file = path.join(options.dataDir, 'updates.json');
    const persistence = options.persistence ?? {
      read: async () => { try { return await readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
      write: (value: string) => atomicWrite(file, value),
    };
    this.doc = new SharedDocument<Stored>(persistence, 'update preferences', d => ({
      ...(typeof d.automatic === 'boolean' ? { automatic: d.automatic } : {}),
      ...(d.server === this.server && typeof d.dismissedVersion === 'string' && VERSION.test(d.dismissedVersion) ? { dismissedVersion: d.dismissedVersion } : {}),
      ...(d.server === this.server ? { server: d.server, ...(metadata(d.metadata) ? { metadata: metadata(d.metadata)! } : {}),
        ...(timestamp(d.checkedAt) ? { checkedAt: d.checkedAt } : {}), ...(timestamp(d.attemptedAt) ? { attemptedAt: d.attemptedAt } : {}), failed: d.failed === true } : {}),
    }), { maxAgeMs: 0, now: this.now });
  }

  async read(linked: boolean): Promise<UpdateStatus> {
    const d = await this.doc.get();
    const m = d.metadata;
    const status = !m ? d.failed ? 'unavailable' : 'unchecked'
      : !versionAtLeast(this.installed, m.minClientVersion) ? 'update_required'
      : !versionAtLeast(this.installed, m.recommendedVersion) ? 'update_available'
      : d.failed ? 'unavailable' : 'current';
    return { ...hostedUpdateStatus(this.server), installedVersion: this.installed, mode: 'local', status,
      automatic: d.automatic ?? linked, dismissed: status === 'update_available' && d.dismissedVersion === m?.recommendedVersion,
      stale: Boolean(d.failed || (d.checkedAt !== undefined && this.now() - d.checkedAt > UPDATE_INTERVAL_MS)),
      ...(m ?? {}), ...(d.checkedAt !== undefined ? { checkedAt: new Date(d.checkedAt).toISOString() } : {}),
      releaseNotesUrl: `https://github.com/lbliii/mcportal/releases/tag/v${m?.recommendedVersion ?? this.installed}` };
  }

  async check(linked: boolean, manual = false): Promise<UpdateStatus> {
    const d = await this.doc.get();
    const age = this.now() - (d.attemptedAt ?? 0);
    if (!manual && (!(d.automatic ?? linked) || (d.attemptedAt !== undefined && age >= 0 && age < (d.failed ? RETRY_MS : UPDATE_INTERVAL_MS)))) return this.read(linked);
    // Even explicit repeated clicks are bounded. Concurrent calls share the fetch.
    if (!this.pending && manual && d.attemptedAt !== undefined && age >= 0 && age < 10_000) return this.read(linked);
    this.pending ??= this.refresh().finally(() => { this.pending = undefined; });
    await this.pending;
    return this.read(linked);
  }

  private async refresh(): Promise<void> {
    const at = this.now();
    let found: Metadata | undefined;
    try {
      const response = await this.fetcher(`${this.server}/.well-known/mcportal`, { timeoutMs: 3000, maxBytes: 16_384, maxRedirects: 0 });
      if (response.status === 200 && !response.truncated) {
        const body = JSON.parse(response.text);
        if (body.version === 1) found = metadata(body);
      }
    } catch { /* An offline check must not disable the room or erase a known update. */ }
    await this.doc.update(d => {
      d.server = this.server; d.attemptedAt = at; d.failed = !found;
      if (found) { d.metadata = found; d.checkedAt = at; }
    });
  }

  async configure(linked: boolean, preferences: Preferences): Promise<UpdateStatus> {
    const current = await this.read(linked);
    if (preferences.dismissedVersion && (current.status !== 'update_available' || preferences.dismissedVersion !== current.recommendedVersion)) {
      throw new AppError('invalid_argument', 'Only the currently available optional update can be dismissed.');
    }
    await this.doc.update(d => Object.assign(d, preferences));
    return this.read(linked);
  }
}

/** A damaged update file should be repairable without making the room unusable. */
export async function updateStatus(ctx: ToolContext): Promise<UpdateStatus> {
  if (!ctx.updates) return hostedUpdateStatus(ctx.updateOrigin ?? (ctx.accountUrl ? new URL(ctx.accountUrl).origin : undefined));
  try { return await ctx.updates.read(Boolean(ctx.link?.linked)); }
  catch { return { ...hostedUpdateStatus(ctx.link?.server), mode: 'local', status: 'unavailable', automatic: false }; }
}

export function updateMessage(update: UpdateStatus): string {
  if (update.status === 'update_required') return `Update MCPortal to ${update.recommendedVersion} to use this hosted account. Installed: ${update.installedVersion}. Guide: ${update.upgradeUrl}`;
  if (update.status === 'update_available') return `MCPortal ${update.recommendedVersion} is available (installed: ${update.installedVersion}). Guide: ${update.upgradeUrl}`;
  if (update.status === 'unavailable') return `Couldn't check for updates. Installed: MCPortal ${update.installedVersion}. Guide: ${update.upgradeUrl}`;
  if (update.status === 'unchecked') return `MCPortal ${update.installedVersion}. Updates haven't been checked. Guide: ${update.upgradeUrl}`;
  return `MCPortal ${update.installedVersion}. ${update.mode === 'hosted' ? 'This connection receives deployed updates.' : 'Up to date at the last successful check.'}`;
}
