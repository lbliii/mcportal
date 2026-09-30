/**
 * The public pages: the landing page at /, /privacy and /support, and the
 * screenshots they show (/site/*.png). No scripts, no third-party requests.
 *
 * The privacy policy describes what this software stores and sends. It applies to
 * whoever runs the server; MCPORTAL_OPERATOR names them on the pages.
 */
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from './auth/oauth.ts';

export const DEFAULT_SUPPORT_URL = 'https://github.com/lbliii/mcportal/issues';
const POLICY_UPDATED = '2026-09-30';   // bump when what's stored changes
const IMAGES = new Set(['columns.png', 'shelves.png', 'reader.png']);
const IMAGE_DIR = fileURLToPath(new URL('./site/', import.meta.url));

export interface SiteConfig {
  publicUrl: string;
  /** Where people get help: an issues page or a mailto: link. */
  supportUrl: string;
  /** Who runs this server, e.g. "Jane Doe". Optional. */
  operator?: string;
  /** Sign-up is invite-only (admins or an allowlist are set). */
  inviteOnly: boolean;
}

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function layout(title: string, body: string, site: SiteConfig): string {
  const by = site.operator ? `Run by ${escapeHtml(site.operator)}. ` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="MCPortal: a reading portal that lives inside Claude.">
<style>
body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:40px 20px 64px;color:#1b1b1a}
a{color:#1f4fd8}h1{font-size:34px;line-height:1.2;margin:8px 0 12px}h2{font-size:21px;margin-top:40px}h3{font-size:16px;margin:24px 0 4px}
nav{display:flex;gap:18px;font-size:14px}nav a{color:#6a6a66;text-decoration:none}nav .brand{color:#1b1b1a;font-weight:600;margin-right:auto}
.lede{font-size:19px;color:#3a3a37}.muted{color:#6a6a66;font-size:14px}
code{background:#f3f3ef;padding:1px 5px;border-radius:4px;word-break:break-all;font-size:14px}
figure{margin:28px 0}figure img{width:100%;border:1px solid #e3e3de;border-radius:12px}figcaption{color:#6a6a66;font-size:14px;margin-top:6px}
.steps li{margin:6px 0}.card{border:1px solid #e3e3de;border-radius:12px;padding:16px 20px;margin:24px 0}
table{border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #e3e3de;padding:6px 12px 6px 0;text-align:left;vertical-align:top}
footer{margin-top:56px;border-top:1px solid #e3e3de;padding-top:16px}
</style></head><body>
<nav><a class="brand" href="/">MCPortal</a><a href="/privacy">Privacy</a><a href="/support">Support</a><a href="/account">Account</a></nav>
${body}
<footer class="muted">${by}<a href="/privacy">Privacy</a> · <a href="/support">Support</a></footer>
</body></html>`;
}

function landing(site: SiteConfig): string {
  const mcp = escapeHtml(`${site.publicUrl}/mcp`);
  const access = site.inviteOnly
    ? `<p><b>MCPortal is in an invite-only beta.</b> If someone sent you an invite link, open it for your setup steps. To ask for an invite, <a href="${escapeHtml(site.supportUrl)}">get in touch</a>.</p>`
    : '<p>Anyone with a GitHub account can sign in.</p>';
  return layout('MCPortal: a reading portal inside Claude', `
<h1>Your corner of the web, inside Claude.</h1>
<p class="lede">MCPortal is a reading portal that lives in your chat. Ask for the sites, subreddits, YouTube channels, GitHub repos and feeds you follow, and Claude lays them out for you. Then read, save and talk about what you find without leaving the conversation.</p>
<figure><img src="/site/columns.png" alt="An MCPortal workspace in Claude: columns of Hacker News, GitHub releases and blog posts, side by side" width="1600" height="666"><figcaption>Columns: each source scrolls on its own.</figcaption></figure>

<h2>How it works</h2>
<ul class="steps">
  <li><b>Ask for what you read.</b> “Add Simon Willison's blog and r/LocalLLaMA.” Paste a site, a feed, <code>r/subreddit</code>, <code>owner/repo</code>, or a YouTube, Bluesky or Mastodon address. MCPortal finds a feed that works.</li>
  <li><b>Arrange it by talking.</b> “Put GitHub on the left.” “Show pictures.” Starter packs (developer, AI, news, games, art, science, music, film) fill a new portal in seconds, and OPML import brings your subscriptions from another reader.</li>
  <li><b>Read and keep things.</b> Stories open in a clean reader view with no ads. Save the good ones to a Saved panel, and ask Claude about any of them. Say “clip that” to keep a quote, an explanation, a table or a chart from the conversation, and find it again in any later chat.</li>
</ul>
<figure><img src="/site/shelves.png" alt="Picture shelves: one row of thumbnails per source" width="1600" height="626"><figcaption>Shelves: one row of pictures per source.</figcaption></figure>
<figure><img src="/site/reader.png" alt="An article open in MCPortal's reader view" width="1600" height="1013"><figcaption>Reader view: just the article.</figcaption></figure>

<h2>Private by design</h2>
<p>MCPortal fetches feeds and pictures on its server, so the sites you read don't see you until you open the original. There are no ads, trackers or analytics. Sign-in is through GitHub, and MCPortal keeps only your GitHub user ID and login. Your layout, sources, saved items and clips are yours: export them any time in open formats, or delete your account yourself. Details are in the <a href="/privacy">privacy policy</a>.</p>

<h2>Get it</h2>
${access}
<div class="card"><p style="margin:0">In Claude, open <b>Settings → Connectors</b>, add a custom connector with this URL, and sign in with GitHub. Then ask <i>“open my portal”</i>.</p><p style="margin:8px 0 0"><code>${mcp}</code></p></div>
<p class="muted">Prefer to run it yourself? MCPortal also runs locally as a Claude Code plugin with no account. See the <a href="https://github.com/lbliii/mcportal">source</a>.</p>`, site);
}

function privacy(site: SiteConfig): string {
  const who = site.operator ? escapeHtml(site.operator) : 'the person who runs this server';
  const support = escapeHtml(site.supportUrl);
  return layout('MCPortal privacy policy', `
<h1>Privacy policy</h1>
<p class="muted">Last updated ${POLICY_UPDATED}. This policy covers the MCPortal service at <code>${escapeHtml(site.publicUrl)}</code>, which is run by ${who}.</p>

<p>Here's the short version. MCPortal stores your GitHub user ID and login, your portal (layout, sources, saved items and clips), a public profile, shares and follows only if you use them, and short-lived sign-in tokens. It doesn't store your email, your name or your GitHub password. It has no ads, trackers or analytics, and it doesn't sell or share your data.</p>

<h2>What MCPortal stores</h2>
<table>
<tr><th>Data</th><th>Why</th><th>How long</th></tr>
<tr><td><b>Account:</b> your GitHub numeric user ID and login, your role, how you joined (for example, by invite), and dates</td><td>To know who you are and whether you're allowed in</td><td>Until your account is deleted</td></tr>
<tr><td><b>Your portal:</b> its name, layout, the sources you add (feed addresses, subreddits, repos, searches), and settings</td><td>To show you your portal</td><td>Until you change it or your account is deleted</td></tr>
<tr><td><b>Saved items:</b> the link, title, source, date and any note you add</td><td>To show your Saved panel</td><td>Until you remove them</td></tr>
<tr><td><b>Clips:</b> quotes, parts of a conversation, notes, tables, images and links you ask Claude to keep, with any title, note and tags</td><td>To show your Clips panel and find them again in later chats</td><td>Until you delete them</td></tr>
<tr><td><b>Pinned results:</b> if you ask Claude to pin results from another connected tool (for example, a list of issues), the titles, links, short summaries and details it copies in, and the request needed to refresh them</td><td>To show that panel</td><td>Until you remove the panel</td></tr>
<tr><td><b>Public profile (only if you create one):</b> your handle, display name and bio, which other signed-in MCPortal users can see</td><td>So people can find you</td><td>Until you remove it; a handle you give up stays reserved for you for 30 days</td></tr>
<tr><td><b>Shares:</b> links and clips you choose to share, with your note, a copy of what you shared, and who it's for (your followers or everyone on MCPortal)</td><td>To show them to the people you shared them with</td><td>Until you remove them</td></tr>
<tr><td><b>Follows, mutes and blocks:</b> who you follow, mute and block</td><td>To build your Following panel and keep blocked people apart</td><td>Until you change them. People see how many followers you have, never who</td></tr>
<tr><td><b>Reports:</b> what you reported, why, and when</td><td>So admins can act on abuse</td><td>Kept after they're resolved; if you delete your account, your name is removed from them</td></tr>
<tr><td><b>Sign-in tokens:</b> stored only as one-way hashes, with the app that asked for them (for example, Claude)</td><td>To keep you signed in</td><td>Access tokens 1 hour; refresh tokens 30 days</td></tr>
<tr><td><b>Invites and the admin audit log:</b> who invited whom, and suspensions or reinstatements with a short reason</td><td>To run an invite-only service and keep a record of admin actions</td><td>The newest 2,000 log entries are kept</td></tr>
</table>
<p>Usage counters (for rate limits), admin sessions and sign-in attempts in progress are held in memory only and are gone when the server restarts. Your IP address is used for rate limiting in memory and isn't stored.</p>

<h2>Signing in with GitHub</h2>
<p>MCPortal asks GitHub for the <code>read:user</code> scope and reads your user ID and login once, when you sign in. It then discards the GitHub token. It can't see your repositories, email or anything else in your GitHub account.</p>

<h2>What MCPortal sends to other sites</h2>
<p>When your portal loads, MCPortal's server fetches the feeds, articles and thumbnails you asked for. Those sites see the server's address, not yours. Fetched content is cached in the server's memory for between two minutes and one day, and is shared across users because it's the same public content. It isn't written to the database. When you choose to open an original story or its discussion, your browser goes to that site directly, and that site's own privacy policy applies.</p>
<p>When you use MCPortal in Claude, what you see in your portal is also available to Claude, and Anthropic's privacy policy covers your conversations.</p>

<h2>What other people see</h2>
<p>Nothing, unless you choose. With a public profile, signed-in MCPortal users can see your handle, display name, bio, follower count, and the shares you made for them (your followers, or everyone). Shares are never published to the open web. Admins can see reported shares and profiles, and can hide a share or suspend an account.</p>

<h2>Logs</h2>
<p>Server logs record which tool ran, whether it worked, and how long it took. They don't record your user ID, your IP address, what you read or what you asked for. An error message can occasionally include the name of a site that failed to load. Separately, the hosting provider (Railway) keeps request logs, which include IP addresses and the pages requested, for a limited time.</p>

<h2>Cookies</h2>
<p>MCPortal uses cookies only to complete a GitHub sign-in (they last 10 minutes) and to keep admins signed in to the admin page (8 hours). There are no tracking or advertising cookies.</p>

<h2>Where it's stored</h2>
<p>Data is stored in a Postgres database hosted by Railway in the United States, with point-in-time recovery backups. Only the operator can access it.</p>

<h2>Your choices</h2>
<ul>
  <li><b>See and change your data:</b> ask Claude to show your portal settings, change them, or remove saved items at any time.</li>
  <li><b>Take it with you:</b> ask Claude to export your data, or download it from your <a href="/account">account page</a>: everything as one file another MCPortal can import, saved items as a bookmarks file, clips as Markdown, and sources as OPML.</li>
  <li><b>Delete clips, shares or your public profile, or block someone:</b> ask Claude at any time. Removing your public profile hides your shares from everyone.</li>
  <li><b>Delete your account:</b> sign in on your <a href="/account">account page</a> and delete it. Your account, portal, saved items, clips, public profile, shares and follows are deleted at once, and you're signed out everywhere. Backups roll over within 30 days.</li>
  <li><b>Disconnect:</b> remove MCPortal from Claude's connectors. You can also revoke it on GitHub under Settings → Applications.</li>
</ul>

<h2>Children</h2>
<p>MCPortal isn't meant for anyone under 13, or under the minimum age for a GitHub account where you live.</p>

<h2>Changes</h2>
<p>If this policy changes, the date at the top changes too. Changes that affect what's stored or who can see it will be announced on this page before they take effect.</p>

<h2>Contact</h2>
<p>Questions or requests: <a href="${support}">${support}</a>.</p>`, site);
}

function support(site: SiteConfig): string {
  const url = escapeHtml(site.supportUrl);
  return layout('MCPortal support', `
<h1>Support</h1>
<p>Found a bug, need a hand, or want your account deleted? Get in touch at <a href="${url}">${url}</a>. Please don't include tokens or other secrets.</p>

<h2>Common questions</h2>
<h3>How do I open my portal?</h3>
<p>In a chat with MCPortal connected, ask <i>“open my portal”</i>. The first time, pick a few starter packs or tell Claude what you like to read.</p>
<h3>How do I add a site?</h3>
<p>Ask Claude to add it, or use the <b>+</b> button in the portal. Paste a web address, a feed, <code>r/subreddit</code>, <code>owner/repo</code>, or a YouTube, Bluesky or Mastodon address. MCPortal finds a feed that works and shows you a preview.</p>
<h3>A panel says it couldn't load.</h3>
<p>Some sites block requests from cloud servers or stop publishing their feed. Try refreshing the panel. If it keeps failing, ask Claude to find another feed for that site.</p>
<h3>Claude says my organization doesn't allow custom connectors.</h3>
<p>Some work and school accounts block connectors that aren't in Claude's directory. Until MCPortal is listed there, use a personal Claude account, or ask your admin.</p>
<h3>I got “sign-in isn't allowed for this account”.</h3>
<p>MCPortal is invite-only right now. The invite is tied to one GitHub account, so sign in as the account that was invited.</p>
<h3>How do I bring my subscriptions from another reader?</h3>
<p>Export OPML from your old reader and ask Claude to import it. To take your subscriptions elsewhere, ask Claude to export OPML.</p>
<h3>Someone is bothering me.</h3>
<p>Ask Claude to block them: they can't follow you or see your shares, and you won't see theirs. To tell the admins, ask Claude to report the share or the person.</p>
<h3>How do I get my data out?</h3>
<p>Ask Claude to export it, or download it from your <a href="/account">account page</a>. Everything comes as one file another MCPortal can import; saved items also come as a bookmarks file, clips as Markdown and sources as OPML.</p>
<h3>How do I delete my account?</h3>
<p>Sign in on your <a href="/account">account page</a> and delete it there. It happens at once. See the <a href="/privacy">privacy policy</a> for what's deleted.</p>`, site);
}

/** Serves /, /privacy, /support and /site/*.png. Returns true if it handled the request. */
export async function serveSite(res: ServerResponse, pathname: string, site: SiteConfig): Promise<boolean> {
  const pages: Record<string, (s: SiteConfig) => string> = { '/': landing, '/privacy': privacy, '/support': support };
  const render = pages[pathname];
  if (render) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', ...HEADERS });
    res.end(render(site));
    return true;
  }
  const image = pathname.match(/^\/site\/([a-z]+\.png)$/)?.[1];
  if (image && IMAGES.has(image)) {
    const data = await readFile(IMAGE_DIR + image).catch(() => undefined);
    if (!data) return false;
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', ...HEADERS });
    res.end(data);
    return true;
  }
  return false;
}
