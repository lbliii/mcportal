  // room/add.js: add a source and OPML import
  // ------------------------------------------------------------ add a source
  function toggleAdd(open = $('addSheet').hidden) {
    $('addSheet').hidden = !open;
    $('btnAdd').setAttribute('aria-pressed', String(open));
    if (open) $('addInput').focus();
  }

  /** @param {string} query */
  async function findSources(query) {
    const hint = $('addHint'), list = $('addResults');
    hint.textContent = 'Looking…'; list.replaceChildren();
    try {
      const data = (await callTool('find_source', { query })).structuredContent;
      hint.textContent = data.candidates.length
        ? (data.candidates.length === 1 ? 'A signal! Open this door?' : `${data.candidates.length} signals from the void! Pick one.`)
        : (data.hint || "Nothing but static. No feed lurks behind that door; try the site's home page or another address.");
      list.replaceChildren(...data.candidates.map((c) => {
        const sub = c.source === 'rss' ? c.config.url : c.source === 'docs' ? docsSourceLabel(c.config) : c.source === 'github' ? `GitHub · ${c.config.mode === 'releases' ? c.config.repo : c.config.query}` : `Hacker News · ${c.config.feed}`;
        const add = el('button', { class: 'btn', onclick: () => addCandidate(c, add) }, 'Add');
        return el('li', { class: 'cand' },
          el('span', { class: 'dot', style: `background:${loneColor(c.source, c.config)}` }),
          el('div', { class: 'cand-main' },
            el('div', { class: 'cand-title', title: c.title }, c.title),
            el('div', { class: 'cand-sub', title: sub }, sub),
            c.preview.slice(0, 2).map((i) => el('div', { class: 'cand-prev', title: i.title }, `· ${i.title}`))),
          add);
      }));
    } catch (error) {
      hint.textContent = `Curses! Couldn't look that up: ${errorText(error)}`;
    }
  }

  /**
   * @param {ToolResults['find_source']['candidates'][number]} c
   * @param {HTMLButtonElement} button
   */
  async function addCandidate(c, button) {
    button.disabled = true; button.textContent = 'Adding…';
    try {
      const data = (await callTool('add_portal', { source: c.source, config: c.config, title: c.source === 'rss' ? undefined : c.title })).structuredContent;
      state.profile = { ...state.profile, ...data.profile };
      state.portals.set(data.portal.portalId, data.portal);
      drawLayout();
      toggleAdd(false); $('addInput').value = ''; $('addResults').replaceChildren();
      toast(`It's alive! ${data.portal.title} has joined your room.`);
      const node = $first(`[data-portal="${CSS.escape(data.portalId)}"]`);
      if (node) node.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest', inline: 'start' });
    } catch (error) {
      button.disabled = false; button.textContent = 'Add';
      toast(errorText(error).replace(/^Not added: /, ''));
    }
  }

  // ------------------------------------------------------------ OPML import
  // If the host blocks file pickers in embedded views, the user can attach the file in chat instead.
  function pickOpml() {
    try { $('opmlFile').value = ''; $('opmlFile').click(); }
    catch { toast('Attach the OPML file in the chat and ask your agent to import it'); }
  }
  $('opmlFile').addEventListener('change', async () => {
    const file = $('opmlFile').files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { toast('That file is over 1 MB'); return; }
    const status = root.classList.contains('welcome-view') ? el('div', { class: 'building' }) : null;
    if (status) $('welcome').append(status);
    const say = (/** @type {string} */ t) => (status ? (status.textContent = t) : setStatus(t));
    say('Smuggling your subscriptions through the portal…');
    try {
      const text = await file.text();
      const res = await callTool('import_opml', { opml: text });
      const summary = (res.content || []).map((c) => c.text).join(' ').split('\n')[0];
      say('Receiving transmissions…');
      const result = await callTool('open_room');
      toggleAdd(false);
      renderRoom(result.structuredContent);
      toast(summary);
    } catch (error) {
      say('');
      toast(`Curses! The import failed: ${errorText(error)}`);
    }
  });
  $('btnImportOpml').addEventListener('click', () => pickOpml());

  $('btnAdd').addEventListener('click', () => toggleAdd());
  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('addInput').value.trim();
    if (q) findSources(q);
  });
  $('addInput').addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleAdd(false); });
