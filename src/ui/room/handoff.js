  // room/handoff.js: send the page you're reading to a new chat, and open one sent here
  // ------------------------------------------------------------ handoffs (docs/explanation/reading.md, phase 2)
  // Hosts can't open or message another conversation, so the page goes through MCPortal:
  // create_handoff stores a pointer (the page, where you were, any passage you selected)
  // under a short code, and the room shows what to say in a new chat. There the agent
  // calls open_handoff, and this card opens at the same place.
  /** The handoff this card was opened from, applied once its page has drawn. @type {Handoff | null} */
  let pendingHandoff = null;

  /** The page now in the reader: its body, address, title and where it lives. */
  function currentPage() {
    const body = $first('[data-passage-url]', $('reader'));
    if (!body) return null;
    /** @type {{ kind: 'article' } | { kind: 'docs', portalId?: string, docs: string }} */
    const place = docsState ? { kind: 'docs', ...('portalId' in docsState.key ? { portalId: docsState.key.portalId } : {}), docs: docsState.docs } : { kind: 'article' };
    return { body, url: body.dataset.passageUrl ?? '', title: body.dataset.passageTitle ?? '', place };
  }

  /** The first block of `body` on screen. @param {HTMLElement} body */
  function firstVisibleBlock(body) {
    const top = readerVisibleTop($('reader'));
    return Math.max(0, logicalBlocks(body).findIndex((b) => b.getBoundingClientRect().bottom > top + 1));
  }

  /** Send the page (and the selected passage, if any) to a new chat. @param {Passage | null} p */
  async function sendToNewChat(p) {
    const page = currentPage();
    if (!page) return;
    const block = p ? p.block : firstVisibleBlock(page.body);
    const heading = headingAnchorAt(page.body, block);
    try {
      const { prompt } = (await callTool('create_handoff', {
        url: page.url, title: page.title, place: page.place,
        anchor: { block, ...(heading ? { heading } : {}) },
        ...(p ? { passage: p.text } : {}),
      })).structuredContent;
      showHandoffSent(page.body, prompt);
    } catch (error) {
      toast(`Curses! Couldn't send that: ${errorText(error)}`);
    }
  }

  /** What to say in the new chat, with Copy, above the page. @param {HTMLElement} body @param {string} prompt */
  function showHandoffSent(body, prompt) {
    for (const old of $$('.handoff-sent', $('reader'))) old.remove();
    const panel = el('div', { class: 'handoff-sent', role: 'status' },
      el('span', null, 'Sent. In a new chat, say: '), el('code', null, prompt),
      copyButton(prompt),
      el('button', { class: 'btn', type: 'button', onclick: () => panel.remove() }, 'Done'));
    body.before(panel);
    panel.scrollIntoView({ block: 'nearest' });
  }

  /**
   * If this card was opened from a handoff for this page, mark it and go to where the
   * user was. Returns whether it did (so the reader doesn't also resume elsewhere).
   * @param {HTMLElement} body
   */
  function applyHandoff(body) {
    const h = pendingHandoff;
    if (!h || h.url !== body.dataset.passageUrl) return false;
    pendingHandoff = null;
    const target = h.anchor || h.passage ? logicalBlocks(body)[resolveBlock(body, h.anchor, h.passage)] : null;
    // With a passage, show it first, and a way to its place in the page; without, go straight there.
    const note = el('div', { class: 'handoff-note' },
      el('div', { class: 'handoff-label' }, h.passage ? 'You sent this passage from your room' : 'Sent from your room'),
      h.passage ? el('blockquote', null, h.passage) : null,
      h.passage && target ? el('button', { class: 'btn', type: 'button', onclick: () => target.scrollIntoView({ block: 'start', behavior: scrollBehavior() }) }, 'Go to it in the page') : null);
    body.before(note);
    (h.passage || !target ? note : target).scrollIntoView({ block: 'start' });
    return true;
  }
