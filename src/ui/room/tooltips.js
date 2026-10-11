  // One tooltip serves static and newly rendered icon controls, including dialogs.
  (() => {
    const tip = el('div', { id: 'controlTooltip', class: 'room-tooltip', role: 'tooltip', popover: 'manual' });
    document.body.append(tip);
    /** @type {HTMLElement | null} */
    let active = null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let keyboard = false;
    let fromFocus = false;

    /** @param {EventTarget | null} target */
    function trigger(target) {
      const node = target instanceof Element ? target.closest('[data-tooltip]') : null;
      return node instanceof HTMLElement ? node : null;
    }
    function hide() {
      clearTimeout(timer);
      if (tip.matches(':popover-open')) tip.hidePopover();
      if (active) {
        const ids = (active.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tip.id);
        if (ids.length) active.setAttribute('aria-describedby', ids.join(' '));
        else active.removeAttribute('aria-describedby');
      }
      active = null;
    }
    function place() {
      if (!active) return;
      const anchor = active.getBoundingClientRect(), box = tip.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(anchor.left + (anchor.width - box.width) / 2, innerWidth - box.width - 8))}px`;
      const below = anchor.bottom + 4;
      tip.style.top = `${Math.max(8, below + box.height <= innerHeight - 8 ? below : anchor.top - box.height - 4)}px`;
    }
    /** @param {HTMLElement} node @param {boolean} focused */
    function show(node, focused) {
      if (active === node && tip.matches(':popover-open')) { clearTimeout(timer); fromFocus ||= focused; return; }
      hide(); active = node; fromFocus = focused;
      timer = setTimeout(() => {
        if (active !== node || !node.isConnected || !node.getClientRects().length) { hide(); return; }
        const label = node.dataset.tooltip || node.getAttribute('aria-label');
        if (!label) { hide(); return; }
        // A modal makes nodes outside it inert, so put its tooltip inside it.
        (node.closest('dialog[open]') || document.body).append(tip);
        tip.textContent = label;
        tip.showPopover(); place();
        const ids = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        node.setAttribute('aria-describedby', [...new Set([...ids, tip.id])].join(' '));
      }, focused ? 0 : 150);
    }
    document.addEventListener('pointerover', event => {
      if (event.pointerType === 'touch') return;
      if (event.target instanceof Node && tip.contains(event.target)) { clearTimeout(timer); return; }
      const node = trigger(event.target);
      if (node && !node.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) show(node, false);
    });
    document.addEventListener('pointerout', event => {
      if (!active) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && (active.contains(next) || tip.contains(next))) return;
      if (fromFocus && active === document.activeElement) return;
      // Keep the hint reachable while crossing the small gap to its surface.
      if (trigger(event.target) === active || event.target instanceof Node && tip.contains(event.target)) {
        clearTimeout(timer); timer = setTimeout(hide, 120);
      }
    });
    document.addEventListener('focusin', event => {
      const node = trigger(event.target);
      if (keyboard && node) show(node, true);
    });
    document.addEventListener('focusout', event => { if (trigger(event.target) === active) hide(); });
    document.addEventListener('pointerdown', () => { keyboard = false; hide(); }, true);
    document.addEventListener('click', hide, true);
    document.addEventListener('keydown', event => {
      keyboard = true;
      if (event.key === 'Escape' && tip.matches(':popover-open')) {
        hide(); event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    new MutationObserver(() => {
      if (!active) return;
      if (!active.isConnected || !active.getClientRects().length) { hide(); return; }
      const label = active.dataset.tooltip || active.getAttribute('aria-label');
      if (!label) hide();
      else if (tip.matches(':popover-open') && tip.textContent !== label) { tip.textContent = label; place(); }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tooltip', 'aria-label', 'hidden', 'open'] });
  })();
