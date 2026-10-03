  // room/room.js: the room: welcome, pictures, saving, refreshing, loadRoom (layouts.js draws it)
  // ------------------------------------------------------------ welcome (first run, or "start over")
  /** @param {ToolResults['open_room']} data */
  function renderWelcome(data) {
    const { packs, maxPacks, rebuilding } = /** @type {NonNullable<ToolResults['open_room']['onboarding']>} */ (data.onboarding);   // renderRoom calls this only when it's set
    state.profile = /** @type {Profile} */ ({ layout: 'columns', openIn: 'card', saved: [], .../** @type {Partial<Profile>} */ (data.profile) });
    root.classList.add('welcome-view');
    $('grid').hidden = true; $('reader').hidden = true;
    $('roomName').textContent = rebuilding ? 'start over' : 'welcome';
    drawIdentity(data.identity);
    if (data.notice) toast(data.notice);
    setStatus('');
    /** @type {Set<string>} */
    const chosen = new Set();
    const build = el('button', { class: 'btn primary', disabled: true, onclick: () => buildRoom([...chosen]) }, 'Summon my portals!');
    const cards = packs.map((p) => el('button', {
      class: 'pack', 'aria-pressed': 'false', title: p.sources.join(' · '),
      onclick: (/** @type {MouseEvent} */ e) => {
        const card = /** @type {HTMLButtonElement} */ (e.currentTarget);   // the pack button the listener is on
        chosen.has(p.id) ? chosen.delete(p.id) : chosen.add(p.id);
        card.setAttribute('aria-pressed', String(chosen.has(p.id)));
        for (const c of cards) if (c.getAttribute('aria-pressed') !== 'true') c.disabled = chosen.size >= maxPacks;
        build.disabled = !chosen.size;
        build.textContent = chosen.size ? `Summon my portals! (${chosen.size})` : 'Summon my portals!';
      },
    }, el('span', { class: 'tick', 'aria-hidden': 'true' }, icon('check')),
      el('span', { class: 'pl' }, p.label), el('span', { class: 'pb' }, p.blurb), el('span', { class: 'ps' }, p.sources.join(' · '))));
    const describe = el('input', { type: 'text', placeholder: 'woodworking, synthwave, Formula 1, a newsletter I read…', 'aria-label': 'Describe your interests' });
    const askAgent = async () => {
      const text = describe.value.trim();
      if (!text) { describe.focus(); return; }
      try {
        await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: `Set up my MCPortal around what I'm into: ${text}` }] }, 10000);
        toast('Your summons has been sent! Your agent will build your room in the chat.');
      } catch { toast('The chat is beyond our reach. Tell your agent there instead.'); }
    };
    describe.addEventListener('keydown', (e) => { if (e.key === 'Enter') askAgent(); });
    const signInFailure = data.identity.mode === 'ghost' ? data.identity.signInFailure : undefined;
    const signingIn = el('div', { class: 'building', hidden: !signInFailure }, signInFailure ? el('p', { class: 'error', role: 'alert' }, signInFailure.message) : null);   // the account menu is hidden here, so sign-in reports under the actions
    $('welcome').replaceChildren(...present([
      /** @type {Element} */ ($('brandBadge').content.firstElementChild).cloneNode(true),   // the template holds the badge
      el('h1', null, rebuilding ? 'Start over' : 'Choose your destiny!'),
      el('p', { class: 'lede' }, rebuilding
        ? `Pick up to ${maxPacks} packs to rebuild your room. This replaces your current layout; your saved items stay.`
        : `Pick up to ${maxPacks} things you're into. MCPortal opens a door to sources that work, and you can change anything later.`),
      el('div', { class: 'packs' }, cards),
      el('div', { class: 'welcome-actions' }, build,
        rebuilding
          ? el('button', { class: 'link-btn', onclick: () => { loading = null; loadRoom(); } }, 'Cancel')
          : el('button', { class: 'link-btn', onclick: () => buildRoom([]) }, 'Skip. Show me what lurks inside.'),
        rebuilding ? null : el('button', { class: 'link-btn', onclick: () => pickOpml() }, 'Fleeing another reader? Smuggle your subscriptions in (OPML)'),
        !rebuilding && data.identity?.mode === 'ghost' && data.identity.canSignIn
          ? el('button', { class: 'link-btn', onclick: () => { signingIn.hidden = false; signIn(signingIn); } }, 'Already have a portal? Sign in to bring it here')
          : null),
      signingIn,
      DEV ? null : el('div', { class: 'ask' },
        el('p', { class: 'lede' }, 'Into something stranger? Describe it and your agent will hunt down the sources.'),
        el('div', { class: 'add-row' }, describe, el('button', { class: 'btn', onclick: askAgent }, 'Ask your agent'))),
    ]));
    $('welcome').hidden = false;
  }

  /** @param {string[]} packIds */
  async function buildRoom(packIds) {
    const note = el('div', { class: 'building' }, packIds.length ? 'Forging your room in the star-furnace…' : 'Cracking open a sample room…');
    $('welcome').append(note);
    for (const b of $('welcome').querySelectorAll('button')) b.disabled = true;
    try {
      const built = (await callTool('build_room', { packs: packIds })).structuredContent;
      note.textContent = 'Receiving transmissions…';
      const result = await callTool('open_room');
      renderRoom(result.structuredContent);
      if (!DEV && packIds.length) {
        hostRequest('ui/update-model-context', {
          content: [{ type: 'text', text: `The user just built their MCPortal from starter packs: ${packIds.join(', ')} (${built.profile.columns.flatMap((c) => c.panels).length} sources). Offer to add anything specific they follow.` }],
        }, 5000).catch(() => {});
      }
    } catch (error) {
      note.textContent = `Curses! That didn't work: ${errorText(error)}`;
      for (const b of $('welcome').querySelectorAll('button')) b.disabled = false;
    }
  }

  /** @param {ToolResults['open_room']} data */
  function renderRoom(data) {
    if (data.onboarding) return renderWelcome(data);
    root.classList.remove('welcome-view', 'article-view');
    $('welcome').hidden = true;
    $('reader').hidden = true;
    $('grid').hidden = false;
    state.profile = /** @type {Profile} */ ({ layout: 'columns', openIn: 'card', saved: [], .../** @type {Partial<Profile>} */ (data.profile) });
    state.saved = new Set(state.profile.saved.map((s) => s.url));
    state.portals = new Map(data.portals.map((p) => [p.portalId, p]));
    state.edition = data.edition; state.lead = data.lead; state.labs = data.labs ?? [];
    $('roomName').textContent = data.profile.name;
    drawIdentity(data.identity);
    drawLayout();
    setUpdated(data.generatedAt);
    if (data.notice) toast(data.notice);
  }

  // ------------------------------------------------------------ pictures
  // The server fetches images (get_thumbnails) and returns data: URIs, so this view
  // never contacts third parties. Requested in batches as they scroll into view.
  /** @type {Map<string, string | null>} */
  const pictures = new Map();   // image url -> data URI, or null when unavailable
  /** @type {Set<string>} */
  const wanted = new Set();
  let pictureTimer = 0, pictureBusy = false;

  /** @param {HTMLElement} node a picture element, with data-img */
  function showPicture(node) {
    const url = (node.dataset.img ?? '');   // only picture elements (with data-img) come here
    if (!pictures.has(url)) return false;
    const data = pictures.get(url);
    const img = /** @type {HTMLImageElement | null} */ (node.tagName === 'IMG' ? node : $first('img', node));
    if (data && img) { img.src = data; img.classList.add('on'); }
    else if (!data && node.classList.contains('avatar')) node.classList.add('gone');
    return true;
  }
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const node = /** @type {HTMLElement} */ (e.target);   // only picture elements are observed
      seen.unobserve(node);
      if (!showPicture(node)) { wanted.add((node.dataset.img ?? '')); clearTimeout(pictureTimer); pictureTimer = setTimeout(loadPictures, 60); }
    }
  }, { rootMargin: '200px' });

  async function loadPictures() {
    if (pictureBusy || !wanted.size) return;
    pictureBusy = true;
    const batch = [...wanted].slice(0, 24);
    batch.forEach((u) => wanted.delete(u));
    try {
      const { images } = (await callTool('get_thumbnails', { urls: batch })).structuredContent;
      for (const u of batch) pictures.set(u, images[u] || null);
    } catch {
      for (const u of batch) pictures.set(u, null);
    }
    for (const node of $$('[data-img]')) if (batch.includes((node.dataset.img ?? ''))) showPicture(node);   // selected by data-img
    pictureBusy = false;
    if (wanted.size) loadPictures();
  }

  // The first few pictures in each portal are what's on screen: ask for them now,
  // without waiting on visibility (which never fires in a hidden or background frame).
  /** @param {HTMLElement} portalNode */
  function primePictures(portalNode, count = 6) {
    const urls = [...new Set([...$$('[data-img]', portalNode)].map((n) => (n.dataset.img ?? '')))].slice(0, count);   // selected by data-img
    for (const u of urls) if (!pictures.has(u)) wanted.add(u);
    if (wanted.size) { clearTimeout(pictureTimer); pictureTimer = setTimeout(loadPictures, 30); }
  }

  /**
   * @template {HTMLElement} T
   * @param {T} node
   * @returns {T}
   */
  function watchPicture(node) {
    if (!showPicture(node)) seen.observe(node);
    return node;
  }
  // Each portal gets its own fallback art style, in layout order, so no two sources on
  // screen look alike. Keyed by feed URL where there is one, so a feed keeps its look.
  /** @param {Profile} profile */
  function assignArt(profile) {
    const specs = profile.columns.flatMap((col) => col.panels);
    const keys = specs.map((spec) => (spec.config && 'url' in spec.config && typeof spec.config.url === 'string' ? spec.config.url : `${spec.source}:${spec.id}`));
    const styles = portalArt.styles(keys);
    state.art = new Map(specs.map((spec, i) => [spec.id, styles[i]]));
  }

  /** A portal's art style: its place in the layout, or (outside the layout) the one its feed hashes to. @param {PortalResult} portal @returns {number} */
  function artStyle(portal) {
    return state.art.has(portal.portalId) ? /** @type {number} */ (state.art.get(portal.portalId)) : portalArt.styles([portal.provenance.endpoint])[0];   // has() just said it's there
  }
  const HOUSE_SOURCES = new Set(['saved', 'clips', 'following', 'pinned']);
  /**
   * A source's colour, for its dot and its cards' top edge. Your own portals take the house
   * inks; a feed takes the lead ink of its fallback art, so the dot, the cards and the
   * pictures agree and no two sources on screen share a colour.
   * @param {string} source
   * @param {number} style
   */
  function sourceColor(source, style) {
    return HOUSE_SOURCES.has(source) ? `var(--mp-source-${source})` : `color-mix(in srgb, ${portalArt.leadOf(style)} var(--mp-source-lead-mix), var(--mp-brand-paper))`;
  }
  /** The colour a source outside the layout (a search result, someone's featured feed) would get. */
  const loneColor = (/** @type {string} */ source, /** @type {object | undefined} */ config) => sourceColor(source, portalArt.styles([config && 'url' in config && typeof config.url === 'string' ? config.url : `${source}:${JSON.stringify(config || {})}`])[0]);

  /**
   * The picture area starts as the source's fallback art; a loaded picture fades in over it.
   * @param {Item} item @param {PortalResult} portal
   */
  function thumbBox(item, portal) {
    const box = el('span', { class: 'thumb' },
      el('img', { alt: '', loading: 'lazy', decoding: 'async' }),
      item.video ? el('span', { class: 'play', 'aria-hidden': 'true' }, icon('play')) : null);
    const art = portalArt.draw(artStyle(portal), item.id || item.url || item.title);
    box.prepend(document.importNode(new DOMParser().parseFromString(art, 'image/svg+xml').documentElement, true));
    if (!item.image) return box;
    box.dataset.img = item.image.url;
    return watchPicture(box);
  }
  /** @param {Item} item one with an image */
  function avatarImg(item) {
    const img = el('img', { class: 'avatar', alt: '', 'data-img': /** @type {NonNullable<Item['image']>} */ (item.image).url });   // callers check item.image first
    return watchPicture(img);
  }

  // ------------------------------------------------------------ saving
  /** Something that can be saved: a feed item, or a page the reader shows. @typedef {Pick<Item, 'url' | 'title'>} Saveable */
  /** @param {Saveable} item @param {string} source */
  function saveButton(item, source, cls = 'mi save') {
    if (!item.url) return null;
    const on = state.saved.has(item.url);
    return el('button', {
      class: cls, 'data-save-url': item.url, 'aria-pressed': String(on),
      title: on ? 'Saved (click to remove)' : 'Save to your room',
      'aria-label': on ? 'Remove from saved' : 'Save to your room',
      onclick: (/** @type {MouseEvent} */ e) => { e.stopPropagation(); toggleSaved(item, source); },
    }, icon('bookmark'));
  }

  function markSaved() {
    for (const b of $$('[data-save-url]')) {
      const on = state.saved.has((b.dataset.saveUrl ?? ''));   // selected by data-save-url
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Saved (click to remove)' : 'Save to your room';
      b.setAttribute('aria-label', on ? 'Remove from saved' : 'Save to your room');
    }
  }

  /** @param {Saveable} item one with a url @param {string} source */
  async function toggleSaved(item, source) {
    const url = item.url ?? '';   // saveButton only offers it for items with a url
    const was = state.saved.has(url);
    was ? state.saved.delete(url) : state.saved.add(url);   // optimistic
    markSaved();
    try {
      const result = await callTool(was ? 'remove_saved' : 'save_item',
        was ? { url } : { url, title: item.title, source: source === 'saved' ? undefined : source });
      const data = result.structuredContent;
      state.saved = new Set(data.saved.map((s) => s.url));
      if (state.profile) {
        state.profile = { ...state.profile, ...data.profile };
        if (data.portal) state.portals.set(data.portal.portalId, data.portal);
        if (data.layoutChanged) { drawLayout(); toast('Saved! A Saved portal has materialized in your room.'); }
        else if (data.portal) redrawPortal(data.portal.portalId);
      }
      if (!was && !data.layoutChanged) toast('Saved!');
    } catch (error) {
      was ? state.saved.add(url) : state.saved.delete(url);
      toast(`Curses! Couldn't ${was ? 'remove' : 'save'} that: ${errorText(error)}`);
    }
    markSaved();
  }

  // Pinned portals hold data the agent fetched with another tool, so only the agent can
  // refresh them: the button asks it in the conversation. Only the portal id goes into
  // the message (ids are [a-z0-9-] slugs); the agent reads the recipe from open_room.
  /** @param {PortalResult} portal */
  function refreshButton(portal) {
    if (!portal.pin) return iconButton('refresh', `Refresh ${portal.title}`, () => refreshPortal(portal.portalId));
    return iconButton('refresh', `Ask your agent to refresh ${portal.title} from ${portal.pin.from}`, () => refreshPinned(portal));
  }
  /** @param {PortalResult} portal a pinned one */
  function pinnedFoot(portal) {
    return `pinned from ${/** @type {NonNullable<PortalResult['pin']>} */ (portal.pin).from} · updated ${ago(portal.provenance.fetchedAt)} · refresh asks your agent`;
  }
  /** @param {PortalResult} portal */
  async function refreshPinned(portal) {
    if (DEV) { toast(`Ask your agent to refresh "${portal.title}"`); return; }
    try {
      await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: `Refresh my pinned MCPortal portal (id ${portal.portalId}).` }] }, 10000);
      toast('Your summons has been sent! Your agent is refreshing it…');
    } catch {
      toast(`The chat is beyond our reach. Ask your agent there to refresh "${portal.title}".`);
    }
  }

  /** @param {string} portalId */
  async function refreshPortal(portalId) {
    const node = $first(`[data-portal="${CSS.escape(portalId)}"]`);
    if (node) node.style.opacity = '0.55';
    try {
      const result = await callTool('refresh_portal', { portalId });
      state.portals.set(portalId, result.structuredContent.portal);
    } catch (error) {
      toast(errorText(error));
    }
    redrawPortal(portalId);
  }

  function loadRoom() {
    if (loading) return loading;   // never run two loads at once
    setStatus('Stand by…');
    loading = (async () => {
      try {
        const result = await callTool('open_room');
        renderRoom(result.structuredContent);
      } catch (error) {
        setStatus('');
        if (/** @type {Error & { needsToken?: boolean }} */ (error).needsToken) {   // callTool rejects with Errors; /preview's 401 sets needsToken
          const input = el('input', { type: 'password', placeholder: 'MCPORTAL_TOKEN', autocomplete: 'off', style: 'flex:1;padding:6px 8px;border:1px solid var(--mp-border-divider);border-radius:7px;background:var(--mp-surface-canvas);color:var(--mp-text-primary)' });
          const connect = () => {
            devToken = input.value.trim();
            try { sessionStorage.setItem('mcportal-token', devToken); } catch {}
            loading = null;
            loadRoom();
          };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
          $('grid').replaceChildren(el('div', { class: 'portal', style: 'flex:1;max-width:460px;padding:14px;gap:10px' },
            el('div', null, devToken ? 'That token was not accepted. Paste the server\'s access token:' : 'Paste this server\'s access token to open the preview:'),
            el('div', { style: 'display:flex;gap:8px' }, input, el('button', { class: 'btn', onclick: connect }, 'Connect'))));
          input.focus();
          return;
        }
        $('grid').replaceChildren(el('div', { class: 'portal', style: 'flex:1' }, el('div', { class: 'error' }, `Your room didn't open (${errorText(error)}). Try again, or ask your agent to open it.`)));
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
