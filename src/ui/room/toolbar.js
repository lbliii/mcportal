  // room/toolbar.js: toolbar controls
  // ------------------------------------------------------------ toolbar
  $('btnSources').addEventListener('click', () => {
    const on = !root.classList.contains('show-sources');
    root.classList.toggle('show-sources', on); $('btnSources').setAttribute('aria-pressed', String(on));
  });
  // Layout and open-in are saved to the profile, so the next open_room keeps them.
  async function saveSettings(change) {
    if (!state.profile) return;
    const before = state.profile;
    state.profile = { ...before, ...change };
    drawLayout();
    try {
      const result = await callTool('update_profile', { profile: state.profile });
      state.profile = result.structuredContent.profile;
    } catch (error) {
      state.profile = before; drawLayout();
      toast(`Couldn't save: ${error.message}`);
    }
  }
  for (const b of $$('[data-layout]')) {
    b.addEventListener('click', () => { if (state.profile && state.profile.layout !== b.dataset.layout) saveSettings({ layout: b.dataset.layout }); });
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
