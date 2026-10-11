  /** @type {Collection[]} */
  let collectionList = [];
  /** @type {ToolResults['open_collection']['sources']} */
  let collectionSources = [];
  /** @type {CollectionData | null} */
  let currentDesk = null;
  let deskGeneration = 0;
  /** @type {Map<string, LibraryHit>} */
  const selectedEvidence = new Map();

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
    for (const button of $$('[data-select-ref]')) { const on = selectedEvidence.has(button.dataset.selectRef || ''); button.setAttribute('aria-pressed', String(on)); }
    const tray = $first('.selection-tray');
    if (tray) { const fresh = selectionTray(); tray.replaceWith(fresh); }
  }
  /** @param {LibraryHit} hit */
  function selectEvidenceButton(hit) {
    const on = selectedEvidence.has(hit.ref);
    const chip = uiChip({label:'Select', selected:on, className:'evidence-select', onChange:selected=>{
      if (selected) selectedEvidence.set(hit.ref, hit); else selectedEvidence.delete(hit.ref);
      updateSelection();
    }}).element;
    chip.dataset.selectRef=hit.ref; chip.setAttribute('aria-label',`Select ${hit.title}`);
    return chip;
  }
  function selectionTray() {
    const compare=uiButton({id:'btnCompare',label:selectedEvidence.size < 2 || selectedEvidence.size > 3 ? 'Compare · select 2–3' : 'Compare',icon:'compare',disabled:selectedEvidence.size < 2 || selectedEvidence.size > 3,onClick:()=>showComparison([...selectedEvidence.values()])});
    compare.setAttribute('aria-label',`Compare (${selectedEvidence.size})`);
    return uiTray({label:'Selected material', className:'selection-tray', hidden:!selectedEvidence.size},
      el('span', {role:'status'}, `${selectedEvidence.size} selected`),
      uiButton({label:'Create collection', onClick:() => showCollections(true)}), compare,
      uiButton({label:'Clear',emphasis:'quiet',size:'compact',onClick:()=>{
        const focus=$first('[data-select-ref][aria-pressed=true]');
        selectedEvidence.clear(); updateSelection(); focus?.focus({preventScroll:true});
      }}));
  }

  async function showCollections(fromSelection = false) {
    enterExperience('collections');
    $('experiences').replaceChildren(el('header', { class: 'experience-heading' }, el('button', { class: 'btn quiet sm', onclick: () => showRecall() }, '← Library'), el('h1', null, 'Collections')),
      el('div', { id: 'collectionCreate' }), el('div', { id: 'collectionCards', class: 'collection-cards', 'aria-live': 'polite' }, uiFeedback({kind:'loading', message:'Loading your collections…'})));
    const title = uiControl('input', { type: 'text', required: true, maxlength: 200, placeholder: 'Agents that remember', 'aria-label': 'Collection title' });
    const purpose = uiControl('input', { type: 'text', maxlength: 1000, placeholder: 'What are you trying to understand?', 'aria-label': 'Collection purpose' });
    const note = el('p', { class: 'experience-muted', role: 'status' }, fromSelection ? `${selectedEvidence.size} selected items will be kept here.` : 'Add saved links and quotes from Library.');
    const titleField = uiField(title, {label:'Collection title', hiddenLabel:true});
    const purposeField = uiField(purpose, {label:'Collection purpose', hiddenLabel:true});
    const create = uiButton({label:'Create collection', emphasis:'primary', type:'submit'});
    const form = el('form', { class: 'collection-create' }, titleField.element, purposeField.element, create, note);
    uiForm(form,{submit:create,onSubmit:async()=>{
        const { collection } = (await callTool('update_collection', { action: 'create', title: title.value.trim(), purpose: purpose.value.trim(), ...(fromSelection ? { entries: [...selectedEvidence.values()].map(hitEntry) } : {}) })).structuredContent;
        if (!collection) throw new Error('The collection was not created.');
        selectedEvidence.clear(); updateSelection(); openDesk(collection.id);
    }});
    $('collectionCreate').append(uiDisclosure({label:'New collection', className:'collection-setup', open:fromSelection}, form));
    try {
      const data = (await callTool('open_collection')).structuredContent;
      collectionList = data.collections; collectionSources = data.sources;
      if (experience !== 'collections') return;
      drawCollectionCards();
    } catch (error) { if (experience === 'collections') $('collectionCards').replaceChildren(uiFeedback({kind:'error', message:`Could not load collections: ${errorText(error)}`, action:uiButton({label:'Try again', onClick:()=>showCollections(fromSelection)})})); }
  }
  function drawCollectionCards() {
    $('collectionCards').replaceChildren(...collectionList.map(c => uiCard({className:'collection-card', title:c.title,
      description:c.purpose || 'A collection of kept reading.',
      meta:`${c.entries.length} kept · ${c.livePortals.length} live sources · updated ${ago(c.updatedAt)}`,
      actions:[uiButton({label:c.kind === 'trail' ? 'Follow trail →' : c.kind === 'comparison' ? 'Reopen comparison →' : 'Open collection →', onClick:()=>openDesk(c.id)})]})));
    if (!collectionList.length) $('collectionCards').append(uiFeedback({kind:'empty', title:'Room for an idea', message:'Create your first collection above, or select a few pieces in Library and bring them together.'}));
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
    } catch (error) { if (generation === deskGeneration && experience === 'desk') $('experiences').replaceChildren(el('p', { class: 'error', role: 'alert' }, errorText(error)), uiButton({label:'Back to collections', onClick:() => showCollections()})); }
  }
  /** @param {CollectionChange} change */
  async function changeDesk(change) {
    if (!currentDesk) return;
    const id = currentDesk.collection.id;
    try { await callTool('update_collection', { ...change, id }); await openDesk(id); }
    catch (error) { toast(errorText(error), 'error'); }
  }
  /** @param {CollectionData} data */
  function showDesk(data) {
    currentDesk = data;
    const c = data.collection;
    if (c.kind === 'comparison' && c.entries.length >= 2) { showComparison(c.entries.map(entryHit), c, data.orientationStale); return; }
    enterExperience('desk');
    const heading = el('header', { class: 'experience-heading' }, el('button', { class: 'btn quiet sm', onclick: () => showCollections() }, '← Your collections'), el('div', { class: 'experience-kicker' }, c.kind === 'trail' ? 'READ WITH A DIRECTION' : 'COLLECTION'), el('h1', null, c.title), el('p', null, c.purpose),
      el('div', { class: 'experience-row' }, el('span', { class: 'experience-muted' }, `${c.entries.length} kept pieces · updated ${ago(c.updatedAt)}`),
        uiButton({label:'Find more material', onClick:() => showRecall()}),
        uiButton({label:'Edit collection', onClick:() => editDesk(c)}),
        uiButton({label:c.kind === 'trail' ? 'View as collection' : 'Read as a trail', onClick:() => changeDesk({ action: 'edit', kind: c.kind === 'trail' ? 'desk' : 'trail' })})));
    const kept = el('section', { class: 'desk-kept' }, el('h2', null, c.kind === 'trail' ? 'Your reading path' : 'Kept for this question'),
      c.kind === 'comparison' ? el('p', {class:'watch-warning',role:'status'}, 'This comparison needs another source. Its remaining evidence is kept below; select material in Library and add it here.') : null,
      selectionTray(),
      selectedEvidence.size ? uiButton({label:`Add ${selectedEvidence.size} selected items to this collection`, onClick:async () => { await changeDesk({ action: 'add', entries: [...selectedEvidence.values()].map(hitEntry) }); selectedEvidence.clear(); updateSelection(); }}) : null,
      ...c.entries.map((entry, index) => deskEntry(entry, index, data)));
    if (!c.entries.length) kept.append(el('div', { class: 'experience-empty' }, 'Find a page or passage in Library, select it, then add it here. You can also keep a personal note below.'));
    kept.append(noteComposer(c.id));
    const side = el('aside', { class: 'desk-context' }, orientationPanel(c, data.orientationStale),
      el('section', { class: 'desk-live' }, el('div', { class: 'experience-row' }, el('h2', null, 'Live sources'), uiButton({label:'Refresh', onClick:() => openDesk(c.id, true)})),
        el('p', { class: 'experience-muted' }, 'Current reading from sources you chose for this collection.'),
        ...data.unavailablePortals.map(id => el('p', { class: 'error' }, `${id} was removed from your room. Reconnect a source in Edit collection.`)),
        ...data.live.map(portal => el('section', { class: 'desk-live-source' }, el('h3', null, portal.title), portal.error ? el('p', { class: 'error' }, portal.error) : null,
          ...portal.items.slice(0, 5).map(item => el('div', { class: 'desk-live-item' }, el('button', { class: 'btn quiet sm', onclick: () => { suspendExperience(); openItem(item, portal); } }, item.title),
            item.url || item.clip ? el('button', { class: 'btn sm', onclick: () => keepDeskItem(item, portal) }, 'Keep') : null)))),
        !data.live.length ? el('p', { class: 'experience-muted' }, 'Choose sources from your room in Edit collection.') : null));
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
      el('div', { class: 'experience-row' }, uiButton({label:'Read →', disabled:unavailable, onClick:() => openLibraryHit(hit)}),
        c.kind === 'trail' ? uiButton({label:entry.completedAt ? 'Undo completion' : 'Finish step', onClick:() => changeDesk({ action: 'complete', refs: [entry.ref], completed: !entry.completedAt })}) : null,
        c.kind === 'trail' && !entry.completedAt ? el('button', {class:'btn quiet sm',onclick:()=>changeDesk({action:'complete',refs:[entry.ref],completed:true,skipped:true})},'Skip step') : null,
        el('button', { class: 'btn sm', disabled: index === 0, 'aria-label': `Move ${entry.title} earlier`, onclick: () => moveDeskEntry(index, -1) }, '↑'),
        el('button', { class: 'btn sm', disabled: index === c.entries.length - 1, 'aria-label': `Move ${entry.title} later`, onclick: () => moveDeskEntry(index, 1) }, '↓'),
        el('button', { class: 'btn quiet sm', onclick: () => changeDesk({ action: 'remove', refs: [entry.ref] }) }, 'Remove from collection')));
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
        el('div', { class: 'orientation-citations' }, c.orientation.refs.map(ref => { const entry = c.entries.find(e => e.ref === ref); return entry ? el('button', { class: 'btn quiet sm', onclick: () => openLibraryHit(entryHit(entry)) }, entry.title) : el('span', { class: 'error' }, 'Removed evidence'); })))
        : el('p', null, 'Ask your agent for an introduction grounded in the material you kept.'),
      uiButton({label:c.orientation ? 'Update with your agent' : 'Ask your agent', disabled:!c.entries.length, onClick:() => askCollectionAgent(c)}));
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
    const text = el('p', null, request);
    const panel = el('div', { class: 'agent-request', role: 'status' }, el('p', null, 'Tell your agent in the chat:'), text, copyButton(request, text, 'Copy request'));
    $('experiences').prepend(panel); panel.scrollIntoView({ block: 'nearest' });
  }
  /** @param {string} id */
  function noteComposer(id) {
    const note = uiControl('textarea', { 'aria-label': 'Personal note', placeholder: 'What are you noticing? Keep a personal note…', maxlength: 16000, required: true });
    const button = uiButton({label:'Keep personal note', type:'submit'});
    const form = el('form', { class: 'desk-note' }, el('h3', null, 'Your own thinking'), uiField(note,{label:'Personal note',hiddenLabel:true}).element, button);
    uiForm(form,{submit:button,onSubmit:async()=>{
        const { clip } = (await callTool('clip', { kind: 'note', content: note.value, title: `Note for ${currentDesk?.collection.title || 'my collection'}`.slice(0,200), source: { kind: 'conversation' } })).structuredContent;
        await callTool('update_collection', { action: 'add', id, entries: [{ ref: `clip:${clip.id}`, title: clip.title }] });
        openDesk(id);
    }});
    return form;
  }
  /** @param {Collection} c */
  function editDesk(c) {
    const title = uiControl('input', { type: 'text', value: c.title, maxlength: 200, 'aria-label': 'Collection title', required: true });
    const purpose = uiControl('textarea', { maxlength: 1000, 'aria-label': 'Collection purpose' }, c.purpose);
    const boxes = collectionSources.map(source => { const input = uiControl('input', { type: 'checkbox', value: source.portalId, checked: c.livePortals.includes(source.portalId) }); return { input, node: el('label', null, input, source.title) }; });
    const save=uiButton({label:'Save collection',emphasis:'primary',type:'submit'});
    const form = el('form', { class: 'desk-editor' }, el('h2', null, 'Edit collection'), uiField(title,{label:'Title'}).element, uiField(purpose,{label:'Purpose (optional)'}).element, el('fieldset', null, el('legend', null, 'Live sources (up to 8)'), ...boxes.map(b => b.node)),
      el('div', { class: 'experience-row' }, save, uiButton({label:'Cancel', type:'button', onClick:() => currentDesk && showDesk(currentDesk)}),
        el('button', { class: 'btn quiet sm', type: 'button', onclick: async () => { try { await callTool('update_collection', { action: 'delete', id: c.id }); showCollections(); } catch (error) { toast(errorText(error), 'error'); } } }, 'Delete collection')));
    uiForm(form,{submit:save,onSubmit:async()=>{const {collection}=(await callTool('update_collection',{action:'edit',id:c.id,title:title.value,purpose:purpose.value,livePortals:boxes.filter(b=>b.input.checked).map(b=>b.input.value)})).structuredContent;if(collection)openDesk(collection.id);}});
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
