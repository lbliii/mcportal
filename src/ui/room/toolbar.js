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
  // Who the room belongs to: your handle (your space) when signed in, ghost mode when not.
  /** @param {Identity} identity */
  function drawIdentity(identity) {
    state.identity = identity;
    const who = $('btnWho');
    const ghost = identity.mode === 'ghost';
    const name = ghost ? 'Ghost mode' : identity.handle ? `@${identity.handle}` : (identity.login ?? 'Signed in');
    const title = ghost
      ? 'Ghost mode: no account. Your portal stays on this computer and nothing is shared.'
      : identity.handle ? `Signed in as @${identity.handle}. Open your space: what people who follow you see.` : `Signed in as ${name}. Open your space to claim a handle.`;
    who.classList.toggle('ghost', ghost);
    who.title = title;
    who.setAttribute('aria-label', title);
    who.replaceChildren(ghost ? icon('ghost') : icon('space'), el('span', { class: 'who-name' }, name));
    who.hidden = false;
  }
  $('btnWho').addEventListener('click', () => {
    if (state.identity?.mode === 'hosted') return loadSpace('', false);
    toast('Ghost mode: no account. Your portal stays on this computer, and nothing is shared or synced.');
  });
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
