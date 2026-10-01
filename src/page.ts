/**
 * The small server-rendered page used by sign-in, the account page, admin sign-in
 * and invite links: one card in the shared design tokens, no scripts.
 */
import { DESIGN_CSS, PRIMITIVES_CSS } from './design/generated.ts';
import { escapeHtml } from './lib/web.ts';

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${DESIGN_CSS}
body{font:var(--mp-type-15)/var(--mp-line-body) var(--mp-font-ui);max-width:460px;margin:12vh auto;padding:0 var(--mp-space-20);background:var(--mp-surface-canvas);color:var(--mp-text-primary)}h1{font-size:var(--mp-type-20)}
.card{border:1px solid var(--mp-border-divider);border-radius:var(--mp-radius-lg);padding:var(--mp-space-20)}.muted{color:var(--mp-text-secondary);font-size:var(--mp-type-13)}code{background:var(--mp-surface-inset);padding:1px 5px;border-radius:var(--mp-radius-xs);word-break:break-all}
button{font:inherit;padding:var(--mp-space-8) var(--mp-space-16);border-radius:var(--mp-radius-control);border:1px solid var(--mp-border-control);background:var(--mp-surface-input);cursor:pointer;margin-right:var(--mp-space-8)}button.primary{background:var(--mp-action-primary);color:var(--mp-action-on-primary);border-color:var(--mp-action-primary)}
button.danger{background:var(--mp-action-danger);color:var(--mp-action-on-danger);border-color:var(--mp-action-danger)}
${PRIMITIVES_CSS}</style>
</head><body><div class="card">${body}</div></body></html>`;
}
