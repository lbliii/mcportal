  // room/toolbar.js: toolbar controls
  // ------------------------------------------------------------ toolbar
  $('btnSources').addEventListener('click', () => {
    const on = !root.classList.contains('show-sources');
    root.classList.toggle('show-sources', on); $('btnSources').setAttribute('aria-pressed', String(on));
  });
  // Layout and open-in are saved to the profile, so the next open_room keeps them.
  /** @param {Pick<Partial<Profile>, 'layout' | 'openIn'>} change */
  async function saveSettings(change) {
    if (!state.profile) return;
    const before = state.profile;
    state.profile = { ...before, ...change };
    drawLayout();
    try {
      // Only the setting that changed: arrange_room can't touch anything it isn't given.
      const result = await callTool('arrange_room', change);
      state.profile = result.structuredContent.profile;
    } catch (error) {
      state.profile = before; drawLayout();
      toast(`Couldn't save: ${errorText(error)}`);
    }
  }
  for (const b of $$('[data-layout]')) {
    b.addEventListener('click', () => {
      const layout = b.dataset.layout;
      if ((layout === 'columns' || layout === 'shelves') && state.profile && state.profile.layout !== layout) saveSettings({ layout });
    });
  }
  $('btnOpenIn').addEventListener('click', () => {
    if (state.profile) saveSettings({ openIn: state.profile.openIn === 'chat' ? 'card' : 'chat' });
  });
  $('btnSpace').addEventListener('click', () => loadSpace('', false));
  $('btnRefresh').addEventListener('click', async () => {
    if (!state.profile) return loadRoom();
    setStatus('Scanning the ether for fresh dispatches…');
    await Promise.all([...state.portals.values()].filter((p) => !p.pin).map((p) => refreshPortal(p.portalId)));
    setUpdated();
  });
  $('btnExpand').addEventListener('click', async () => {
    const want = displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
    try { const r = await hostRequest('ui/request-display-mode', { mode: want }, 5000); setDisplayMode((r && r.mode) || want); }
    catch { toast("Fullscreen isn't available here"); }
  });
