  // room/dom.js: shared state and DOM helpers: el(), ago(), status line, toast
  // ------------------------------------------------------------ state + rendering
  const state = { profile: null, portals: new Map(), saved: new Set(), art: new Map() };   // art: portal id -> fallback art style

  function el(tag, attrs, ...children) {
    if (tag === 'a' && attrs && attrs.onclick && !attrs.href) attrs = { ...attrs, role: 'button', tabindex: '0', onkeydown: e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
    } };
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));  // text only, never HTML
    }
    return node;
  }

  function ago(iso) {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }
  function setStatus(text) { $('status').textContent = text; $('status').title = ''; }
  function setUpdated(iso) {
    const t = new Date(iso || Date.now());
    setStatus(t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    $('status').title = `Updated ${t.toLocaleString()}`;
  }
  let toastTimer = 0;
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
