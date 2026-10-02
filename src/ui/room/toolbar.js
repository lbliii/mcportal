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
  // Who the room belongs to: your handle when signed in, ghost mode when not. The chip opens
  // a small menu: what the mode means, and signing in (ghost) or your space, account page and
  // signing out (signed in).
  /** @param {Identity} identity */
  function drawIdentity(identity) {
    state.identity = identity;
    const who = $('btnWho');
    const ghost = identity.mode === 'ghost';
    const name = ghost ? 'Ghost mode' : identity.handle ? `@${identity.handle}` : (identity.login ?? 'Signed in');
    const offline = identity.mode === 'linked' && Boolean(identity.offline);
    const title = ghost ? 'Ghost mode: not signed in' : offline ? `Signed in as ${name}, offline: showing your portal as last synced` : `Signed in as ${name}`;
    who.classList.toggle('ghost', ghost);
    who.classList.toggle('offline', offline);
    who.title = title;
    who.setAttribute('aria-label', `${title}. Account menu`);
    who.setAttribute('aria-expanded', 'false');
    who.replaceChildren(ghost ? icon('ghost') : icon('space'), el('span', { class: 'who-name' }, name));
    who.hidden = false;
    $('whoMenu').hidden = true;
  }

  /** @param {boolean} open */
  function showWhoMenu(open) {
    $('whoMenu').hidden = !open;
    $('btnWho').setAttribute('aria-expanded', String(open));
    if (open) drawWhoMenu();
  }

  /** @param {...(Child | Child[])} children */
  const setWhoMenu = (...children) => $('whoMenu').replaceChildren(...children.flat().filter(/** @returns {c is Node | string} */ (c) => c instanceof Node || typeof c === 'string'));

  function drawWhoMenu() {
    const identity = state.identity;
    if (!identity) return;
    if (identity.mode === 'ghost') {
      setWhoMenu(
        el('div', { class: 'who-head' }, icon('ghost'), el('b', null, 'Ghost mode')),
        el('p', null, 'No account: your portal lives on this computer, and nothing is synced or shared.'),
        identity.canSignIn
          ? [el('p', { class: 'muted' }, 'Sign in to keep the same portal on every device, and to share and follow. This computer\'s portal comes with you.'),
            el('button', { class: 'btn primary', type: 'button', onclick: signIn }, 'Sign in to sync and share')]
          : null);
      return;
    }
    const linked = identity.mode === 'linked';
    const name = identity.handle ? `@${identity.handle}` : (identity.login ?? 'Signed in');
    setWhoMenu(
      el('div', { class: 'who-head' }, icon('space'), el('b', null, name)),
      el('p', null, linked ? `This computer keeps your portal in your hosted MCPortal (${new URL(identity.server).host}), so it's the same wherever you sign in.` : 'Signed in to your hosted MCPortal.'),
      linked && identity.offline ? el('p', { class: 'muted' }, `Offline: this is your portal as last synced${identity.syncedAt ? ` (${ago(identity.syncedAt)})` : ''}. Feeds still load; changes wait until you're back online.`) : null,
      el('div', { class: 'who-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => { showWhoMenu(false); loadSpace('', false); } }, identity.handle ? 'Your space' : 'Claim a handle'),
        identity.accountUrl ? el('button', { class: 'btn', type: 'button', onclick: () => openLink(identity.accountUrl ?? '') }, 'Account page') : null,
        linked ? el('button', { class: 'btn', type: 'button', onclick: confirmSignOut }, 'Sign out') : null));
  }

  async function signIn() {
    setWhoMenu(el('p', null, 'Opening the sign-in page…'));
    try {
      const { url } = (await callTool('link_account')).structuredContent;
      await openLink(url);
      setWhoMenu(
        el('p', null, 'Finish signing in with GitHub in your browser. This computer\'s portal is added to your account.'),
        el('button', { class: 'btn primary', type: 'button', onclick: () => { showWhoMenu(false); loadRoom(); } }, 'I\'ve signed in'));
    } catch (error) {
      setWhoMenu(el('p', { class: 'error' }, `Couldn't start signing in: ${errorText(error)}`));
    }
  }

  function confirmSignOut() {
    setWhoMenu(
      el('p', null, 'Sign this computer out? Your portal is copied here first, so nothing disappears, and MCPortal goes back to ghost mode.'),
      el('div', { class: 'who-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => drawWhoMenu() }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'button', onclick: signOut }, 'Sign out')));
  }

  async function signOut() {
    setWhoMenu(el('p', null, 'Copying your portal to this computer…'));
    try {
      await callTool('unlink_account');
      showWhoMenu(false);
      toast('Signed out. Your portal is on this computer, in ghost mode.');
      loadRoom();
    } catch (error) {
      setWhoMenu(el('p', { class: 'error' }, `Still signed in: ${errorText(error)}`));
    }
  }

  $('btnWho').addEventListener('click', () => showWhoMenu($('whoMenu').hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('whoMenu').hidden) { showWhoMenu(false); $('btnWho').focus(); } });
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!$('whoMenu').hidden && target instanceof Node && !$('whoMenu').contains(target) && !$('btnWho').contains(target)) showWhoMenu(false);
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
