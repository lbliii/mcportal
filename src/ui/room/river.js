  // room/river.js: the river, every portal merged into one stream (docs/plans/river.md)
  // ------------------------------------------------------------ river
  // The agent's picks, then what's new, then what you've seen. Each portal keeps its own
  // order and the portals merge by time; the same link from two portals is one story
  // naming both. A follow's share of a link in your feeds is the feed's story, with
  // "@handle shared" and their note; a fresh share lifts it, as a reblog would. A run from one portal folds after RIVER.run, and a page counts what the
  // reader sees: a story or a fold row is one unit. A refresh never moves what's on screen:
  // stories that arrive wait behind a "N new since you started" button.
  //
  // Inline (the chat scrolls) a page is RIVER.page and every page is asked for; after
  // RIVER.offerFull pages the river offers fullscreen. Fullscreen pages are RIVER.fullPage,
  // and the next one loads as the end nears, at most RIVER.autoLoads times; then it asks.
  // The river remembers how many units it shows, not pages, so switching modes keeps them.
  const RIVER = { page: 10, fullPage: 20, autoLoads: 2, offerFull: 3, run: 3 };
  /** Coming back to the river checks for new stories at most this often, and only in portals past their freshness. */
  const RIVER_RECHECK_MS = 5 * 60 * 1000;
  /** Portals that aren't streams of stories (tables of contents, the agent's data): named at the end instead. */
  const OFF_RIVER = new Set(['docs', 'pinned']);

  /** Someone you follow who shared or reblogged a story: their note, and the post (for reblogging it). @typedef {{ handle: string, note?: string | undefined, share?: Item['share'] }} Sharer */
  /** @typedef {{ key: string, portal: PortalResult, item: Item, also: PortalResult[], shared: Sharer[], why?: string | undefined }} Story */
  /** @typedef {{ picks: Story[], fresh: Story[], seen: Story[] }} RiverStories */
  /** @typedef {{ story: Story } | { fold: Story[], key: string } | { divider: true }} RiverUnit */

  /**
   * What the river keeps across redraws (a refresh, a save, a page): how many units it shows
   * (0: a page), where each later page began, which folds are open, how many pages loaded
   * themselves, and the stories in the order first drawn, until the reader asks for what
   * arrived. A new open_room (a new portals map) starts it over.
   */
  const riverView = {
    limit: 0, autoLoaded: 0, arrived: 0, checkedAt: Date.now(),
    /** @type {number[]} */ starts: [],
    /** @type {Set<string>} */ open: new Set(),
    /** @type {RiverStories | null} */ frozen: null,
    /** @type {Map<string, PortalResult> | null} */ portals: null,
  };
  /** @type {IntersectionObserver | null} */
  let riverNearEnd = null;
  const riverPageSize = () => (root.classList.contains('fullscreen') ? RIVER.fullPage : RIVER.page);

  /** A story's identity for spotting the same link twice: no fragment, tracking parameters, www or trailing slash. @param {string} url */
  function storyKey(url) {
    try {
      const u = new URL(url);
      for (const k of [...u.searchParams.keys()]) if (/^(utm_.*|ref|fbclid|gclid)$/.test(k)) u.searchParams.delete(k);
      return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
    } catch { return url; }
  }
  /** @param {Story} story */
  const storyId = (story) => `${story.portal.portalId}\n${story.item.id}`;
  /** Who shared an item of a Following portal (its first meta is "@handle"), with their note (its summary). @param {PortalResult} portal @param {Item} item @returns {Sharer | null} */
  function sharerOf(portal, item) {
    const handle = item.meta[0] ?? '';
    return portal.source === 'following' && handle.startsWith('@') ? { handle: handle.slice(1), note: item.summary, share: item.share } : null;
  }

  /**
   * The river's stories: the picks, then the new and the seen, each merged by time.
   * Merging repeatedly takes the head of whichever portal's queue is newest, so a portal's
   * own order (HN's rank, a feed's) holds. An item without a date takes the one before it
   * in its portal, or the portal's fetch time.
   * @param {PortalResult[]} portals in layout order
   * @param {Array<{ portal: PortalResult, item: Item, why?: string | undefined }>} picks
   * @returns {RiverStories}
   */
  function riverStories(portals, picks) {
    /** @type {Map<string, Story>} */
    const byKey = new Map();
    /** The story, or null when it's already in the river (then its portal joins that story's "also on"). @param {PortalResult} portal @param {Item} item @param {string} [why] */
    const take = (portal, item, why) => {
      const key = item.url ? storyKey(item.url) : `${portal.portalId}\n${item.id}`;
      const known = byKey.get(key);
      const sharer = sharerOf(portal, item);
      if (known) {
        if (sharer) { if (!known.shared.some((s) => s.handle === sharer.handle)) known.shared.push(sharer); }
        // A shared story belongs to its source: the feed's copy takes it over where the share put it.
        else if (known.portal.source === 'following') Object.assign(known, { portal, item });
        else if (known.portal.portalId !== portal.portalId && !known.also.some((p) => p.portalId === portal.portalId)) known.also.push(portal);
        return null;
      }
      /** @type {Story} */
      const story = { key, portal, item, also: [], shared: sharer ? [sharer] : [], why };
      byKey.set(key, story);
      return story;
    };
    /** @type {Story[]} */
    const top = [];
    for (const p of picks) { const story = take(p.portal, p.item, p.why); if (story) top.push(story); }
    const timed = portals.map((portal) => {
      let last = Date.parse(portal.provenance.fetchedAt ?? '') || 0;
      return portal.items.map((item) => {
        const t = Date.parse(item.publishedAt ?? '');
        if (!Number.isNaN(t)) last = t;
        return { portal, item, t: last };
      });
    });
    /** @param {boolean} fresh */
    const merge = (fresh) => {
      const queues = timed.map((q) => q.filter((s) => Boolean(s.item.new) === fresh));
      const heads = queues.map(() => 0);
      /** @type {Story[]} */
      const out = [];
      for (;;) {
        let best = -1;
        /** @type {{ portal: PortalResult, item: Item, t: number } | undefined} */
        let next;
        queues.forEach((q, i) => { const head = q[heads[i] ?? 0]; if (head && (!next || head.t > next.t)) { best = i; next = head; } });   // ties go to the earlier portal
        if (!next) return out;
        heads[best] = (heads[best] ?? 0) + 1;
        const story = take(next.portal, next.item);
        if (story) out.push(story);
      }
    };
    return { picks: top, fresh: merge(true), seen: merge(false) };
  }

  /**
   * The stories in the order the reader first saw them, each brought up to date (a save, a
   * refresh's new counts), and how many stories are new to the river since. A story that
   * left its feed stays where it was until the reader asks for the update.
   * @param {RiverStories} frozen @param {RiverStories} now
   * @returns {{ stories: RiverStories, arrived: number }}
   */
  function keepPlaces(frozen, now) {
    const latest = new Map([...now.picks, ...now.fresh, ...now.seen].map((s) => [s.key, s]));
    const placed = new Set([...frozen.picks, ...frozen.fresh, ...frozen.seen].map((s) => s.key));
    /** @param {Story[]} list */
    const update = (list) => list.map((s) => latest.get(s.key) ?? s);
    return { stories: { picks: update(frozen.picks), fresh: update(frozen.fresh), seen: update(frozen.seen) }, arrived: [...latest.keys()].filter((k) => !placed.has(k)).length };
  }

  /**
   * Stories as units: a run from one portal longer than RIVER.run folds the rest of the run
   * into one row, unless the reader opened it.
   * @param {Story[]} stories @param {Set<string>} open fold keys the reader expanded
   * @returns {RiverUnit[]}
   */
  function riverUnits(stories, open) {
    /** @type {RiverUnit[]} */
    const units = [];
    for (let i = 0; i < stories.length;) {
      const portalId = stories[i]?.portal.portalId;
      let end = i + 1;
      while (end < stories.length && stories[end]?.portal.portalId === portalId) end++;
      const run = stories.slice(i, end);
      for (const story of run.slice(0, RIVER.run)) units.push({ story });
      const rest = run.slice(RIVER.run);
      const first = rest[0];
      if (first) {
        const key = storyId(first);
        if (open.has(key)) for (const story of rest) units.push({ story });
        else units.push({ fold: rest, key });
      }
      i = end;
    }
    return units;
  }

  /**
   * The first `limit` units: new, a divider when seen stories follow, then seen. The
   * divider isn't a unit and never ends what's shown.
   * @param {RiverUnit[]} fresh @param {RiverUnit[]} seen @param {number} limit
   * @returns {{ shown: RiverUnit[], more: number }} what's shown, and how many units are left
   */
  function riverPage(fresh, seen, limit) {
    /** @type {RiverUnit} */
    const divider = { divider: true };
    const all = [...fresh, ...(fresh.length && seen.length ? [divider] : []), ...seen];
    /** @type {RiverUnit[]} */
    const shown = [];
    let count = 0;
    for (const unit of all) {
      if (count >= limit) break;
      shown.push(unit);
      if (!('divider' in unit)) count++;
    }
    if (shown.at(-1) === divider) shown.pop();
    return { shown, more: fresh.length + seen.length - count };
  }

  /** The portals in layout order, as loaded. @param {Profile} profile */
  function roomPortals(profile) {
    /** @type {PortalResult[]} */
    const out = [];
    for (const spec of profile.columns.flatMap((c) => c.panels)) { const portal = state.portals.get(spec.id); if (portal) out.push(portal); }
    return out;
  }

  /**
   * The river's children: what's lost, the head and the arrivals button, the picks, the
   * stream a page at a time, its end, and what's left out.
   * @param {Profile} profile
   */
  function drawRiver(profile) {
    if (riverView.portals !== state.portals) Object.assign(riverView, { portals: state.portals, frozen: null, arrived: 0, limit: 0, starts: [], autoLoaded: 0, checkedAt: Date.now() });
    const portals = roomPortals(profile);
    const flowing = portals.filter((p) => !OFF_RIVER.has(p.source) && !p.error);
    // Only the agent's edition is labelled a pick; without one the river is just the stream (no fallback lead).
    const now = riverStories(flowing, state.edition ? frontStories() : []);
    let stories = now;
    if (riverView.frozen) ({ stories, arrived: riverView.arrived } = keepPlaces(riverView.frozen, now));
    riverView.frozen = stories;
    const { picks, fresh, seen } = stories;
    const size = riverPageSize();
    const limit = Math.max(riverView.limit, size);
    const { shown, more } = riverPage(riverUnits(fresh, riverView.open), riverUnits(seen, riverView.open), limit);
    const col = el('div', { class: 'river-col' });

    const lost = portals.filter((p) => p.error);
    if (lost.length) col.append(el('p', { class: 'river-lost' }, 'Signal lost: ', ...lost.flatMap((p, i) => [i ? ', ' : '',
      el('button', { class: 'link-btn', type: 'button', title: `Retry ${p.title}`, onclick: () => refreshPortal(p.portalId) }, p.title)]), '.'));

    const newCount = [...state.portals.values()].reduce((n, p) => n + (p.newCount ?? 0), 0);
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    col.append(el('header', { class: 'river-head' }, el('h1', { class: 'fp-kicker' }, newCount ? `${date} · ${newCount} new` : date)));
    if (riverView.arrived) {
      col.append(el('button', { class: 'river-arrived', type: 'button', onclick: showArrivals },
        `${riverView.arrived} new ${riverView.arrived === 1 ? 'story' : 'stories'} since you started`));
    }

    let pos = 0;
    /** @param {Story} story */
    const article = (story) => {
      const node = watchNew(renderItem(story.item, story.portal, 'story', { color: portalColor(story.portal), why: story.why ?? '', also: story.also.map((p) => p.title), shared: story.shared }), story.item, story.portal);
      node.dataset.story = storyId(story);
      node.setAttribute('aria-posinset', String(++pos));
      node.setAttribute('aria-setsize', '-1');
      return node;
    };
    if (picks.length) {
      col.append(el('section', { class: 'river-picks', 'aria-label': 'Picked by your agent' },
        el('h2', { class: 'fp-label' }, state.edition?.title || 'Picked by your agent'), picks.map(article)));
    }
    const feed = el('div', { class: 'river-feed', role: 'feed', 'aria-label': 'Your river', 'aria-busy': 'false' });
    const total = shown.filter((u) => !('divider' in u)).length + more;
    let units = 0;
    for (const unit of shown) {
      if ('divider' in unit) { feed.append(el('p', { class: 'river-divider' }, "You're caught up. Earlier from your portals")); continue; }
      // Where a later page began, a separator the "more" button sends focus to (the BBC GEL load-more pattern).
      const at = riverView.starts.indexOf(units);
      if (at >= 0) {
        const end = Math.min(riverView.starts[at + 1] ?? limit, total);
        feed.append(el('p', { class: 'river-page', tabindex: '-1', 'data-from': String(units + 1) }, `Stories ${units + 1} to ${end}`));
      }
      units++;
      if ('fold' in unit) {
        const lead = unit.fold[0];
        if (lead) feed.append(el('div', { class: 'river-fold' }, el('button', {
          class: 'link-btn', type: 'button',
          onclick: () => { riverView.open.add(unit.key); redrawRiver(); $first(`[data-story="${CSS.escape(unit.key)}"] .item-main`)?.focus(); },
        }, el('span', { class: 'dot', style: `background:${portalColor(lead.portal)}` }), `${unit.fold.length} more from ${lead.portal.title}`)));
      } else feed.append(article(unit.story));
    }
    if (!shown.length && !picks.length) feed.append(el('div', { class: 'empty' }, 'All quiet on every frequency… for now. New stories will show up here.'));
    col.append(feed);

    if (more > 0) {
      const next = () => { riverNextPage(limit, size); $first(`#grid .river-page[data-from="${limit + 1}"]`)?.focus(); };
      const buttons = el('div', { class: 'river-more' }, el('button', { class: 'link-btn fp-more', type: 'button', onclick: next }, `${Math.min(size, more)} more of ${more}`));
      if (!root.classList.contains('fullscreen') && canFullscreen && limit >= RIVER.offerFull * RIVER.page) {
        buttons.append(el('button', { class: 'link-btn fp-more', type: 'button', onclick: () => toggleFullscreen() }, 'Open the full river'));
      }
      col.append(buttons);
    } else if (shown.length) {
      col.append(el('p', { class: 'fp-end river-end' }, fresh.length && !seen.length ? "You're caught up." : "That's everything your portals fetched.",
        ' ', el('button', { class: 'link-btn', type: 'button', onclick: () => refreshAll() }, 'Refresh')));
    }

    const aside = portals.filter((p) => OFF_RIVER.has(p.source) && !p.error);
    if (aside.length) col.append(el('p', { class: 'river-aside' }, 'Also in your room: ', ...aside.flatMap((p, i) => [i ? ', ' : '',
      el('button', { class: 'link-btn', type: 'button', onclick: () => openPortal(p.portalId) }, p.title)])));
    primePictures(col);
    loadNearEnd(feed, more, limit, size);
    return [col];
  }

  /**
   * Fullscreen only: the next page loads as the last story nears the screen, at most
   * RIVER.autoLoads times; after that, and inline, the reader asks for it.
   * @param {HTMLElement} feed @param {number} more @param {number} limit @param {number} size
   */
  function loadNearEnd(feed, more, limit, size) {
    riverNearEnd?.disconnect();
    riverNearEnd = null;
    const last = feed.lastElementChild;
    if (!root.classList.contains('fullscreen') || more <= 0 || riverView.autoLoaded >= RIVER.autoLoads || !last) return;
    riverNearEnd = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      riverNearEnd?.disconnect();
      riverView.autoLoaded++;
      riverNextPage(limit, size);
    }, { rootMargin: '0px 0px 400px 0px' });
    riverNearEnd.observe(last);
  }

  /** Draw the river again in place (the window keeps its scroll). Not while a portal is open: it redraws on the way back. */
  function redrawRiver() {
    if (portalLevel || !state.profile) return;
    $('grid').replaceChildren(...drawRiver(state.profile));
  }

  /** Show the next page after the `limit` units shown. @param {number} limit @param {number} size */
  function riverNextPage(limit, size) {
    riverView.starts.push(limit);
    riverView.limit = limit + size;
    redrawRiver();
  }

  /** The reader asked for what arrived: the river is merged afresh and read from the top. */
  function showArrivals() {
    Object.assign(riverView, { frozen: null, arrived: 0 });
    redrawRiver();
    $first('#grid .river-head')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    $first('#grid .story .item-main')?.focus({ preventScroll: true });
  }

  // Coming back to the river (the tab or app regains focus) checks the portals past their
  // freshness, at most every RIVER_RECHECK_MS. Nothing polls while the reader is here:
  // what arrives waits behind the arrivals button.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || state.profile?.layout !== 'river' || Date.now() - riverView.checkedAt < RIVER_RECHECK_MS) return;
    riverView.checkedAt = Date.now();
    for (const portal of state.portals.values()) {
      const loaded = portal.provenance.fetchedAt ? Date.parse(portal.provenance.fetchedAt) : portalLoadedAt.get(portal.portalId);
      const stale = loaded !== undefined && loaded + portal.provenance.ttlSeconds * 1000 < Date.now();
      if (!portal.pin && !OFF_RIVER.has(portal.source) && stale) refreshPortal(portal.portalId);
    }
  });

  // Keys (Mastodon's): j and k move between stories, o opens one, s saves it.
  document.addEventListener('keydown', (e) => {
    if (state.profile?.layout !== 'river' || portalLevel || e.metaKey || e.ctrlKey || e.altKey) return;
    if (root.classList.contains('article-view') || root.classList.contains('welcome-view') || $('grid').hidden) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const stories = [...$$('#grid .story')];
    const at = stories.findIndex((s) => s.contains(document.activeElement));
    if (e.key === 'j' || e.key === 'k') {
      const next = stories[at < 0 ? 0 : Math.max(0, Math.min(stories.length - 1, at + (e.key === 'j' ? 1 : -1)))];
      if (!next) return;
      e.preventDefault();
      $first('.item-main', next)?.focus();
    } else if (at >= 0 && (e.key === 'o' || e.key === 's')) {
      const target = stories[at] && $first(e.key === 'o' ? '.item-main' : '.save', stories[at]);
      if (!target) return;
      e.preventDefault();
      target.click();
    }
  });
