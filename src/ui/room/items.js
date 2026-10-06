  // room/items.js: one item, drawn in a form (docs/explanation/social.md)
  // ------------------------------------------------------------ item forms
  // Every layout draws items through renderItem. A form is how much room an item gets:
  // row (a line in a portal list), tile (a card in a shelf), lead (the front page's
  // first story) or story (one in the river). New forms join ITEM_FORMS; each keeps one content-opening button with
  // its actions beside it, never inside it.
  /** @typedef {'row' | 'tile' | 'lead' | 'story'} ItemForm */
  /**
   * How an item looks: its portal's colour, whether its shelf shows pictures, whether it
   * names its portal (outside one), the agent's reason for picking it (its own words), the
   * other portals that have the same story, and the people you follow who shared it.
   * @typedef {{ color?: string, media?: boolean, from?: boolean, why?: string, also?: string[], shared?: Array<{ handle: string, note?: string | undefined, share?: Item['share'] }> }} ItemLook
   */

  /** @param {Item} item @param {PortalResult} portal @param {ItemForm} [form] @param {ItemLook} [look] */
  function renderItem(item, portal, form = 'row', look = {}) {
    return ITEM_FORMS[form](item, portal, look);
  }

  // Compact meta: "364 points" -> ▲364, "192 comments" -> a comment-count link to the
  // discussion, "by someone" dropped (kept in the tooltip). Unknown strings pass through.
  /** @param {Item} item @param {boolean} [when] the item's age at the end (the river shows it in the from line) */
  function compactMeta(item, when = true) {
    /** @type {Array<HTMLElement | null>} */
    const out = [];
    let byline = '';
    for (const m of item.meta) {
      let hit;
      if ((hit = /^([\d.,]+k?) points?$/.exec(m))) out.push(el('span', { class: 'mi', style: 'cursor:default' }, icon('up'), hit[1]));
      else if ((hit = /^([\d.,]+k?) comments?$/.exec(m))) {
        const url = item.discussionUrl && item.discussionUrl !== item.url ? item.discussionUrl : null;
        out.push(url
          ? el('button', { class: 'mi', title: 'Open the discussion', 'aria-label': `${hit[1]} comments, open the discussion`, onclick: (/** @type {MouseEvent} */ e) => { e.stopPropagation(); openLink(url); } }, icon('comment'), hit[1])
          : el('span', { class: 'mi', style: 'cursor:default' }, icon('comment'), hit[1]));
      } else if (/^by /.test(m)) byline = m;
      else out.push(el('span', /^\W*[\d.,]+k?\b/.test(m) ? null : { class: 'meta-text' }, m));   // words (a domain, a language) can give way; counts can't
    }
    if (when && item.publishedAt) out.push(el('span', null, ago(item.publishedAt)));
    return { out, byline };
  }

  /** The title line: the New mark, a GitHub owner's avatar, the title. @param {Item} item */
  function itemTitle(item) {
    const avatar = item.image && item.image.kind === 'avatar' ? avatarImg(item) : null;
    return el('span', { class: 'item-title' }, item.new ? el('span', { class: 'new-mark' }, 'New') : null, avatar, item.title);
  }

  /**
   * A row's and the lead's actions: points and comments, then open the original, save, and
   * share (Saved) or reblog (everything else: a follow's post, else the link).
   * @param {Item} item @param {PortalResult} portal @param {boolean} [when] @param {boolean} [reblog] add the reblog button
   */
  function itemActions(item, portal, when = true, reblog = true) {
    const { out, byline } = compactMeta(item, when);
    if (item.url) out.push(el('button', { class: 'mi go', title: 'Open the original', 'aria-label': 'Open the original', onclick: () => openLink(item.url ?? '') }, icon('external')));   // checked just before
    out.push(saveButton(item, portal.source));
    if (portal.source === 'saved' && item.url) out.push(el('button', { class: 'mi go', title: 'Share to your space', 'aria-label': 'Share to your space', onclick: () => openComposer(item) }, icon('share')));
    if (reblog && portal.source !== 'saved') { const button = reblogButton(reblogTarget(item, portal, item.share)); if (button) out.push(button); }
    return { out, byline };
  }

  /**
   * What the people you follow did with a story. The context row ("@ana shared", "@ben
   * reblogged @ana", "Reblogged by @ben, @cy and 2 more"), the trail (the original's note,
   * then one reblog's: never deeper), why the original is gone, and what the reblog button
   * acts on (the post behind it, else the link).
   * @param {Item} item @param {PortalResult} portal @param {NonNullable<ItemLook['shared']>} shared
   */
  function storySocial(item, portal, shared) {
    const reblogs = shared.filter((s) => s.share?.reblog);
    const original = reblogs[0]?.share?.reblog;
    const direct = shared.find((s) => !s.share?.reblog);
    const by = original ? original.by : direct?.handle;
    let context = '';
    if (reblogs.length > 2) context = `Reblogged by ${sharerNames(reblogs.map((s) => s.handle))}`;
    else if (reblogs.length) context = `${sharerNames(reblogs.map((s) => s.handle))} reblogged ${original?.by ? `@${original.by}` : 'a removed post'}`;
    else if (shared.length) context = `${sharerNames(shared.map((s) => s.handle))} shared`;
    /** @type {Array<{ by: string, note: string }>} */
    const trail = [];
    const originalNote = original ? original.note : direct?.note;
    if (by && originalNote) trail.push({ by, note: originalNote });
    const reblogNote = reblogs.find((s) => s.note);
    if (reblogNote?.note) trail.push({ by: reblogNote.handle, note: reblogNote.note });
    const removed = original?.removed === 'detached' ? 'Its author removed the original post from this reblog.' : original?.removed ? 'The original post was removed.' : '';
    // Reblog the post behind it (any of them reaches the same original); its count and your reblog come from the one that knows most.
    const behind = [...shared].map((s) => s.share).filter((s) => s !== undefined).sort((a, b) => Number(Boolean(b.mine)) - Number(Boolean(a.mine)) || (b.reblogs ?? 0) - (a.reblogs ?? 0))[0];
    const target = reblogTarget(item, portal, behind, by ? { by, note: originalNote } : undefined);
    return { context, trail, removed, target };
  }

  /** "@a shared", "@a and @b", "@a, @b and 2 more". @param {string[]} handles */
  function sharerNames(handles) {
    const names = handles.map((h) => `@${h}`);
    if (names.length <= 2) return names.join(' and ');
    return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  }

  /** Which portal an item is from, outside it: the portal's dot and title. @param {PortalResult} portal @param {string} color */
  const itemFrom = (portal, color) => el('div', { class: 'item-from' }, el('span', { class: 'dot', style: `background:${color}` }), portal.title);
  /** The agent's reason, set apart from the source's words. @param {string} why */
  const itemWhy = (why) => el('div', { class: 'item-why' }, el('span', { class: 'item-why-label' }, 'Why this'), why);

  /** A click anywhere on the item but its buttons and links opens it. @param {Item} item @param {PortalResult} portal */
  const openOnClick = (item, portal) => (/** @type {MouseEvent} */ e) => { if (!/** @type {Element} */ (e.target).closest('button, a')) openFrom(e, item, portal); };

  /** @type {Record<ItemForm, (item: Item, portal: PortalResult, look: ItemLook) => HTMLElement>} */
  const ITEM_FORMS = {
    /** A line in a portal's list: title, summary, a thumbnail beside them, and every action. */
    row(item, portal, { color = '', from = false, why = '' }) {
      const { out, byline } = itemActions(item, portal);
      const text = [itemTitle(item), item.summary ? el('span', { class: 'item-summary' }, item.summary) : null];
      const main = el('button', { class: 'item-main', type: 'button', title: byline, onclick: (/** @type {MouseEvent} */ e) => openFrom(e, item, portal) },
        item.image && item.image.kind === 'thumb' ? el('span', { class: 'item-row' }, thumbBox(item, portal), el('span', { class: 'item-text' }, text)) : text);
      return el('div', { class: 'item', onclick: openOnClick(item, portal) }, from ? itemFrom(portal, color) : null, main,
        out.length ? el('div', { class: 'item-meta' }, out) : null, why ? itemWhy(why) : null);
    },

    /** The front page's first story: its picture across the top, a larger title, a longer summary. */
    lead(item, portal, { color = '', why = '' }) {
      const { out, byline } = itemActions(item, portal);
      const main = el('button', { class: 'item-main', type: 'button', title: byline, onclick: (/** @type {MouseEvent} */ e) => openFrom(e, item, portal) },
        item.image && item.image.kind === 'thumb' ? thumbBox(item, portal) : null,
        itemTitle(item), item.summary ? el('span', { class: 'item-summary' }, item.summary) : null);
      return el('div', { class: 'item lead', style: `--mp-source-color:${color}`, onclick: openOnClick(item, portal) }, itemFrom(portal, color), main,
        out.length ? el('div', { class: 'item-meta' }, out) : null, why ? itemWhy(why) : null);
    },

    /**
     * A story in the river: who you follow shared it, the portal it's from and its age, its
     * picture across, a larger title, a sharer's note in their own voice, every action. The
     * portal's name opens the portal.
     */
    story(item, portal, { color = '', why = '', also = [], shared = [] }) {
      // A Following item's meta is "@handle", "reblogged @x" and its kind, and its summary is the
      // note: the context row and the trail say those, so they aren't repeated.
      const following = portal.source === 'following';
      const meta = following ? item.meta.filter((m) => !m.startsWith('@') && !m.startsWith('reblogged ') && m !== 'link') : item.meta;
      const { out, byline } = itemActions({ ...item, meta }, portal, false, false);
      const { context, trail, removed, target } = storySocial(item, portal, shared);
      const reblog = reblogButton(target);
      if (reblog) out.push(reblog);
      const main = el('button', { class: 'item-main', type: 'button', title: byline, onclick: (/** @type {MouseEvent} */ e) => openFrom(e, item, portal) },
        item.image && item.image.kind === 'thumb' ? thumbBox(item, portal) : null,
        itemTitle(item), item.summary && !following ? el('span', { class: 'item-summary' }, item.summary) : null);
      return el('article', { class: 'item story', style: `--mp-source-color:${color}`, onclick: openOnClick(item, portal) },
        context ? el('div', { class: 'story-context' }, context) : null,
        el('div', { class: 'item-from' }, el('span', { class: 'dot', style: `background:${color}` }),
          el('button', { class: 'story-portal', type: 'button', title: `Open ${portal.title}`, onclick: () => openPortal(portal.portalId) }, portal.title),
          also.length ? el('span', { class: 'story-also' }, `also on ${also.join(', ')}`) : null,
          item.publishedAt ? el('span', { class: 'story-when' }, ago(item.publishedAt)) : null),
        main,
        removed ? el('p', { class: 'story-removed' }, removed) : null,
        trail.map((n) => el('p', { class: 'story-note' }, el('span', { class: 'story-note-by' }, `@${n.by}`), n.note)),
        out.length ? el('div', { class: 'item-meta' }, out) : null, why ? itemWhy(why) : null);
    },

    /** A card in a shelf. In a media shelf every card gets a picture area, so the row stays even. */
    tile(item, portal, { color = '', media = false }) {
      const meta = compactMeta(item).out;
      const save = saveButton(item, portal.source);
      if (save) { save.classList.add('go'); meta.push(save); }
      const reblog = portal.source === 'saved' ? null : reblogButton(reblogTarget(item, portal, item.share));
      if (reblog) meta.push(reblog);
      const content = [itemTitle(item), media ? null : item.summary ? el('span', { class: 'item-summary' }, item.summary) : null];
      const main = el('button', { class: 'card-main', type: 'button', title: item.title, onclick: (/** @type {MouseEvent} */ e) => openFrom(e, item, portal) },
        media ? [thumbBox(item.image && item.image.kind === 'thumb' ? item : { ...item, image: undefined }, portal), el('span', { class: 'card-body' }, content)] : content);
      return el('div', { class: media ? 'card media' : 'card', style: `--mp-source-color:${color}`, onclick: openOnClick(item, portal) }, main,
        meta.length ? el('div', { class: 'item-meta' }, meta) : null);
    },
  };
