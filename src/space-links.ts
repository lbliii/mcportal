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
import { createHash } from 'node:crypto';
import { RateLimiter } from './lib/rate-limit.ts';
import { publicSpacePage, publicSpaceFeed, previewMeta } from './spaces.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts } from './accounts.ts';
import type { OAuthServer } from './auth/oauth.ts';
import { isAppError } from './lib/errors.ts';
import type { Logger } from './lib/log.ts';
import { escapeHtml, PAGE_CSP, redirect, sendHtml } from './lib/web.ts';
import { page } from './page.ts';
import type { PageSessions } from './page-sessions.ts';
import type { PublicProfiles } from './public-profiles.ts';
import type { Social } from './social.ts';
import type { SourceDeps } from './sources.ts';
import { thumbnail } from './thumbnails.ts';

const ROUTE = /^\/@([a-z0-9_]{2,30})(\/(?:signin|feed|image\/[a-z0-9_-]{1,80}))?$/;
const HEADERS = { 'x-robots-tag': 'noindex, nofollow' };

export interface SpaceLinkDeps {
  accounts: Accounts;
  oauth: OAuthServer;
  publicProfiles: PublicProfiles;
  social: Social;
  images?: SourceDeps | undefined;
  /** The account page's sessions: one sign-in serves both. */
  sessions: PageSessions;
  publicUrl: string;
  log?: Logger | undefined;
  trustProxy?: boolean | undefined;
  now?: (() => number) | undefined;
}

export class SpaceLinks {
  private deps: SpaceLinkDeps;
  private limits: RateLimiter;
  private cache = new Map<string, { signature: string; at: number; page: string; feed: string }>();

  constructor(deps: SpaceLinkDeps) {
    this.deps = deps;
    this.limits = new RateLimiter(120, 60_000, deps.now);
  }

  /** Returns true if it handled the request. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let path: string;
    try { path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase(); } catch { return false; }
    const match = ROUTE.exec(path);
    if (!match) return false;
    const handle = match[1]!;
    const hops = this.deps.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
    const ip = hops.at(-1) || req.socket.remoteAddress || 'unknown';
    if (!this.limits.take(ip)) { sendHtml(res, 429, page('Slow down', '<p>Try again in a minute.</p>'), { ...HEADERS, 'retry-after': '60' }); return true; }
    const owner = await this.deps.publicProfiles.byHandle(handle);
    if (!owner || this.deps.accounts.actor(owner.profile.accountId).status !== 'active') return this.nobody(res, handle), true;

    if (match[2] === '/signin') {
      if (req.method !== 'GET') { this.nobody(res, handle); return true; }
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
    if (match[2]?.startsWith('/image/')) {
      const post = !owner.profile.private ? await this.deps.social.get('', match[2].slice('/image/'.length)) : undefined;
      const preview = post?.reblogOf ? (post.original && 'author' in post.original ? post.original : undefined) : post;
      // Only a currently public post in this Space can supply an image; reblogs resolve
      // their original live, so deletion, hiding, privacy and detachment revoke it too.
      const image = post?.author.handle === owner.profile.handle ? preview?.image : undefined;
      const data = image && this.deps.images ? await thumbnail(image.url, this.deps.images) : null;
      if (!data) { this.nobody(res, handle); return true; }
      const comma = data.indexOf(',');
      const bytes = Buffer.from(data.slice(comma + 1), 'base64');
      res.writeHead(200, { ...HEADERS, 'content-type': data.slice(5, data.indexOf(';')), 'content-length': String(bytes.length), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
      res.end(req.method === 'HEAD' ? undefined : bytes);
      return true;
    }
    if (!owner.profile.private) {
      const profile = owner.profile;
      // Check visibility anew before using any cached HTML: a hide, deletion, block or
      // private switch takes effect on this request, including another writer's changes.
      const [posts, details] = await Promise.all([
        this.deps.social.sharesOf('', profile.accountId, { limit: 50 }),
        this.deps.social.spaceDetails('', profile.accountId),
      ]);
      const { accountId: _id, travelers: _travelers, broughtAboard: _brought, ...pub } = profile;
      const space = { ...pub, ...details, mine: false, followers: 0, following: false, posts, sources: profile.sources ?? [], link: new URL(`/@${profile.handle}`, this.deps.publicUrl).href };
      const signature = createHash('sha256').update(JSON.stringify(space)).digest('hex');
      const now = (this.deps.now ?? Date.now)();
      let cached = this.cache.get(handle);
      if (!cached || cached.signature !== signature || now - cached.at > 60_000) {
        cached = { signature, at: now, page: publicSpacePage(space, this.deps.publicUrl), feed: publicSpaceFeed(space, this.deps.publicUrl) };
        if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(handle, cached);
      }
      if (match[2] === '/feed') {
        res.writeHead(200, { ...HEADERS, 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : cached.feed);
      } else {
        sendHtml(res, 200, req.method === 'HEAD' ? '' : cached.page, { ...HEADERS, 'content-security-policy': PAGE_CSP.replace('img-src data:', "img-src 'self' data:") });
      }
      return true;
    }
    this.cache.delete(handle);
    if (match[2] === '/feed') { this.nobody(res, handle); return true; }
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
    sendHtml(res, 200, page(`@${owner.profile.handle}`, body, { door: 'open', kicker: viewer ? 'Signed in' : 'A door has opened!', head: previewMeta(owner.profile.handle, owner.profile.cover, this.deps.publicUrl) }), HEADERS);
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
