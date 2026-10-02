  // room/dom.js: shared state and DOM helpers: el(), ago(), status line, toast
  // ------------------------------------------------------------ state + rendering
  /** @type {RoomState} */
  const state = { profile: null, identity: null, portals: new Map(), saved: new Set(), art: new Map(), edition: undefined, lead: undefined, labs: [] };   // art: portal id -> fallback art style

  /** @typedef {Node | string | number | null | undefined | false} Child */
  /**
   * An element with attributes, listeners (on…) and children. Children are text or
   * nodes, never HTML. An <a> with onclick and no href acts as a button.
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {Record<string, any> | null} [attrs]
   * @param {...(Child | Child[])} children
   * @returns {HTMLElementTagNameMap[K]}
   */

  function el(tag, attrs, ...children) {
    if (tag === 'a' && attrs && attrs.onclick && !attrs.href) attrs = { ...attrs, role: 'button', tabindex: '0', onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); /** @type {HTMLElement} */ (e.currentTarget).click(); }
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

  /** "5m ago", "3d ago", or a date. @param {string | undefined} iso */
  function ago(iso) {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }
  /** @param {string} text */
  function setStatus(text) { $('status').textContent = text; $('status').title = ''; }
  /** @param {string} [iso] */
  function setUpdated(iso) {
    const t = new Date(iso || Date.now());
    setStatus(t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    $('status').title = `Updated ${t.toLocaleString()}`;
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let toastTimer;
  /** A short message at the bottom of the room. @param {string} text */
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /** A thrown value's message, for the user. @param {unknown} error */
  function errorText(error) {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * The entries that are there (drops null, undefined and false), typed as such.
   * @template T
   * @param {Array<T | null | undefined | false>} list
   * @returns {T[]}
   */
  function present(list) {
    return /** @type {T[]} */ (list.filter((x) => x !== null && x !== undefined && x !== false));
  }
