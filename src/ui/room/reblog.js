  // room/reblog.js: reblogging from the room (docs/explanation/social.md, phase 3)
  // ------------------------------------------------------------ reblog
  // One button with a menu: Reblog, Reblog with a note, Undo reblog. A story someone you
  // follow posted reblogs their post (the credit stays theirs); a story no one has posted
  // becomes a new post, saved first, as sharing always is. Every button for the same post
  // reads its state from reblogMarks, so they all agree after a change (as saved marks do).
  /**
   * What a reblog button acts on: the post behind a story (a follow's share or reblog), or
   * its link when there's none. `quote` is the original's author and note, for the composer.
   * @typedef {{ key: string, shareId?: string | undefined, url?: string | undefined, title: string, item?: Item | undefined, portal?: PortalResult | undefined, mine?: string | undefined, count: number, canReblog: boolean, quote?: { by: string, note?: string | undefined } | undefined }} ReblogTarget
   */
  /** Changes made since the room loaded: target key -> the viewer's reblog (or null) and the count. @type {Map<string, { mine: string | null, count: number }>} */
  const reblogMarks = new Map();
  /** @type {WeakMap<HTMLElement, ReblogTarget>} */
  const reblogTargets = new WeakMap();

  /** Reblogging needs an account: ghost mode shows no buttons. A share card has no identity, but showing it took one. */
  const canPost = () => state.identity?.mode !== 'ghost';

  /**
   * A story's target: the post behind it, else its link.
   * @param {Item} item @param {PortalResult} portal @param {Item['share']} [share] @param {ReblogTarget['quote']} [quote]
   * @returns {ReblogTarget}
   */
  function reblogTarget(item, portal, share, quote) {
    if (share) {
      return { key: `post:${share.reblog?.root ?? share.id}`, shareId: share.id, url: item.url, title: item.title, item, portal,
        mine: share.mine, count: share.reblogs ?? 0, canReblog: Boolean(share.canReblog), quote };
    }
    return { key: `url:${item.url ?? ''}`, url: item.url, title: item.title, item, portal, count: 0, canReblog: true, quote };
  }

  /** A post in a Space or a share card as a target. @param {SharedItem} share @returns {ReblogTarget} */
  function shareTarget(share) {
    const original = share.original && 'author' in share.original ? share.original : undefined;
    return { key: `post:${share.reblogOf?.root ?? share.id}`, shareId: share.id, url: share.url, title: share.title,
      mine: share.myReblog, count: share.reblogCount, canReblog: share.canReblog,
      quote: original ? { by: original.author.handle, note: original.note } : { by: share.author.handle, note: share.note } };
  }

  /** @param {ReblogTarget} target */
  const markOf = (target) => reblogMarks.get(target.key) ?? { mine: target.mine ?? null, count: target.count };

  /**
   * The reblog button for a target, or null when the viewer can't post or there's nothing to
   * reblog.
   * @param {ReblogTarget} target
   */
  function reblogButton(target, cls = 'mi reblog') {
    if (!canPost() || (!target.shareId && !target.url)) return null;
    const button = el('button', { class: cls, type: 'button', 'data-reblog-key': target.key, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: (/** @type {MouseEvent} */ e) => { e.stopPropagation(); openReblogMenu(button, target); } });
    reblogTargets.set(button, target);
    drawReblogButton(button, target);
    return button;
  }

  /**
   * The button's look and name from the target's state: the moon in the doorway once
   * reblogged, struck through when the post can't be reblogged, and the pooled count.
   * @param {HTMLElement} button @param {ReblogTarget} target
   */
  function drawReblogButton(button, target) {
    const { mine, count } = markOf(target);
    const off = !mine && !target.canReblog;
    const counted = count ? ` (${count} reblog${count === 1 ? '' : 's'})` : '';
    const name = off ? "You can't reblog this post" : `${mine ? 'Undo reblog' : 'Reblog'}${counted}`;
    button.classList.toggle('on', Boolean(mine));
    if (button instanceof HTMLButtonElement) button.disabled = off;
    button.setAttribute('aria-label', name);
    button.title = off ? name : mine ? 'Reblogged: click for options' : 'Reblog';
    button.replaceChildren(icon(off ? 'reblogOff' : 'reblog'), el('span', { class: 'reblog-label' }, mine ? 'Reblogged' : 'Reblog'),
      ...(count ? [el('span', { class: 'reblog-count' }, String(count))] : []));
  }

  /** Every button for this target's post agrees with its mark. @param {string} key */
  function markReblogs(key) {
    for (const button of $$('[data-reblog-key]')) {
      const target = reblogTargets.get(button);
      if (target && target.key === key) drawReblogButton(button, target);
    }
  }

  // ------------------------------------------------------------ the menu
  /** @type {{ menu: HTMLElement, button: HTMLElement } | null} */
  let openMenu = null;

  /** @param {boolean} [focus] give focus back to the button */
  function closeReblogMenu(focus = true) {
    if (!openMenu) return;
    const { menu, button } = openMenu;
    openMenu = null;
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    if (focus && button.isConnected) button.focus();
  }

  /** @param {HTMLElement} button @param {ReblogTarget} target */
  function openReblogMenu(button, target) {
    if (openMenu) { const same = openMenu.button === button; closeReblogMenu(same); if (same) return; }
    const { mine } = markOf(target);
    const item = (/** @type {string} */ label, /** @type {() => void} */ act) => el('button', { type: 'button', role: 'menuitem', tabindex: '-1', onclick: () => { closeReblogMenu(false); act(); } }, label);
    const go = item('Reblog', () => { if (audience) reblog(target, button, audience.value()); });
    const audience = mine ? null : audienceSwitch('Reblog', go, true);
    const menu = el('div', { class: 'reblog-menu', role: 'menu', 'aria-label': `Reblog “${target.title}”` },
      mine ? item('Undo reblog', () => undoReblog(target, button))
        : [el('div', { class: 'reblog-submit-row', role: 'none' }, audience?.node, go), item('Reblog with a note', () => reblogWithNote(target, button, audience?.isReady() ? audience.value() : undefined))]);
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
      const at = items.findIndex((i) => i === document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeReblogMenu(); }
      else if (e.key === 'Tab') closeReblogMenu(false);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
        if (next instanceof HTMLElement) next.focus();
      }
    });
    document.body.append(menu);
    const box = button.getBoundingClientRect();
    menu.style.top = `${Math.round(box.bottom + window.scrollY + 4)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(box.right - menu.offsetWidth, document.documentElement.clientWidth - menu.offsetWidth - 8)) + window.scrollX)}px`;
    openMenu = { menu, button };
    button.setAttribute('aria-expanded', 'true');
    $first('[role="menuitem"]:not(:disabled)', menu)?.focus();
    // Read it first? Only a nudge, never a gate: the reader opens if they take it. Not in the reader itself.
    const { url, item: story, portal } = target;
    if (!mine && url && story && portal && isHttpUrl(url) && $('reader').hidden) {
      callTool('get_reading', { url }).then((result) => {
        if (result.structuredContent?.reading || openMenu?.menu !== menu) return;
        menu.prepend(el('div', { class: 'reblog-nudge' }, "You haven't read this yet. ",
          el('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: 'link-btn', onclick: () => { closeReblogMenu(false); openItem(story, portal); } }, 'Read it first?')));
      }).catch(() => {});
    }
  }
  document.addEventListener('click', (e) => { if (openMenu && !e.composedPath().includes(openMenu.menu)) closeReblogMenu(false); });

  // ------------------------------------------------------------ acting
  /** Keep the source preview even on an existing bookmark, preserving its chosen title. @param {ReblogTarget} target */
  async function saveReblogLink(target) {
    const url = target.url ?? '';
    if (!target.item) return state.saved.has(url);
    const saved = state.profile?.saved.find((s) => s.url === url);
    return changeSaved({ ...target.item, title: saved?.title ?? target.item.title }, target.portal?.source ?? 'saved');
  }

  /**
   * Post it: reblog the post behind the story, or (no post behind it) save the link and post
   * it. Resolves to the new post, or null when it didn't happen (the toast says why).
   * @param {ReblogTarget} target @param {string | undefined} note @param {SharedItem['audience']} audience
   */
  async function postReblog(target, note, audience) {
    const extra = { ...(note ? { note } : {}), audience };
    if (target.shareId) {
      const payload = { reblogOf: target.shareId, ...extra };
      const result = (await callTool('share', { ...payload, requestKey: pendingWriteKey('share', payload) })).structuredContent.share;
      confirmWrite('share', payload); return result;
    }
    const url = target.url ?? '';
    if (!(await saveReblogLink(target))) return null;   // saving failed; changeSaved said why
    const payload = { savedUrl: url, ...extra };
    const result = (await callTool('share', { ...payload, requestKey: pendingWriteKey('share', payload) })).structuredContent.share;
    confirmWrite('share', payload); return result;
  }

  /** It happened: mark it everywhere, stamp the button, say so. @param {ReblogTarget} target @param {SharedItem} share @param {HTMLElement} [button] */
  function reblogged(target, share, button) {
    rememberShareAudience(share);
    const { count } = markOf(target);
    reblogMarks.set(target.key, { mine: share.id, count: target.shareId ? count + 1 : count });
    markReblogs(target.key);
    if (button && button.isConnected) { button.classList.remove('stamp'); void button.offsetWidth; button.classList.add('stamp'); }
    toast(`Sent through the portal! Reblogged · ${share.audience === 'everyone' ? 'Public' : 'Followers only'}. ${audienceHelp(share.audience)}`);
  }

  /** @param {ReblogTarget} target @param {HTMLElement} button @param {SharedItem['audience']} audience */
  async function reblog(target, button, audience) {
    button.setAttribute('aria-busy', 'true');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      const share = await postReblog(target, undefined, audience);
      if (share) reblogged(target, share, button);
    } catch (error) { toast(`The portal refused: ${errorText(error)}`); }
    finally { button.removeAttribute('aria-busy'); drawReblogButton(button, target); }
  }

  /** @param {ReblogTarget} target @param {HTMLElement} button */
  async function undoReblog(target, button) {
    const { mine, count } = markOf(target);
    if (!mine) return;
    try {
      await callTool('unshare', { id: mine });
      reblogMarks.set(target.key, { mine: null, count: target.shareId ? Math.max(0, count - 1) : count });
      markReblogs(target.key);
      if (button.isConnected) button.focus();
      toast('Reblog undone.');
    } catch (error) { toast(`Couldn't undo it: ${errorText(error)}`); }
  }

  /**
   * The composer, with the original quoted above it. A link no one has posted is saved first,
   * since a post is of something saved.
   * @param {ReblogTarget} target @param {HTMLElement} button @param {SharedItem['audience']} [audience]
   */
  async function reblogWithNote(target, button, audience) {
    if (!target.shareId && !(await saveReblogLink(target))) return;
    openComposer({ title: target.title, url: target.url }, {
      target: target.shareId ? { reblogOf: target.shareId } : { savedUrl: target.url },
      verb: 'Reblog',
      audience,
      quote: target.quote,
      onDone: (/** @type {SharedItem} */ share) => reblogged(target, share, button),
    });
  }
