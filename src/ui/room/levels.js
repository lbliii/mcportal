  // room/levels.js: the room's zoom levels, room → portal → item (docs/explanation/social.md)
  // ------------------------------------------------------------ transitions
  // A level change is one animated step where the browser has View Transitions and the
  // user hasn't asked for less motion; otherwise it happens at once. `from` is the element
  // that seems to grow into `to()`, the element it becomes after the change. Resolves once
  // the change is made (the animation may still be running).
  const ZOOM = 'mp-zoom';
  /** @param {() => void} update @param {HTMLElement | null} [from] @param {() => HTMLElement | null} [to] @returns {Promise<void>} */
  function transition(update, from, to) {
    if (typeof document.startViewTransition !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return Promise.resolve(); }
    if (from) from.style.viewTransitionName = ZOOM;
    /** @type {HTMLElement | null} */
    let target = null;
    const step = document.startViewTransition(() => {
      if (from) from.style.viewTransitionName = '';
      update();
      target = to ? to() : null;
      if (target) target.style.viewTransitionName = ZOOM;
    });
    step.finished.finally(() => { if (target) target.style.viewTransitionName = ''; });
    return step.updateCallbackDone.catch(() => {});
  }

  // The story the user just clicked, so the reader can grow out of it.
  /** @type {HTMLElement | null} */
  let zoomSource = null;
  /** Remember where an item was opened from (a click on it), then open it. @param {Event} e @param {Item} item @param {PortalResult} portal */
  function openFrom(e, item, portal) {
    const node = e.currentTarget instanceof Element ? e.currentTarget.closest('.item, .card') : null;
    zoomSource = node instanceof HTMLElement ? node : null;
    openItem(item, portal);
  }
  /** The clicked story, once: later opens (from the agent, a link) don't zoom from it. */
  function takeZoomSource() {
    const node = zoomSource; zoomSource = null;
    return node && node.isConnected ? node : null;
  }

  // ------------------------------------------------------------ portal level
  /** A visible destination in contextual navigation. @param {() => unknown} back @param {string} [label] */
  function roomBackButton(back, label = 'Back to your room') {
    const button = iconButton('back', label, back, 'btn room-back');
    button.append(el('span', null, 'Room'));
    return button;
  }
  // One portal filling the frame. It's drawn inside the grid, so the reader opens over it
  // and returns to it like it does to the room. The room's own nodes are set aside, not
  // redrawn, and come back where they were: lanes, rows, pages shown, focus.
  /**
   * @typedef {object} PortalLevel
   * @property {string} portalId
   * @property {ChildNode[]} room the room's nodes, set aside
   * @property {string} gridClass
   * @property {{ x: number, y: number, focus: Element | null, positions: Array<{ node: HTMLElement, left: number, top: number }> }} place
   * @property {boolean} stale the room changed underneath (a refresh or a save): redraw it on the way back
   */
  /** @type {PortalLevel | null} */
  let portalLevel = null;
  /** Items the portal level shows first inline, and how many more each "more" adds. Fullscreen shows them all. */
  const LEVEL_PAGE = 10;

  /** @param {string} portalId */
  function openPortal(portalId) {
    const portal = state.portals.get(portalId);
    if (!portal || portalLevel) return;
    const grid = $('grid');
    const place = { x: window.scrollX, y: window.scrollY, focus: document.activeElement,
      positions: [grid, ...$$('.items, .shelf-row', grid)].map((node) => ({ node, left: node.scrollLeft, top: node.scrollTop })) };
    const from = $first(`[data-portal="${CSS.escape(portalId)}"]`, grid);
    transition(() => {
      portalLevel = { portalId, room: [...grid.childNodes], gridClass: grid.className, place, stale: false };
      grid.className = 'grid portal-level';
      grid.replaceChildren(renderPortalLevel(portal));
      window.scrollTo(0, 0);
      $first('.level h1', grid)?.focus({ preventScroll: true });
    }, from, () => $first('.level', grid));
  }

  function closePortal() {
    const level = portalLevel;
    if (!level) return;
    const grid = $('grid');
    transition(() => {
      portalLevel = null;
      if (level.stale) drawLayout();   // what changed is drawn fresh; the window keeps its place
      else {
        grid.className = level.gridClass;
        grid.replaceChildren(...level.room);
        for (const { node, left, top } of level.place.positions) { node.scrollLeft = left; node.scrollTop = top; }
      }
      if (level.place.focus instanceof HTMLElement && level.place.focus.isConnected) level.place.focus.focus({ preventScroll: true });
      else $first(`[data-portal="${CSS.escape(level.portalId)}"] .portal-title`, grid)?.focus({ preventScroll: true });
      window.scrollTo(level.place.x, level.place.y);
    }, $first('.level', grid), () => $first(`[data-portal="${CSS.escape(level.portalId)}"]`, grid));
  }

  /** A portal's items changed (refresh, save): redraw it if it's open, and the room when it comes back. @param {string} portalId */
  function portalChanged(portalId) {
    if (!portalLevel) return;
    portalLevel.stale = true;
    const portal = state.portals.get(portalId);
    if (portal && portalLevel.portalId === portalId) $('grid').replaceChildren(renderPortalLevel(portal));
  }

  /** @param {PortalResult} portal */
  function renderPortalLevel(portal) {
    const wrap = el('section', { class: 'level', 'data-portal-level': portal.portalId, style: `--mp-source-color:${portalColor(portal)}` },
      el('div', { class: 'level-head', role: 'group', 'aria-label': 'Source controls' },
        roomBackButton(closePortal),
        el('span', { class: 'dot', style: `background:${portalColor(portal)}` }),
        el('h1', { class: 'level-title', tabindex: '-1' }, portal.title),
        el('span', { class: 'portal-count' }, portalCount(portal)),
        el('span', { class: 'tools' }, refreshButton(portal))));
    const items = portalItems(portal, () => {
      const list = el('ul', { class: 'items' });
      const more = el('button', { class: 'link-btn fp-more', type: 'button' });
      let count = 0;
      const page = () => {
        const next = portal.items.slice(count, displayMode === 'fullscreen' ? undefined : count + LEVEL_PAGE);
        list.append(...next.map((item) => el('li', null, watchNew(renderItem(item, portal, 'row'), item, portal))));
        count += next.length;
        more.hidden = count >= portal.items.length;
        more.textContent = `${Math.min(LEVEL_PAGE, portal.items.length - count)} more of ${portal.items.length - count}`;
        primePictures(list, next.length);
      };
      more.addEventListener('click', page);
      page();
      return el('div', null, list, more);
    });
    if (items) wrap.append(items);
    wrap.append(portalFoot(portal, true));
    primePictures(wrap);
    return wrap;
  }
