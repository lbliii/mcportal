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
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (e.currentTarget instanceof HTMLElement) e.currentTarget.click(); }
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

