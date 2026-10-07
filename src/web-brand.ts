/** Self-contained web identity for hosted pages and the local sign-in listener. */
import { readFileSync } from 'node:fs';
import { escapeHtml } from './lib/web.ts';

// Use the generated outlines: never retype or redraw the wordmark. Embedding the
// assets also works on a one-shot loopback listener with no asset routes.
const lockup = readFileSync(new URL('../brand/lockup-on-dark.svg', import.meta.url), 'utf8').trim();
const icon = readFileSync(new URL('../brand/mark-small.svg', import.meta.url)).toString('base64');
const font = readFileSync(new URL('../brand/fonts/Jost-Bold.ttf', import.meta.url)).toString('base64');
const css = readFileSync(new URL('./ui/web-brand.css', import.meta.url), 'utf8');
const brandSvg = (name: string) => readFileSync(new URL(`../brand/${name}`, import.meta.url), 'utf8').trim();

/** The door plate over a page's card: lit with the moon in it for good news, dark when something failed. Decorative. */
export const DOOR_ART = { open: brandSvg('door-open.svg'), shut: brandSvg('door-shut.svg') };
/** The Portal mark, for the consent screen. Its halftone gets its own id so it can sit beside the lockup's. */
export const WEB_MARK = brandSvg('mark.svg').replaceAll('mcp-ht', 'mcp-ht-mark').replace('<svg ', '<svg class="web-mark" aria-hidden="true" focusable="false" ').replace(' role="img" aria-label="MCPortal"', '');

export const WEB_BRAND_CSS = `@font-face{font-family:"MCPortal Jost";src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:700;font-display:swap}\n${css}`;
export const WEB_BRAND_ICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon}">`;

function base(siteUrl?: string): string {
  if (!siteUrl) return '';
  const url = new URL(siteUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Web page links require an HTTP(S) origin');
  return url.origin;
}

export function webHeader(siteUrl?: string): string {
  return `<header class="web-masthead" data-mcportal-brand><div class="web-wrap"><a class="web-logo" href="${escapeHtml(base(siteUrl) || '/')}" aria-label="MCPortal home">${lockup}</a><span class="web-tagline">Your liminal webspace.</span></div></header>`;
}

export function webFooter(siteUrl?: string): string {
  const origin = escapeHtml(base(siteUrl));
  return `<footer class="web-footer"><div class="web-wrap"><span>A reading portal in your agent.</span><nav aria-label="MCPortal information"><a href="${origin}/support">Help</a><a href="${origin}/privacy">Privacy</a><a href="${origin}/terms">Terms</a><a href="${origin}/security">Security</a></nav></div></footer>`;
}
