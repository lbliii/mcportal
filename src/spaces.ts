/** Script-free public Space pages and feeds use the room's format and art engine. */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { escapeHtml } from './lib/web.ts';
import { page } from './page.ts';
import type { ToolResults } from './tools/results.ts';
import type { Cover } from './space-design.ts';
import type { SharedItem } from './social.ts';
const scripts = ['space-inks.js', 'art.js', 'space-format.js'].map((f) => readFileSync(new URL(`./ui/${f}`, import.meta.url), 'utf8')).join('\n');
const renderer = runInNewContext(`${scripts}; spaceFormat`, { URL }, { timeout: 1000 }) as { render: (space: ToolResults['open_space']['space'], options: { public: boolean }) => string };
const css = readFileSync(new URL('./ui/space.css', import.meta.url), 'utf8');
const artCss = '.art{--mp-art-paper:var(--mp-art-ink-p);--mp-art-ink:var(--mp-art-ink-c)}.art .ap{fill:var(--mp-art-paper)}.art .aa{fill:var(--mp-art-ink-a)}.art .ab{fill:var(--mp-art-ink-b)}.art .ac{fill:var(--mp-art-ink)}.art .ax{fill:var(--mp-art-ink-x)}.art .sb{stroke:var(--mp-art-ink-b)}.art .sc{stroke:var(--mp-art-ink)}@media(prefers-color-scheme:dark){.art{--mp-art-paper:var(--mp-art-ink-c);--mp-art-ink:var(--mp-art-ink-p)}}';
export function spacePreview(cover: Cover | undefined): string {
  return `/site/space-${cover?.ink ?? 'atomic'}-${cover?.motif ?? 'arches'}.png`;
}
export function previewMeta(handle: string, cover: Cover | undefined, origin: string, title?: string): string {
  return `<meta property="og:type" content="profile"><meta property="og:title" content="${escapeHtml(title || `@${handle}`)}"><meta property="og:image" content="${escapeHtml(new URL(spacePreview(cover), origin).href)}"><meta property="og:url" content="${escapeHtml(new URL(`/@${handle}`, origin).href)}"><meta name="twitter:card" content="summary_large_image">`;
}
export function publicSpacePage(space: ToolResults['open_space']['space'], origin: string): string {
  return page(space.spaceTitle || `@${space.handle}`, renderer.render(space, { public: true }), {
    wide: true,
    head: `${previewMeta(space.handle, space.cover, origin, space.spaceTitle || space.displayName)}<link rel="alternate" type="application/rss+xml" title="@${escapeHtml(space.handle)}" href="/@${escapeHtml(space.handle)}/feed">`,
    style: `${artCss}\n${css}\n.web-main.wide{max-width:1180px}.card{padding:0;box-shadow:none;border:0;background:none}.card::before{display:none}.card .space-sheet h1{margin-bottom:12px}.card .space-sheet .space-head{padding:22px 26px}`,
  });
}
function safeUrl(value: string | undefined): string | undefined {
  try { const u = new URL(value ?? ''); return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined; } catch { return undefined; }
}
/** Feed text follows exactly the public page's clip and original visibility rules. */
function feedPost(post: SharedItem, spaceLink: string): string {
  const original = post.original && 'author' in post.original ? post.original : undefined;
  const tombstone = Boolean(post.reblogOf && !original);
  const title = tombstone ? 'A post for MCPortal members' : original?.title || post.title;
  const clip = original?.clip || post.clip;
  const content = [
    post.reblogOf ? (original ? `Reblogged @${original.author.handle}` : 'A post for MCPortal members. Sign in to see it.') : '',
    !tombstone && original?.note ? original.note : '',
    !tombstone && clip?.data.kind === 'quote' ? clip.data.text.slice(0, 400) : (!tombstone && clip ? 'Sign in to see this clip.' : ''),
    post.note || '',
  ].filter(Boolean).join('\n\n');
  const link = tombstone ? `${spaceLink}/signin` : safeUrl(original?.url || post.url) || spaceLink;
  return `<item><guid isPermaLink="false">${escapeHtml(`${spaceLink}#${post.id}`)}</guid><title>${escapeHtml(title)}</title><link>${escapeHtml(link)}</link><pubDate>${new Date(post.createdAt).toUTCString()}</pubDate><description>${escapeHtml(content)}</description></item>`;
}
export function publicSpaceFeed(space: ToolResults['open_space']['space'], origin: string): string {
  const link = new URL(`/@${space.handle}`, origin).href;
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeHtml(space.spaceTitle || `@${space.handle}`)}</title><link>${escapeHtml(link)}</link><description>${escapeHtml(space.bio || `Posts from @${space.handle}`)}</description>${space.posts.slice(0, 50).map((post) => feedPost(post, link)).join('')}</channel></rss>`;
}
