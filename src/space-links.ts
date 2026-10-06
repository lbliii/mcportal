/**
 * Space links (docs/plans/finding-people.md, phase 2): a person's Space at /@handle,
 * as a bridge into the agent, where the room lives. Not MCP, and no script.
 *
 *   GET /@<handle>          who it is (the handle only, until you sign in) and how to get there
 *   GET /@<handle>/signin   sign in with GitHub (browser-bound), then back to /@<handle>
 *
 * Signing in here remembers that you came through the link, so your agent offers to follow
 * them the next time it opens your room; when the link brought a brand-new account, its
 * owner hears so once (Social.introduce). Being signed in to the account page counts too.
 * A handle that doesn't exist, is suspended, or blocks you looks the same: nobody here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts } from './accounts.ts';
import type { OAuthServer } from './auth/oauth.ts';
import { isAppError } from './lib/errors.ts';
import type { Logger } from './lib/log.ts';
import { escapeHtml, redirect, sendHtml } from './lib/web.ts';
import { page } from './page.ts';
import type { PageSessions } from './page-sessions.ts';
import type { PublicProfiles } from './public-profiles.ts';
import type { Social } from './social.ts';

const ROUTE = /^\/@([a-z0-9_]{2,30})(\/signin)?$/;
const HEADERS = { 'x-robots-tag': 'noindex, nofollow' };

export interface SpaceLinkDeps {
  accounts: Accounts;
  oauth: OAuthServer;
  publicProfiles: PublicProfiles;
  social: Social;
  /** The account page's sessions: one sign-in serves both. */
  sessions: PageSessions;
  publicUrl: string;
  log?: Logger | undefined;
}

export class SpaceLinks {
  private deps: SpaceLinkDeps;

  constructor(deps: SpaceLinkDeps) {
    this.deps = deps;
  }

  /** Returns true if it handled the request. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method !== 'GET') return false;
    let path: string;
    try { path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase(); } catch { return false; }
    const match = ROUTE.exec(path);
    if (!match) return false;
    const handle = match[1]!;
    const owner = await this.deps.publicProfiles.byHandle(handle);
    if (!owner || this.deps.accounts.actor(owner.profile.accountId).status !== 'active') return this.nobody(res, handle), true;

    if (match[2]) {
      this.deps.oauth.beginPageSignIn(req, res, async (who, out, clearCookie) => {
        if ('error' in who) return sendHtml(out, 400, page('Sign-in failed', `<p>${escapeHtml(who.error)}.</p><p><a class="button primary" href="/@${handle}/signin">Try again</a></p>`, { door: 'shut', kicker: 'Signal lost' }), { ...clearCookie, ...HEADERS });
        const existed = Boolean(await this.deps.accounts.forIdentity(who));
        const admission = await this.deps.accounts.admit(who);
        if (!admission.ok) {
          const why = admission.reason === 'suspended' ? 'This GitHub account is suspended on MCPortal.' : 'MCPortal is invite-only for now, and this GitHub account isn\'t on the list yet. Ask the person who sent you this link for an invite.';
          return sendHtml(out, 403, page('Not yet', `<p>${why}</p>`, { door: 'shut' }), { ...clearCookie, ...HEADERS });
        }
        await this.introduce(admission.account.id, handle, !existed);
        redirect(out, `/@${handle}`, { 'set-cookie': [clearCookie['set-cookie']!, this.deps.sessions.start(admission.account.id, who.login)] });
      });
      return true;
    }

    const current = this.deps.sessions.current(req);
    const viewer = current?.session.accountId;
    const outcome = viewer ? await this.introduce(viewer, handle, false) : undefined;
    if (outcome === 'hidden') return this.nobody(res, handle), true;
    const at = `@${escapeHtml(owner.profile.handle)}`;
    const mcp = escapeHtml(`${this.deps.publicUrl}/mcp`);
    const ask = `<p>Ask your agent:</p><p><code>open ${at}'s space</code></p>`;
    const connect = `<ol>
  <li>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>
  <li>Name it <b>MCPortal</b> and use this URL:<br><code>${mcp}</code></li>
  <li>Click <b>Connect</b> and sign in with GitHub.</li>
  <li>In a new chat, ask: <i>“open my portal”</i>.</li>
</ol>`;
    let body: string;
    if (!viewer) {
      body = `<h1>${at} is on MCPortal</h1>
<p>MCPortal is your liminal webspace: a reading portal that lives in your agent, with the sites, channels and feeds you follow one door away, and the people you follow beside them.</p>
<h2>Already use MCPortal?</h2>${ask}
<h2>New here?</h2>
<p><a class="button primary" href="/@${escapeHtml(owner.profile.handle)}/signin">Sign in with GitHub</a></p>
<p>Then add MCPortal to your agent, and the first time you open your room, it offers to follow ${at}.</p>
<p class="muted">MCPortal only learns your GitHub user ID and login. ${at}'s posts and profile are for people signed in to MCPortal.</p>`;
    } else if (outcome === 'self') {
      body = `<h1>This is your Space link</h1>
<p>Share it with friends. People who sign in through it are offered a follow of you, and if it brings someone new to MCPortal, your room tells you once they've claimed a handle.</p>`;
    } else {
      const done = outcome === 'following' ? `<p>You already follow ${at}.</p>` : `<p>The next time your agent opens your room, it offers to follow ${at}. Or go now:</p>`;
      body = `<h1>${at} is on MCPortal</h1>${done}${ask}
<h2>Haven't added MCPortal to your agent yet?</h2>${connect}`;
    }
    sendHtml(res, 200, page(`@${owner.profile.handle}`, body, { door: 'open', kicker: viewer ? 'Signed in' : 'A door has opened!' }), HEADERS);
    return true;
  }

  /** Remember the visit; a block or a suspension in between reads as nobody here. */
  private async introduce(viewer: string, handle: string, newAccount: boolean): Promise<'self' | 'following' | 'offered' | 'hidden'> {
    try {
      const outcome = await this.deps.social.introduce(viewer, handle, newAccount);
      if (outcome === 'offered') this.deps.log?.info('social.space_link_intro', { newAccount });
      return outcome;
    } catch (error) {
      if (isAppError(error) && error.code === 'not_found') return 'hidden';
      throw error;
    }
  }

  private nobody(res: ServerResponse, handle: string): void {
    sendHtml(res, 404, page('Nobody here', `<h1>Nobody here by that name</h1><p>There's no MCPortal Space at @${escapeHtml(handle)}. Check the link with the person who sent it.</p>`, { door: 'shut', kicker: 'This door has closed' }), HEADERS);
  }
}
