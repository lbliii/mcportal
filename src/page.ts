/** Script-free branded pages for consent, account, invites and local sign-in results. */
import { DESIGN_CSS, PRIMITIVES_CSS } from './design/generated.ts';
import { escapeHtml } from './lib/web.ts';
import { DOOR_ART, WEB_BRAND_CSS, WEB_BRAND_ICON, WEB_MARK, webHeader, webFooter } from './web-brand.ts';

export interface PageOptions {
  /** Server-built, escaped metadata. */
  head?: string;
  /** Local callback pages link to the hosted origin rather than nonexistent local routes. */
  siteUrl?: string;
  /**
   * A short line over the heading. Pulp for good news ("It's alive!") and a few words on a
   * light failure ("Signal lost"); leave it off for accounts, deletion and consent.
   */
  kicker?: string;
  /** A door plate at the top of the card: `open` welcomes, `shut` says a link expired or something failed. */
  door?: 'open' | 'shut';
  /** A wider card, for pages with more on them (the signed-in account page). */
  wide?: boolean;
  /** More CSS for a page with pieces of its own. */
  style?: string;
}

/** An app and MCPortal joined by an orbit of dots, for the top of the consent screen. Decorative: the text says who. */
export function handshake(appName: string): string {
  return `<div class="handshake" aria-hidden="true"><span class="app">${escapeHtml(appName)}</span><span class="orbit"></span>${WEB_MARK}</div>`;
}

export function page(title: string, body: string, options: PageOptions = {}): string {
  const heading = /<h1\b/i.test(body) ? '' : `<h1>${escapeHtml(title)}</h1>`;
  const plate = options.door ? `<div class="door-plate">${DOOR_ART[options.door]}</div>` : '';
  const kicker = options.kicker ? `<p class="kicker">${escapeHtml(options.kicker)}</p>` : '';
  const card = ['card', options.door ? `door ${options.door}` : ''].filter(Boolean).join(' ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · MCPortal</title>
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#1F2A36">${WEB_BRAND_ICON}${options.head ?? ''}
<style>${DESIGN_CSS}\n${PRIMITIVES_CSS}\n${WEB_BRAND_CSS}
.web-main{max-width:680px;margin:0 auto;padding:clamp(32px,7vh,72px) var(--mp-space-24) var(--mp-space-40)}
.card{min-width:0;border:2px solid var(--mp-text-primary);border-radius:var(--mp-radius-lg);padding:clamp(24px,4vw,40px);background:var(--mp-surface-card);box-shadow:6px 6px 0 var(--mp-brand-mustard);overflow-wrap:anywhere}
.card::before{content:"";display:block;width:80px;height:8px;margin-bottom:var(--mp-space-24);background:radial-gradient(circle,var(--mp-brand-teal) 1.5px,transparent 1.9px) 0 0/8px 8px}
h1,h2{font-family:var(--mp-font-heading);font-weight:700;line-height:1.15}h1{font-size:clamp(1.75rem,4vw,2rem);margin:0 0 var(--mp-space-24)}h2{font-size:var(--mp-type-20);margin:var(--mp-space-32) 0 var(--mp-space-12)}
p{margin:0 0 var(--mp-space-20)}.card>:last-child{margin-bottom:0}.muted{color:var(--mp-text-secondary);font-size:var(--mp-type-14)}
code{background:var(--mp-surface-inset);padding:2px 6px;border-radius:var(--mp-radius-xs);font:var(--mp-type-14)/1.5 var(--mp-font-mono);overflow-wrap:anywhere}
form{margin:var(--mp-space-24) 0;display:flex;flex-wrap:wrap;gap:var(--mp-space-12);align-items:center}form p{width:100%;margin:0}label{display:block}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;max-width:100%;font:inherit;padding:var(--mp-space-10) var(--mp-space-16);border-radius:var(--mp-radius-control);border:1px solid var(--mp-border-control);background:var(--mp-surface-input);color:var(--mp-text-primary);text-decoration:none;text-align:center;overflow-wrap:anywhere}
button:hover,.button:hover{background:var(--mp-surface-hover)}button.primary,.button.primary{background:var(--mp-action-primary);color:var(--mp-action-on-primary);border-color:var(--mp-action-primary)}
button.danger{background:var(--mp-action-danger);color:var(--mp-action-on-danger);border-color:var(--mp-action-danger)}
input:not([type=hidden]),select,textarea{min-width:0;max-width:100%;padding:var(--mp-space-8);border:1px solid var(--mp-border-control);border-radius:var(--mp-radius-control)}
input[type=file]{width:100%;overflow:hidden}input[type=file]::file-selector-button{font:inherit;margin-right:var(--mp-space-8);padding:var(--mp-space-8);border:1px solid var(--mp-border-control);border-radius:var(--mp-radius-control);background:var(--mp-surface-input);color:var(--mp-text-primary)}
ul,ol{padding-left:var(--mp-space-24)}li{margin-bottom:var(--mp-space-12)}li form{margin:var(--mp-space-12) 0;flex-wrap:wrap}
@media(max-width:480px){.web-main{padding:var(--mp-space-32) var(--mp-space-16) var(--mp-space-40)}.card{padding:var(--mp-space-24) var(--mp-space-20)}}
.web-main.wide{max-width:820px}
.card.door::before{display:none}.card.door.shut{box-shadow:6px 6px 0 var(--mp-brand-brick)}
.door-plate{height:148px;margin:calc(-1*clamp(24px,4vw,40px)) calc(-1*clamp(24px,4vw,40px)) clamp(24px,4vw,32px);background-color:var(--mp-web-night);background-image:radial-gradient(circle,rgba(242,230,207,.55) 1px,transparent 1.4px),radial-gradient(circle,rgba(242,230,207,.3) .8px,transparent 1.2px);background-size:97px 61px,53px 43px;background-position:11px 7px,31px 23px;border-bottom:2px solid var(--mp-text-primary);border-radius:calc(var(--mp-radius-lg) - 2px) calc(var(--mp-radius-lg) - 2px) 0 0;overflow:hidden}
.door-plate svg{display:block;width:100%;height:100%}
.kicker{font:700 var(--mp-type-13)/1.3 var(--mp-font-heading);letter-spacing:.12em;text-transform:uppercase;color:var(--mp-text-link);margin:0 0 var(--mp-space-8)}.kicker+h1{margin-top:0}
button.primary,.button.primary{background:var(--mp-brand-mustard);color:var(--mp-brand-ink);border:2px solid var(--mp-brand-ink);box-shadow:3px 3px 0 var(--mp-brand-brick);font-weight:600}
button.primary:hover,.button.primary:hover{background:var(--mp-brand-mustard);transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--mp-brand-brick)}
button.primary:active,.button.primary:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--mp-brand-brick)}
.handshake{display:flex;align-items:center;gap:var(--mp-space-12);margin:0 0 var(--mp-space-24)}
.handshake .app{font:700 var(--mp-type-15)/1.2 var(--mp-font-heading);border:2px solid var(--mp-text-primary);border-radius:var(--mp-radius-control);background:var(--mp-surface-canvas);padding:var(--mp-space-10) var(--mp-space-12);box-shadow:3px 3px 0 var(--mp-brand-teal);max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.handshake .orbit{flex:1;min-width:28px;height:14px;background:radial-gradient(circle,var(--mp-brand-mustard) 2.5px,transparent 3px) 0 50%/14px 14px repeat-x}
.handshake .web-mark{width:52px;height:52px;flex:none}
@media(max-width:480px){.door-plate{height:112px;margin:calc(-1*var(--mp-space-24)) calc(-1*var(--mp-space-20)) var(--mp-space-24)}}
@media(prefers-reduced-motion:reduce){button.primary,.button.primary{transform:none!important}}
@media(forced-colors:active){.card{box-shadow:none}.card::before{background:CanvasText}.door-plate{display:none}.handshake .orbit{background:none;border-top:2px dotted CanvasText}button.primary,.button.primary{box-shadow:none}}
${options.style ?? ''}
</style></head><body class="web-page">${webHeader(options.siteUrl)}<main class="web-main${options.wide ? ' wide' : ''}"><div class="${card}">${plate}${kicker}${heading}${body}</div></main>${webFooter(options.siteUrl)}</body></html>`;
}
