  /** @type {LibraryQuery} */
  let recallQuery = {};
  /** @type {LibraryResult | null} */
  let recallResult = null;
  let recallGeneration = 0, previewGeneration = 0;
  /** @type {LibraryHit | null} */
  let recallPreview = null;

  /** @param {LibraryResult} [provided] */
  function showRecall(provided) {
    enterExperience('recall');
    if (provided) { recallQuery = { query: provided.query }; recallResult = provided; recallPreview = provided.hits[0] || null; }
    const query = el('input', { type: 'search', placeholder: 'Find an explanation, a passage, a page…', 'aria-label': 'Search your library', maxlength: 300, value: recallQuery.query || '' });
    const site = el('input', { type: 'text', placeholder: 'Site or source', 'aria-label': 'Filter by site or source', value: recallQuery.site || '', maxlength: 200 });
    const tag = el('input', { type: 'text', placeholder: 'Tag', 'aria-label': 'Filter by tag', value: recallQuery.tag || '', maxlength: 60 });
    const kind = el('select', { 'aria-label': 'Filter by kind' }, ['', 'saved', 'reading', 'quote', 'note', 'exchange', 'table', 'image', 'link'].map(k => el('option', { value: k }, k ? k[0].toUpperCase() + k.slice(1) : 'All material')));
    kind.value = recallQuery.kind || '';
    const status = el('select', { 'aria-label': 'Filter by reading status' }, ['', 'seen', 'opened', 'read'].map(s => el('option', { value: s }, s || 'Any reading status')));
    status.value = recallQuery.status || '';
    const submit = () => {
      // The selected values come from fixed options; the server validates them again.
      recallQuery = { query: query.value.trim(), site: site.value.trim(), tag: tag.value.trim() };
      const chosenKind = ['saved', 'reading', 'quote', 'note', 'exchange', 'table', 'image', 'link'].find(k => k === kind.value);
      if (chosenKind === 'saved' || chosenKind === 'reading' || chosenKind === 'quote' || chosenKind === 'note' || chosenKind === 'exchange' || chosenKind === 'table' || chosenKind === 'image' || chosenKind === 'link') recallQuery.kind = chosenKind;
      if (status.value === 'seen' || status.value === 'opened' || status.value === 'read') recallQuery.status = status.value;
      fetchRecall();
    };
    const search = el('form', { class: 'recall-search', onsubmit: (/** @type {SubmitEvent} */ e) => { e.preventDefault(); submit(); } },
      el('div', { class: 'experience-row' }, query, el('button', { class: 'btn primary', type: 'submit' }, 'Search')),
      el('div', { class: 'recall-filters' }, kind, site, tag, status));
    $('experiences').replaceChildren(el('header', { class: 'experience-heading' }, el('span', { class: 'experience-kicker' }, 'YOUR COMMONPLACE BOOK'), el('h1', null, 'Recall Shelf'),
      el('p', null, 'Find what stayed with you. Saved pages, kept passages and reading, together.')), search,
      el('p', { id: 'recallCount', class: 'experience-muted', role: 'status' }),
      el('p', { id: 'recallCoverage', class: 'experience-muted' }),
      selectionTray(),
      el('div', { class: 'recall-body' }, el('div', { id: 'recallResults', class: 'recall-results' }), el('aside', { id: 'recallPreview', class: 'recall-preview', 'aria-label': 'Material preview' })));
    if (recallResult) drawRecallResults();
    else fetchRecall();
  }

  async function fetchRecall(offset = 0, append = false) {
    const generation = ++recallGeneration, view = navigation.token();
    $('recallResults').setAttribute('aria-busy', 'true');
    $('recallCount').textContent = 'Searching your kept material…';
    try {
      const { library } = (await callTool('search_library', { ...recallQuery, offset, limit: 25 })).structuredContent;
      if (generation !== recallGeneration || !navigation.owns(view)) return;
      recallResult = append && recallResult ? { ...library, hits: [...recallResult.hits, ...library.hits] } : library;
      if (!append) recallPreview = library.hits[0] || null;
      if (navigation.experience === 'recall') drawRecallResults();
    } catch (error) {
      if (generation !== recallGeneration || !navigation.owns(view)) return;
      $('recallCount').textContent = `Could not search: ${errorText(error)}`;
      $('recallResults').replaceChildren(el('button', { class: 'btn', onclick: () => fetchRecall() }, 'Try again'));
    } finally { if (generation === recallGeneration && navigation.owns(view)) $('recallResults').setAttribute('aria-busy', 'false'); }
  }

  /** @param {LibraryHit} hit */
  function libraryLabel(hit) {
    return [hit.clipKind || (hit.saved ? 'Saved page' : 'Reading'), hit.reading?.status, hit.origin === 'conversation' ? 'From a conversation' : '', ...hit.tags.map(t => `#${t}`)].filter(Boolean).join(' · ');
  }
  function drawRecallResults() {
    if (!recallResult) return;
    $('recallCount').textContent = `${recallResult.total} ${recallResult.total === 1 ? 'match' : 'matches'}${recallResult.query ? ` for “${recallResult.query}”` : ' in your library'}`;
    $('recallCoverage').textContent = recallResult.search
      ? `${recallResult.search.query ? `Search words: ${recallResult.search.query}. ` : ''}${recallResult.search.coverage}`
      : 'Searches saved and reading metadata and retained clips. Original page bodies are not searched.';
    $('recallResults').replaceChildren(...recallResult.hits.map(hit => el('article', { class: `recall-hit${recallPreview?.ref === hit.ref ? ' selected' : ''}`, 'data-ref': hit.ref },
      selectEvidenceButton(hit),
      el('div', { class: 'experience-kicker' }, libraryLabel(hit)),
      el('button', { class: 'recall-title', 'aria-pressed': String(recallPreview?.ref === hit.ref), onclick: () => { recallPreview = hit; drawRecallResults(); $first(`[data-ref="${CSS.escape(hit.ref)}"] .recall-title`, $('recallResults'))?.focus({ preventScroll: true }); } }, hit.title),
      el('p', { class: 'experience-muted' }, `${hit.source} · ${ago(hit.updatedAt)}`),
      hit.excerpt ? el('p', { class: hit.clipKind === 'quote' ? 'recall-quote' : 'recall-excerpt' }, hit.excerpt) : null,
      hit.matched.length ? el('small', { class: 'experience-muted' }, `Matched: ${hit.matched.join(', ')}`) : null,
      el('button', { class: 'link-btn', onclick: () => openLibraryHit(hit) }, hit.clipId ? 'Read kept material →' : 'Resume reading →'))));
    if (!recallResult.hits.length) $('recallResults').append(el('div', { class: 'experience-empty' }, el('h2', null, recallResult.query ? 'No matching material' : 'Nothing here yet'), el('p', null, 'Try words from the title, a saved note or a kept passage, or change your filters. Saving a link does not retain its page text.')));
    if (recallResult.nextOffset !== null) {
      const next = recallResult.nextOffset;
      $('recallResults').append(el('button', { class: 'btn', onclick: () => fetchRecall(next, true) }, 'Show more material'));
    }
    drawRecallPreview();
  }
  async function drawRecallPreview() {
    const generation = ++previewGeneration, hit = recallPreview;
    const box = $('recallPreview'); box.hidden = !hit;
    if (!hit) return;
    box.replaceChildren(...present([el('span', { class: 'experience-kicker' }, 'RETURN TO THE IDEA'), el('h2', null, hit.title), el('p', { class: 'experience-muted' }, hit.source),
      el('div', { class: 'recall-preview-body' }, hit.excerpt || 'Open this page to read it at its source.'),
      el('button', { class: 'btn primary', onclick: () => openLibraryHit(hit) }, hit.clipId ? 'Read kept material' : 'Open in reader'),
      hit.url && hit.locator ? el('button', { class: 'btn', onclick: () => openLibraryHit(hit, true) }, 'Return to passage') : null,
      hit.url ? el('button', { class: 'link-btn', onclick: () => openLink(hit.url || '') }, 'Open original') : null]));
    if (!hit.clipId) return;
    const body = $first('.recall-preview-body', box);
    try {
      const { clip } = (await callTool('get_clip', { id: hit.clipId })).structuredContent;
      if (generation !== previewGeneration || !body?.isConnected) return;
      body.replaceChildren(...present(clipBody(clip.data)));
    } catch (error) { if (generation === previewGeneration && body?.isConnected) body.textContent = `This kept material is unavailable: ${errorText(error)}`; }
  }
