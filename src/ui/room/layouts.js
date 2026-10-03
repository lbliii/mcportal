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
   * @property {() => void} [redraw] for a layout without portal blocks: draw it again after one portal changes
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

    /**
     * The front page: the agent's lead and picks, then each portal's top items, top to
     * bottom in profile order. Nothing in it scrolls on its own; a portal shows more a page
     * at a time, and the page grows.
     */
    frontpage: {
      gridClass: 'frontpage',
      draw: (profile) => {
        const top = frontTop();
        return [frontHead(), ...(top ? [top] : []),
          el('div', { class: 'fp-blocks' }, profile.columns.flatMap((col) => col.panels).map((spec) => renderPortal(spec.id))),
          el('p', { class: 'fp-end', id: 'frontEnd' })];
      },
      portal: (portalId) => {
        const portal = state.portals.get(portalId);
        const wrap = el('section', { class: 'portal fp-block', 'data-portal': portalId });
        if (!portal) return standBy(wrap);
        wrap.append(el('div', { class: 'portal-head' }, ...portalLabel(portal), el('span', { class: 'tools' }, refreshButton(portal))));
        const items = portalItems(portal, () => {
          // What the top of the page already shows isn't repeated here.
          const shown = onFront();
          const rest = portal.items.filter((item) => !shown.has(frontKey(portalId, item.id)));
          if (!rest.length) return el('div', { class: 'empty' }, 'Everything here is in the picks above.');
          const list = el('ul', { class: 'items' });
          const more = el('button', { class: 'link-btn fp-more', type: 'button' });
          let count = 0;
          const page = () => {
            const next = rest.slice(count, count + (count ? FRONT.page : FRONT.first));
            list.append(...next.map((item) => el('li', null, watchNew(renderItem(item, portal, 'row'), item, portal))));
            count += next.length;
            more.hidden = count >= rest.length;
            more.textContent = `${Math.min(FRONT.page, rest.length - count)} more of ${rest.length - count}`;
            primePictures(list, next.length);
            queueMicrotask(frontEnd);   // once this block is on the page (a refresh swaps it in after)
          };
          more.addEventListener('click', page);
          page();
          return el('div', null, list, more);
        });
        if (items) wrap.append(items);
        wrap.append(portalFoot(portal, true));
        primePictures(wrap);
        return wrap;
      },
    },

    /**
     * The river (river.js): every portal merged into one stream. It has no portal blocks, so a
     * portal that changes redraws it whole; where one portal is needed alone, columns draws it.
     */
    river: {
      gridClass: 'river',
      draw: (profile) => drawRiver(profile),
      portal: (portalId) => ROOM_LAYOUTS.columns.portal(portalId),
      redraw: () => redrawRiver(),
    },
  };

  // ------------------------------------------------------------ front page parts
  /** Items each portal block shows first, and how many more each "more" adds. */
  const FRONT = { first: 3, page: 5, picks: 3 };
  /** @param {string} portalId @param {string} itemId */
  const frontKey = (portalId, itemId) => `${portalId}\n${itemId}`;

  /**
   * The lead and the picks after it, each with its portal and item as the room has them now.
   * @returns {Array<{ portal: PortalResult, item: Item, why?: string | undefined }>}
   */
  function frontStories() {
    /** @type {Array<{ portal: PortalResult, item: Item, why?: string | undefined }>} */
    const out = [];
    const add = (/** @type {string} */ portalId, /** @type {string} */ itemId, /** @type {string | undefined} */ why) => {
      const portal = state.portals.get(portalId);
      const item = portal && portal.items.find((i) => i.id === itemId);
      if (portal && item && !out.some((s) => s.portal === portal && s.item === item)) out.push({ portal, item, why });
    };
    if (state.lead) add(state.lead.portalId, state.lead.itemId, state.lead.why);
    for (const pick of (state.edition?.picks ?? []).slice(0, FRONT.picks + 1)) add(pick.portalId, pick.item.id, pick.why);
    return out.slice(0, FRONT.picks + 1);
  }
  const onFront = () => new Set(frontStories().map((s) => frontKey(s.portal.portalId, s.item.id)));

  /** The edition's name, date and count of what's new; without an edition, a way to ask for one. */
  function frontHead() {
    const fresh = [...state.portals.values()].reduce((n, p) => n + (p.newCount ?? 0), 0);
    const edition = state.edition;
    const date = new Date(edition ? edition.createdAt : Date.now()).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return el('header', { class: 'fp-head' },
      el('div', { class: 'fp-kicker' }, fresh ? `${date} · ${fresh} new` : date),
      el('h1', { class: 'fp-title' }, edition ? edition.title : 'The front page'),
      edition && edition.intro ? el('p', { class: 'fp-intro' }, edition.intro) : null,
      edition || DEV ? null : el('button', { class: 'link-btn fp-ask', type: 'button', onclick: askForHighlights }, 'Ask your agent to pick the highlights'));
  }

  async function askForHighlights() {
    try {
      await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: 'Pick the highlights from my MCPortal room.' }] }, 10000);
      toast('Your summons has been sent! Your agent is picking the highlights.');
    } catch { toast('The chat is beyond our reach. Ask your agent there for highlights.'); }
  }

  /** The lead, and beside it (or under it, when narrow) the other picks. */
  function frontTop() {
    const [lead, ...picks] = frontStories();
    if (!lead) return null;
    const look = (/** @type {PortalResult} */ portal, /** @type {string | undefined} */ why) => ({ color: portalColor(portal), from: true, why: why ?? '' });
    const top = el('section', { class: picks.length ? 'fp-top has-picks' : 'fp-top', 'aria-label': 'The lead' },
      watchNew(renderItem(lead.item, lead.portal, 'lead', look(lead.portal, lead.why)), lead.item, lead.portal),
      picks.length ? el('div', { class: 'fp-picks' }, el('h2', { class: 'fp-label' }, 'Also picked'),
        el('ul', null, picks.map((p) => el('li', null, watchNew(renderItem(p.item, p.portal, 'row', look(p.portal, p.why)), p.item, p.portal))))) : null);
    primePictures(top);
    return top;
  }

  /** The last line: what's new that the page isn't showing yet, or that you're caught up. */
  function frontEnd() {
    const end = $first('#frontEnd');
    if (!end) return;
    const fresh = [...state.portals.values()].reduce((n, p) => n + (p.newCount ?? 0), 0);
    const showing = new Set([...$$('#grid [data-seen-item]')].map((n) => frontKey(n.dataset.seenPortal ?? '', n.dataset.seenItem ?? '')));
    const hidden = fresh - showing.size;
    end.textContent = hidden > 0 ? `${hidden} more new ${hidden === 1 ? 'story waits' : 'stories wait'} inside your portals.` : "You're caught up.";
  }

  /** @type {Array<Profile['layout']>} */
  const LAYOUT_NAMES = ['columns', 'shelves', 'frontpage', 'river'];
  /** Layouts that are labs: offered while the server has the lab on, and kept for whoever chose one. */
  const LAB_LAYOUTS = ['frontpage', 'river'];
  /** A layout by name (a toolbar button's), if there is one. @param {string | undefined} name */
  const layoutNamed = (name) => LAYOUT_NAMES.find((l) => l === name);

  /** The profile's layout, or columns for one this page doesn't know. @param {Profile} profile */
  const layoutOf = (profile) => ROOM_LAYOUTS[profile.layout] ?? ROOM_LAYOUTS.columns;

  function drawLayout() {
    const p = /** @type {Profile} */ (state.profile);   // callers draw only once a room is loaded
    assignArt(p);
    const layout = layoutOf(p);
    const grid = $('grid');
    portalLevel = null;   // drawing the room leaves any open portal
    grid.classList.remove('portal-level');
    for (const other of Object.values(ROOM_LAYOUTS)) if (other.gridClass) grid.classList.toggle(other.gridClass, other === layout);
    grid.replaceChildren(...layout.draw(p));
    if (layout === ROOM_LAYOUTS.frontpage) frontEnd();
    for (const b of $$('[data-layout]')) b.setAttribute('aria-pressed', String(b.dataset.layout === p.layout));
    // A lab's layout is offered while the server has the lab on, and kept for whoever chose it.
    for (const lab of LAB_LAYOUTS) $first(`[data-layout="${lab}"]`)?.toggleAttribute('hidden', !(state.labs.includes(lab) || p.layout === lab));
    $('btnOpenIn').setAttribute('aria-pressed', String(p.openIn === 'chat'));
  }

  /** One portal, as the current layout draws it. @param {string} portalId */
  function renderPortal(portalId) {
    return (state.profile ? layoutOf(state.profile) : ROOM_LAYOUTS.columns).portal(portalId);
  }

  /** A portal's items changed (a refresh, a save): draw it again where the room shows it. @param {string} portalId */
  function redrawPortal(portalId) {
    const layout = state.profile ? layoutOf(state.profile) : ROOM_LAYOUTS.columns;
    if (layout.redraw) layout.redraw();
    else $first(`[data-portal="${CSS.escape(portalId)}"]`)?.replaceWith(renderPortal(portalId));
    portalChanged(portalId);
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

  /** The dot in the source's colour, the title (it opens the portal on its own), the count. @param {PortalResult} portal */
  function portalLabel(portal) {
    return [
      el('span', { class: 'dot', style: `background:${portalColor(portal)}` }),
      el('button', { class: 'portal-title', type: 'button', title: `Open ${portal.title}`, onclick: () => openPortal(portal.portalId) }, portal.title),
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

  /** @param {Provenance} provenance */
  function provenanceTime(provenance) {
    return provenance.fetchedAt ? ` · fetched ${new Date(provenance.fetchedAt).toLocaleString()}${provenance.cached ? ' (cached)' : ''}` : '';
  }

  /** Where the items came from and how fresh they are. @param {PortalResult} portal @param {boolean} ttl */
  function portalFoot(portal, ttl) {
    const p = portal.provenance;
    return el('div', { class: 'portal-foot' }, portal.pin ? pinnedFoot(portal)
      : `${p.source} · ${p.endpoint}${provenanceTime(p)}${ttl ? ` · cache lifetime ${p.ttlSeconds}s` : ''}`);
  }
