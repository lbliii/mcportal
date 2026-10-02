/**
 * The account page and download links. Not MCP: nothing a model reads can reach
 * the actions here, which is why deleting an account lives on this page.
 *
 *   GET  /account                  sign in, or: your data, downloads, delete
 *   GET  /account/login            sign in with GitHub (browser-bound)
 *   GET  /account/export/<format>  download (signed in)
 *   POST /account/import           upload an MCPortal export (signed in, same origin, CSRF)
 *   POST /account/delete           delete everything (signed in, same origin, CSRF, typed confirmation)
 *   POST /account/logout
 *   POST /account/devices/revoke   sign one app or device out (signed in, same origin, CSRF)
 *   GET  /download/<token>         a one-time link from the export_data tool (15 minutes)
 *   GET  /upload/<token>           a one-time link from import_portal: pick a file (15 minutes)
 *   POST /upload/<token>
 *
 * Uploads go from the browser straight to the server, so an export of any size
 * (up to the clip caps) never has to pass through the model.
 *
 * Plain server-rendered forms: no scripts. Sessions live in memory for an hour.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts } from './accounts.ts';
import type { OAuthServer } from './auth/oauth.ts';
import type { ClipStore } from './clips.ts';
import { AppError, errorCode, isAppError } from './lib/errors.ts';
import { secretToken, sha256Hex } from './lib/ids.ts';
import type { Logger } from './lib/log.ts';
import { boundaryOf, parseMultipart } from './lib/multipart.ts';
import { escapeHtml, readBody, readForm, redirect, sameOrigin, sendHtml } from './lib/web.ts';
import { page } from './page.ts';
import { PageSessions, type PageSession } from './page-sessions.ts';
import { buildExport, describeImport, EXPORT_FORMATS, importExport, parseExport, type ExportFile, type ExportFormat } from './portability.ts';
import type { PublicProfiles } from './public-profiles.ts';
import type { Social } from './social.ts';
import type { EditionStore } from './editions.ts';
import type { HandoffStore } from './handoffs.ts';
import type { SeenStore } from './seen.ts';
import type { ReadingStore } from './reading.ts';
import type { ProfileStore } from './store.ts';

const SESSION_MS = 3600 * 1000;
const DOWNLOAD_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_FORM = 2048;
/** An export holds at most 50 MB of clips; leave room for the layout and JSON overhead. */
export const MAX_UPLOAD = 60 * 1024 * 1024;

export interface AccountDeps {
  accounts: Accounts;
  oauth: OAuthServer;
  store: ProfileStore;
  reading?: ReadingStore | undefined;
  handoffs?: HandoffStore | undefined;
  seen?: SeenStore | undefined;
  editions?: EditionStore | undefined;
  clips?: ClipStore | undefined;
  publicProfiles?: PublicProfiles | undefined;
  social?: Social | undefined;
  publicUrl: string;
  log?: Logger | undefined;
  now?: (() => number) | undefined;
}

const hash = sha256Hex;

function prune<V extends { expiresAt: number }>(map: Map<string, V>, now: number): void {
  for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
  while (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value!);
}

/** The export file and the other fields of an upload form. */
async function readUpload(req: IncomingMessage): Promise<{ file?: Buffer; csrf?: string }> {
  const boundary = boundaryOf(req.headers['content-type']);
  if (!boundary) throw new AppError('invalid_argument', 'Upload the file with the form');
  const parts = parseMultipart(await readBody(req, MAX_UPLOAD), boundary);
  const file = parts.get('file'), csrf = parts.get('csrf')?.data.toString('utf8');
  return { ...(file && file.data.length ? { file: file.data } : {}), ...(csrf !== undefined ? { csrf } : {}) };
}

function uploadForm(action: string, csrf?: string): string {
  return `<form method="post" action="${action}" enctype="multipart/form-data">
  ${csrf ? `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">` : ''}
  <p><input type="file" name="file" accept=".json,application/json" aria-label="MCPortal export file" required></p>
  <p><button class="primary">Import</button></p>
</form>`;
}

/** The account page's own pieces, over the shared page style. */
const ACCOUNT_STYLE = `
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:22px 0 8px}
.stats div{border:2px solid var(--mp-web-text);border-radius:var(--mp-radius-card);background:var(--mp-web-canvas);padding:12px 14px 10px;box-shadow:5px 5px 0 var(--mp-brand-brick)}
.stats div:nth-child(2){box-shadow:5px 5px 0 var(--mp-brand-mustard)}.stats div:nth-child(3){box-shadow:5px 5px 0 var(--mp-brand-teal)}
.stats b{display:block;font:700 34px/1 var(--mp-font-heading);margin-bottom:4px}.stats span{display:block;line-height:1.3;color:var(--mp-web-secondary);font-size:var(--mp-type-14)}
ul.rows{list-style:none;padding:0;margin:0 0 10px;border-top:1px solid var(--mp-web-divider)}
ul.rows li{border-bottom:1px solid var(--mp-web-divider)}ul.rows .muted{white-space:nowrap}
ul.rows form{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 0;margin:0}
.files{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:0 0 8px}
.files a{display:block;border:2px solid var(--mp-web-text);border-radius:var(--mp-radius-card);padding:10px 14px;text-decoration:none;color:var(--mp-web-text);background:var(--mp-web-canvas)}
.files a:hover{box-shadow:4px 4px 0 var(--mp-brand-teal);transform:translate(-2px,-2px)}
.files b{display:block;font-family:var(--mp-font-heading)}.files span{color:var(--mp-web-secondary);font-size:var(--mp-type-13)}
.danger-zone{margin-top:40px;border:2px dashed var(--mp-brand-brick);border-radius:var(--mp-radius-card);padding:18px 20px}
.danger-zone h2{margin-top:0}.danger-zone h2::before{background:radial-gradient(circle,var(--mp-brand-brick) 1.5px,transparent 1.9px) 0 0/8px 8px}
@media (max-width:520px){.stats{gap:10px}.stats b{font-size:26px}.files{grid-template-columns:1fr}}
`;

function sendFile(res: ServerResponse, file: ExportFile): void {
  res.writeHead(200, {
    'content-type': file.contentType,
    'content-disposition': `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'content-length': String(file.body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  res.end(file.body);
}

/** What deleting an account needs: every store, and something that can revoke its sign-ins. */
export type DeletionDeps = Pick<AccountDeps, 'accounts' | 'store' | 'reading' | 'handoffs' | 'seen' | 'editions' | 'clips' | 'publicProfiles' | 'social'> & {
  oauth: { revokeUser(userId: string): Promise<number> };
};

/**
 * Delete an account and everything it owns: room, saved items, reading, handoffs, what
 * they've seen, their edition, clips, public profile, shares, follows, mutes and blocks,
 * sign-ins and the apps only they used, and the account. What outlasts it names nobody:
 * reports (anonymized; see SocialStore.forget), audit entries, and their handles, held
 * for 30 days so nobody can pose as them. `by` is who asked (them, or an admin).
 */
export async function deleteAccountData(accountId: string, deps: DeletionDeps, by = accountId): Promise<{ clips: number; tokens: number }> {
  await deps.store.delete(accountId);
  await deps.reading?.deleteAll(accountId);
  await deps.handoffs?.deleteAll(accountId);
  await deps.seen?.deleteAll(accountId);
  await deps.editions?.deleteAll(accountId);
  const clips = deps.clips ? await deps.clips.deleteAll(accountId) : 0;
  await deps.social?.forget(accountId);
  await deps.publicProfiles?.forget(accountId);
  const tokens = await deps.oauth.revokeUser(accountId);
  await deps.accounts.deleteAccount(accountId, by);
  return { clips, tokens };
}

export class AccountPage {
  private sessions: PageSessions;
  private downloads = new Map<string, { userId: string; format: ExportFormat; expiresAt: number }>();
  private uploads = new Map<string, { userId: string; expiresAt: number }>();
  private deps: AccountDeps;
  private now: () => number;

  constructor(deps: AccountDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.sessions = new PageSessions('account', { publicUrl: deps.publicUrl, ttlMs: SESSION_MS, max: MAX_ENTRIES, now: this.now });
  }

  get url(): string {
    return `${this.deps.publicUrl}/account`;
  }

  /** A one-time download link for the export_data tool. The export is built when it's opened. */
  downloadLink(userId: string, format: ExportFormat): string {
    prune(this.downloads, this.now());
    const token = secretToken(24);
    this.downloads.set(hash(token), { userId, format, expiresAt: this.now() + DOWNLOAD_MS });
    return `${this.deps.publicUrl}/download/${token}`;
  }

  private async exportSources(userId: string) {
    return { ...this.deps, publicProfile: await this.deps.publicProfiles?.get(userId), social: this.deps.social };
  }

  /** A one-time upload page for import_portal, so the file never passes through the model. */
  uploadLink(userId: string): string {
    prune(this.uploads, this.now());
    const token = secretToken(24);
    this.uploads.set(hash(token), { userId, expiresAt: this.now() + DOWNLOAD_MS });
    return `${this.deps.publicUrl}/upload/${token}`;
  }

  /** Import an uploaded export and answer with what happened. */
  private async runImport(res: ServerResponse, userId: string, upload: { file?: Buffer }, back: string): Promise<void> {
    if (!upload.file) return sendHtml(res, 400, page('No file', `<p>Pick your MCPortal export file (a .json). <a href="${back}">Go back</a>.</p>`, { door: 'shut' }));
    try {
      const result = await importExport(parseExport(upload.file.toString('utf8')), userId, this.deps);
      this.deps.log?.info('account.import', { portals: result.portalsAdded, saved: result.savedAdded, clips: result.clipsAdded });
      const lines = describeImport(result).split('\n').map((l) => `<p>${escapeHtml(l)}</p>`).join('');
      sendHtml(res, 200, page('Imported', `${lines}<p>In your agent, ask <i>“open my room”</i> to see it.</p>`, { kicker: 'Materialized!' }));
    } catch (error) {
      if (!isAppError(error) || error.code === 'internal') throw error;
      sendHtml(res, 400, page('Not imported', `<p>${escapeHtml(error.message)}</p><p><a href="${back}">Try another file</a>.</p>`, { door: 'shut' }));
    }
  }

  private async home(res: ServerResponse, s: PageSession): Promise<void> {
    const profile = await this.deps.store.get(s.accountId);
    const clips = this.deps.clips ? (await this.deps.clips.usage(s.accountId)).count : 0;
    const pub = await this.deps.publicProfiles?.get(s.accountId);
    const grants = await this.deps.oauth.grantsOf(s.accountId);
    const portals = profile.columns.reduce((n, c) => n + c.panels.length, 0);
    const login = escapeHtml(s.login);
    const labels: Record<ExportFormat, [string, string]> = {
      mcportal: ['Everything', 'MCPortal export, JSON'],
      bookmarks: ['Saved items', 'Bookmarks file, HTML'],
      clips: ['Clips', 'Markdown, .tar.gz'],
      opml: ['Sources', 'OPML'],
    };
    const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(s.csrf)}">`;
    const signOut = `<form method="post" action="/account/logout">${csrf}<button class="small">Sign out</button></form>`;
    const stat = (n: number, one: string, many: string) => `<div><b>${n}</b><span>${n === 1 ? one : many}</span></div>`;
    sendHtml(res, 200, page('Your MCPortal account', `
<p>${pub ? `Your public profile is <b>@${escapeHtml(pub.handle)}</b>.` : 'You have no public profile. Ask your agent to set one up if you want one.'}</p>
<div class="stats">${stat(portals, 'portal', 'portals')}${stat(profile.saved.length, 'saved item', 'saved items')}${stat(clips, 'clip', 'clips')}</div>
<h2>Signed-in apps and devices</h2>
${grants.length ? `<ul class="rows">${grants.map((g) => `<li><form method="post" action="/account/devices/revoke">
  ${csrf}<input type="hidden" name="grant" value="${escapeHtml(g.grantId)}">
  <span><b>${escapeHtml(g.clientName)}</b> <span class="muted">${g.lastUsedAt ? `last used ${new Date(g.lastUsedAt).toISOString().slice(0, 10)}` : ''}</span></span>
  <button class="small">Revoke</button></form></li>`).join('')}</ul>
<p class="muted">Revoking signs that app or device out at once; it can sign in again.</p>` : '<p class="muted">None right now.</p>'}
<h2>Download your data</h2>
<div class="files">${EXPORT_FORMATS.map((f) => `<a href="/account/export/${f}"><b>${labels[f][0]}</b><span>${labels[f][1]}</span></a>`).join('')}</div>
<h2>Import</h2>
<p>Add an MCPortal export from another server or your own machine. It only adds: nothing in your portal is removed or moved.</p>
${uploadForm('/account/import', s.csrf)}
<div class="danger-zone">
<h2>Delete your account</h2>
<p>This deletes your room, saved items, clips, public profile, shares and follows, and signs you out everywhere. It can't be undone, so download your data first.</p>
<form method="post" action="/account/delete">
  ${csrf}
  <p><label>Type <code>delete @${login}</code> to confirm:<input name="confirm" autocomplete="off" spellcheck="false"></label></p>
  <p><button class="danger">Delete my account</button></p>
</form>
</div>`, { heading: `@${s.login}`, kicker: 'Signed in as', wide: true, aside: signOut, style: ACCOUNT_STYLE }));
  }

  /** Returns true if it handled the request. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const route = url.pathname.replace(/\/+$/, '') || '/';

    const token = route.match(/^\/download\/([A-Za-z0-9_-]{20,64})$/)?.[1];
    if (route.startsWith('/download/') && req.method === 'GET') {
      const key = token ? hash(token) : '';
      const entry = this.downloads.get(key);
      this.downloads.delete(key);   // one use
      if (!entry || entry.expiresAt <= this.now() || this.deps.accounts.actor(entry.userId).status !== 'active') {
        sendHtml(res, 410, page('Link expired', '<p>This download link has expired or was already used. Ask for a new export, or download from your <a href="/account">account page</a>.</p>', { door: 'shut', kicker: 'This door has closed' }));
        return true;
      }
      sendFile(res, await buildExport(entry.format, entry.userId, await this.exportSources(entry.userId)));
      return true;
    }

    if (route.startsWith('/upload/') && (req.method === 'GET' || req.method === 'POST')) {
      const key = hash(route.match(/^\/upload\/([A-Za-z0-9_-]{20,64})$/)?.[1] ?? '');
      const entry = this.uploads.get(key);
      if (!entry || entry.expiresAt <= this.now() || this.deps.accounts.actor(entry.userId).status !== 'active') {
        this.uploads.delete(key);
        sendHtml(res, 410, page('Link expired', '<p>This upload link has expired or was already used. Ask your agent for a new one, or import from your <a href="/account">account page</a>.</p>', { door: 'shut', kicker: 'This door has closed' }));
        return true;
      }
      if (req.method === 'GET') {
        sendHtml(res, 200, page('Import into MCPortal', `<p>Pick your MCPortal export file. It only adds to your room: nothing is removed or moved.</p>${uploadForm(route)}<p class="muted">This link works once, for 15 minutes.</p>`, { kicker: 'Incoming transmission' }));
        return true;
      }
      if (!sameOrigin(req, this.deps.publicUrl)) return sendHtml(res, 403, page('Refused', '<p>That upload didn\'t come from the import page.</p>', { door: 'shut' })), true;
      this.uploads.delete(key);   // one use, whatever happens next
      let upload: { file?: Buffer };
      try {
        upload = await readUpload(req);
      } catch (error) {
        const big = errorCode(error) === 'limit_exceeded';
        return sendHtml(res, big ? 413 : 400, page('Not imported', `<p>${big ? `That file is over ${MAX_UPLOAD / 1024 / 1024} MB.` : 'The upload was malformed.'} Ask your agent for a new link.</p>`, { door: 'shut' }), { connection: 'close' }), true;
      }
      await this.runImport(res, entry.userId, upload, '/account');
      return true;
    }

    if (route !== '/account' && !route.startsWith('/account/')) return false;

    if (route === '/account/login' && req.method === 'GET') {
      this.deps.oauth.beginPageSignIn(req, res, async (who, out, clearCookie) => {
        if ('error' in who) return sendHtml(out, 400, page('Sign-in failed', `<p>${escapeHtml(who.error)}.</p><p><a class="button primary" href="/account/login">Try again</a></p>`, { door: 'shut', kicker: 'Signal lost' }), clearCookie);
        const account = await this.deps.accounts.forIdentity(who);
        if (!account) return sendHtml(out, 404, page('No account', `<p>@${escapeHtml(who.login)} has no account on this MCPortal server, so there's nothing stored for it.</p>`, { door: 'shut' }), clearCookie);
        redirect(out, '/account', { 'set-cookie': [clearCookie['set-cookie']!, this.sessions.start(account.id, who.login)] });
      });
      return true;
    }

    const current = this.sessions.current(req);
    if (route === '/account' && req.method === 'GET') {
      if (!current) {
        sendHtml(res, 200, page('Your MCPortal account', '<p>Sign in to see what MCPortal keeps for you, sign apps and devices out, download your data, or delete your account.</p><p><a class="button primary" href="/account/login">Sign in with GitHub</a></p><p class="muted">MCPortal only learns your GitHub user ID and login.</p>', { kicker: 'Account' }));
      } else await this.home(res, current.session);
      return true;
    }
    if (!current) {
      redirect(res, '/account');
      return true;
    }

    const format = route.match(/^\/account\/export\/([a-z]+)$/)?.[1] as ExportFormat | undefined;
    if (format && req.method === 'GET') {
      if (!EXPORT_FORMATS.includes(format)) return sendHtml(res, 404, page('Not found', '<p>No such export. <a href="/account">Go back</a>.</p>', { door: 'shut' })), true;
      sendFile(res, await buildExport(format, current.session.accountId, await this.exportSources(current.session.accountId)));
      return true;
    }

    if (route === '/account/import' && req.method === 'POST') {
      if (!sameOrigin(req, this.deps.publicUrl)) return sendHtml(res, 403, page('Refused', '<p>That request didn\'t come from your account page. <a href="/account">Go back</a>.</p>', { door: 'shut' })), true;
      let upload: { file?: Buffer; csrf?: string };
      try {
        upload = await readUpload(req);
      } catch (error) {
        const big = errorCode(error) === 'limit_exceeded';
        return sendHtml(res, big ? 413 : 400, page('Not imported', `<p>${big ? `That file is over ${MAX_UPLOAD / 1024 / 1024} MB.` : 'The upload was malformed.'} <a href="/account">Go back</a>.</p>`, { door: 'shut' }), { connection: 'close' }), true;
      }
      if (!this.sessions.csrfMatches(current.session, upload.csrf)) return sendHtml(res, 403, page('Refused', '<p>That request didn\'t come from your account page. <a href="/account">Go back</a>.</p>', { door: 'shut' })), true;
      await this.runImport(res, current.session.accountId, upload, '/account');
      return true;
    }

    if ((route === '/account/delete' || route === '/account/logout' || route === '/account/devices/revoke') && req.method === 'POST') {
      let form: URLSearchParams;
      try {
        form = await readForm(req, MAX_FORM);
      } catch {
        return sendHtml(res, 400, page('Bad request', '<p>Try again from the <a href="/account">account page</a>.</p>', { door: 'shut' })), true;
      }
      if (!sameOrigin(req, this.deps.publicUrl) || !this.sessions.csrfMatches(current.session, form.get('csrf'))) {
        return sendHtml(res, 403, page('Refused', '<p>That request didn\'t come from your account page. <a href="/account">Go back</a>.</p>', { door: 'shut' })), true;
      }
      if (route === '/account/devices/revoke') {
        const revoked = await this.deps.oauth.revokeGrantOf(current.session.accountId, form.get('grant') ?? '');
        if (revoked) this.deps.log?.info('account.device_revoked', {});
        redirect(res, '/account');
        return true;
      }
      if (route === '/account/logout') {
        this.sessions.end(current.key);
        redirect(res, '/account', { 'set-cookie': this.sessions.cookie('', 0) });
        return true;
      }
      const expected = `delete @${current.session.login}`.toLowerCase();
      if ((form.get('confirm') ?? '').trim().toLowerCase() !== expected) {
        return sendHtml(res, 400, page('Not deleted', `<p>Nothing was deleted: type <code>${escapeHtml(expected)}</code> exactly to confirm. <a href="/account">Go back</a>.</p>`, { door: 'shut' })), true;
      }
      const { accountId } = current.session;
      const done = await deleteAccountData(accountId, this.deps);
      this.sessions.endAll(accountId);
      for (const [k, d] of this.downloads) if (d.userId === accountId) this.downloads.delete(k);
      for (const [k, u] of this.uploads) if (u.userId === accountId) this.uploads.delete(k);
      this.deps.log?.info('account.deleted', { clips: done.clips, tokens: done.tokens });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': this.sessions.cookie('', 0), 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(page('Account deleted', '<p>Your room, saved items, clips, public profile, shares and follows are gone, and you\'re signed out everywhere. Remove MCPortal from your agent\'s connectors too.</p>', { heading: 'Your account is deleted', door: 'shut' }));
      return true;
    }

    sendHtml(res, 404, page('Not found', '<p>There\'s nothing at this address. Go to <a href="/account">your account</a>.</p>', { door: 'shut' }));
    return true;
  }
}
