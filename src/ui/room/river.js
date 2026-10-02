  // room/river.js: the river, every portal merged into one stream (docs/plans/river.md)
  // ------------------------------------------------------------ river
  // The agent's picks, then what's new, then what you've seen. Each portal keeps its own
  // order and the portals merge by time; the same link from two portals is one story
  // naming both. A run from one portal folds after RIVER.run, and a page counts what the
  // reader sees: a story or a fold row is one unit.
  const RIVER = { page: 10, run: 3 };
  /** Portals that aren't streams of stories (tables of contents, the agent's data): named at the end instead. */
  const OFF_RIVER = new Set(['docs', 'pinned']);

  /** @typedef {{ portal: PortalResult, item: Item, also: PortalResult[], why?: string | undefined }} Story */
  /** @typedef {{ story: Story } | { fold: Story[], key: string } | { divider: true }} RiverUnit */

  /** What the river shows across redraws (a refresh, a save): how many pages, which folds are open. */
  const riverView = { pages: 1, /** @type {Set<string>} */ open: new Set() };

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

  /**
   * The river's stories: the picks, then the new and the seen, each merged by time.
   * Merging repeatedly takes the head of whichever portal's queue is newest, so a portal's
   * own order (HN's rank, a feed's) holds. An item without a date takes the one before it
   * in its portal, or the portal's fetch time.
   * @param {PortalResult[]} portals in layout order
   * @param {Array<{ portal: PortalResult, item: Item, why?: string | undefined }>} picks
   * @returns {{ picks: Story[], fresh: Story[], seen: Story[] }}
   */
  function riverStories(portals, picks) {
    /** @type {Map<string, Story>} */
    const byKey = new Map();
    /** The story, or null when it's already in the river (then its portal joins that story's "also on"). @param {PortalResult} portal @param {Item} item @param {string} [why] */
    const take = (portal, item, why) => {
      const key = item.url ? storyKey(item.url) : `${portal.portalId}\n${item.id}`;
      const known = byKey.get(key);
      if (known) {
        if (known.portal !== portal && !known.also.includes(portal)) known.also.push(portal);
        return null;
      }
      /** @type {Story} */
      const story = { portal, item, also: [], why };
      byKey.set(key, story);
      return story;
    };
    /** @type {Story[]} */
    const top = [];
    for (const p of picks) { const story = take(p.portal, p.item, p.why); if (story) top.push(story); }
    const timed = portals.map((portal) => {
      let last = Date.parse(portal.provenance.fetchedAt) || 0;
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
   * Stories as units: a run from one portal longer than RIVER.run folds the rest of the run
   * into one row, unless the reader opened it.
   * @param {Story[]} stories @param {Set<string>} open fold keys the reader expanded
   * @returns {RiverUnit[]}
   */
  function riverUnits(stories, open) {
    /** @type {RiverUnit[]} */
    const units = [];
    for (let i = 0; i < stories.length;) {
      const portal = stories[i]?.portal;
      let end = i + 1;
      while (end < stories.length && stories[end]?.portal === portal) end++;
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
   * The first `pages` pages of units: new, a divider when seen stories follow, then seen.
   * The divider isn't a unit and never ends a page.
   * @param {RiverUnit[]} fresh @param {RiverUnit[]} seen @param {number} pages
   * @returns {{ shown: RiverUnit[], more: number }} what's shown, and how many units are left
   */
  function riverPage(fresh, seen, pages) {
    /** @type {RiverUnit} */
    const divider = { divider: true };
    const all = [...fresh, ...(fresh.length && seen.length ? [divider] : []), ...seen];
    const limit = pages * RIVER.page;
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

  /** The river's children: what's lost, the head, the picks, a page of the stream, what's left out. @param {Profile} profile */
  function drawRiver(profile) {
    const portals = roomPortals(profile);
    const flowing = portals.filter((p) => !OFF_RIVER.has(p.source) && !p.error);
    // Only the agent's edition is labelled a pick; without one the river is just the stream (no fallback lead).
    const { picks, fresh, seen } = riverStories(flowing, state.edition ? frontStories() : []);
    const { shown, more } = riverPage(riverUnits(fresh, riverView.open), riverUnits(seen, riverView.open), riverView.pages);
    const col = el('div', { class: 'river-col' });

    const lost = portals.filter((p) => p.error);
    if (lost.length) col.append(el('p', { class: 'river-lost' }, 'Signal lost: ', ...lost.flatMap((p, i) => [i ? ', ' : '',
      el('button', { class: 'link-btn', type: 'button', title: `Retry ${p.title}`, onclick: () => refreshPortal(p.portalId) }, p.title)]), '.'));

    const newCount = [...state.portals.values()].reduce((n, p) => n + (p.newCount ?? 0), 0);
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    col.append(el('header', { class: 'river-head' }, el('h1', { class: 'fp-kicker' }, newCount ? `${date} · ${newCount} new` : date)));

    let pos = 0;
    /** @param {Story} story */
    const article = (story) => {
      const node = watchNew(renderItem(story.item, story.portal, 'story', { color: portalColor(story.portal), why: story.why ?? '', also: story.also.map((p) => p.title) }), story.item, story.portal);
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
    for (const unit of shown) {
      if ('divider' in unit) feed.append(el('p', { class: 'river-divider' }, "You're caught up. Earlier from your portals"));
      else if ('fold' in unit) {
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
      col.append(el('button', {
        class: 'link-btn fp-more', type: 'button',
        onclick: () => {
          const before = $$('#grid .river-feed > article').length;
          riverView.pages++; redrawRiver();
          $first(`#grid .river-feed > article:nth-of-type(${before + 1}) .item-main`)?.focus();   // the first story of the new page
        },
      }, `${Math.min(RIVER.page, more)} more of ${more}`));
    } else if (shown.length) col.append(el('p', { class: 'fp-end' }, "That's everything your portals fetched."));

    const aside = portals.filter((p) => OFF_RIVER.has(p.source) && !p.error);
    if (aside.length) col.append(el('p', { class: 'river-aside' }, 'Also in your room: ', ...aside.flatMap((p, i) => [i ? ', ' : '',
      el('button', { class: 'link-btn', type: 'button', onclick: () => openPortal(p.portalId) }, p.title)])));
    primePictures(col);
    return [col];
  }

  /** Draw the river again in place (the window keeps its scroll). Not while a portal is open: it redraws on the way back. */
  function redrawRiver() {
    if (portalLevel || !state.profile) return;
    $('grid').replaceChildren(...drawRiver(state.profile));
  }

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
