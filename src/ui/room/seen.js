  // room/seen.js: what the user has had on screen, so "new" means new to them
  // ------------------------------------------------------------ seen (docs/plans/attention.md, phase 3)
  // open_room marks items new to this user (src/seen.ts). An item that stays at least half
  // on screen for SEEN_AFTER ms, or that the user opens, is sent back with mark_seen, in
  // batches at most every SEEN_FLUSH ms and when the page is hidden. Its "new" mark stays
  // for this visit; the next open_room no longer counts it.
  const SEEN_AFTER = 1000;
  const SEEN_FLUSH = 10000;
  const SEEN_BATCH = { portals: 40, items: 100 };
  /** portal id -> ids of items seen and not yet sent @type {Map<string, Set<string>>} */
  const seenQueue = new Map();
  let seenFlushTimer = 0;
  /** @type {Map<Element, number>} */
  const seenTimers = new Map();
  const seenWatch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const node = entry.target;
      if (!(node instanceof HTMLElement)) continue;
      clearTimeout(seenTimers.get(node));
      seenTimers.delete(node);
      if (!entry.isIntersecting) continue;
      seenTimers.set(node, window.setTimeout(() => {
        seenTimers.delete(node);
        seenWatch.unobserve(node);
        if (node.isConnected) queueSeen(node.dataset.seenPortal ?? '', node.dataset.seenItem ?? '');
      }, SEEN_AFTER));
    }
  }, { threshold: 0.5 });

  /** Watch a new item's element until it's been seen. @template {HTMLElement} T @param {T} node @param {Item} item @param {PortalResult} portal @returns {T} */
  function watchNew(node, item, portal) {
    if (!item.new) return node;
    node.classList.add('new');
    node.dataset.seenPortal = portal.portalId;
    node.dataset.seenItem = item.id;
    seenWatch.observe(node);
    return node;
  }

  /** @param {string} portalId @param {string} itemId */
  function queueSeen(portalId, itemId) {
    if (!portalId || !itemId) return;
    const ids = seenQueue.get(portalId) ?? new Set();
    ids.add(itemId);
    seenQueue.set(portalId, ids);
    if (!seenFlushTimer) seenFlushTimer = window.setTimeout(flushSeen, SEEN_FLUSH);
  }

  function flushSeen() {
    clearTimeout(seenFlushTimer); seenFlushTimer = 0;
    if (!seenQueue.size) return;
    const portals = [...seenQueue].slice(0, SEEN_BATCH.portals).map(([portalId, ids]) => ({ portalId, itemIds: [...ids].slice(0, SEEN_BATCH.items) }));
    seenQueue.clear();
    callTool('mark_seen', { portals }).catch(() => {});   // a convenience: a lost batch only means a few items look new again
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSeen(); });

  /** The portal heading's count: "30", or "30 · 7 new". @param {PortalResult} portal */
  function portalCount(portal) {
    if (portal.error) return '';
    return portal.newCount ? `${portal.items.length} · ${portal.newCount} new` : String(portal.items.length);
  }
