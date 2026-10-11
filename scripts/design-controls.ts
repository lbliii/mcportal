/** Development catalogue of the shipped primitives, without room-specific overrides. */
import { DESIGN_CSS, PRIMITIVES_CSS } from '../src/design/generated.ts';

export function designControls(): string {
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCPortal controls</title>
<style>${DESIGN_CSS}${PRIMITIVES_CSS}
body{margin:0;padding:var(--mp-panel-padding);font-size:var(--mp-type-13)}main{max-width:52rem;margin:auto}h1{font-size:var(--mp-type-20)}h2{font-size:var(--mp-type-14)}p{line-height:var(--mp-line-body);color:var(--mp-text-secondary)}section{border-top:1px solid var(--mp-border-divider);margin-top:var(--mp-panel-section-gap);padding-top:var(--mp-panel-padding)}.samples{display:flex;align-items:center;flex-wrap:wrap;gap:var(--mp-space-12)}label{display:grid;gap:var(--mp-space-4)}code{font-family:var(--mp-font-mono)}#measurements{white-space:pre-wrap}a{display:inline-block}html[data-touch]{--mp-control-height:var(--mp-control-touch);--mp-control-minimum:var(--mp-control-touch);--mp-control-field-height:var(--mp-control-touch)}</style></head>
<body><main><a href="/">All surfaces</a><h1>Shared controls</h1><p>These use the production tokens and primitives. Check icon hints, navigation and layout variants in the room fixture.</p>
<div class="samples"><label>Theme<select class="field" id="theme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Targets<select class="field" id="targets"><option value="pointer">Pointer</option><option value="touch">Touch preview</option></select></label><label>Text<select class="field" id="text"><option value="100%">100%</option><option value="200%">200%</option></select></label></div>
<section><h2>Button variants</h2><div class="samples"><button class="btn" data-measure="Button">Save</button><button class="btn primary" data-measure="Primary">Save</button><button class="btn danger" data-measure="Danger">Delete</button><button class="btn" aria-pressed="true">Selected ✓</button><button class="btn" disabled>Unavailable</button><button class="btn" aria-busy="true">Saving…</button></div><p>Emphasis and state share one size. Labels grow and wrap with the user's text preference.</p></section>
<section><h2>Icon actions</h2><div class="samples"><button class="ib sm" aria-label="Add source, compact" data-measure="Compact icon">${icon}</button><button class="ib" aria-label="Add source" data-measure="Icon">${icon}</button><button class="ib" aria-label="Selected action" aria-pressed="true">${icon}</button><button class="ib" aria-label="Unavailable action" disabled>${icon}</button><button class="mi" aria-label="Discussion" data-measure="Metadata">${icon} 3</button></div><p>24px compact / 28px standard targets; 14px / 16px glyphs. Metadata may use 12px glyphs inside the same minimum target.</p></section>
<section><h2>Fields</h2><div class="samples"><label>Source<input class="field" placeholder="example.com" data-measure="Field"></label><label>Open stories<select class="field"><option>In this room</option><option>In the conversation</option></select></label></div><p>32px minimum fields, growing with text. Touch targets become at least 44px.</p></section>
<section><h2>Rendered sizes</h2><output id="measurements"></output></section>
</main><script>
const root=document.documentElement;
function measure(){document.querySelector('#measurements').textContent=[...document.querySelectorAll('[data-measure]')].map(n=>{const r=n.getBoundingClientRect();return n.dataset.measure+': '+Math.round(r.width)+' × '+Math.round(r.height)+'px'}).join('\\n')}
document.querySelector('#theme').onchange=e=>{root.dataset.theme=e.target.value;measure()};
document.querySelector('#targets').onchange=e=>{root.toggleAttribute('data-touch',e.target.value==='touch');measure()};
document.querySelector('#text').onchange=e=>{root.style.fontSize=e.target.value;measure()};
new ResizeObserver(measure).observe(document.body);measure();
</script></body></html>`;
}
