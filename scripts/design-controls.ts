/** The catalogue executes the exact scripts and CSS shipped in the room. */
import { CATALOGUE_JS, COMPONENT_JS, DESIGN_CSS, PRIMITIVES_CSS } from '../src/design/generated.ts';

export function designControls(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCPortal design system</title>
<style>${DESIGN_CSS}${PRIMITIVES_CSS}
body{margin:0;padding:var(--mp-panel-padding);font-size:var(--mp-type-13)}main{max-width:52rem;margin:auto}h1{font-size:var(--mp-type-20)}h2{font-size:var(--mp-type-14)}p{line-height:var(--mp-line-body);color:var(--mp-text-secondary)}section{border-top:1px solid var(--mp-border-divider);margin-top:var(--mp-panel-section-gap);padding-top:var(--mp-panel-padding)}.samples{display:flex;align-items:center;flex-wrap:wrap;gap:var(--mp-space-12)}.samples>.ui-field{max-width:100%}.sample-settings{display:grid;gap:var(--mp-panel-section-gap);width:min(100%,var(--mp-panel-width))}code{font-family:var(--mp-font-mono);overflow-wrap:anywhere}#measurements{white-space:pre-wrap}a{display:inline-block}.contract{padding:var(--mp-space-8) 0}.contract p{margin:var(--mp-space-4) 0}.contract summary{cursor:pointer}html[data-touch]{--mp-control-height:var(--mp-control-touch);--mp-control-minimum:var(--mp-control-touch);--mp-control-field-height:var(--mp-control-touch)}</style></head>
<body><main id="catalogue"><a href="/">All surfaces</a><h1>MCPortal design system</h1><p>Production controls and patterns. Compact chrome, comfortable reading. Change the theme, target or text preference to inspect every example.</p></main><script>${COMPONENT_JS}\n${CATALOGUE_JS}</script></body></html>`;
}
