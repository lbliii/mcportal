  // room/social.js: social: clips, composer, spaces, shares
  // ------------------------------------------------------------ clips
  // Clips are structured data from our own server; every piece is still built as
  // DOM text. Images are <img src="data:…">, so nothing inside an SVG can run.
  /** @typedef {ToolResults['open_space']['space']} Space */
  /** A share to open: an Item of a following portal, or a post in a space. @typedef {{ title: string; share?: { id: string; kind: 'link' | 'clip' } }} ShareRef */

  /** @param {ClipData} data */
  function clipBody(data) {
    if (data.kind === 'quote') return [el('p', { class: 'clip-quote' }, data.text), data.attribution ? el('p', { class: 'clip-attr' }, `— ${data.attribution}`) : null];
    if (data.kind === 'exchange') return data.turns.map((t) => el('div', { class: `turn ${t.speaker === 'user' ? 'user' : ''}` }, el('div', { class: 'speaker' }, t.speaker), el('div', { class: 'said' }, t.text)));
    if (data.kind === 'note') return [...blockNodes(data.blocks).childNodes];
    if (data.kind === 'table') return [el('div', { class: 'table-wrap' }, el('table', null,
      el('thead', null, el('tr', null, data.columns.map((c) => el('th', null, c)))),
      el('tbody', null, data.rows.map((r) => el('tr', null, r.map((c) => el('td', null, c)))))))];
    if (data.kind === 'image' && /^image\/(png|jpeg|webp|svg\+xml)$/.test(data.mime) && /^[A-Za-z0-9+/=]+$/.test(data.data)) {
      const img = el('img', { class: 'clip-img', alt: '', src: `data:${data.mime};base64,${data.data}` });
      img.addEventListener('click', () => img.classList.toggle('zoom'));
      return [img];
    }
    if (data.kind === 'link' && isHttpUrl(data.url)) return [el('p', null, el('button', { class: 'btn', onclick: () => openLink(data.url) }, data.url))];
    return [el('div', { class: 'error' }, 'This clip can\'t be shown.')];
  }

  /** @param {Clip} clip @param {boolean} withBack */
  function clipNodes(clip, withBack) {
    /** @type {Partial<Clip['source']>} */
    const src = clip.source || {};
    const from = src.url ? (src.title || new URL(src.url).hostname) : src.kind === 'conversation' ? 'a conversation' : (src.title || '');
    const top = el('div', { class: 'reader-top' },
      iconButton('back', withBack ? 'Back to your room' : 'Open your room', closeReader, 'ib'),
      src.url && isHttpUrl(src.url) ? iconButton('external', 'Open where it came from', () => openLink(src.url ?? ''), 'ib') : null);  // checked just before
    return present([top, el('h1', null, clip.title),
      el('div', { class: 'byline' }, [`${clip.kind[0].toUpperCase()}${clip.kind.slice(1)}`, from ? `from ${from}` : '', `clipped ${ago(clip.createdAt)}`].filter(Boolean).join(' · ')),
      clip.tags.length ? el('div', { class: 'clip-tags' }, clip.tags.map((t) => el('span', null, `#${t}`))) : null,
      clip.note ? el('p', { class: 'clip-note' }, clip.note) : null,
      el('div', { class: 'body' }, clipBody(clip.data)),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: (/** @type {MouseEvent} */ e) => { /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.currentTarget).parentNode).replaceWith(composer({ clipId: clip.id }, clip.title)); } }, icon('share'), ' Share to your space')),  // the button's parent: this row
      el('div', { class: 'prov' }, `Your clip ${clip.id}. Only you can see it until you share it.`)]);
  }

  // This view belongs to a get_clip call: it is a clip card, not a room.
  /** @param {Clip} clip */
  function showClipCard(clip) {
    root.classList.add('article-view');
    $('roomName').textContent = 'clip';
    $('grid').hidden = true;
    const reader = $('reader');
    reader.hidden = false; reader.scrollTop = 0;
    reader.replaceChildren(...clipNodes(clip, false));
    setStatus('');
  }

  /** @param {string} id */
  async function loadClipCard(id) {
    setStatus('Stand by…');
    try {
      showClipCard((await callTool('get_clip', { id })).structuredContent.clip);
    } catch (error) {
      setStatus('');
      $('grid').hidden = true;
      $('reader').hidden = false;
      $('reader').replaceChildren(el('div', { class: 'error' }, `That clip has vanished into another dimension (${errorText(error)}).`));
    }
  }

  /** @param {Item} item */
  async function openClip(item) {
    const reader = $('reader');
    rememberRoomNavigation();
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    reader.replaceChildren(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title), el('div', { class: 'byline' }, 'Stand by…'));
    try {
      // Only clip items come here (openItem checks item.clip).
      const clip = (await callTool('get_clip', { id: /** @type {NonNullable<Item['clip']>} */ (item.clip).id })).structuredContent.clip;
      reader.replaceChildren(...clipNodes(clip, true));
      if (!DEV) {
        hostRequest('ui/update-model-context', {
          content: [{ type: 'text', text: `The user opened their clip ${clip.id} (${clip.kind}) in MCPortal. Use get_clip with that id if they ask about it.` }],
          structuredContent: { viewingClip: { id: clip.id } },
        }, 5000).catch(() => {});
      }
    } catch (error) {
      reader.replaceChildren(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title),
        el('div', { class: 'error' }, `That clip has vanished into another dimension (${errorText(error)}).`));
    }
  }

  // ------------------------------------------------------------ sharing into your space
  // The user writes the note here themselves, so nothing is posted in their name without them.
  /**
   * @param {Record<string, string | undefined>} target what to post: { clipId }, { savedUrl } or { reblogOf } @param {string} title
   * @param {{ verb?: string, onDone?: (share: SharedItem) => void }} [options] the button's word, and what to do once it's posted
   */
  function composer(target, title, { verb = 'Share', onDone } = {}) {
    const note = el('textarea', { placeholder: 'Add a note (optional): why it\'s worth a look', 'aria-label': `${verb} note (optional)`, maxlength: '500' });
    const audience = el('select', { class: 'btn', 'aria-label': `Who sees this ${verb.toLowerCase()}` }, el('option', { value: 'followers' }, 'Followers'), el('option', { value: 'everyone' }, 'Everyone who can see your Space'));
    const go = el('button', { class: 'btn', style: 'font-weight:600' }, verb);
    const box = el('div', { class: 'composer' }, el('div', { class: 'byline', style: 'margin:0 0 6px' }, `${verb} “${title}” to your space`), note,
      el('div', { class: 'row' }, el('span', null, 'Who sees it:'), audience, el('span', { class: 'spacer' }), go));
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const result = await callTool('share', { ...target, note: note.value, audience: audience.value });
        box.replaceChildren(el('div', null, `Transmitted! ${audience.value === 'everyone' ? 'Everyone who can see your Space' : 'Your followers'} will find it in your space.`));
        onDone?.(result.structuredContent.share);
      } catch (error) {
        toast(errorText(error));
        go.disabled = false;
      }
    });
    return box;
  }

  /**
   * The composer as its own view: share a saved item, or (with options) reblog a post, its
   * original's author and note quoted above, in their voice.
   * @param {{ title: string, url?: string | undefined }} item
   * @param {{ target?: Record<string, string | undefined>, verb?: string, quote?: { by: string, note?: string | undefined } | undefined, onDone?: (share: SharedItem) => void }} [options]
   */
  function openComposer(item, { target = { savedUrl: item.url }, verb = 'Share', quote, onDone } = {}) {
    const reader = $('reader');
    rememberRoomNavigation();
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    reader.replaceChildren(...present([el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')),
      el('h1', null, item.title), el('div', { class: 'byline' }, [item.url, quote ? `reblogging @${quote.by}` : ''].filter(Boolean).join(' · ')),
      quote && quote.note ? el('p', { class: 'story-note' }, el('span', { class: 'story-note-by' }, `@${quote.by}`), quote.note) : null,
      composer(target, item.title, { verb, onDone })]));
  }

  // ------------------------------------------------------------ spaces
  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back]
   * @param {(input: Record<string, unknown>) => Promise<boolean>} [saveOwner] */
  function spaceSheet(space, withBack, back, saveOwner) {
    const sheet = el('div');
    // spaceFormat escapes every authored value. Only the constant art engine supplies SVG.
    sheet.innerHTML = spaceFormat.render(space);
    for (const image of $$('[data-img]', sheet)) watchPicture(image);
    for (const button of sheet.querySelectorAll('button')) {
      button.addEventListener('click', async () => {
        const postId = button.dataset.spacePost;
        const pinId = button.dataset.spacePin;
        const handle = button.dataset.spaceHandle;
        if (postId) { const post = [...space.posts, ...(space.pinned ? [space.pinned] : [])].find((p) => p.id === postId); if (post) {
          const reader = $('reader'), nodes = [...reader.childNodes], className = reader.className, scroll = reader.scrollTop;
          openShare({ title: post.title, share: { id: post.id, kind: post.kind } }, () => { reader.className = className; reader.replaceChildren(...nodes); reader.scrollTop = scroll; primePictures(reader); });
        } }
        else if (handle) openSpaceFrom(handle);
        else {
          button.disabled = true;
          try {
            if (pinId) {
              const change = { pinnedShareId: space.pinnedShareId === pinId ? '' : pinId };
              if (saveOwner) { if (!await saveOwner(change)) button.disabled = false; }
              else { await callTool('set_public_profile', change); await loadSpace(space.mine ? '' : space.handle, false, back); }
            }
            else if (button.hasAttribute('data-space-follow')) {
              await callTool('relationship', { handle: space.handle, action: space.following ? 'unfollow' : 'follow' });
              space.following = !space.following; space.followers += space.following ? 1 : -1;
              showSpace(space, withBack, back);
            } else if (button.dataset.spaceSource !== undefined) {
              const src = space.sources[Number(button.dataset.spaceSource)];
              if (src) { await callTool('add_portal', { source: src.source, config: src.config, title: src.title }); button.textContent = 'Added'; }
            }
          } catch (error) { toast(errorText(error)); button.disabled = false; }
        }
      });
    }
    for (const post of sheet.querySelectorAll('.post')) post.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button, a')) return;
      post.querySelector('button[data-space-post]')?.dispatchEvent(new MouseEvent('click'));
    });
    if (space.format === 'patch') {
      for (const link of sheet.querySelectorAll('.space-tabs a')) link.addEventListener('click', (e) => {
        e.preventDefault(); const target = link.getAttribute('href');
        for (const section of sheet.querySelectorAll('section[id]')) if (section instanceof HTMLElement) section.hidden = `#${section.id}` !== target;
        for (const tab of sheet.querySelectorAll('.space-tabs a')) tab.setAttribute('aria-current', String(tab === link));
      });
    }
    return sheet;
  }

  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back] */
  function spaceNodes(space, withBack, back) {
    const preview = el('div', { class: 'space-owner-preview' });
    /** @type {ReturnType<typeof spaceCustomization> | undefined} */
    let owner;
    owner = space.mine ? spaceCustomization(space, () => {
      preview.replaceChildren(spaceSheet(space, withBack, back, owner?.save)); primePictures(preview);
    }) : undefined;
    preview.append(spaceSheet(space, withBack, back, owner?.save));
    const toolbar = withBack ? el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', back || closeReader, 'ib')) : null;
    if (toolbar) trackReaderToolbar(toolbar);
    if (owner) owner.layout.append(preview);
    return present([toolbar, owner ? el('div', { class: 'space-owner-view' }, owner.bar, owner.layout) : preview]);
  }

  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back] */
  function showSpace(space, withBack, back) {
    const reader = $('reader');
    reader.classList.add('space');
    $('grid').hidden = true; reader.hidden = false;
    reader.replaceChildren(...spaceNodes(space, withBack, back));
    primePictures(reader);
    setStatus('');
  }

  // This view belongs to an open_space call: it is a space card.
  /** @param {Space} space */
  function showSpaceCard(space) {
    root.classList.add('article-view');
    $('roomName').textContent = `@${space.handle}`;
    showSpace(space, false);
  }

  /** @param {string} handle '' for your own space @param {boolean} asCard @param {(e: MouseEvent) => void} [back] */
  async function loadSpace(handle, asCard, back) {
    setStatus('Stand by…');
    try {
      const space = (await callTool('open_space', handle ? { handle } : {})).structuredContent.space;
      asCard ? showSpaceCard(space) : showSpace(space, true, back);
    } catch (error) {
      setStatus('');
      toast(errorText(error));
    }
  }

  /**
   * Open someone's space from wherever their handle is, and come back to exactly that: the
   * room (closeReader restores it) or what the reader was showing, at its scroll position.
   * @param {string} handle
   */
  function openSpaceFrom(handle) {
    const reader = $('reader');
    if (reader.hidden) { rememberRoomNavigation(); void loadSpace(handle, false); return; }
    const was = { nodes: [...reader.childNodes], scroll: reader.scrollTop, className: reader.className };
    void loadSpace(handle, false, () => {
      reader.className = was.className;
      reader.replaceChildren(...was.nodes);
      reader.scrollTop = was.scroll;
    });
  }

  /** @param {import('../space-design.ts').Cover | undefined} cover */
  function patchAvatar(cover) {
    if (!cover) return null;
    const node = el('span'); node.innerHTML = spaceFormat.avatar(cover); return node;
  }

  /**
   * Every handle is a door (docs/plans/finding-people.md): "@ana" anywhere opens their space.
   * @param {string} handle @param {string} [className]
   */
  function handleButton(handle, className = '') {
    return el('button', { class: `handle ${className}`.trim(), type: 'button', title: `Open @${handle}'s space`,
      onclick: (/** @type {MouseEvent} */ e) => { e.stopPropagation(); openSpaceFrom(handle); } }, `@${handle}`);
  }

  /**
   * Follow the first person on a post you don't follow yet (its author, then the original's
   * author, then who it came via): the moment you liked what they shared.
   * @param {SharedItem} share
   */
  function followButton(share) {
    const handle = share.canFollow?.[0];
    if (!handle) return null;
    const button = el('button', { class: 'btn follow', type: 'button', 'aria-pressed': 'false' }, `Follow @${handle}`);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await callTool('relationship', { handle, action: 'follow' });
        button.setAttribute('aria-pressed', 'true');
        button.textContent = `Following @${handle}`;
        toast(`Following @${handle}. Their posts will arrive in your Following portal.`);
      } catch (error) { toast(errorText(error)); button.disabled = false; }
    });
    return button;
  }

  /**
   * A shared link opened in the reader keeps who shared it: their handle (a door), the
   * original's author for a reblog, the notes, and Follow for whoever on it you don't
   * follow yet (get_share knows; the Following portal's item doesn't).
   * @param {Item} item an item of a Following portal @param {NonNullable<Item['share']>} share its share
   */
  function sharedBy(item, share) {
    const author = item.meta.find((m) => /^@[a-z0-9_]{2,30}$/.test(m))?.slice(1);
    const by = share.reblog?.by;
    const actions = el('div', { class: 'share-actions' });
    callTool('get_share', { id: share.id })
      .then((result) => { const follow = followButton(result.structuredContent.share); if (follow) actions.append(follow); })
      .catch(() => {});   // the reader works without it
    return el('section', { class: 'shared-by', 'aria-label': 'Shared with you' },
      el('div', { class: 'byline' }, patchAvatar(share.cover), author ? handleButton(author) : 'Someone', ...(by ? [' reblogged ', handleButton(by), "'s link"] : [' shared this link'])),
      by && share.reblog?.note ? el('p', { class: 'story-note' }, handleButton(by, 'story-note-by'), share.reblog.note) : null,
      item.summary ? el('p', { class: by ? 'story-note' : 'share-note' }, by && author ? handleButton(author, 'story-note-by') : null, item.summary) : null,
      actions);
  }

  /**
   * What Space links left for this room, said once (open_room's intros): a Follow for the
   * people whose link brought the user here, and who joined through the user's own link.
   * @param {ToolResults['open_room']['intros']} intros
   */
  function drawIntros(intros) {
    document.getElementById('intros')?.remove();
    if (!intros || (!intros.offer.length && !intros.joined.length)) return;
    const strip = el('section', { id: 'intros', class: 'intros', 'aria-label': 'From Space links' });
    for (const handle of intros.offer) {
      const follow = el('button', { class: 'btn follow', type: 'button', 'aria-pressed': 'false' }, `Follow @${handle}`);
      const row = el('div', { class: 'intro' }, patchAvatar(intros.covers?.[handle]), el('span', null, 'You came in through ', handleButton(handle), "'s Space link."), follow,
        el('button', { class: 'link-btn', type: 'button', onclick: () => { row.remove(); if (!strip.children.length) strip.remove(); } }, 'Not now'));
      follow.addEventListener('click', async () => {
        follow.disabled = true;
        try {
          const result = (await callTool('relationship', { handle, action: 'follow' })).structuredContent;
          follow.setAttribute('aria-pressed', 'true');
          follow.textContent = `Following @${handle}`;
          if (result.layoutChanged) void loadRoom();   // the Following portal was just added
        } catch (error) { toast(errorText(error)); follow.disabled = false; }
      });
      strip.append(row);
    }
    if (intros.joined.length) {
      strip.append(el('div', { class: 'intro' }, el('span', null, ...intros.joined.flatMap((h, i) => [i ? ', ' : '', ...present([patchAvatar(intros.covers?.[h])]), handleButton(h)]), ` joined MCPortal through your Space link.`)));
    }
    $('grid').before(strip);
  }

  /**
   * A suggested person's buttons (the People portal, docs/plans/finding-people.md): Follow,
   * and Not for me, which takes them out of the portal and tells find_people next time.
   * @param {Item} item @param {PortalResult} portal
   */
  function personActions(item, portal) {
    const person = item.person;
    if (!person) return [];
    const follow = el('button', { class: 'mi person-act follow', type: 'button', 'aria-pressed': String(person.following), disabled: person.following }, person.following ? 'Following' : 'Follow');
    follow.addEventListener('click', async (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      follow.disabled = true;
      try {
        const result = (await callTool('relationship', { handle: person.handle, action: 'follow' })).structuredContent;
        person.following = true;
        follow.setAttribute('aria-pressed', 'true');
        follow.textContent = 'Following';
        toast(`Following @${person.handle}. Their posts will arrive in your Following portal.`);
        if (result.layoutChanged && !$('grid').hidden) void loadRoom();   // the Following portal was just added
      } catch (error) { toast(errorText(error)); follow.disabled = false; }
    });
    const pass = el('button', { class: 'mi person-act', type: 'button' }, 'Not for me');
    pass.addEventListener('click', async (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      pass.disabled = true;
      try {
        await callTool('pass_person', { handle: person.handle });
        portal.items = portal.items.filter((i) => i !== item);
        pass.closest('.item, .card')?.remove();
        toast(`Passed on @${person.handle}. Your agent will know next time it looks for people.`);
      } catch (error) { toast(errorText(error)); pass.disabled = false; }
    });
    return [follow, pass];
  }

  // This view belongs to a suggest_people call: the agent's picks as a card.
  /** @param {PortalResult} portal */
  function showPeopleCard(portal) {
    root.classList.add('article-view');
    $('roomName').textContent = 'people';
    $('welcome').hidden = true;
    $('grid').hidden = true;
    const reader = $('reader');
    reader.hidden = false; reader.scrollTop = 0;
    reader.replaceChildren(readerTop('', false), el('h1', null, 'People you might follow'),
      el('div', { class: 'byline' }, "Your agent's picks, from what they chose to share. They're kept in your People portal."),
      portal.items.length ? el('div', { class: 'people-card' }, portal.items.map((item) => renderItem(item, portal))) : el('div', { class: 'empty' }, 'Nobody to suggest right now.'));
    setStatus('');
  }

  /** Copy a Space's link; where the clipboard is off limits, show it to copy by hand. @param {string} link */
  async function copySpaceLink(link) {
    try { await navigator.clipboard.writeText(link); toast('Copied your Space link. Anyone who signs in through it is offered a follow of you.'); }
    catch { toast(`Your Space link: ${link}`); }
  }

  // ------------------------------------------------------------ shares
  // Other people's words: built as text like everything else, and labeled with who wrote them.
  // A reblog shows its original live (author, note, clip) above the reblogger's note: two
  // voices at most. Your own post shows who reblogged it and your controls over that.
  /** @param {SharedItem} share @param {boolean} withBack @param {Reblogger[]} [rebloggers] */
  function shareNodes(share, withBack, rebloggers = []) {
    const to = share.audience === 'everyone' ? 'everyone on MCPortal' : 'followers';
    const original = share.original && 'author' in share.original ? share.original : undefined;
    const preview = share.reblogOf ? original : share;
    const top = el('div', { class: 'reader-top' },
      iconButton('back', withBack ? 'Back to your room' : 'Open your room', closeReader, 'ib'),
      share.url && isHttpUrl(share.url) ? iconButton('external', 'Open the original', () => openLink(share.url ?? ''), 'ib') : null);  // checked just before
    const clip = original?.clip ?? share.clip;
    const body = clip ? clipBody(clip.data)
      : share.url && isHttpUrl(share.url) ? [el('p', null, el('button', { class: 'btn', onclick: () => openLink(share.url ?? '') }, share.url))] : [];  // checked just before
    const by = share.mine ? 'You' : handleButton(share.author.handle);
    const did = share.reblogOf
      ? [by, ' reblogged ', ...(original ? [handleButton(original.author.handle), `'s ${share.kind === 'clip' ? (clip ? clip.kind : 'clip') : 'link'}`] : ['a post']), ...(share.via ? [' via ', handleButton(share.via)] : [])]
      : [by, ` shared ${share.kind === 'clip' ? `a ${share.clip ? share.clip.kind : 'clip'}` : 'a link'}`];
    const removed = share.original && 'removed' in share.original
      ? (share.original.removed === 'detached' ? 'Its author removed the original post from this reblog.' : 'The original post was removed.') : '';
    const reblog = share.mine && !share.reblogOf ? null : reblogButton(shareTarget(share));
    const follow = followButton(share);
    return present([top, el('h1', null, share.title),
      el('div', { class: 'byline' }, did, ` · with ${to} · ${ago(share.createdAt)}`),
      removed ? el('p', { class: 'story-removed' }, removed) : null,
      preview?.image ? watchPicture(el('div', { class: 'space-link-preview', 'data-img': preview.image.url }, el('img', { class: 'space-link-image', alt: '', decoding: 'async' }))) : null,
      preview?.description ? el('p', { class: 'item-summary' }, preview.description) : null,
      original?.note ? el('p', { class: 'story-note' }, handleButton(original.author.handle, 'story-note-by'), original.note) : null,
      share.note ? el('p', { class: share.reblogOf ? 'story-note' : 'share-note' }, share.reblogOf ? (share.mine ? el('span', { class: 'story-note-by' }, 'You') : handleButton(share.author.handle, 'story-note-by')) : null, share.note) : null,
      el('div', { class: 'body' }, body),
      reblog || follow ? el('div', { class: 'share-actions' }, reblog, follow) : null,
      share.mine && !share.reblogOf ? reblogControls(share, rebloggers) : null,
      el('div', { class: 'prov' }, share.hiddenAt ? 'An admin hid this share; only you can see it.' : `Shared on MCPortal. ${share.mine ? '' : 'Written by another user.'}`)]);
  }

  /**
   * Your post's reblogs: who passed it on (each one can be cut loose from your post, for good)
   * and who may reblog it from now on.
   * @param {SharedItem} share @param {Reblogger[]} rebloggers
   */
  function reblogControls(share, rebloggers) {
    const rule = el('select', { class: 'btn', 'aria-label': 'Who can reblog this post' },
      ['anyone', 'followers', 'nobody'].map((r) => el('option', { value: r, selected: (share.reblogs ?? 'anyone') === r }, r === 'anyone' ? 'Anyone' : r === 'followers' ? 'Your followers' : 'Nobody')));
    rule.addEventListener('change', async () => {
      rule.disabled = true;
      try {
        await callTool('share_settings', { id: share.id, reblogs: rule.value });
        toast(rule.value === 'nobody' ? 'Sealed: nobody can reblog it now. Reblogs made before stay.' : 'Saved. Reblogs made before stay.');
      } catch (error) { toast(errorText(error)); }
      rule.disabled = false;
    });
    const list = rebloggers.map((r) => {
      const cut = r.detached ? el('span', { class: 'pm' }, 'removed from this reblog') : el('button', { class: 'link-btn', type: 'button' }, 'Remove my post from this reblog');
      if (!r.detached) cut.addEventListener('click', async () => {
        if (cut.dataset.sure !== 'yes') { cut.dataset.sure = 'yes'; cut.textContent = "Sure? This can't be undone"; return; }
        try {
          await callTool('share_settings', { id: share.id, detach: r.reblogId });
          cut.replaceWith(el('span', { class: 'pm' }, 'removed from this reblog'));
        } catch (error) { toast(errorText(error)); }
      });
      return el('li', null, patchAvatar(r.cover), handleButton(r.handle), ' · ', cut);
    });
    return el('section', { class: 'share-reblogs', 'aria-label': 'Reblogs' },
      el('h2', null, share.reblogCount ? `${share.reblogCount} reblog${share.reblogCount === 1 ? '' : 's'}` : 'No reblogs yet'),
      list.length ? el('ul', null, list) : null,
      el('div', { class: 'row' }, el('span', null, 'Who can reblog it:'), rule));
  }

  /** @param {SharedItem} share @param {Reblogger[]} [rebloggers] */
  function showShareCard(share, rebloggers) {
    root.classList.add('article-view');
    $('roomName').textContent = 'shared';
    $('grid').hidden = true;
    const reader = $('reader');
    reader.hidden = false; reader.scrollTop = 0;
    reader.replaceChildren(...shareNodes(share, false, rebloggers));
    primePictures(reader);
    setStatus('');
  }

  /** @param {string} id */
  async function loadShareCard(id) {
    setStatus('Stand by…');
    try {
      const { share, rebloggers, labs } = (await callTool('get_share', { id })).structuredContent;
      if (labs) state.labs = labs;
      showShareCard(share, rebloggers);
    } catch (error) {
      setStatus('');
      $('grid').hidden = true;
      $('reader').hidden = false;
      $('reader').replaceChildren(el('div', { class: 'error' }, `That share has vanished into another dimension (${errorText(error)}).`));
    }
  }

  /** @param {ShareRef} item @param {(scroll: number) => void} [back] back to the space, at this scroll position */
  async function openShare(item, back) {
    const reader = $('reader');
    const scroll = reader.scrollTop;
    reader.classList.remove('space');
    rememberRoomNavigation();
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    reader.replaceChildren(el('div', { class: 'reader-top' }, iconButton('back', 'Back', back ? () => back(scroll) : closeReader, 'ib')), el('h1', null, item.title), el('div', { class: 'byline' }, 'Stand by…'));
    try {
      // Only shares come here: openItem checks item.share, and space posts always carry one.
      const { share, rebloggers, labs } = (await callTool('get_share', { id: /** @type {NonNullable<ShareRef['share']>} */ (item.share).id })).structuredContent;
      if (labs) state.labs = labs;
      const nodes = shareNodes(share, true, rebloggers);
      if (back) nodes[0].replaceChildren(iconButton('back', 'Back to the space', () => back(scroll), 'ib'), ...[...nodes[0].children].slice(1));
      reader.replaceChildren(...nodes);
      primePictures(reader);
    } catch (error) {
      reader.replaceChildren(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title),
        el('div', { class: 'error' }, `That share has vanished into another dimension (${errorText(error)}).`));
    }
  }
