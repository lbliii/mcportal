  // room/highlights.js: the agent's picks from what's new, as a card (show_highlights)
  // ------------------------------------------------------------ highlights (docs/plans/attention.md, phase 4)
  // Each pick is the source's own item (title, link, summary, actions, as in the room) with
  // the agent's reason set apart. The reason and the intro are the agent's words, shown as
  // text. "Not for me" marks the item seen, so it won't come up as new again.
  /** @typedef {ToolResults['show_highlights']['highlights']} Highlights */

  /** @param {Highlights} h */
  function showHighlightsCard(h) {
    root.classList.add('article-view');
    $('roomName').textContent = 'highlights';
    $('welcome').hidden = true;
    $('grid').hidden = true;
    const reader = $('reader');
    reader.hidden = false; reader.scrollTop = 0;
    renderReader(readerTop('', false), el('h1', null, h.title),
      el('div', { class: 'byline' }, h.intro ?? ''),
      el('ul', { class: 'highlights' }, h.picks.map(highlightNode)));
    setStatus('');
  }

  /** @param {Highlights['picks'][number]} pick */
  function highlightNode(pick) {
    /** @type {PortalResult} the item's portal, as much of it as opening and saving need */
    const portal = { portalId: pick.portalId, source: pick.source, title: pick.portalTitle, items: [pick.item], provenance: { source: pick.source, endpoint: '', fetchedAt: '', cached: false, ttlSeconds: 0 } };
    const node = el('li', { class: 'highlight', style: `--mp-source-color:${loneColor(pick.source, undefined)}` },
      el('div', { class: 'highlight-from' }, pick.portalTitle),
      renderItem(pick.item, portal),
      el('div', { class: 'highlight-why' }, el('span', { class: 'highlight-label' }, "Why it's here"), pick.why),
      el('button', { class: 'btn not-for-me', type: 'button', onclick: () => {
        queueSeen(pick.portalId, pick.item.id); flushSeen();
        node.remove();
        toast("Got it. It won't come up as new again.");
      } }, 'Not for me'));
    return node;
  }
