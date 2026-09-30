/**
 * The account page and download links. Not MCP: nothing a model reads can reach
 * the actions here, which is why deleting an account lives on this page.
 *
 *   GET  /account                  sign in, or: your data, downloads, delete
 *   GET  /account/login            sign in with GitHub (browser-bound)
 *   GET  /account/export/<format>  download (signed in)
 *   POST /account/delete           delete everything (signed in, same origin, CSRF, typed confirmation)
 *   POST /account/logout
 *   GET  /download/<token>         a one-time link from the export_data tool (15 minutes)
 *
 * Plain server-rendered forms: no scripts. Sessions live in memory for an hour.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts } from './accounts.ts';
import { cookies, escapeHtml, page, redirect, safeEqual, sendHtml, type OAuthServer } from './auth/oauth.ts';
import type { ClipStore } from './clips.ts';
import { buildExport, EXPORT_FORMATS, type ExportFile, type ExportFormat } from './portability.ts';
import type { PublicProfiles } from './public-profiles.ts';
import type { ProfileStore } from './store.ts';

const SESSION_MS = 3600 * 1000;
const DOWNLOAD_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_FORM = 2048;

export interface AccountDeps {
  accounts: Accounts;
  oauth: OAuthServer;
  store: ProfileStore;
  clips?: ClipStore;
  publicProfiles?: PublicProfiles;
  publicUrl: string;
  log?: (message: string) => void;
  now?: () => number;
}

interface Session {
  accountId: string;
  login: string;
  csrf: string;
  expiresAt: number;
}

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

function prune<V extends { expiresAt: number }>(map: Map<string, V>, now: number): void {
  for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
  while (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value!);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_FORM) throw new Error('Form too large');
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

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

/**
 * Delete an account and everything it owns: portal, saved items, clips, public
 * profile (its handle stays held for 30 days), sign-in tokens, and the account.
 */
export async function deleteAccountData(accountId: string, deps: Pick<AccountDeps, 'accounts' | 'oauth' | 'store' | 'clips' | 'publicProfiles'>, by = accountId): Promise<{ clips: number; tokens: number }> {
  await deps.store.delete(accountId);
  const clips = deps.clips ? await deps.clips.deleteAll(accountId) : 0;
  await deps.publicProfiles?.remove(accountId);
  const tokens = await deps.oauth.revokeUser(accountId);
  await deps.accounts.deleteAccount(accountId, by);
  return { clips, tokens };
}

export class AccountPage {
  private sessions = new Map<string, Session>();
  private downloads = new Map<string, { userId: string; format: ExportFormat; expiresAt: number }>();
  private deps: AccountDeps;
  private now: () => number;

  constructor(deps: AccountDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  get url(): string {
    return `${this.deps.publicUrl}/account`;
  }

  private get secure(): boolean {
    return this.deps.publicUrl.startsWith('https://');
  }

  private get cookieName(): string {
    return this.secure ? '__Host-mcportal_account' : 'mcportal_account';
  }

  private cookie(value: string, maxAgeSeconds: number): string {
    return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${this.secure ? '; Secure' : ''}`;
  }

  /** A one-time download link for the export_data tool. The export is built when it's opened. */
  downloadLink(userId: string, format: ExportFormat): string {
    prune(this.downloads, this.now());
    const token = randomBytes(24).toString('base64url');
    this.downloads.set(hash(token), { userId, format, expiresAt: this.now() + DOWNLOAD_MS });
    return `${this.deps.publicUrl}/download/${token}`;
  }

  private session(req: IncomingMessage): { key: string; session: Session } | undefined {
    const raw = cookies(req)[this.cookieName];
    if (!raw) return undefined;
    const key = hash(raw);
    const session = this.sessions.get(key);
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return undefined;
    }
    return { key, session };
  }

  private sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin) return origin === new URL(this.deps.publicUrl).origin;
    return req.headers['sec-fetch-site'] === 'same-origin';
  }

  private async home(res: ServerResponse, s: Session): Promise<void> {
    const profile = await this.deps.store.get(s.accountId);
    const clips = this.deps.clips ? (await this.deps.clips.usage(s.accountId)).count : 0;
    const pub = await this.deps.publicProfiles?.get(s.accountId);
    const panels = profile.columns.reduce((n, c) => n + c.panels.length, 0);
    const login = escapeHtml(s.login);
    const labels: Record<ExportFormat, string> = { mcportal: 'Everything (MCPortal export, JSON)', bookmarks: 'Saved items (bookmarks file)', clips: 'Clips (Markdown, .tar.gz)', opml: 'Sources (OPML)' };
    sendHtml(res, 200, page('Your MCPortal account', `
<h1>Your MCPortal account</h1>
<p>Signed in as <b>@${login}</b>${pub ? `. Public profile: <b>@${escapeHtml(pub.handle)}</b>` : '. No public profile'}.</p>
<p class="muted">${panels} panel(s), ${profile.saved.length} saved item(s), ${clips} clip(s).</p>
<h2 style="font-size:16px">Download your data</h2>
<ul>${EXPORT_FORMATS.map((f) => `<li><a href="/account/export/${f}">${labels[f]}</a></li>`).join('')}</ul>
<h2 style="font-size:16px">Delete your account</h2>
<p>This deletes your portal, saved items, clips and public profile, and signs you out everywhere. It can't be undone, so download your data first.</p>
<form method="post" action="/account/delete">
  <input type="hidden" name="csrf" value="${escapeHtml(s.csrf)}">
  <p><label>Type <code>delete @${login}</code> to confirm:<br><input name="confirm" autocomplete="off" style="font:inherit;padding:6px 8px;width:100%;box-sizing:border-box;margin-top:6px"></label></p>
  <p><button class="primary" style="background:#c62828;border-color:#c62828">Delete my account</button></p>
</form>
<form method="post" action="/account/logout"><input type="hidden" name="csrf" value="${escapeHtml(s.csrf)}"><button>Sign out</button></form>`));
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
        sendHtml(res, 410, page('Link expired', '<p>This download link has expired or was already used. Ask for a new export, or download from your <a href="/account">account page</a>.</p>'));
        return true;
      }
      sendFile(res, await buildExport(entry.format, entry.userId, { ...this.deps, publicProfile: await this.deps.publicProfiles?.get(entry.userId) }));
      return true;
    }

    if (route !== '/account' && !route.startsWith('/account/')) return false;

    if (route === '/account/login' && req.method === 'GET') {
      this.deps.oauth.beginPageSignIn(req, res, async (who, out, clearCookie) => {
        if ('error' in who) return sendHtml(out, 400, page('Sign-in failed', `<p>${escapeHtml(who.error)}.</p><p><a href="/account">Try again</a></p>`), clearCookie);
        const account = await this.deps.accounts.forIdentity(who);
        if (!account) return sendHtml(out, 404, page('No account', `<p>@${escapeHtml(who.login)} has no account on this MCPortal server, so there's nothing stored for it.</p>`), clearCookie);
        prune(this.sessions, this.now());
        const raw = randomBytes(32).toString('base64url');
        this.sessions.set(hash(raw), { accountId: account.id, login: who.login, csrf: randomBytes(24).toString('base64url'), expiresAt: this.now() + SESSION_MS });
        out.writeHead(302, { location: '/account', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'set-cookie': [clearCookie['set-cookie']!, this.cookie(raw, SESSION_MS / 1000)] });
        out.end();
      });
      return true;
    }

    const current = this.session(req);
    if (route === '/account' && req.method === 'GET') {
      if (!current) {
        sendHtml(res, 200, page('Your MCPortal account', '<h1>Your MCPortal account</h1><p>Download your data or delete your account.</p><p><a href="/account/login"><button class="primary">Sign in with GitHub</button></a></p>'));
      } else await this.home(res, current.session);
      return true;
    }
    if (!current) {
      redirect(res, '/account');
      return true;
    }

    const format = route.match(/^\/account\/export\/([a-z]+)$/)?.[1] as ExportFormat | undefined;
    if (format && req.method === 'GET') {
      if (!EXPORT_FORMATS.includes(format)) return sendHtml(res, 404, page('Not found', '<p>No such export.</p>')), true;
      sendFile(res, await buildExport(format, current.session.accountId, { ...this.deps, publicProfile: await this.deps.publicProfiles?.get(current.session.accountId) }));
      return true;
    }

    if ((route === '/account/delete' || route === '/account/logout') && req.method === 'POST') {
      let form: URLSearchParams;
      try {
        form = await readForm(req);
      } catch {
        return sendHtml(res, 400, page('Bad request', '<p>Try again from the <a href="/account">account page</a>.</p>')), true;
      }
      if (!this.sameOrigin(req) || !safeEqual(form.get('csrf') ?? '', current.session.csrf)) {
        return sendHtml(res, 403, page('Refused', '<p>That request didn\'t come from your account page. <a href="/account">Go back</a>.</p>')), true;
      }
      if (route === '/account/logout') {
        this.sessions.delete(current.key);
        redirect(res, '/account', { 'set-cookie': this.cookie('', 0) });
        return true;
      }
      const expected = `delete @${current.session.login}`.toLowerCase();
      if ((form.get('confirm') ?? '').trim().toLowerCase() !== expected) {
        return sendHtml(res, 400, page('Not deleted', `<p>Nothing was deleted: type <code>${escapeHtml(expected)}</code> exactly to confirm. <a href="/account">Go back</a>.</p>`)), true;
      }
      const { accountId } = current.session;
      const done = await deleteAccountData(accountId, this.deps);
      for (const [k, s] of this.sessions) if (s.accountId === accountId) this.sessions.delete(k);
      for (const [k, d] of this.downloads) if (d.userId === accountId) this.downloads.delete(k);
      this.deps.log?.(`account deleted (${done.clips} clips, ${done.tokens} token records)`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': this.cookie('', 0), 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(page('Account deleted', '<h1>Your account is deleted</h1><p>Your portal, saved items, clips and public profile are gone, and you\'re signed out everywhere. Remove MCPortal from your Claude connectors too.</p>'));
      return true;
    }

    sendHtml(res, 404, page('Not found', '<p><a href="/account">Your account</a></p>'));
    return true;
  }
}
