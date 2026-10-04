/** Script-free branded pages for consent, account, invites and local sign-in results. */
import { DESIGN_CSS, PRIMITIVES_CSS } from './design/generated.ts';
import { escapeHtml } from './lib/web.ts';
import { WEB_BRAND_CSS, WEB_BRAND_ICON, webHeader, webFooter } from './web-brand.ts';

/** Local callback pages link to the hosted origin rather than nonexistent local routes. */
export interface PageOptions { siteUrl?: string; }

export function page(title: string, body: string, options: PageOptions = {}): string {
  const heading = /<h1\b/i.test(body) ? '' : `<h1>${escapeHtml(title)}</h1>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · MCPortal</title>
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#1F2A36">${WEB_BRAND_ICON}
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
@media(forced-colors:active){.card{box-shadow:none}.card::before{background:CanvasText}}
</style></head><body class="web-page">${webHeader(options.siteUrl)}<main class="web-main"><div class="card">${heading}${body}</div></main>${webFooter(options.siteUrl)}</body></html>`;
}
