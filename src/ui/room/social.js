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
      iconButton('back', experienceReturn ? 'Back to your reading experience' : withBack ? 'Back to your room' : 'Open your room', closeReader, 'ib'),
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
    renderReader(...clipNodes(clip, false));
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
      renderReader(el('div', { class: 'error' }, `That clip has vanished into another dimension (${errorText(error)}).`));
    }
  }

  /** @param {Item} item */
  async function openClip(item) {
    const reader = $('reader');
    rememberRoomNavigation();
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    renderReader(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title), el('div', { class: 'byline' }, 'Stand by…'));
    try {
      // Only clip items come here (openItem checks item.clip).
      const clip = (await callTool('get_clip', { id: /** @type {NonNullable<Item['clip']>} */ (item.clip).id })).structuredContent.clip;
      renderReader(...clipNodes(clip, true));
      if (!DEV) {
        hostRequest('ui/update-model-context', {
          content: [{ type: 'text', text: `The user opened their clip ${clip.id} (${clip.kind}) in MCPortal. Use get_clip with that id if they ask about it.` }],
          structuredContent: { viewingClip: { id: clip.id } },
        }, 5000).catch(() => {});
      }
    } catch (error) {
      renderReader(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title),
        el('div', { class: 'error' }, `That clip has vanished into another dimension (${errorText(error)}).`));
    }
  }

  // ------------------------------------------------------------ sharing into your space
  // The user writes the note here themselves, so nothing is posted in their name without them.
  let audienceSwitchId = 0;
  /** Public uses the existing everyone audience; followers-only never reaches the public Space. @param {SharedItem['audience']} audience */
  const audienceHelp = (audience) => audience === 'everyone' ? 'Visible on your Space. Private Space settings still apply.' : 'Visible only to your followers. Hidden from your public Space.';

  /** Keep newly opened composers in this room in sync with the preference saved by the server. @param {SharedItem} share */
  function rememberShareAudience(share) {
    if (state.profile) state.profile.shareAudience = share.audience;
  }

  /**
   * One audience control for composers and quick reblogs. Cards without a room load
   * the account's private preference before enabling submission.
   * @param {string} verb @param {HTMLButtonElement} submit @param {boolean} [inMenu] @param {SharedItem['audience']} [initialAudience]
   */
  function audienceSwitch(verb, submit, inMenu = false, initialAudience) {
    const id = `share-audience-${++audienceSwitchId}`;
    /** @type {SharedItem['audience']} */
    let selected = initialAudience ?? state.profile?.shareAudience ?? 'everyone';
    const help = el('div', { id: `${id}-help`, class: 'audience-help', 'aria-live': 'polite' }, audienceHelp(selected));
    /** @type {SharedItem['audience'][]} */
    const choices = ['everyone', 'followers'];
    const inputs = choices.map((value) => el('input', { type: 'radio', name: id, value, checked: selected === value,
      ...(inMenu ? { role: 'menuitemradio', tabindex: '-1', 'aria-checked': String(selected === value) } : {}),
      onchange: () => { selected = value; draw(); } }));
    const group = el('div', { class: 'audience-switch', role: 'group', 'aria-label': `${verb} audience`, 'aria-describedby': `${id}-help` },
      inputs.map((input, i) => el('label', null, input, choices[i] === 'everyone' ? 'Public' : 'Followers only')));
    const node = el('div', { class: 'share-audience-control', ...(inMenu ? { role: 'none' } : {}) }, group, help);
    let ready = Boolean(state.profile || initialAudience);
    function draw() {
      for (const input of inputs) {
        input.checked = input.value === selected;
        if (inMenu) input.setAttribute('aria-checked', String(input.checked));
      }
      help.textContent = audienceHelp(selected);
    }
    /** @param {boolean} disabled */
    function disable(disabled) { for (const input of inputs) input.disabled = disabled; submit.disabled = disabled; }
    function load() {
      disable(true);
      help.textContent = 'Loading your audience preference…';
      callTool('account_settings').then(({ structuredContent }) => {
        selected = structuredContent.shareAudience ?? 'everyone';
        ready = true;
        draw(); disable(false);
      }).catch((error) => {
        help.replaceChildren('Couldn’t load your audience preference. ', el('button', { type: 'button', class: 'link-btn',
          ...(inMenu ? { role: 'menuitem', tabindex: '-1' } : {}),
          onclick: load }, 'Retry'));
        toast(errorText(error));
      });
    }
    if (!state.profile && !initialAudience) load();
    return { node, value: () => selected, disable, isReady: () => ready };
  }

  /**
   * @param {Record<string, string | undefined>} target what to post: { clipId }, { savedUrl } or { reblogOf } @param {string} title
   * @param {{ verb?: string, audience?: SharedItem['audience'] | undefined, onDone?: (share: SharedItem) => void }} [options] the button's word, and what to do once it's posted
   */
  function composer(target, title, { verb = 'Share', audience: initialAudience, onDone } = {}) {
    const note = el('textarea', { placeholder: 'Add a note (optional): why it\'s worth a look', 'aria-label': `${verb} note (optional)`, maxlength: '500' });
    const go = el('button', { type: 'button', class: 'btn', style: 'font-weight:600' }, verb);
    const audience = audienceSwitch(verb, go, false, initialAudience);
    const box = el('div', { class: 'composer' }, el('div', { class: 'byline', style: 'margin:0 0 6px' }, `${verb} “${title}” to your space`), note,
      el('div', { class: 'row' }, audience.node, go));
    go.addEventListener('click', async () => {
      const selected = audience.value();
      audience.disable(true);
      try {
        const result = await callTool('share', { ...target, note: note.value, audience: selected });
        rememberShareAudience(result.structuredContent.share);
        box.replaceChildren(el('div', { role: 'status' }, `${verb === 'Reblog' ? 'Reblogged' : 'Shared'} · ${result.structuredContent.share.audience === 'everyone' ? 'Public' : 'Followers only'}. ${audienceHelp(result.structuredContent.share.audience)}`));
        onDone?.(result.structuredContent.share);
      } catch (error) {
        toast(errorText(error));
        audience.disable(false);
      }
    });
    return box;
  }

  /**
   * The composer as its own view: share a saved item, or (with options) reblog a post, its
   * original's author and note quoted above, in their voice.
   * @param {{ title: string, url?: string | undefined }} item
   * @param {{ target?: Record<string, string | undefined>, verb?: string, audience?: SharedItem['audience'] | undefined, quote?: { by: string, note?: string | undefined } | undefined, onDone?: (share: SharedItem) => void }} [options]
   */
  function openComposer(item, { target = { savedUrl: item.url }, verb = 'Share', audience, quote, onDone } = {}) {
    const reader = $('reader');
    rememberRoomNavigation();
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    renderReader(...present([el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')),
      el('h1', null, item.title), el('div', { class: 'byline' }, [item.url, quote ? `reblogging @${quote.by}` : ''].filter(Boolean).join(' · ')),
      quote && quote.note ? el('p', { class: 'story-note' }, el('span', { class: 'story-note-by' }, `@${quote.by}`), quote.note) : null,
      composer(target, item.title, { verb, audience, onDone })]));
  }

  // ------------------------------------------------------------ spaces
  /** Print-shop choices are named plates; text is authored here or approved in chat. */
  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back] */
  function printShop(space, withBack, back) {
    const shop = el('section', { class: 'space-printshop', 'aria-label': 'Print shop' }, el('strong', null, 'Print shop'));
    /** @param {Record<string, unknown>} input */
    const save = async (input) => {
      try { await callTool('set_public_profile', input); const updated = (await callTool('open_space', {})).structuredContent.space; showSpace(updated, withBack, back); }
      catch (error) { toast(errorText(error)); }
    };
    for (const [field, label, values, value] of [
      ['ink', 'Ink', spaceInks.sets.map((s) => s.name), space.cover?.ink],
      ['motif', 'Motif', spaceInks.motifs, space.cover?.motif],
      ['format', 'Format', spaceInks.formats, space.format || 'paperback'],
    ]) {
      const select = el('select', { 'aria-label': String(label) });
      // The three named sets above are arrays; keep their values out of arbitrary markup.
      if (Array.isArray(values)) for (const v of values) { const option = el('option', { value: v }, v.replace(/-/g, ' ')); option.selected = v === value; select.append(option); }
      select.addEventListener('change', () => save({ [String(field)]: select.value }));
      shop.append(el('label', null, String(label), select));
    }
    shop.append(el('button', { class: 'btn', type: 'button', onclick: () => save({ reroll: true }) }, 'Re-roll'),
      el('button', { class: 'btn', type: 'button', disabled: !space.link, onclick: () => copySpaceLink(space.link || '') }, 'Copy link to your space'),
      listingButton(space, withBack, back));
    const publicBox = el('input', { type: 'checkbox', 'aria-label': 'Public Space' });
    publicBox.checked = !space.private;
    publicBox.addEventListener('change', () => save({ public: publicBox.checked }));
    const settings = el('div', { class: 'space-printshop-settings' });
    settings.append(el('label', null, publicBox, 'Public Space: anyone on the web can read it.'), el('p', { class: 'space-privacy-note' }, 'Followers-only posts stay within your followers. Copies, screenshots and feed caches made while public cannot be recalled.'));
    const topics = el('input', { type: 'text', value: space.frequency?.join(', ') || '', 'aria-label': 'Transmitting on topics', placeholder: 'Up to four topics, separated by commas' });
    const travelers = el('input', { type: 'text', value: (space.travelers || []).map((p) => p.handle).join(', '), 'aria-label': 'Fellow travelers', placeholder: 'Up to six listed handles' });
    settings.append(el('label', null, 'Transmitting on', topics), el('label', null, 'Fellow travelers', travelers),
      el('button', { class: 'btn', type: 'button', onclick: () => save({ frequency: topics.value.split(',').map((s) => s.trim()).filter(Boolean), travelers: travelers.value.split(',').map((s) => s.trim()).filter(Boolean) }) }, 'Save words and travelers'));
    const stamps = el('details', null, el('summary', null, 'Visible stamps'));
    for (const name of spaceInks.stamps) {
      const box = el('input', { type: 'checkbox' }); box.checked = !space.hiddenStamps?.some((s) => s === name);
      box.addEventListener('change', () => {
        /** @type {Set<string>} */ const hidden = new Set(space.hiddenStamps || []); box.checked ? hidden.delete(name) : hidden.add(name);
        void save({ hiddenStamps: [...hidden] });
      });
      stamps.append(el('label', null, box, name));
    }
    settings.append(stamps);
    shop.append(el('details', null, el('summary', null, 'Words, travelers and privacy'), settings));
    return shop;
  }

  /** Owner-only preferences and a preview before turning private activity into a public list.
   * @param {Space} space @param {'sources' | 'people'} section @param {boolean} withBack @param {(e: MouseEvent) => void} [back]
   */
  function spaceSectionSettings(space, section, withBack, back) {
    const sources = section === 'sources';
    const setting = sources ? 'showSources' : 'showPeople';
    const curationKey = sources ? 'sourceCuration' : 'peopleCuration';
    const candidates = space.sectionPreview?.[section] ?? [];
    const label = sources ? 'Show sources I follow on my Space' : 'Show people I follow on my Space';
    const saved = space[curationKey] ?? { pinned: candidates.filter((entry) => entry.pinned).map((entry) => entry.key), order: [], hidden: [] };
    const enabled = space[setting] === true;
    const visibleCandidates = candidates.filter((entry) => !saved.hidden.includes(entry.key));
    const preview = el('div', { class: 'space-section-preview', hidden: true });
    const toggle = el('input', { type: 'checkbox', checked: enabled, 'aria-label': label });
    const box = el('div', { class: 'space-section-settings' });
    /** @param {Record<string, unknown>} patch */
    async function save(patch) {
      const wasOpen = box.querySelector('details')?.open;
      const scroll = $('reader').scrollTop;
      const focus = document.activeElement?.getAttribute('aria-label');
      const alternateFocus = focus?.startsWith('Pin ') ? focus.replace(/^Pin /, 'Unpin ')
        : focus?.startsWith('Unpin ') ? focus.replace(/^Unpin /, 'Pin ')
        : focus?.startsWith('Hide ') ? focus.replace(/^Hide /, 'Show ')
        : focus?.startsWith('Show ') ? focus.replace(/^Show /, 'Hide ') : focus;
      box.querySelectorAll('button, input').forEach((node) => node.setAttribute('disabled', ''));
      try {
        await callTool('set_public_profile', patch);
        const next = (await callTool('open_space')).structuredContent.space;
        showSpace(next, withBack, back);
        const settings = [...$('reader').querySelectorAll('.space-section-settings')][sources ? 0 : 1];
        const details = settings?.querySelector('details');
        if (details) details.open = Boolean(wasOpen);
        $('reader').scrollTop = scroll;
        if (focus) for (const node of settings?.querySelectorAll('button, input') ?? []) {
          if (node instanceof HTMLElement && (node.getAttribute('aria-label') === focus || node.getAttribute('aria-label') === alternateFocus)) { node.focus({ preventScroll: true }); break; }
        }
      } catch (error) {
        toast(errorText(error)); toggle.checked = enabled;
        box.querySelectorAll('button, input').forEach((node) => node.removeAttribute('disabled'));
      }
    }
    toggle.addEventListener('change', () => {
      if (!toggle.checked) { preview.hidden = true; if (enabled) save({ [setting]: false }); return; }
      preview.hidden = false;
      preview.replaceChildren(el('p', null, 'Preview — visible to signed-in MCPortal users after you enable this section.'),
        visibleCandidates.length ? el('ul', null, visibleCandidates.map((entry) => el('li', null,
          'title' in entry ? entry.title : `@${entry.handle}`))) : el('p', null, sources ? 'No eligible public sources yet. Add a public feed to your room and it will appear automatically.' : 'No people followed yet. Follow someone on MCPortal and they will appear automatically.'),
        el('button', { class: 'btn', onclick: () => save({ [setting]: true }) }, sources ? 'Show these sources on my Space' : 'Show these people on my Space'),
        el('button', { class: 'btn', onclick: () => { preview.hidden = true; toggle.checked = enabled; } }, 'Cancel'));
    });
    /** @param {string} key @param {'pinned' | 'hidden'} field */
    function flip(key, field) {
      const list = saved[field];
      return save({ [curationKey]: { ...saved, [field]: list.includes(key) ? list.filter((value) => value !== key) : [...list, key] } });
    }
    /** @param {string} key @param {number} direction */
    function move(key, direction) {
      const pinned = saved.pinned.includes(key);
      const keys = candidates.filter((entry) => saved.pinned.includes(entry.key) === pinned).map((entry) => entry.key);
      const at = keys.indexOf(key), to = at + direction;
      if (to < 0 || to >= keys.length) return;
      [keys[at], keys[to]] = [keys[to], keys[at]];
      save({ [curationKey]: { ...saved, [pinned ? 'pinned' : 'order']: keys } });
    }
    const personal = el('details', { class: 'space-curation' }, el('summary', null, 'Personalize this section (optional)'),
      el('p', null, 'Pinned entries appear first. Hide entries here without unfollowing them. Other entries update automatically.'),
      candidates.map((entry) => {
        const hidden = saved.hidden.includes(entry.key), pinned = saved.pinned.includes(entry.key);
        const peers = candidates.filter((candidate) => saved.pinned.includes(candidate.key) === pinned);
        const at = peers.findIndex((candidate) => candidate.key === entry.key);
        const title = 'title' in entry ? entry.title : `@${entry.handle}`;
        return el('div', { class: 'space-curation-entry' }, el('span', null, `${title}${hidden ? ' (hidden)' : ''}`),
          el('button', { class: 'btn', 'aria-label': `${pinned ? 'Unpin' : 'Pin'} ${title}`, onclick: () => flip(entry.key, 'pinned') }, pinned ? 'Unpin' : 'Pin'),
          el('button', { class: 'btn', 'aria-label': `${hidden ? 'Show' : 'Hide'} ${title}`, onclick: () => flip(entry.key, 'hidden') }, hidden ? 'Show' : 'Hide'),
          el('button', { class: 'btn', disabled: at === 0, 'aria-label': `Move ${title} up`, onclick: () => move(entry.key, -1) }, '↑'),
          el('button', { class: 'btn', disabled: at === peers.length - 1, 'aria-label': `Move ${title} down`, onclick: () => move(entry.key, 1) }, '↓'));
      }));
    box.append(el('label', { class: 'space-visibility' }, toggle, label),
      el('p', { class: 'byline' }, enabled ? 'Updates automatically as you follow and unfollow.' : sources
        ? space.showSources === false ? 'This section is hidden. Preview sources from your room to show it again; your recommendations and curation are kept.'
          : 'Room subscriptions are private. Preview eligible public sources before showing them here. Existing recommendations stay visible until you hide them.'
        : 'Your following list stays private until you choose to show it here.'), preview, personal);
    return box;
  }

  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back] */
  function spaceNodes(space, withBack, back) {
    const sheet = el('div');
    // spaceFormat escapes every authored value. Only the constant art engine supplies SVG.
    sheet.innerHTML = spaceFormat.render(space);
    for (const image of $$('[data-img]', sheet)) watchPicture(image);
    for (const button of sheet.querySelectorAll('button')) {
      button.addEventListener('click', async () => {
        const postId = button.dataset.spacePost;
        const pinId = button.dataset.spacePin;
        const handle = button.dataset.spaceHandle;
        if (postId) { const post = [...space.posts, ...(space.pinned ? [space.pinned] : [])].find((p) => p.id === postId); if (post) openShare({ title: post.title, share: { id: post.id, kind: post.kind } }, (scroll) => { showSpace(space, withBack, back); $('reader').scrollTop = scroll; }); }
        else if (handle) openSpaceFrom(handle);
        else {
          button.disabled = true;
          try {
            if (pinId) { await callTool('set_public_profile', { pinnedShareId: space.pinnedShareId === pinId ? '' : pinId }); await loadSpace(space.mine ? '' : space.handle, false, back); }
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
    const toolbar = withBack ? el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', back || closeReader, 'ib')) : null;
    if (toolbar) trackReaderToolbar(toolbar);
    return present([toolbar, space.mine ? printShop(space, withBack, back) : null,
      space.mine ? spaceSectionSettings(space, 'sources', withBack, back) : null,
      space.mine ? spaceSectionSettings(space, 'people', withBack, back) : null,
      sheet]);
  }

  /** @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back] */
  function showSpace(space, withBack, back) {
    const reader = $('reader');
    reader.classList.add('space');
    $('grid').hidden = true; reader.hidden = false;
    renderReader(...spaceNodes(space, withBack, back));
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
    const was = { controls: [...$('readerControls').childNodes], nodes: [...reader.childNodes], scroll: reader.scrollTop, className: reader.className };
    void loadSpace(handle, false, () => {
      reader.className = was.className;
      renderReader(...was.controls, ...was.nodes);
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
   * Your Space says whether people with similar sources can find you, and switches it.
   * @param {Space} space @param {boolean} withBack @param {(e: MouseEvent) => void} [back]
   */
  function listingButton(space, withBack, back) {
    const button = el('button', { class: 'btn', type: 'button', 'aria-pressed': String(Boolean(space.listed)) }, space.listed ? 'Listed: people with similar sources can find you' : 'Unlisted: list me');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { profile } = (await callTool('set_public_profile', { listed: !space.listed })).structuredContent;
        space.listed = profile.listed;
        toast(profile.listed ? 'Listed. People with similar sources can find you.' : "Unlisted. Your Space\'s public visibility is unchanged.");
        showSpace(space, withBack, back);
      } catch (error) { toast(errorText(error)); button.disabled = false; }
    });
    return button;
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
    renderReader(readerTop('', false), el('h1', null, 'People you might follow'),
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
    const to = share.audience === 'everyone' ? 'Public' : 'Followers only';
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
    renderReader(...shareNodes(share, false, rebloggers));
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
      renderReader(el('div', { class: 'error' }, `That share has vanished into another dimension (${errorText(error)}).`));
    }
  }

  /** @param {ShareRef} item @param {(scroll: number) => void} [back] back to the space, at this scroll position */
  async function openShare(item, back) {
    const reader = $('reader');
    const scroll = reader.scrollTop;
    reader.classList.remove('space');
    rememberRoomNavigation();
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    renderReader(el('div', { class: 'reader-top' }, iconButton('back', 'Back', back ? () => back(scroll) : closeReader, 'ib')), el('h1', null, item.title), el('div', { class: 'byline' }, 'Stand by…'));
    try {
      // Only shares come here: openItem checks item.share, and space posts always carry one.
      const { share, rebloggers, labs } = (await callTool('get_share', { id: /** @type {NonNullable<ShareRef['share']>} */ (item.share).id })).structuredContent;
      if (labs) state.labs = labs;
      const nodes = shareNodes(share, true, rebloggers);
      if (back) nodes[0].replaceChildren(iconButton('back', 'Back to the space', () => back(scroll), 'ib'), ...[...nodes[0].children].slice(1));
      renderReader(...nodes);
      primePictures(reader);
    } catch (error) {
      renderReader(el('div', { class: 'reader-top' }, iconButton('back', 'Back to your room', closeReader, 'ib')), el('h1', null, item.title),
        el('div', { class: 'error' }, `That share has vanished into another dimension (${errorText(error)}).`));
    }
  }
