  // room/add.js: add a source and OPML import
  // ------------------------------------------------------------ add a source
  let sourceGeneration = 0;
  let setupBusy = false;
  function invalidateSources() {
    sourceGeneration++;
    $('addResults').replaceChildren();
    $('addResults').setAttribute('aria-busy', 'false');
  }
  function beginSourcePreview() {
    invalidateSources();
    $('addResults').setAttribute('aria-busy', 'true');
    return sourceGeneration;
  }
  function toggleAdd(open = $('addSheet').hidden) {
    const returnFocus = $('addSheet').contains(document.activeElement);
    $('addSheet').hidden = !open;
    $('btnAdd').setAttribute('aria-pressed', String(open));
    if (open) $('addInput').focus();
    else { invalidateSources(); if (returnFocus) $('btnAdd').focus(); }
  }

  /** @param {string} query */
  async function findSources(query) {
    const generation = beginSourcePreview();
    const hint = $('addHint'), list = $('addResults');
    hint.textContent = 'Looking…'; list.replaceChildren();
    try {
      const data = (await callTool('find_source', { query })).structuredContent;
      if (generation !== sourceGeneration) return;
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
      if (generation === sourceGeneration) hint.textContent = `Couldn't look that up: ${errorText(error)}. Check the address and scan again.`;
    } finally { if (generation === sourceGeneration) list.setAttribute('aria-busy', 'false'); }
  }

  /**
   * @param {ToolResults['find_source']['candidates'][number]} c
   * @param {HTMLButtonElement} button
   */
  async function addCandidate(c, button) {
    const generation = sourceGeneration;
    button.disabled = true; button.textContent = 'Adding…';
    try {
      const data = (await callTool('add_portal', { source: c.source, config: c.config, title: c.source === 'rss' ? undefined : c.title })).structuredContent;
      state.profile = { ...state.profile, ...data.profile };
      state.portals.set(data.portal.portalId, data.portal);
      drawLayout();
      if (generation === sourceGeneration) { toggleAdd(false); $('addInput').value = ''; }
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
  /** Keep the detailed outcome until dismissed, including when room hydration fails.
   * @param {ToolResults['import_opml']} data @param {string} xml
   */
  function importReport(data, xml) {
    const report = $('importReport');
    const heading = el('h2', { tabindex: '-1' }, 'Subscription import');
    const rows = (/** @type {{url: string, title: string, error?: string}[]} */ feeds) => el('ul', null, feeds.map(f => el('li', null,
      el('strong', null, f.title), el('div', null, f.url), f.error ? el('p', null, f.error) : null)));
    report.hidden = false;
    report.replaceChildren(...present([heading,
      el('p', { role: 'status' }, `${data.imported} added; ${data.alreadyPresent ?? 0} already present; ${data.failed.length} failed; ${data.deferred?.length ?? 0} left to import.`),
      data.added?.length ? el('details', null, el('summary', null, 'Added subscriptions'), rows(data.added)) : null,
      data.failed.length ? el('details', { open: true }, el('summary', null, 'Needs repair'), rows(data.failed)) : null,
      data.deferred?.length ? el('details', { open: true }, el('summary', null, 'Left to import'),
        el('p', null, 'Make room if needed, then retry. Large files may need more than one pass.'), rows(data.deferred)) : null,
      data.failed.length || data.deferred?.length ? el('button', { class: 'btn', onclick: () => runOpml(xml) }, 'Retry remaining subscriptions') : null,
      el('button', { class: 'btn', onclick: () => { report.hidden = true; report.replaceChildren(); (root.classList.contains('welcome-view') ? $first('button', $('welcome')) : $('btnAdd'))?.focus(); } }, 'Dismiss report')]));
    heading.focus();
  }

  /** @param {string} xml */
  async function runOpml(xml) {
    if (setupBusy) { toast('Please wait for the current setup to finish.'); return; }
    setupBusy = true;
    const report = $('importReport');
    report.hidden = false;
    report.setAttribute('aria-busy', 'true');
    const status = el('p', { role: 'status' }, 'Importing subscriptions…');
    report.append(status);
    $('btnImportOpml').disabled = true;
    try {
      const res = await callTool('import_opml', { opml: xml });
      toggleAdd(false);
      try { renderRoom((await callTool('open_room')).structuredContent); }
      catch { /* The writes succeeded. Keep their report even if refresh failed. */ }
      importReport(res.structuredContent, xml);
      const reload = el('button', { class: 'btn', onclick: async () => {
        reload.disabled = true;
        try { renderRoom((await callTool('open_room')).structuredContent); toast('Room refreshed'); }
        catch(error) { toast(`Room refresh failed: ${errorText(error)}`); }
        finally { reload.disabled = false; }
      } }, 'Refresh room');
      report.append(reload);
    } catch (error) {
      status.textContent = `Import could not finish: ${errorText(error)}. Retry is safe: existing subscriptions are kept.`;
      report.append(el('button', { class: 'btn', onclick: () => runOpml(xml) }, 'Retry import'));
    } finally { setupBusy = false; $('btnImportOpml').disabled = false; report.setAttribute('aria-busy', 'false'); }
  }
  $('opmlFile').addEventListener('change', async () => {
    const file = $('opmlFile').files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { toast('That file is over 1 MB'); return; }
    try { await runOpml(await file.text()); }
    catch(error) { toast(`Could not read that file: ${errorText(error)}`); }
  });
  $('btnImportOpml').addEventListener('click', () => pickOpml());

  $('btnAdd').addEventListener('click', () => toggleAdd());
  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('addInput').value.trim();
    if (!q) { invalidateSources(); $('addHint').textContent = 'Enter a site or feed address to scan.'; $('addInput').focus(); return; }
    if (q) $('addStore').getAttribute('aria-pressed') === 'true' ? previewStore(q) : findSources(q);
  });
  $('addInput').addEventListener('input', () => { invalidateSources(); $('addHint').textContent = 'Scan to preview this address.'; });
  $('addSheet').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); toggleAdd(false); } });
