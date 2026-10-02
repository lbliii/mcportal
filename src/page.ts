/**
 * The small server-rendered pages: sign-in and consent, the account page, invites,
 * one-time download and upload links, and what they say when something goes wrong.
 * They wear the landing page's house style (src/house.ts): the night band with the
 * lockup, then one card on paper with a door at the top of it, open for a welcome or
 * good news and shut when a link has expired or something failed. No scripts, and the
 * art is inline, so the same page works from the loopback listener of a local sign-in.
 */
import { DOOR_OPEN, DOOR_SHUT, LOCKUP_ON_DARK, MARK } from './brand-art.ts';
import { HOUSE_CSS, houseFooter, houseNav } from './house.ts';
import { escapeHtml } from './lib/web.ts';

export interface PageOptions {
  /** The heading, if it differs from the tab's title. */
  heading?: string;
  /** A short line over the heading. Pulp for good news ("It's alive!"); plain or none for accounts and deletion. */
  kicker?: string;
  /** The door plate: `open` (the default) welcomes, `shut` says something didn't work, `none` leaves it off. */
  door?: 'open' | 'shut' | 'none';
  /** A wider card, for pages with more on them (the account page). */
  wide?: boolean;
  /** HTML set beside the heading (the account page's sign-out). */
  aside?: string;
  /** More CSS, for a page with pieces of its own. */
  style?: string;
  /** Make the nav and footer links absolute, for a page served from somewhere else (the loopback sign-in). */
  base?: string;
}

const STYLE = `${HOUSE_CSS}
.sky,.plate{background-image:radial-gradient(circle,rgba(242,230,207,.55) 1px,transparent 1.4px),radial-gradient(circle,rgba(242,230,207,.3) .8px,transparent 1.2px);background-size:97px 61px,53px 43px;background-position:11px 7px,31px 23px}
body{min-height:100vh;display:flex;flex-direction:column}
main.door{flex:1;width:100%;max-width:580px;margin:0 auto;padding:44px 20px 80px}
main.door.wide{max-width:760px}
.ticket{background:var(--mp-web-card);border:2px solid var(--mp-web-text);border-radius:var(--mp-radius-lg);box-shadow:9px 9px 0 var(--mp-brand-mustard);overflow:hidden}
.ticket.shut{box-shadow:9px 9px 0 var(--mp-brand-brick)}
.plate{background-color:var(--mp-web-night);height:148px;border-bottom:2px solid var(--mp-web-text)}
.plate svg{display:block;width:100%;height:100%}
.inner{padding:26px 30px 30px}
@media (max-width:520px){main.door{padding:28px 14px 56px}.inner{padding:22px 20px 24px}.plate{height:120px}nav .brand svg{height:24px}nav a.to[href$="/privacy"]{display:none}}
.head{display:flex;align-items:flex-start;gap:16px}.head>div{flex:1;min-width:0}.head form{margin:4px 0 0}
.kicker{font:700 13px/1.2 var(--mp-font-heading);letter-spacing:.12em;text-transform:uppercase;color:var(--mp-web-link);margin:0 0 10px}
.ticket.shut .kicker{color:var(--mp-brand-brick)}
.ticket h1{font-size:clamp(28px,5vw,38px);line-height:1.1;margin:0 0 16px;overflow-wrap:anywhere}
.ticket h2{font-size:22px;margin:40px 0 12px}
.ticket h2::before{width:72px;height:8px;margin-bottom:14px}
.ticket p{margin:0 0 12px}.ticket p:last-child{margin-bottom:0}
.ticket ul{padding-left:20px}
.ticket code{background:color-mix(in srgb,var(--mp-web-text) 9%,transparent);padding:2px 7px;border-radius:5px;font-size:.92em;word-break:normal;overflow-wrap:anywhere}
.muted{font-size:var(--mp-type-14)}
.ticket button,.ticket .button{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:600 var(--mp-type-15)/1.2 var(--mp-font-ui);padding:10px 18px;min-height:42px;border-radius:var(--mp-radius-control);border:2px solid var(--mp-web-text);background:transparent;color:var(--mp-web-text);text-decoration:none;cursor:pointer;margin:0 10px 8px 0;transition:transform .08s,box-shadow .08s}
.ticket button:is(:hover,:active),.ticket .button:hover{background:color-mix(in srgb,var(--mp-web-text) 8%,transparent)}
.ticket button.primary,.ticket .button.primary{background:var(--mp-brand-mustard);color:var(--mp-brand-ink);border-color:var(--mp-brand-ink);box-shadow:4px 4px 0 var(--mp-brand-brick)}
.ticket button.primary:is(:hover,:active),.ticket .button.primary:hover{background:var(--mp-brand-mustard);color:var(--mp-brand-ink);transform:translate(-1px,-1px);box-shadow:5px 5px 0 var(--mp-brand-brick)}
.ticket button.primary:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--mp-brand-brick)}
.ticket button.danger,.ticket button.danger:is(:hover,:active){background:var(--mp-brand-brick);color:var(--mp-brand-paper);border-color:var(--mp-brand-ink);box-shadow:4px 4px 0 var(--mp-brand-ink)}
.ticket button.small{min-height:34px;padding:5px 12px;font-size:var(--mp-type-13);margin:0}
.ticket input:not([type=hidden]){font:inherit;width:100%;padding:9px 11px;border:2px solid var(--mp-web-text);border-radius:var(--mp-radius-control);background:var(--mp-web-canvas);color:var(--mp-web-text);margin-top:8px}
.ticket input[type=file]{padding:8px}
.ticket input[type=file]::file-selector-button{font:600 var(--mp-type-13) var(--mp-font-ui);margin-right:12px;padding:6px 12px;border:2px solid var(--mp-web-text);border-radius:6px;background:var(--mp-web-card);color:var(--mp-web-text);cursor:pointer}
ol.steps{margin:20px 0}ol.steps li{margin-bottom:18px}
.handshake{display:flex;align-items:center;gap:14px;margin:4px 0 22px}
.handshake .app{font:700 var(--mp-type-15)/1.2 var(--mp-font-heading);border:2px solid var(--mp-web-text);border-radius:var(--mp-radius-control);background:var(--mp-web-canvas);padding:10px 14px;box-shadow:4px 4px 0 var(--mp-brand-teal);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.handshake .orbit{flex:1;min-width:32px;height:14px;background:radial-gradient(circle,var(--mp-brand-mustard) 2.5px,transparent 3px) 0 50%/14px 14px repeat-x}
.handshake .mark{width:56px;height:56px;flex:none}
`;

/** An app and MCPortal, joined by an orbit of dots: the top of the consent screen. Decorative; the text says who. */
export function handshake(appName: string): string {
  return `<div class="handshake" aria-hidden="true"><span class="app">${escapeHtml(appName)}</span><span class="orbit"></span>${MARK}</div>`;
}

/** One page: the night band and its nav, a card with the door plate, heading and `body`, and the footer. */
export function page(title: string, body: string, options: PageOptions = {}): string {
  const door = options.door ?? 'open';
  const base = options.base ?? '';
  const plate = door === 'none' ? '' : `<div class="plate">${door === 'open' ? DOOR_OPEN : DOOR_SHUT}</div>`;
  const kicker = options.kicker ? `<p class="kicker">${escapeHtml(options.kicker)}</p>` : '';
  const head = `<div class="head"><div>${kicker}<h1>${escapeHtml(options.heading ?? title)}</h1></div>${options.aside ?? ''}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<link rel="icon" href="${escapeHtml(base)}/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#1F2A36"><meta name="robots" content="noindex">
<style>${STYLE}${options.style ?? ''}</style>
</head><body>
<header class="sky">${houseNav(LOCKUP_ON_DARK, base)}</header>
<main class="door${options.wide ? ' wide' : ''}"><div class="ticket${door === 'shut' ? ' shut' : ''}">${plate}<div class="inner">${head}${body}</div></div></main>
${houseFooter('', base)}
</body></html>`;
}
