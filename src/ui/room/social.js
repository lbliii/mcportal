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
      src.url && isHttpUrl(src.url) ? iconButton('external', 'Open where it came from', () => openLink(/** @type {string} */ (src.url)), 'ib') : null);  // checked just before
    // filter(Boolean) drops the nulls, leaving elements.
    return /** @type {HTMLElement[]} */ ([top, el('h1', null, clip.title),
      el('div', { class: 'byline' }, [`${clip.kind[0].toUpperCase()}${clip.kind.slice(1)}`, from ? `from ${from}` : '', `clipped ${ago(clip.createdAt)}`].filter(Boolean).join(' · ')),
      clip.tags.length ? el('div', { class: 'clip-tags' }, clip.tags.map((t) => el('span', null, `#${t}`))) : null,
      clip.note ? el('p', { class: 'clip-note' }, clip.note) : null,
      el('div', { class: 'body' }, clipBody(clip.data)),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: (/** @type {MouseEvent} */ e) => { /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.currentTarget).parentNode).replaceWith(composer({ clipId: clip.id }, clip.title)); } }, icon('share'), ' Share to your space')),  // the button's parent: this row
      el('div', { class: 'prov' }, `Your clip ${clip.id}. Only you can see it until you share it.`)].filter(Boolean));
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
  /** @param {Record<string, string | undefined>} target what to share: { clipId } or { savedUrl } @param {string} title */
  function composer(target, title) {
    const note = el('textarea', { placeholder: 'Add a note (optional): why it\'s worth a look', 'aria-label': 'Share note (optional)', maxlength: '500' });
    const audience = el('select', { class: 'btn', 'aria-label': 'Who sees this share' }, el('option', { value: 'followers' }, 'Followers'), el('option', { value: 'mcportal' }, 'Everyone on MCPortal'));
    const go = el('button', { class: 'btn', style: 'font-weight:600' }, 'Share');
    const box = el('div', { class: 'composer' }, el('div', { class: 'byline', style: 'margin:0 0 6px' }, `Share “${title}” to your space`), note,
      el('div', { class: 'row' }, el('span', null, 'Who sees it:'), audience, el('span', { class: 'spacer' }), go));
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await callTool('share', { ...target, note: note.value, audience: audience.value });
        box.replaceChildren(el('div', null, `Transmitted! ${audience.value === 'mcportal' ? 'Everyone on MCPortal' : 'Your followers'} will find it in your space.`));
      } catch (error) {
        toast(errorText(error));
        go.disabled = false;
      }
    });
    return box;
  }

  /** @param {Item} item */
  function openComposer(item) {
    const reader = $('reader');
    rememberRoomNavigation();
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    reader.replaceChildren(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')),
      el('h1', null, item.title), el('div', { class: 'byline' }, item.url), composer({ savedUrl: item.url }, item.title));
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
    const meta = [ago(post.createdAt), post.mine && post.audience === 'followers' ? 'followers only' : null, post.hiddenAt ? 'hidden by an admin' : null].filter(Boolean);
    return [top, el('div', { class: 'pc' }, body, post.note ? el('p', { class: 'pn' }, post.note) : null, el('div', { class: 'pm' }, meta.join(' · ')))];
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
    // filter(Boolean) drops the nulls, leaving elements.
    return /** @type {HTMLElement[]} */ ([
      withBack ? el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', back || closeReader, 'ib')) : null,
      el('div', { class: 'space-head' },
        el('h1', null, name),
        el('div', { class: 'who' }, [`@${space.handle}`, space.spaceTitle && space.displayName ? space.displayName : null].filter(Boolean).join(' · ')),
        space.bio ? el('p', { class: 'bio' }, space.bio) : null,
        el('div', { class: 'row' }, follow, el('span', null, `${space.followers} follower${space.followers === 1 ? '' : 's'}`), el('span', null, `· ${space.posts.length} post${space.posts.length === 1 ? '' : 's'}`),
          space.mine ? el('span', null, '· this is what visitors see (followers-only posts show only to followers)') : null)),
      space.sources.length ? el('h2', null, 'Sources I read') : null,
      space.sources.length ? el('div', { class: 'sources' }, sources) : null,
      el('h2', null, 'Posts'),
      posts.length ? el('div', { class: 'posts' }, posts) : el('div', { class: 'empty' }, space.mine ? 'Your space stands empty, waiting. Share a saved item or a clip to put something in it.' : 'Nothing shared that you can see yet.'),
    ].filter(Boolean));
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

  /** @param {string} handle '' for your own space @param {boolean} asCard */
  async function loadSpace(handle, asCard) {
    setStatus('Stand by…');
    try {
      const space = (await callTool('open_space', handle ? { handle } : {})).structuredContent.space;
      asCard ? showSpaceCard(space) : showSpace(space, true);
    } catch (error) {
      setStatus('');
      toast(errorText(error));
    }
  }

  // ------------------------------------------------------------ shares
  // Other people's words: built as text like everything else, and labeled with who wrote them.
  /** @param {SharedItem} share @param {boolean} withBack */
  function shareNodes(share, withBack) {
    const who = share.mine ? 'You' : `@${share.author.handle}`;
    const to = share.audience === 'mcportal' ? 'everyone on MCPortal' : 'followers';
    const top = el('div', { class: 'reader-top' },
      iconButton('back', withBack ? 'Back to your room' : 'Open your room', closeReader, 'ib'),
      share.url && isHttpUrl(share.url) ? iconButton('external', 'Open the original', () => openLink(/** @type {string} */ (share.url)), 'ib') : null);  // checked just before
    const body = share.clip ? clipBody(share.clip.data)
      : share.url && isHttpUrl(share.url) ? [el('p', null, el('button', { class: 'btn', onclick: () => openLink(/** @type {string} */ (share.url)) }, share.url))] : [];  // checked just before
    // filter(Boolean) drops the nulls, leaving elements.
    return /** @type {HTMLElement[]} */ ([top, el('h1', null, share.title),
      el('div', { class: 'byline' }, [`${who} shared ${share.kind === 'clip' ? `a ${share.clip ? share.clip.kind : 'clip'}` : 'a link'}`, `with ${to}`, ago(share.createdAt)].join(' · ')),
      share.note ? el('p', { class: 'share-note' }, share.note) : null,
      el('div', { class: 'body' }, body),
      el('div', { class: 'prov' }, share.hiddenAt ? 'An admin hid this share; only you can see it.' : `Shared on MCPortal. ${share.mine ? '' : 'Written by another user.'}`)].filter(Boolean));
  }

  /** @param {SharedItem} share */
  function showShareCard(share) {
    root.classList.add('article-view');
    $('roomName').textContent = 'shared';
    $('grid').hidden = true;
    const reader = $('reader');
    reader.hidden = false; reader.scrollTop = 0;
    reader.replaceChildren(...shareNodes(share, false));
    setStatus('');
  }

  /** @param {string} id */
  async function loadShareCard(id) {
    setStatus('Stand by…');
    try {
      showShareCard((await callTool('get_share', { id })).structuredContent.share);
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
      const nodes = shareNodes((await callTool('get_share', { id: /** @type {NonNullable<ShareRef['share']>} */ (item.share).id })).structuredContent.share, true);
      if (back) nodes[0].replaceChildren(iconButton('back', 'Back to the space', () => back(scroll), 'ib'), ...[...nodes[0].children].slice(1));
      reader.replaceChildren(...nodes);
    } catch (error) {
      reader.replaceChildren(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title),
        el('div', { class: 'error' }, `That share has vanished into another dimension (${errorText(error)}).`));
    }
  }
