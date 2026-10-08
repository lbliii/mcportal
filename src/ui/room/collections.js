  /** @type {Collection[]} */
  let collectionList = [];
  /** @type {ToolResults['open_collection']['sources']} */
  let collectionSources = [];
  /** @type {CollectionData | null} */
  let currentDesk = null;
  let deskGeneration = 0;
  /** @type {Map<string, LibraryHit>} */
  const selectedEvidence = new Map();
  $('btnCollections').addEventListener('click', () => showCollections());

  /** @param {LibraryHit} hit */
  function hitEntry(hit) {
    return { ref: hit.ref, title: hit.title.slice(0, 300), ...(hit.source ? { source: hit.source.slice(0,200) } : {}), ...(hit.url ? { url: hit.url } : {}), ...(hit.docs ? { docs: hit.docs } : {}), ...(hit.locator ? { locator: hit.locator } : {}) };
  }
  /** @param {CollectionEntry} entry @returns {LibraryHit} */
  function entryHit(entry) {
    const clipId = entry.ref.startsWith('clip:') ? entry.ref.slice(5) : undefined;
    return { ref: entry.ref, title: entry.title, kind: clipId ? 'clip' : 'page', ...(clipId ? { clipId } : {}),
      ...(entry.ref.startsWith('url:') ? { url: entry.ref.slice(4) } : entry.url ? { url: entry.url } : {}),
      ...(entry.docs ? { docs: entry.docs } : {}), ...(entry.locator ? { locator: entry.locator } : {}),
      source: entry.source || '', tags: [], excerpt: entry.excerpt || '', updatedAt: entry.addedAt, saved: false, matched: [] };
  }
  function updateSelection() {
    $('btnCompare').disabled = selectedEvidence.size < 2 || selectedEvidence.size > 3;
    const compare = $('btnCompare'), label = selectedEvidence.size ? `Compare (${selectedEvidence.size})` : 'Compare';
    const text = $first('.experience-nav-label', compare);
    if (text) text.textContent = label;
    compare.setAttribute('aria-label', label); compare.title = label;
    if (selectedEvidence.size) compare.dataset.count = String(selectedEvidence.size); else delete compare.dataset.count;
    for (const button of $$('[data-select-ref]')) { const on = selectedEvidence.has(button.dataset.selectRef || ''); button.setAttribute('aria-pressed', String(on)); button.textContent = on ? 'Selected ✓' : 'Select'; }
    const tray = $first('.selection-tray');
    if (tray) { const fresh = selectionTray(); tray.replaceWith(fresh); }
  }
  /** @param {LibraryHit} hit */
  function selectEvidenceButton(hit) {
    const on = selectedEvidence.has(hit.ref);
    return el('button', { class: 'btn sm evidence-select', 'data-select-ref': hit.ref, 'aria-label': `Select ${hit.title}`, 'aria-pressed': String(on), onclick: () => {
      if (selectedEvidence.has(hit.ref)) selectedEvidence.delete(hit.ref); else selectedEvidence.set(hit.ref, hit);
      updateSelection();
    } }, on ? 'Selected ✓' : 'Select');
  }
  function selectionTray() {
    return el('div', { class: 'selection-tray experience-row', hidden: !selectedEvidence.size },
      el('span', null, `${selectedEvidence.size} kept ${selectedEvidence.size === 1 ? 'item' : 'items'} selected`),
      el('button', { class: 'btn', onclick: () => showCollections(true) }, 'Create a desk'),
      el('button', { class: 'btn', disabled: selectedEvidence.size < 2 || selectedEvidence.size > 3, onclick: () => showComparison([...selectedEvidence.values()]) }, 'Compare 2–3 sources'),
      el('button', { class: 'link-btn', onclick: () => { selectedEvidence.clear(); updateSelection(); } }, 'Clear'));
  }
  async function showCollections(fromSelection = false) {
    enterExperience('collections');
    $('experiences').replaceChildren(el('header', { class: 'experience-heading' }, el('span', { class: 'experience-kicker' }, 'MAKE SOMETHING OF YOUR READING'), el('h1', null, 'Your Topic Desks'), el('p', null, 'A place for a question, the evidence you keep, and the sources you follow.')),
      el('div', { id: 'collectionCreate' }), el('div', { id: 'collectionCards', class: 'collection-cards', 'aria-live': 'polite' }, 'Loading your collections…'));
    const title = el('input', { type: 'text', required: true, maxlength: 200, placeholder: 'Agents that remember', 'aria-label': 'New desk title' });
    const purpose = el('input', { type: 'text', maxlength: 1000, placeholder: 'What are you trying to understand?', 'aria-label': 'New desk purpose' });
    const note = el('p', { class: 'experience-muted', role: 'status' }, fromSelection ? `${selectedEvidence.size} selected items will be kept here.` : 'Start with a question. Add reading from Recall or your room.');
    const create = el('button', { class: 'btn primary', type: 'submit' }, 'Create desk');
    const form = el('form', { class: 'collection-create' }, title, purpose, create, note);
    form.addEventListener('submit', async e => {
      e.preventDefault(); create.disabled = true;
      try {
        const { collection } = (await callTool('update_collection', { action: 'create', title: title.value.trim(), purpose: purpose.value.trim(), ...(fromSelection ? { entries: [...selectedEvidence.values()].map(hitEntry) } : {}) })).structuredContent;
        if (!collection) throw new Error('The desk was not created.');
        selectedEvidence.clear(); updateSelection(); openDesk(collection.id);
      } catch (error) { note.textContent = errorText(error); create.disabled = false; }
    });
    $('collectionCreate').append(form);
    try {
      const data = (await callTool('open_collection')).structuredContent;
      collectionList = data.collections; collectionSources = data.sources;
      if (experience !== 'collections') return;
      drawCollectionCards();
    } catch (error) { if (experience === 'collections') $('collectionCards').textContent = `Could not load collections: ${errorText(error)}`; }
  }
  function drawCollectionCards() {
    $('collectionCards').replaceChildren(...collectionList.map(c => el('article', { class: 'collection-card' }, el('span', { class: 'experience-kicker' }, c.kind),
      el('h2', null, c.title), el('p', null, c.purpose || 'A collection of kept reading.'),
      el('p', { class: 'experience-muted' }, `${c.entries.length} kept · ${c.livePortals.length} live sources · updated ${ago(c.updatedAt)}`),
      el('button', { class: 'btn', onclick: () => openDesk(c.id) }, c.kind === 'trail' ? 'Follow trail →' : c.kind === 'comparison' ? 'Reopen comparison →' : 'Open desk →'))));
    if (!collectionList.length) $('collectionCards').append(el('div', { class: 'experience-empty' }, el('h2', null, 'Room for an idea'), el('p', null, 'Create your first desk above, or select a few pieces in Recall and bring them together.')));
  }
  async function openDesk(id = '', refresh = false) {
    const generation = ++deskGeneration;
    enterExperience('desk');
    $('experiences').replaceChildren(el('p', { class: 'experience-muted', role: 'status' }, 'Opening your collection…'));
    try {
      const data = (await callTool('open_collection', { id, refresh })).structuredContent;
      if (generation !== deskGeneration || experience !== 'desk') return;
      collectionList = data.collections; collectionSources = data.sources;
      if (!data.desk) throw new Error('This collection is unavailable.');
      showDesk(data.desk);
    } catch (error) { if (generation === deskGeneration && experience === 'desk') $('experiences').replaceChildren(el('p', { class: 'error', role: 'alert' }, errorText(error)), el('button', { class: 'btn', onclick: () => showCollections() }, 'Back to your desks')); }
  }
  /** @param {CollectionChange} change */
  async function changeDesk(change) {
    if (!currentDesk) return;
    const id = currentDesk.collection.id;
    try { await callTool('update_collection', { ...change, id }); await openDesk(id); }
    catch (error) { toast(errorText(error)); }
  }
  /** @param {CollectionData} data */
  function showDesk(data) {
    currentDesk = data;
    const c = data.collection;
    if (c.kind === 'comparison' && c.entries.length >= 2) { showComparison(c.entries.map(entryHit), c, data.orientationStale); return; }
    enterExperience('desk');
    const heading = el('header', { class: 'experience-heading' }, el('button', { class: 'link-btn', onclick: () => showCollections() }, '← Your collections'), el('div', { class: 'experience-kicker' }, c.kind === 'trail' ? 'READ WITH A DIRECTION' : 'YOUR TOPIC DESK'), el('h1', null, c.title), el('p', null, c.purpose),
      el('div', { class: 'experience-row' }, el('span', { class: 'experience-muted' }, `${c.entries.length} kept pieces · updated ${ago(c.updatedAt)}`),
        el('button', { class: 'btn', onclick: () => showRecall() }, 'Find more material'),
        el('button', { class: 'btn', onclick: () => editDesk(c) }, 'Edit desk'),
        el('button', { class: 'btn', onclick: () => changeDesk({ action: 'edit', kind: c.kind === 'trail' ? 'desk' : 'trail' }) }, c.kind === 'trail' ? 'View as desk' : 'Read as a trail')));
    const kept = el('section', { class: 'desk-kept' }, el('h2', null, c.kind === 'trail' ? 'Your reading path' : 'Kept for this question'),
      c.kind === 'comparison' ? el('p', {class:'watch-warning',role:'status'}, 'This comparison needs another source. Its remaining evidence is kept below; select material in Recall and add it here.') : null,
      selectionTray(),
      selectedEvidence.size ? el('button', { class: 'btn', onclick: async () => { await changeDesk({ action: 'add', entries: [...selectedEvidence.values()].map(hitEntry) }); selectedEvidence.clear(); updateSelection(); } }, `Add ${selectedEvidence.size} selected items to this desk`) : null,
      ...c.entries.map((entry, index) => deskEntry(entry, index, data)));
    if (!c.entries.length) kept.append(el('div', { class: 'experience-empty' }, 'Find a page or passage in Recall, select it, then add it here. You can also keep a personal note below.'));
    kept.append(noteComposer(c.id));
    const side = el('aside', { class: 'desk-context' }, orientationPanel(c, data.orientationStale),
      el('section', { class: 'desk-live' }, el('div', { class: 'experience-row' }, el('h2', null, 'Live sources'), el('button', { class: 'btn', onclick: () => openDesk(c.id, true) }, 'Refresh')),
        el('p', { class: 'experience-muted' }, 'Current reading from sources you chose for this desk.'),
        ...data.unavailablePortals.map(id => el('p', { class: 'error' }, `${id} was removed from your room. Reconnect a source in Edit desk.`)),
        ...data.live.map(portal => el('section', { class: 'desk-live-source' }, el('h3', null, portal.title), portal.error ? el('p', { class: 'error' }, portal.error) : null,
          ...portal.items.slice(0, 5).map(item => el('div', { class: 'desk-live-item' }, el('button', { class: 'link-btn', onclick: () => { suspendExperience(); openItem(item, portal); } }, item.title),
            item.url || item.clip ? el('button', { class: 'btn sm', onclick: () => keepDeskItem(item, portal) }, 'Keep') : null)))),
        !data.live.length ? el('p', { class: 'experience-muted' }, 'Choose sources from your room in Edit desk.') : null));
    $('experiences').replaceChildren(heading, el('div', { class: 'desk-layout' }, kept, side));
  }
  /** @param {CollectionEntry} entry @param {number} index @param {CollectionData} data */
  function deskEntry(entry, index, data) {
    const c = data.collection, hit = entryHit(entry), unavailable = data.unavailableRefs.includes(entry.ref);
    const preview = el('div', { class: 'desk-entry-preview' }, entry.excerpt || '');
    const card = el('article', { class: 'desk-entry', 'data-ref': entry.ref },
      el('div', { class: 'experience-row' }, el('span', { class: 'experience-kicker' }, c.kind === 'trail' ? `STEP ${index + 1}${entry.completedAt ? entry.completion === 'skipped' ? ' · SKIPPED' : ' · COMPLETED' : ''}` : entry.ref.startsWith('clip:') ? 'KEPT MATERIAL' : 'KEPT PAGE'), selectEvidenceButton(hit)),
      el('h3', null, entry.title), entry.reason ? el('p', null, entry.reason) : null, el('small', { class: 'experience-muted' }, entry.source || entry.url || entry.ref), preview,
      unavailable ? el('p', { class: 'error', role: 'status' }, 'This clip was removed. Its membership remains so you can see what is missing.') : null,
      el('div', { class: 'experience-row' }, el('button', { class: 'btn', disabled: unavailable, onclick: () => openLibraryHit(hit) }, 'Read →'),
        c.kind === 'trail' ? el('button', { class: 'btn', onclick: () => changeDesk({ action: 'complete', refs: [entry.ref], completed: !entry.completedAt }) }, entry.completedAt ? 'Undo completion' : 'Finish step') : null,
        c.kind === 'trail' && !entry.completedAt ? el('button', {class:'link-btn',onclick:()=>changeDesk({action:'complete',refs:[entry.ref],completed:true,skipped:true})},'Skip step') : null,
        el('button', { class: 'btn sm', disabled: index === 0, 'aria-label': `Move ${entry.title} earlier`, onclick: () => moveDeskEntry(index, -1) }, '↑'),
        el('button', { class: 'btn sm', disabled: index === c.entries.length - 1, 'aria-label': `Move ${entry.title} later`, onclick: () => moveDeskEntry(index, 1) }, '↓'),
        el('button', { class: 'link-btn', onclick: () => changeDesk({ action: 'remove', refs: [entry.ref] }) }, 'Remove from desk')));
    if (hit.clipId && !unavailable) callTool('get_clip', { id: hit.clipId }).then(({ structuredContent: { clip } }) => {
      if (preview.isConnected) preview.replaceChildren(...present(clipBody(clip.data)));
    }).catch(() => { if (preview.isConnected) preview.textContent = 'This clip is unavailable.'; });
    return card;
  }
  function moveDeskEntry(index = 0, by = 1) {
    if (!currentDesk) return;
    const order = currentDesk.collection.entries.map(e => e.ref), next = index + by;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    changeDesk({ action: 'reorder', refs: order });
  }
  /** @param {Collection} c @param {boolean} stale */
  function orientationPanel(c, stale) {
    return el('section', { class: 'desk-orientation' }, el('span', { class: 'experience-kicker' }, 'AGENT ORIENTATION'), el('h2', null, 'A way into the topic'),
      c.orientation ? el('div', null, stale ? el('p', { class: 'error', role: 'status' }, 'Some cited evidence is missing. Ask your agent to update this orientation.') : null,
        el('p', { class: 'agent-writing' }, c.orientation.text), el('small', { class: 'experience-muted' }, `Agent-written · ${new Date(c.orientation.createdAt).toLocaleString()}`),
        el('div', { class: 'orientation-citations' }, c.orientation.refs.map(ref => { const entry = c.entries.find(e => e.ref === ref); return entry ? el('button', { class: 'link-btn', onclick: () => openLibraryHit(entryHit(entry)) }, entry.title) : el('span', { class: 'error' }, 'Removed evidence'); })))
        : el('p', null, 'Ask your agent for an introduction grounded in the material you kept.'),
      el('button', { class: 'btn', disabled: !c.entries.length, onclick: () => askCollectionAgent(c) }, c.orientation ? 'Update with your agent' : 'Ask your agent'));
  }
  /** @param {Collection} c */
  async function askCollectionAgent(c) {
    const request = `Open my MCPortal collection ${c.id}. Write an orientation for its purpose using the actual entries. Use update_collection action orientation with text and refs naming evidence you consulted. Label uncertainty and keep source passages separate from your interpretation.`;
    await readingAgentRequest(request);
  }
  /** An explicit request, with a copyable fallback for hosts without messages. @param {string} request */
  async function readingAgentRequest(request) {
    if (!DEV && hostCapabilities.message) {
      try { await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: request }] }, 10000); toast('Sent to your agent'); return; }
      catch { /* The request stays available below. */ }
    }
    const panel = el('div', { class: 'agent-request', role: 'status' }, el('p', null, 'Tell your agent in the chat:'), el('p', null, request), copyButton(request));
    $('experiences').prepend(panel); panel.scrollIntoView({ block: 'nearest' });
  }
  /** @param {string} id */
  function noteComposer(id) {
    const note = el('textarea', { 'aria-label': 'Personal desk note', placeholder: 'What are you noticing? Keep a personal note…', maxlength: 16000, required: true });
    const button = el('button', { class: 'btn', type: 'submit' }, 'Keep personal note');
    const form = el('form', { class: 'desk-note' }, el('h3', null, 'Your own thinking'), note, button);
    form.addEventListener('submit', async e => {
      e.preventDefault(); button.disabled = true;
      try {
        const { clip } = (await callTool('clip', { kind: 'note', content: note.value, title: `Note for ${currentDesk?.collection.title || 'my desk'}`.slice(0,200), source: { kind: 'conversation' } })).structuredContent;
        await callTool('update_collection', { action: 'add', id, entries: [{ ref: `clip:${clip.id}`, title: clip.title }] });
        openDesk(id);
      } catch (error) { toast(errorText(error)); button.disabled = false; }
    });
    return form;
  }
  /** @param {Collection} c */
  function editDesk(c) {
    const title = el('input', { type: 'text', value: c.title, maxlength: 200, 'aria-label': 'Desk title', required: true });
    const purpose = el('textarea', { maxlength: 1000, 'aria-label': 'Desk purpose' }, c.purpose);
    const boxes = collectionSources.map(source => { const input = el('input', { type: 'checkbox', value: source.portalId, checked: c.livePortals.includes(source.portalId) }); return { input, node: el('label', null, input, source.title) }; });
    const form = el('form', { class: 'desk-editor' }, el('h2', null, 'Edit your desk'), title, purpose, el('fieldset', null, el('legend', null, 'Live sources (up to 8)'), ...boxes.map(b => b.node)),
      el('div', { class: 'experience-row' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save desk'), el('button', { class: 'btn', type: 'button', onclick: () => currentDesk && showDesk(currentDesk) }, 'Cancel'),
        el('button', { class: 'link-btn', type: 'button', onclick: async () => { try { await callTool('update_collection', { action: 'delete', id: c.id }); showCollections(); } catch (error) { toast(errorText(error)); } } }, 'Delete collection')));
    form.addEventListener('submit', e => { e.preventDefault(); changeDesk({ action: 'edit', title: title.value, purpose: purpose.value, livePortals: boxes.filter(b => b.input.checked).map(b => b.input.value) }); });
    $('experiences').replaceChildren(form);
  }
  /** @param {Item} item @param {PortalResult} portal */
  async function keepDeskItem(item, portal) {
    if (!item.url && !item.clip) return;
    const ref = item.clip ? `clip:${item.clip.id}` : `url:${item.url}`;
    const spec = state.profile?.columns.flatMap(c => c.panels).find(p => p.id === portal.portalId);
    const docs = spec?.source === 'docs' ? spec.config.url : undefined;
    await changeDesk({ action: 'add', entries: [{ ref, title: item.title.slice(0,300), source: portal.title.slice(0,200), ...(docs ? { docs } : {}) }] });
  }
