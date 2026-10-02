/**
 * The house style every page the server renders shares: the landing page and its policy
 * pages (src/site.ts), and the small pages for sign-in, the account, invites and links
 * (src/page.ts). A mid-century paperback: a night-sky band on top (dark in both schemes),
 * cream paper below (ink in dark mode), Jost for headings, halftone rules, and boxes
 * printed with an off-register block of colour behind them. Colours are brand/README.md's.
 */
import { DESIGN_CSS, PRIMITIVES_CSS } from './design/generated.ts';
import { escapeHtml } from './lib/web.ts';

export const TAGLINE = 'Your liminal webspace.';

/** The base: tokens, type, the night band and its nav, buttons, cards, numbered steps and the footer. */
export const HOUSE_CSS = `
@font-face{font-family:"MCPortal Jost";src:url(/site/jost-bold.ttf) format("truetype");font-weight:700;font-display:swap}
${DESIGN_CSS}
:root,:root[data-theme],:root:not([data-theme]){--mp-surface-canvas:var(--mp-web-canvas);--mp-surface-card:var(--mp-web-card);--mp-text-primary:var(--mp-web-text);--mp-text-secondary:var(--mp-web-secondary);--mp-text-link:var(--mp-web-link)}
*{box-sizing:border-box}
body{margin:0;background:var(--mp-surface-canvas);color:var(--mp-text-primary);font:1.0625rem/var(--mp-reader-line) var(--mp-font-ui)}
a{color:var(--mp-text-link)}
h1,h2,h3,.jost{font-family:var(--mp-font-heading);font-weight:700;letter-spacing:-.005em}
h1{font-size:clamp(36px,5.2vw,54px);line-height:1.05;margin:0 0 16px}
h2{font-size:30px;line-height:1.15;margin:64px 0 14px}
h2::before{content:"";display:block;width:104px;height:10px;margin-bottom:20px;background:radial-gradient(circle,var(--mp-brand-teal) 1.5px,transparent 1.9px) 0 0/8px 8px}
h3{font-size:var(--mp-type-19);margin:28px 0 4px}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.sky{background:var(--mp-web-night);color:var(--mp-brand-paper);position:relative;overflow:hidden}
.sky a{color:var(--mp-brand-mustard)}
nav{position:relative;z-index:1;display:flex;align-items:center;gap:22px;padding-top:22px;padding-bottom:22px;font-size:var(--mp-type-15)}
nav a.to{color:#D4C8AF;text-decoration:none}nav a.to:hover{color:var(--mp-brand-paper)}
nav .brand{margin-right:auto;display:flex}@media (max-width:520px){nav{gap:18px}}nav .brand img,nav .brand svg{height:30px;width:auto;display:block}
.sky .button{display:inline-block;background:var(--mp-brand-mustard);color:var(--mp-brand-ink);font-weight:600;text-decoration:none;padding:10px 20px;border-radius:var(--mp-radius-control);box-shadow:4px 4px 0 var(--mp-brand-brick)}
.muted{color:var(--mp-text-secondary);font-size:var(--mp-type-15)}
code{background:var(--mp-surface-inset);padding:1px 6px;border-radius:4px;word-break:break-all;font-size:var(--mp-type-15)}
ol.steps{list-style:none;padding:0;margin:24px 0;counter-reset:step}
ol.steps li{counter-increment:step;position:relative;padding-left:58px;margin:0 0 22px;min-height:40px}
ol.steps li::before{content:counter(step);position:absolute;left:0;top:2px;width:38px;height:38px;border-radius:50%;background:var(--mp-brand-mustard);color:var(--mp-brand-ink);display:flex;align-items:center;justify-content:center;font:700 19px/1 var(--mp-font-heading)}
ol.steps li>b:first-child{font-family:var(--mp-font-heading);font-size:var(--mp-type-19);display:block}
.card{background:var(--mp-surface-card);border:2px solid var(--mp-text-primary);border-radius:var(--mp-radius-lg);padding:20px 24px;margin:28px 0;box-shadow:9px 9px 0 var(--mp-brand-mustard)}
.card p{margin:0}.card p+p{margin-top:10px}
footer{background:var(--mp-web-night);color:#D4C8AF;font-size:var(--mp-type-15)}
footer .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;padding-top:28px;padding-bottom:28px}
footer .tag{margin-right:auto;color:var(--mp-brand-paper);font-size:17px}
footer a{color:var(--mp-brand-paper)}
${PRIMITIVES_CSS}
body{background:var(--mp-web-canvas);color:var(--mp-web-text);line-height:var(--mp-reader-line)}
`;

/** The nav in the night band: the brand (an <img> or inline SVG) linking home, then the pages. `base` makes the links absolute. */
export function houseNav(brand: string, base = ''): string {
  return `<nav class="wrap"><a class="brand" href="${escapeHtml(base)}/">${brand}</a><a class="to" href="${escapeHtml(base)}/privacy">Privacy</a><a class="to" href="${escapeHtml(base)}/support">Support</a><a class="to" href="${escapeHtml(base)}/account">Account</a></nav>`;
}

/** The footer: the tagline, then `extra` (already HTML) and the links. */
export function houseFooter(extra = '', base = ''): string {
  const b = escapeHtml(base);
  return `<footer><div class="wrap"><span class="tag jost">${TAGLINE}</span>${extra}<a href="${b}/privacy">Privacy</a><a href="${b}/security">Security</a><a href="${b}/support">Support</a><a href="https://github.com/lbliii/mcportal">Source</a></div></footer>`;
}
