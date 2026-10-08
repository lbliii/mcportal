import type { WatchStore } from '../watches.ts';
import type { Watches } from '../store-watches.ts';
/**
 * A local MCPortal, linked or not. Each request asks for its ToolContext here, which
 * is the local files when there's no link.json, or the hosted account's state (remote
 * stores) when there is. Signing in and out happen here too:
 *
 *   - Signing in merges this computer's portal into the account (an additive import:
 *     portals it doesn't have, saved items, clips, reading history; nothing removed).
 *     The local files are left as they are.
 *   - Signing out copies the account's portal back to the local files (also additive),
 *     revokes this computer's sign-in, and deletes link.json, so nothing disappears.
 */
import { hostedOrigin } from './hosted-url.ts';
import { AppError, errorCode } from '../lib/errors.ts';
import { buildExport, describeImport, importExport, parseExport, type ExportFormat } from '../portability.ts';
import type { ProfileStore } from '../store.ts';
import type { ClipStore } from '../clip-stores.ts';
import type { EditionStore } from '../editions.ts';
import type { HandoffStore } from '../handoffs.ts';
import type { ReadingStore } from '../reading.ts';
import { FileCollectionStore, type CollectionStore } from '../collections.ts';
import { FileExperienceStore, type ExperienceStore } from '../experiences.ts';
import type { SeenStore } from '../seen.ts';
import type { ToolContext } from '../tools/kit.ts';
import { versionAtLeast } from '../api/calls.ts';
import { SERVER_INFO } from '../mcp.ts';
import { StateClient } from './client.ts';
import { FileLinkAuth, LinkFile, type LinkRecord } from './link-file.ts';
import { startSignIn, type PendingSignIn } from './signin.ts';
import { signInFailure, type SignInFailure } from './signin-errors.ts';
import { linkedStores } from './stores.ts';

/** The hosted MCPortal a local one signs in to (MCPORTAL_HOSTED_URL to use another). */
export const DEFAULT_HOSTED_URL = 'https://mcportal.lol';

/** What tools see of the link (ctx.link): whether this MCPortal is signed in, and the two actions. */
export interface LinkControl {
  linked: boolean;
  /** The hosted MCPortal (origin), and the account as it signed in. */
  server: string;
  login?: string | undefined;
  /** Start signing in; resolves to the URL the user opens. */
  start(): Promise<{ url: string }>;
  /** Sign out: copy the portal back here, revoke, forget. Resolves to what happened, for the user. */
  unlink(): Promise<string>;
  /** Linked: whether the hosted server answered last time, and when the room was last synced (ms). */
  health?: (() => { offline: boolean; syncedAt?: number }) | undefined;
  /** Last failed attempt in this process, so the room and agent can explain what happened. */
  signInFailure?: (() => SignInFailure | undefined) | undefined;
}

export interface LocalStores {
  store: ProfileStore;
  clips: ClipStore;
  collections?: CollectionStore;
  experiences?: ExperienceStore;
  reading: ReadingStore;
  watchStore?: WatchStore;
  watches?: Watches;
  seen: SeenStore;
  handoffs: HandoffStore;
  editions: EditionStore;
}

export interface LocalSessionOptions {
  dataDir: string;
  /** The local single user's id in the data directory (MCPORTAL_USER, default "default"). */
  localUser: string;
  local: LocalStores;
  /** Everything else every context has: the fetcher, cache, deliver for local files. */
  base: Omit<ToolContext, 'store' | 'userId'>;
  /** Called once a sign-in finishes in the browser: what the caller can reach has changed. */
  onLinked?: (() => void) | undefined;
  hostedUrl?: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

export class LocalSession {
  readonly link: LinkFile;
  private readonly options: LocalSessionOptions;
  private readonly server: string;
  /** The linked stores, kept while the link is the same, so the room cache lasts across calls. */
  private linked: { key: string; client: StateClient; stores: ReturnType<typeof linkedStores> } | undefined;
  private pending: PendingSignIn | undefined;
  private lastSignInFailure: SignInFailure | undefined;
  /** Said once on the next open_room after signing in (what the merge did). */
  private notice: string | undefined;
  private nudged = false;

  constructor(options: LocalSessionOptions) {
    this.options = { ...options, local: { ...options.local, collections: options.local.collections ?? new FileCollectionStore(options.dataDir), experiences: options.local.experiences ?? new FileExperienceStore(options.dataDir) } };
    this.link = new LinkFile(options.dataDir);
    this.server = hostedOrigin(options.hostedUrl ?? DEFAULT_HOSTED_URL);
  }

  /** Used by the local worker without consuming request notices. */
  async isLinked(): Promise<boolean> { return Boolean(await this.link.read()); }

  /** The context for one request: local, or linked when link.json says so. */
  async context(): Promise<ToolContext> {
    const record = await this.link.read();
    const control = this.control(record);
    if (!record) {
      this.linked = undefined;
      return { ...this.options.base, ...this.options.local, userId: this.options.localUser, localFiles: true, link: control };
    }
    const { client, stores } = this.linkedFor(record);
    const notice = this.notice;
    this.notice = undefined;
    if (notice) stores.store.addNotice(notice);
    // Once per process: the hosted server runs a newer MCPortal than this computer.
    if (!this.nudged && client.serverVersion && !versionAtLeast(SERVER_INFO.version, client.serverVersion)) {
      this.nudged = true;
      stores.store.addNotice(`MCPortal ${client.serverVersion} is out (this computer has ${SERVER_INFO.version}). Update to get what's new; this version keeps working until the hosted MCPortal stops supporting it.`);
    }
    control.health = () => stores.store.health();
    return {
      ...this.options.base,
      ...stores,
      userId: record.accountId,
      localFiles: true,
      accountUrl: `${record.server}/account`,
      link: control,
      deliver: (format) => this.download(client, format),
      importer: async (data) => (await client.upload(JSON.stringify(data))).result,
    };
  }

  private linkedFor(record: LinkRecord) {
    const key = `${record.server}|${record.accountId}|${record.clientId}`;
    if (this.linked?.key !== key) {
      const client = new StateClient({ server: record.server, auth: new FileLinkAuth(this.link, this.fetchOptions()), ...this.fetchOptions() });
      this.linked = { key, client, stores: linkedStores(client, record.accountId, this.options.now ? { now: this.options.now } : {}) };
    }
    return this.linked;
  }

  private fetchOptions(): { fetch?: typeof fetch; now?: () => number } {
    return { ...(this.options.fetch ? { fetch: this.options.fetch } : {}), ...(this.options.now ? { now: this.options.now } : {}) };
  }

  private control(record: LinkRecord | undefined): LinkControl {
    return {
      linked: Boolean(record),
      server: record?.server ?? this.server,
      login: record?.login,
      start: () => this.start(),
      unlink: () => this.unlink(),
      signInFailure: () => this.lastSignInFailure,
    };
  }

  /** Begin signing in (or hand back the sign-in already waiting for the browser). */
  async start(): Promise<{ url: string }> {
    if (await this.link.read()) throw new AppError('conflict', 'This MCPortal is already signed in.');
    if (this.pending) return { url: this.pending.url };
    this.lastSignInFailure = undefined;
    const pending = await startSignIn({
      server: this.server,
      link: this.link,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      ...(this.options.now ? { now: this.options.now } : {}),
      onLinked: (_record, client) => this.mergeLocal(client),
      onSyncFailure: (message) => { this.notice = message; },
      ...(this.options.base.log ? { log: this.options.base.log } : {}),
    }).catch((error: unknown) => {
      if (error instanceof AppError) this.lastSignInFailure = signInFailure(error);
      throw error;
    });
    this.pending = pending;
    void pending.done.then(() => { this.lastSignInFailure = undefined; this.options.onLinked?.(); }, (error: unknown) => {
      if (this.pending === pending && error instanceof AppError) this.lastSignInFailure = signInFailure(error);
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    return { url: pending.url };
  }

  /** The first-link merge: this computer's portal into the account, additively. */
  private async mergeLocal(client: StateClient): Promise<string | undefined> {
    const { local, localUser } = this.options;
    const profile = await local.store.get(localUser);
    const clips = (await local.clips.usage(localUser)).count;
    const collections = await local.collections?.list(localUser) ?? [];
    const experiences = (await local.experiences?.get(localUser))?.state;
    if (!profile.onboarded && !profile.saved.length && !clips && !collections.length && !experiences?.catchup && !experiences?.watches.length && !(await local.watchStore?.list(localUser))?.length) return undefined;
    const file = await buildExport('mcportal', localUser, local);
    const { summary } = await client.upload(file.body.toString('utf8'));
    const note = `This computer's portal was added to your account. ${summary.replace(/^Imported: /, '')}`;
    this.notice = note;
    return note;
  }

  /** Sign out: copy back, revoke, forget. */
  async unlink(): Promise<string> {
    const record = await this.link.read();
    if (!record) throw new AppError('failed_precondition', 'This MCPortal isn\'t signed in.');
    const { client } = this.linkedFor(record);
    let copied: string;
    try {
      const file = await client.download('mcportal');
      const result = await importExport(parseExport(file.body.toString('utf8')), this.options.localUser, this.options.local);
      copied = `Your portal was copied to this computer (${describeImport(result).replace(/^Imported: /, '').replace(/\.$/, '')}).`;
    } catch (error) {
      // A sign-in that's already gone can't copy anything; the portal is still in the account.
      if (errorCode(error) !== 'unauthenticated') throw error;
      copied = 'This computer\'s sign-in had already ended, so nothing was copied; your portal is still in your hosted account.';
    }
    await this.revoke(record);
    await this.link.remove();
    this.linked = undefined;
    return `Signed out. ${copied} MCPortal here is in ghost mode again.`;
  }

  /** Best effort: the token is useless once link.json is gone, and the account page can revoke it too. */
  private async revoke(record: LinkRecord): Promise<void> {
    await (this.options.fetch ?? fetch)(new URL('/oauth/revoke', record.server), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: record.refreshToken, client_id: record.clientId }).toString(),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  /** export_data on a linked MCPortal: built by the hosted account, saved on this computer. */
  private async download(client: StateClient, format: ExportFormat): Promise<{ kind: 'file'; where: string; summary: string }> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const file = await client.download(format);
    const dir = path.join(this.options.dataDir, 'exports');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const where = path.join(dir, file.filename);
    await writeFile(where, file.body, { mode: 0o600 });
    return { kind: 'file', where, summary: file.summary };
  }
}
