import { DESIGN_CSS, PRIMITIVES_CSS } from './design/generated.ts';
/**
 * The admin page (identity plan, phase 2): invites, suspensions and the audit
 * log in a browser. Deliberately not MCP: nothing a model reads can reach it.
 *
 *   GET  /admin              the page (or a sign-in prompt)
 *   GET  /admin/login        sign in with GitHub (browser-bound; admins only)
 *   POST /admin/logout
 *   GET  /admin/api/state    accounts, invites, audit log, reports, usage, CSRF token
 *   POST /admin/api/{invite,uninvite,suspend,reinstate}
 *   POST /admin/api/report          { id, action: hide | dismiss }: resolve a report
 *   POST /admin/api/unhide          { id }: show a hidden share again
 *   GET  /join/<code>        public: how an invited person connects (no script)
 *
 * Sessions live in memory (sign in again after a deploy), in an HttpOnly,
 * SameSite=Lax cookie. Every change needs the session, a same-origin request and
 * the CSRF token, and re-checks that the admin is still an active admin.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Accounts } from './accounts.ts';
import type { PublicProfiles } from './public-profiles.ts';
import type { Social } from './social.ts';
import type { OAuthServer } from './auth/oauth.ts';
import type { UsageBudget } from './lib/budget.ts';
import type { ToolMetrics } from './lib/metrics.ts';
import { httpStatus, isAppError, type ErrorCode } from './lib/errors.ts';
import { escapeHtml, readJson, redirect, sameOrigin, sendHtml, sendJson, sendJsonError } from './lib/web.ts';
import { page } from './page.ts';
import { PageSessions, type PageSession } from './page-sessions.ts';

const SESSION_MS = 8 * 3600 * 1000;
const MAX_SESSIONS = 200;
const MAX_BODY = 4096;
/** An API error: { error: code, error_description: message }, with the code's HTTP status. */
function fail(res: ServerResponse, code: ErrorCode, message: string): void {
  sendJsonError(res, httpStatus(code), code, message);
}

const ADMIN_HTML = fileURLToPath(new URL('./ui/admin.html', import.meta.url));


export class AdminPanel {
  private sessions: PageSessions;
  private accounts: Accounts;
  private oauth: OAuthServer;
  private publicUrl: string;
  private social: Social | undefined;
  private profiles: PublicProfiles | undefined;
  private budget: UsageBudget | undefined;
  private metrics: ToolMetrics | undefined;

  constructor(accounts: Accounts, oauth: OAuthServer, publicUrl: string, now: () => number = Date.now, options: { social?: Social | undefined; profiles?: PublicProfiles | undefined; budget?: UsageBudget | undefined; metrics?: ToolMetrics | undefined } = {}) {
    this.accounts = accounts;
    this.oauth = oauth;
    this.publicUrl = publicUrl;
    this.social = options.social;
    this.profiles = options.profiles;
    this.budget = options.budget;
    this.metrics = options.metrics;
    this.sessions = new PageSessions('admin', { publicUrl, ttlMs: SESSION_MS, max: MAX_SESSIONS, now });
  }

  /** Usage on this instance: the budget (heaviest accounts today, by login) and per-tool counters. */
  private usageView(): unknown {
    const budget = this.budget?.snapshot();
    return {
      budget: budget && { ...budget, today: budget.today.map((u) => ({ ...u, login: this.accounts.actor(u.userId).login ?? null })) },
      tools: this.metrics?.snapshot(),
    };
  }

  /** Open reports and the last few resolved ones, with what they're about. */
  private async reportsView(): Promise<unknown[]> {
    if (!this.social) return [];
    const reports = [...(await this.social.reports('open')), ...(await this.social.reports('resolved')).slice(0, 20)];
    const who = async (accountId: string) => ({ accountId, login: this.accounts.actor(accountId).login ?? null, handle: (await this.profiles?.get(accountId))?.handle ?? null });
    return Promise.all(reports.map(async (r) => {
      const share = r.targetKind === 'share' ? await this.social!.getShareForAdmin(r.targetId) : undefined;
      const targetAccount = share?.accountId ?? (r.targetKind === 'profile' ? r.targetId : undefined);
      return {
        ...r,
        reporter: r.reporterId === 'deleted' ? { accountId: 'deleted', login: null, handle: null } : await who(r.reporterId),
        target: {
          kind: r.targetKind,
          id: r.targetId,
          exists: r.targetKind === 'profile' || Boolean(share),
          account: targetAccount ? await who(targetAccount) : null,
          ...(share ? { title: share.title, note: share.note ?? '', url: share.url ?? '', hidden: Boolean(share.hiddenAt), kind: share.kind } : {}),
        },
      };
    }));
  }

  /** The current admin, re-checked against accounts on every request. */
  private session(req: IncomingMessage): { key: string; session: PageSession } | undefined {
    const current = this.sessions.current(req);
    if (!current) return undefined;
    const actor = this.accounts.actor(current.session.accountId);
    if (actor.role !== 'admin' || actor.status !== 'active') {
      this.sessions.end(current.key);
      return undefined;
    }
    return current;
  }

  /** A change needs a same-origin request and the session's CSRF token: why not, if it's refused. */
  private refusal(req: IncomingMessage, session: PageSession): string | undefined {
    if (!sameOrigin(req, this.publicUrl)) return 'Cross-site request refused';
    if (!this.sessions.csrfMatches(session, String(req.headers['x-csrf'] ?? ''))) return 'Missing or stale CSRF token; reload the page';
    return undefined;
  }

  /** The /join/<code> page: who invited them and the steps to connect. */
  private async join(res: ServerResponse, code: string): Promise<void> {
    const headers = { 'x-robots-tag': 'noindex, nofollow' };
    const invite = await this.accounts.findInvite(code);
    if (!invite) {
      return sendHtml(res, 404, page('Invite not valid', '<h1>This invite link isn\'t valid anymore</h1><p>It may have been revoked. Ask the person who invited you for a new one.</p>'), headers);
    }
    const login = escapeHtml(invite.login);
    if (invite.acceptedAt) {
      return sendHtml(res, 200, page('Already in', `<h1>@${login} is already in</h1><p>MCPortal is connected to that account. In Claude, ask <i>“open my room”</i>.</p>`), headers);
    }
    const inviter = invite.invitedBy.startsWith('admin:') ? `@${escapeHtml(invite.invitedBy.slice(6))}` : 'The admin';
    const mcp = escapeHtml(`${this.publicUrl}/mcp`);
    sendHtml(res, 200, page('You\'re invited to MCPortal', `
<h1>You're invited to MCPortal</h1>
<p>${inviter} invited <b>@${login}</b> to MCPortal, your liminal webspace: a reading portal that lives in your agent, with the sites, channels and feeds you follow one door away.</p>
<ol>
  <li>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>
  <li>Name it <b>MCPortal</b> and use this URL:<br><code>${mcp}</code></li>
  <li>Click <b>Connect</b> and sign in with GitHub as <b>@${login}</b>.</li>
  <li>In a new chat, ask: <i>“open my portal”</i>.</li>
</ol>
<p class="muted">The invite is for @${login}, so signing in with another GitHub account won't work. If your organization's Claude doesn't allow custom connectors, hosted MCPortal isn't available to you yet.</p>`), headers);
  }

  /** Returns true if it handled the request. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const joinCode = route.match(/^\/join\/([^/]+)$/)?.[1];
    if (joinCode !== undefined && req.method === 'GET') {
      await this.join(res, decodeURIComponent(joinCode));
      return true;
    }
    if (route !== '/admin' && !route.startsWith('/admin/')) return false;

    if (route === '/admin/login' && req.method === 'GET') {
      this.oauth.beginPageSignIn(req, res, async (who, out, clearCookie) => {
        if ('error' in who) return sendHtml(out, 400, page('Sign-in failed', `<p>${escapeHtml(who.error)}.</p><p><a href="/admin">Try again</a></p>`), clearCookie);
        const admission = await this.accounts.admit(who);
        const actor = admission.ok ? this.accounts.actor(admission.account.id) : undefined;
        if (!admission.ok || !actor || actor.role !== 'admin' || actor.status !== 'active') {
          return sendHtml(out, 403, page('Admins only', `<p>@${escapeHtml(who.login)} isn't an admin of this MCPortal server.</p>`), clearCookie);
        }
        redirect(out, '/admin', { 'set-cookie': [clearCookie['set-cookie']!, this.sessions.start(admission.account.id, who.login)] });
      });
      return true;
    }

    const current = this.session(req);

    if (route === '/admin' && req.method === 'GET') {
      if (!current) {
        sendHtml(res, 200, page('MCPortal admin', '<h1>MCPortal admin</h1><p>Invites, suspensions and the audit log.</p><p><a href="/admin/login"><button class="primary">Sign in with GitHub</button></a></p><p class="muted">Admins only.</p>'));
        return true;
      }
      const nonce = randomBytes(16).toString('base64');
      const html = (await readFile(ADMIN_HTML, 'utf8')).replace('/*MCPORTAL_DESIGN*/', DESIGN_CSS + PRIMITIVES_CSS).replaceAll('__NONCE__', nonce);
      sendHtml(res, 200, html, {
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      });
      return true;
    }

    if (!current) {
      fail(res, 'unauthenticated', 'Sign in at /admin');
      return true;
    }

    if (route === '/admin/logout' && req.method === 'POST') {
      if (!sameOrigin(req, this.publicUrl)) return fail(res, 'forbidden', 'Cross-site request refused'), true;
      this.sessions.end(current.key);
      redirect(res, '/admin', { 'set-cookie': this.sessions.cookie('', 0) });
      return true;
    }

    if (route === '/admin/api/state' && req.method === 'GET') {
      await this.accounts.load(true);
      const { accounts, invites } = await this.accounts.list();
      sendJson(res, 200, { me: { login: current.session.login, accountId: current.session.accountId }, csrf: current.session.csrf, accounts, invites, audit: await this.accounts.auditLog(100), reports: await this.reportsView(), usage: this.usageView() });
      return true;
    }

    const moderation = route.match(/^\/admin\/api\/(report|unhide)$/)?.[1];
    if (moderation && req.method === 'POST') {
      const refused = this.refusal(req, current.session);
      if (refused) return fail(res, 'forbidden', refused), true;
      if (!this.social) return fail(res, 'not_found', 'Sharing is not enabled on this server'), true;
      let body: Record<string, unknown>;
      try {
        body = await readJson(req, MAX_BODY);
      } catch {
        return fail(res, 'invalid_argument', 'Send a small JSON body'), true;
      }
      const id = String(body.id ?? '');
      const by = `admin:${current.session.login}`;
      if (moderation === 'unhide') {
        if (!(await this.social.hideShare(id, false))) return fail(res, 'not_found', 'No such share'), true;
        await this.accounts.record(by, 'share.unhidden', id);
      } else {
        const report = (await this.social.reports()).find((r) => r.id === id);
        if (!report) return fail(res, 'not_found', 'No such report'), true;
        if (body.action === 'hide') {
          if (report.targetKind !== 'share' || !(await this.social.hideShare(report.targetId, true))) return fail(res, 'invalid_argument', 'That report is not about a share that still exists'), true;
          await this.social.resolveReport(id, by, 'share hidden');
          await this.accounts.record(by, 'share.hidden', report.targetId, `report ${id}`);
        } else if (body.action === 'dismiss') {
          await this.social.resolveReport(id, by, 'dismissed');
          await this.accounts.record(by, 'report.dismissed', id);
        } else return fail(res, 'invalid_argument', 'action must be hide or dismiss'), true;
      }
      const { accounts, invites } = await this.accounts.list();
      sendJson(res, 200, { ok: true, accounts, invites, audit: await this.accounts.auditLog(100), reports: await this.reportsView() });
      return true;
    }

    const action = route.match(/^\/admin\/api\/(invite|uninvite|suspend|reinstate)$/)?.[1];
    if (action && req.method === 'POST') {
      const refused = this.refusal(req, current.session);
      if (refused) return fail(res, 'forbidden', refused), true;
      let body: Record<string, unknown>;
      try {
        body = await readJson(req, MAX_BODY);
      } catch {
        return fail(res, 'invalid_argument', 'Send a small JSON body'), true;
      }
      const who = String(body.who ?? '').trim();
      if (!who) return fail(res, 'invalid_argument', 'Say who'), true;
      const by = `admin:${current.session.login}`;
      try {
        if (action === 'invite') await this.accounts.invite(who, by);
        else if (action === 'uninvite') await this.accounts.uninvite(who, by);
        else {
          const self = [current.session.accountId, current.session.login.toLowerCase()].includes(who.toLowerCase().replace(/^@/, ''));
          if (self && action === 'suspend') return fail(res, 'invalid_argument', "You can't suspend yourself"), true;
          await this.accounts.setStatus(who, action === 'suspend' ? 'suspended' : 'active', by, String(body.reason ?? ''));
        }
      } catch (error) {
        if (!isAppError(error) || error.code === 'internal') throw error;
        return fail(res, error.code, error.message), true;
      }
      const { accounts, invites } = await this.accounts.list();
      sendJson(res, 200, { ok: true, accounts, invites, audit: await this.accounts.auditLog(100), reports: await this.reportsView() });
      return true;
    }

    fail(res, 'not_found', 'Not found');
    return true;
  }
}
