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
    const audience = el('select', { class: 'btn', 'aria-label': `Who sees this ${verb.toLowerCase()}` }, el('option', { value: 'followers' }, 'Followers'), el('option', { value: 'mcportal' }, 'Everyone on MCPortal'));
    const go = el('button', { class: 'btn', style: 'font-weight:600' }, verb);
    const box = el('div', { class: 'composer' }, el('div', { class: 'byline', style: 'margin:0 0 6px' }, `${verb} “${title}” to your space`), note,
      el('div', { class: 'row' }, el('span', null, 'Who sees it:'), audience, el('span', { class: 'spacer' }), go));
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const result = await callTool('share', { ...target, note: note.value, audience: audience.value });
        box.replaceChildren(el('div', null, `Transmitted! ${audience.value === 'mcportal' ? 'Everyone on MCPortal' : 'Your followers'} will find it in your space.`));
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
  const ACCENT = { blue: '#2563eb', teal: '#0d9488', green: '#16a34a', amber: '#d97706', orange: '#ea580c', rose: '#e11d48', violet: '#7c3aed', slate: '#475569' };

  /** @param {SharedItem} post */
  function postPreview(post) {
    const c = post.clip ? post.clip.data : null;
    let hostName = '';
    try { hostName = post.url ? new URL(post.url).hostname.replace(/^www\./, '') : ''; } catch { hostName = ''; }
    let top = null;
    if (c && c.kind === 'image' && c.data && /^image\/(png|jpeg|webp|svg\+xml)$/.test(c.mime) && /^[A-Za-z0-9+/=]+$/.test(c.data)) top = el('img', { alt: '', loading: 'lazy', src: `data:${c.mime};base64,${c.data}` });
    const body = [];
    if (c && c.kind === 'quote') body.push(el('p', { class: 'pq' }, c.text), c.attribution ? el('div', { class: 'pm' }, `— ${c.attribution}`) : null);
    else if (c && c.kind === 'table') body.push(el('div', { class: 'pt' }, post.title), el('table', { class: 'mini' }, el('tr', null, c.columns.slice(0, 4).map((x) => el('th', null, x))), c.rows.slice(0, 5).map((r) => el('tr', null, r.slice(0, 4).map((x) => el('td', null, x))))));
    else if (c && c.kind === 'note') body.push(el('div', { class: 'pt' }, post.title), el('div', { class: 'body-lines' }, c.blocks.slice(1, 4).map((b) => el('p', null, b.type === 'li' ? `• ${b.text}` : b.text))));
    else if (c && c.kind === 'exchange') body.push(el('div', { class: 'pt' }, post.title), el('div', { class: 'body-lines' }, c.turns.slice(0, 2).map((t) => el('p', null, el('b', null, `${t.speaker}: `), t.text.slice(0, 160)))));
    else if (c && c.kind === 'image') body.push(el('div', { class: 'pt' }, post.title));
    else body.push(el('div', { class: 'pt' }, post.title), hostName ? el('div', { class: 'pm', style: 'margin-top:0' }, hostName) : null);
    const original = post.original && 'author' in post.original ? post.original : undefined;
    const meta = [ago(post.createdAt), post.mine && post.audience === 'followers' ? 'followers only' : null, post.hiddenAt ? 'hidden by an admin' : null,
      post.reblogCount ? `${post.reblogCount} reblog${post.reblogCount === 1 ? '' : 's'}` : null].filter(Boolean);
    const reblogged = post.reblogOf ? el('div', { class: 'pr' }, icon('reblog'), original ? `reblogged @${original.author.handle}${post.via ? ` via @${post.via}` : ''}` : 'reblogged a removed post') : null;
    return [top, el('div', { class: 'pc' }, reblogged, body, post.note ? el('p', { class: 'pn' }, post.note) : null, el('div', { class: 'pm' }, meta.join(' · ')))];
  }

  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back] */
  function spaceNodes(space, withBack, back) {
    const name = space.spaceTitle || space.displayName || `@${space.handle}`;
    const follow = space.mine ? null : el('button', { class: 'btn follow', 'aria-pressed': String(space.following) }, space.following ? 'Following' : 'Follow');
    if (follow) follow.addEventListener('click', async () => {
      const action = space.following ? 'unfollow' : 'follow';
      follow.disabled = true;
      try {
        await callTool('relationship', { handle: space.handle, action });
        space.following = !space.following;
        space.followers += space.following ? 1 : -1;
        showSpace(space, withBack, back);
      } catch (error) { toast(errorText(error)); follow.disabled = false; }
    });
    const reShow = (/** @type {number} */ scroll) => { showSpace(space, withBack, back); $('reader').scrollTop = scroll || 0; };
    const posts = space.posts.map((post) => el('div', {
      class: 'post', role: 'button', tabindex: '0', title: 'Open',
      onclick: () => openShare({ title: post.title, share: { id: post.id, kind: post.kind } }, reShow),
      onkeydown: (/** @type {KeyboardEvent} */ e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openShare({ title: post.title, share: { id: post.id, kind: post.kind } }, reShow); } },
    }, postPreview(post)));
    const sources = space.sources.map((src) => {
      const add = space.mine ? null : el('button', { class: 'btn' }, 'Add');
      if (add) add.addEventListener('click', async () => {
        add.disabled = true;
        try { await callTool('add_portal', { source: src.source, config: src.config, title: src.title }); add.textContent = 'Added'; }
        catch (error) { toast(errorText(error)); add.disabled = false; }
      });
      // An rss source carries an rss config: normalizeFeatured pairs them.
      return el('div', { class: 'source' }, el('span', { class: 'dot', style: `background:${loneColor(src.source, src.config)}` }),
        el('div', { class: 'st' }, el('div', null, src.title), el('div', null, src.source === 'rss' ? (() => { try { return new URL(/** @type {Extract<PortalSpec, { source: 'rss' }>['config']} */ (src.config).url).hostname.replace(/^www\./, ''); } catch { return 'feed'; } })() : src.source === 'hn' ? 'Hacker News' : 'GitHub')), add);
    });
    return present([
      withBack ? el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', back || closeReader, 'ib')) : null,
      el('div', { class: 'space-head' },
        el('h1', null, name),
        el('div', { class: 'who' }, [`@${space.handle}`, space.spaceTitle && space.displayName ? space.displayName : null].filter(Boolean).join(' · ')),
        space.bio ? el('p', { class: 'bio' }, space.bio) : null,
        el('div', { class: 'row' }, follow, el('span', null, `${space.followers} follower${space.followers === 1 ? '' : 's'}`), el('span', null, `· ${space.posts.length} post${space.posts.length === 1 ? '' : 's'}`),
          space.mine ? el('span', null, '· this is what visitors see (followers-only posts show only to followers)') : null),
        space.mine && space.link ? el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: () => copySpaceLink(space.link ?? '') }, icon('share'), ' Copy link to your space')) : null),
      space.sources.length ? el('h2', null, 'Sources I read') : null,
      space.sources.length ? el('div', { class: 'sources' }, sources) : null,
      el('h2', null, 'Posts'),
      posts.length ? el('div', { class: 'posts' }, posts) : el('div', { class: 'empty' }, space.mine ? 'Your space stands empty, waiting. Share a saved item or a clip to put something in it.' : 'Nothing shared that you can see yet.'),
    ]);
  }

  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back] */
  function showSpace(space, withBack, back) {
    const reader = $('reader');
    // No accent reads ACCENT[undefined], which falls back to the default.
    reader.style.setProperty('--mp-space-accent', ACCENT[/** @type {keyof typeof ACCENT} */ (space.accent)] || 'var(--mp-action-primary)');
    reader.classList.add('space');
    $('grid').hidden = true; reader.hidden = false;
    reader.replaceChildren(...spaceNodes(space, withBack, back));
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
    const was = { nodes: [...reader.childNodes], scroll: reader.scrollTop, className: reader.className, accent: reader.style.getPropertyValue('--mp-space-accent') };
    void loadSpace(handle, false, () => {
      reader.className = was.className;
      reader.style.setProperty('--mp-space-accent', was.accent);
      reader.replaceChildren(...was.nodes);
      reader.scrollTop = was.scroll;
    });
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
      el('div', { class: 'byline' }, author ? handleButton(author) : 'Someone', ...(by ? [' reblogged ', handleButton(by), "'s link"] : [' shared this link'])),
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
      const row = el('div', { class: 'intro' }, el('span', null, 'You came in through ', handleButton(handle), "'s Space link."), follow,
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
      strip.append(el('div', { class: 'intro' }, el('span', null, ...intros.joined.flatMap((h, i) => [i ? ', ' : '', handleButton(h)]), ` joined MCPortal through your Space link.`)));
    }
    $('grid').before(strip);
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
    const to = share.audience === 'mcportal' ? 'everyone on MCPortal' : 'followers';
    const original = share.original && 'author' in share.original ? share.original : undefined;
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
      return el('li', null, handleButton(r.handle), ' · ', cut);
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
    } catch (error) {
      reader.replaceChildren(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title),
        el('div', { class: 'error' }, `That share has vanished into another dimension (${errorText(error)}).`));
    }
  }
