  // Preferences keep the existing profile contract; the drawer only changes their home.
  $('showSources').addEventListener('change', () => {
    root.classList.toggle('show-sources', $('showSources').checked);
  });
  let settingsBusy = false;
  /** @param {Pick<Partial<Profile>, 'layout' | 'openIn'>} change */
  async function saveSettings(change) {
    if (!state.profile || settingsBusy) return;
    settingsBusy = true;
    const focused = document.activeElement;
    const controls = [...$$('[data-layout]'), $('openIn')];
    controls.forEach((b) => b.setAttribute('disabled', ''));
    $('layoutMenu').setAttribute('aria-busy', 'true');
    const before = state.profile;
    state.profile = { ...before, ...change };
    drawLayout();
    try {
      const result = await callTool('arrange_room', change);
      state.profile = result.structuredContent.profile;
    } catch (error) {
      state.profile = before; drawLayout();
      toast(`Couldn't save: ${errorText(error)}`);
    } finally {
      settingsBusy = false;
      controls.forEach((b) => b.removeAttribute('disabled'));
      $('layoutMenu').removeAttribute('aria-busy');
      if ($('settingsPanel').open && focused instanceof HTMLElement && (document.activeElement === document.body || document.activeElement === focused)) focused.focus({ preventScroll: true });
    }
  }
  for (const button of $$('[data-layout]')) {
    button.addEventListener('click', () => {
      const layout = layoutNamed(button.dataset.layout);
      if (layout && state.profile && state.profile.layout !== layout) saveSettings({ layout });
    });
  }
  $('openIn').addEventListener('change', () => saveSettings({ openIn: $('openIn').value === 'chat' ? 'chat' : 'card' }));

  /** @param {boolean} open */
  function showSettings(open) {
    const panel = $('settingsPanel');
    if (!open) { if (panel.open) panel.close(); return; }
    closeNavigationMenus();
    drawWhoMenu();
    $('showSources').checked = root.classList.contains('show-sources');
    root.classList.add('settings-open');
    $('btnSettings').setAttribute('aria-expanded', 'true');
    if (!panel.open) panel.showModal();
  }
  $('btnSettings').addEventListener('click', () => showSettings(true));
  $('btnCloseSettings').addEventListener('click', () => showSettings(false));
  $('settingsPanel').addEventListener('close', () => {
    root.classList.remove('settings-open');
    $('btnSettings').setAttribute('aria-expanded', 'false');
  });

  /** Popovers share native Escape, focus return and outside-click dismissal. */
  function closeNavigationMenus() {
    for (const menu of [$('moreMenu'), $('roomOptions')]) if (menu.matches(':popover-open')) menu.hidePopover();
  }
  /** @param {HTMLElement} menu @param {HTMLButtonElement} button */
  function navigationMenu(menu, button) {
    menu.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      const anchor = button.getBoundingClientRect();
      menu.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - 272))}px`;
      menu.style.top = `${anchor.bottom + 4}px`;
    });
    menu.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(menu.matches(':popover-open'))));
    menu.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('button') && menu.matches(':popover-open')) menu.hidePopover(); });
  }
  navigationMenu($('moreMenu'), $('btnMore'));
  navigationMenu($('roomOptions'), $('btnRoomOptions'));

  /** @param {Identity} identity */
  function drawIdentity(identity) {
    state.identity = identity;
    if ($('settingsPanel').open) drawWhoMenu();
  }

  /** @param {Element} target @param {...(Child | Child[])} children */
  const fill = (target, ...children) => target.replaceChildren(...children.flat().filter(/** @returns {c is Node | string} */ (c) => c instanceof Node || typeof c === 'string'));
  /** @param {...(Child | Child[])} children */
  const setWhoMenu = (...children) => fill($('whoMenu'), ...children);

  function drawWhoMenu() {
    const identity = state.identity;
    if (!identity) return;
    if (identity.mode === 'ghost') {
      setWhoMenu(
        el('div', { class: 'who-head' }, icon('ghost'), el('b', null, 'Local only')),
        el('p', null, 'Saved on this computer. Nothing is synced or shared.'),
        identity.signInFailure ? el('p', { class: 'error', role: 'alert' }, identity.signInFailure.message) : null,
        identity.canSignIn
          ? [el('button', { class: 'btn primary', type: 'button', onclick: () => signIn() }, 'Sign in to sync')]
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
        identity.handle
          ? el('button', { class: 'btn', type: 'button', onclick: () => { showSettings(false); loadSpace('', false); } }, 'Your space')
          : el('button', { class: 'btn primary', type: 'button', onclick: drawClaim }, 'Claim a handle'),
        identity.accountUrl ? el('button', { class: 'btn', type: 'button', onclick: () => openLink(identity.accountUrl ?? '') }, 'Account page') : null,
        linked ? el('button', { class: 'btn', type: 'button', onclick: confirmSignOut }, 'Sign out') : null));
  }

  /** Start linking this computer; progress shows in the account menu, or in `target` (the welcome screen, where there's no menu). @param {Element} [target] */
  async function signIn(target = $('whoMenu')) {
    fill(target, el('p', null, 'Opening the sign-in page…'));
    try {
      const { url } = (await callTool('link_account')).structuredContent;
      await openLink(url);
      fill(target,
        el('p', null, 'Finish signing in with GitHub in your browser. This computer\'s portal is added to your account, and this room updates when you\'re done.'),
        el('button', { class: 'btn', type: 'button', onclick: () => { showSettings(false); loadRoom(); } }, 'I\'ve signed in'));
      watchSignIn(target);
    } catch (error) {
      fill(target, el('p', { class: 'error', role: 'alert' }, `Couldn't start signing in: ${errorText(error)}`),
        el('button', { class: 'btn', type: 'button', onclick: () => signIn(target) }, 'Try signing in again'));
    }
  }

  // Claiming a handle creates the public profile, and with it the user's Space.
  function drawClaim() {
    const identity = state.identity;
    // The GitHub login as a handle, when it makes one (hyphens aren't allowed).
    const login = identity && identity.mode !== 'ghost' ? (identity.login ?? '').toLowerCase().replace(/-/g, '_').slice(0, 30) : '';
    const input = el('input', { type: 'text', value: /^[a-z0-9_]{2,30}$/.test(login) ? login : '', placeholder: 'yourname', maxlength: '31', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Handle' });
    const problem = el('p', { class: 'who-error', role: 'alert', hidden: true });
    const claim = el('button', { class: 'btn primary', type: 'button' }, 'Claim');
    // Being findable is its own choice, asked plainly and off by default (docs/plans/finding-people.md).
    const listed = el('input', { type: 'checkbox' });
    const publicSpace = el('input', { type: 'checkbox' }); publicSpace.checked = true;
    const submit = async () => {
      const handle = input.value.trim().replace(/^@/, '');
      if (!handle) { input.focus(); return; }
      claim.disabled = true; input.disabled = true; problem.hidden = true;
      try {
        const { profile } = (await callTool('set_public_profile', { handle, listed: listed.checked, public: publicSpace.checked })).structuredContent;
        if (state.identity && state.identity.mode !== 'ghost') drawIdentity({ ...state.identity, handle: profile.handle });
        toast(`You're @${profile.handle}.`);
        loadSpace('', false);
      } catch (error) {
        claim.disabled = false; input.disabled = false;
        problem.textContent = errorText(error);
        problem.hidden = false;
        input.focus();
      }
    };
    claim.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    setWhoMenu(
      el('div', { class: 'who-head' }, icon('space'), el('b', null, 'Claim a handle')),
      el('p', null, 'Your handle is how people on MCPortal find you, follow you and see what you share. It makes a public profile and your Space; the rest of your room stays private.'),
      el('label', { class: 'who-claim' }, el('span', { 'aria-hidden': 'true' }, '@'), input),
      el('p', { class: 'muted' }, '2 to 30 letters, digits or underscores. You can change it later.'),
      el('label', { class: 'who-list' }, publicSpace, 'Public Space: anyone on the web can read it'),
      el('label', { class: 'who-list' }, listed, 'List me, so people with similar sources can find me'),
      problem,
      el('div', { class: 'who-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => drawWhoMenu() }, 'Back'),
        claim));
    input.focus();
    input.select();
  }

  // Signing in finishes in the browser, outside this room: watch for it, and redraw the room
  // (the toolbar says who it belongs to) once it lands. The sign-in link lasts 10 minutes.
  /** @param {Identity | null} identity */
  const identityKey = (identity) => !identity ? '' : identity.mode === 'ghost' ? 'ghost' : `${identity.mode}|${identity.handle ?? ''}`;
  let signInWatch = 0;

  /** Redraw the room if who it belongs to has changed. @returns {Promise<boolean>} whether it had */
  async function identityChanged() {
    if (!state.identity) return false;   // a card (an article, a space), not the room
    try {
      const { identity } = (await callTool('account_settings')).structuredContent;
      if (identityKey(identity) === identityKey(state.identity)) { state.identity = identity; return false; }
      await loadRoom();
      return true;
    } catch {
      return false;
    }
  }

  /** @param {Element} target */
  function watchSignIn(target) {
    const watch = ++signInWatch;
    const until = Date.now() + 10 * 60_000;
    const tick = async () => {
      if (watch !== signInWatch) return;
      if (Date.now() > until) {
        fill(target, el('p', { class: 'error', role: 'alert' }, 'The sign-in link expired. Start again with a fresh link on this computer.'),
          el('button', { class: 'btn', type: 'button', onclick: () => signIn(target) }, 'Try signing in again'));
        return;
      }
      if (await identityChanged()) {
        signInWatch++;
        const identity = state.identity;
        if (identity && identity.mode !== 'ghost') toast(`Signed in${identity.handle ? ` as @${identity.handle}` : identity.login ? ` as ${identity.login}` : ''}.`);
        return;
      }
      const identity = state.identity;
      if (identity?.mode === 'ghost' && identity.signInFailure) {
        signInWatch++;
        fill(target, el('p', { class: 'error', role: 'alert' }, identity.signInFailure.message),
          el('button', { class: 'btn', type: 'button', onclick: () => signIn(target) }, 'Try signing in again'));
        return;
      }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  }

  // Back in view: the agent (or another room) may have signed in or out meanwhile.
  let identityCheckedAt = 0;
  const recheckIdentity = () => {
    if (!state.identity || document.visibilityState !== 'visible' || Date.now() - identityCheckedAt < 15_000) return;
    identityCheckedAt = Date.now();
    void identityChanged();
  };
  document.addEventListener('visibilitychange', recheckIdentity);
  window.addEventListener('focus', recheckIdentity);

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
      showSettings(false);
      toast('Signed out. Your portal is saved on this computer.');
      loadRoom();
    } catch (error) {
      setWhoMenu(el('p', { class: 'error' }, `Still signed in: ${errorText(error)}`));
    }
  }

  /** Refresh every portal the room can fetch itself (pinned ones are the agent's). */
  async function refreshAll() {
    if (!state.profile) return loadRoom();
    setStatus('Refreshing sources…');
    await Promise.all([...state.portals.values()].filter((p) => !p.pin).map((p) => refreshPortal(p.portalId)));
    setUpdated();
  }
  $('btnRefresh').addEventListener('click', refreshAll);
  async function toggleFullscreen() {
    const want = displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
    try { const r = await hostRequest('ui/request-display-mode', { mode: want }, 5000); setDisplayMode((r && r.mode) || want); }
    catch { toast("Fullscreen isn't available here"); }
  }
  $('btnExpand').addEventListener('click', toggleFullscreen);
