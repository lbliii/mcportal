  // room/layouts.js: the room's layouts, one renderer each (docs/plans/room-layouts.md)
  // ------------------------------------------------------------ layouts
  // A layout draws the same room (the profile's ordered columns of portals) its own way.
  // Adding one never changes another: each says what class the grid gets, how the whole
  // room is drawn, and how one portal is drawn (to redraw it after a refresh or a save).
  /**
   * @typedef {object} RoomLayout
   * @property {string | null} gridClass the grid's extra class, if any
   * @property {(profile: Profile) => HTMLElement[]} draw the grid's children
   * @property {(portalId: string) => HTMLElement} portal one portal
   */

  /** @type {Record<Profile['layout'], RoomLayout>} */
  const ROOM_LAYOUTS = {
    /** Side-by-side columns of stacked portals; each portal lists its items. */
    columns: {
      gridClass: null,
      draw: (profile) => profile.columns.map((col) => el('div', { class: 'col', style: `--mp-column-weight:${col.width}` }, col.panels.map((spec) => renderPortal(spec.id)))),
      portal: (portalId) => {
        const portal = state.portals.get(portalId);
        const wrap = el('section', { class: 'portal', 'data-portal': portalId });
        if (!portal) return standBy(wrap);
        wrap.append(el('div', { class: 'portal-head' }, ...portalLabel(portal), el('span', { class: 'tools' }, refreshButton(portal))));
        const items = portalItems(portal, () => el('ul', { class: 'items' }, portal.items.map((item) => el('li', null, watchNew(renderItem(item, portal, 'row'), item, portal)))));
        if (items) wrap.append(items);
        wrap.append(portalFoot(portal, true));
        primePictures(wrap);
        return wrap;
      },
    },

    /** One sideways row of cards per portal, in layout order. */
    shelves: {
      gridClass: 'shelves',
      draw: (profile) => profile.columns.flatMap((col) => col.panels).map((spec) => renderPortal(spec.id)),
      portal: (portalId) => {
        const portal = state.portals.get(portalId);
        const wrap = el('section', { class: 'shelf', 'data-portal': portalId });
        if (!portal) return standBy(wrap);
        const color = portalColor(portal);
        const row = el('div', { class: 'shelf-row' });
        const page = (/** @type {number} */ dir) => row.scrollBy({ left: dir * Math.max(200, row.clientWidth - 60), behavior: scrollBehavior() });
        wrap.append(el('div', { class: 'shelf-head' }, ...portalLabel(portal),
          el('span', { class: 'tools' },
            iconButton('left', `Scroll ${portal.title} left`, () => page(-1)),
            iconButton('right', `Scroll ${portal.title} right`, () => page(1)),
            refreshButton(portal))));
        const items = portalItems(portal, () => {
          // A picture row only when most items have pictures; otherwise it's mostly empty boxes.
          const withThumbs = portal.items.filter((i) => i.image && i.image.kind === 'thumb').length;
          const media = withThumbs >= 2 && withThumbs * 2 >= portal.items.length;
          row.append(...portal.items.map((item) => watchNew(renderItem(item, portal, 'tile', { color, media }), item, portal)));
          return row;
        });
        if (items) wrap.append(items);
        wrap.append(portalFoot(portal, false));
        primePictures(wrap);
        return wrap;
      },
    },
  };

  /** The profile's layout, or columns for one this page doesn't know. @param {Profile} profile */
  const layoutOf = (profile) => ROOM_LAYOUTS[profile.layout] ?? ROOM_LAYOUTS.columns;

  function drawLayout() {
    const p = /** @type {Profile} */ (state.profile);   // callers draw only once a room is loaded
    assignArt(p);
    const layout = layoutOf(p);
    const grid = $('grid');
    for (const other of Object.values(ROOM_LAYOUTS)) if (other.gridClass) grid.classList.toggle(other.gridClass, other === layout);
    grid.replaceChildren(...layout.draw(p));
    for (const b of $$('[data-layout]')) b.setAttribute('aria-pressed', String(b.dataset.layout === p.layout));
    $('btnOpenIn').setAttribute('aria-pressed', String(p.openIn === 'chat'));
  }

  /** One portal, as the current layout draws it. @param {string} portalId */
  function renderPortal(portalId) {
    return (state.profile ? layoutOf(state.profile) : ROOM_LAYOUTS.columns).portal(portalId);
  }

  // ------------------------------------------------------------ portal parts
  // What every layout's portal has: its label, its items or why there are none, its footer.
  /** @param {HTMLElement} wrap */
  function standBy(wrap) {
    wrap.append(el('div', { class: 'empty' }, 'Stand by…'));
    return wrap;
  }

  /** @param {PortalResult} portal */
  const portalColor = (portal) => sourceColor(portal.source, artStyle(portal));

  /** The dot in the source's colour, the title, the count. @param {PortalResult} portal */
  function portalLabel(portal) {
    return [
      el('span', { class: 'dot', style: `background:${portalColor(portal)}` }),
      el('span', { class: 'portal-title', title: portal.title }, portal.title),
      el('span', { class: 'portal-count' }, portalCount(portal)),
    ];
  }

  /**
   * The portal's error, its empty state, or its items as the layout draws them.
   * @param {PortalResult} portal @param {() => HTMLElement | null} items called only when there are some
   */
  function portalItems(portal, items) {
    if (portal.error) return el('div', { class: 'error' }, `Signal lost in the ion storm (${portal.error}). Try refreshing this portal.`);
    if (!portal.items.length) return el('div', { class: 'empty' }, 'All quiet on this frequency… for now. New posts will show up here.');
    return items();
  }

  /** Where the items came from and how fresh they are. @param {PortalResult} portal @param {boolean} ttl */
  function portalFoot(portal, ttl) {
    const p = portal.provenance;
    return el('div', { class: 'portal-foot' }, portal.pin ? pinnedFoot(portal)
      : `${p.source} · ${p.endpoint} · fetched ${new Date(p.fetchedAt).toLocaleTimeString()}${p.cached ? ' (cached)' : ''}${ttl ? ` · fresh for ${p.ttlSeconds}s` : ''}`);
  }
