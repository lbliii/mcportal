  /** @type {ToolResults['check_updates']['update'] | undefined} */
  let currentUpdate;
  let updateBusy = false;
  let updateError = '';
  let releaseDismissedHere = false;
  /** @param {boolean} manual */
  async function refreshUpdates(manual) {
    if (updateBusy) return;
    updateBusy = true; updateError = ''; drawUpdateSettings();
    try { drawUpdates((await callTool('check_updates', {refresh:manual})).structuredContent.update); }
    catch (error) { if (manual) updateError = `Couldn't check: ${errorText(error)}`; }
    finally { updateBusy = false; drawUpdateSettings(); }
  }
  /** @param {{automatic?:boolean, dismissedVersion?:string}} preferences */
  async function saveUpdatePreferences(preferences) {
    if (updateBusy) return;
    updateBusy = true; updateError = ''; drawUpdateSettings();
    try { drawUpdates((await callTool('set_update_preferences', preferences)).structuredContent.update); }
    catch (error) { updateError = `Couldn't save update preferences: ${errorText(error)}`; }
    finally { updateBusy = false; drawUpdateSettings(); }
  }
  /** @param {ToolResults['check_updates']['update']} update */
  function releaseNoticeKey(update) { return `mcportal-release:${new URL(update.upgradeUrl).origin}`; }
  /** @param {ToolResults['check_updates']['update']} update */
  function releaseWasSeen(update) {
    if (releaseDismissedHere) return true;
    try { return localStorage.getItem(releaseNoticeKey(update)) === update.installedVersion; }
    catch { return true; } // Sandboxed hosts may deny storage; release details remain in Settings.
  }
  function dismissRelease() {
    if (!currentUpdate) return;
    releaseDismissedHere = true;
    try { localStorage.setItem(releaseNoticeKey(currentUpdate), currentUpdate.installedVersion); } catch { /* current view only */ }
    drawUpdates(currentUpdate);
  }
  /** @param {ToolResults['check_updates']['update'] | undefined} update */
  function drawUpdates(update) {
    if (!update) return; // Older tool results can still open this UI.
    currentUpdate = update;
    const banner = $('updateNotice');
    const outdatedCard = update.installedVersion !== APP_INFO.version;
    const available = ['update_available', 'update_required'].includes(update.status) && !update.dismissed;
    const release = update.status === 'current' && !outdatedCard && !releaseWasSeen(update);
    banner.hidden = !outdatedCard && !available && !release;
    if (!banner.hidden) {
      const label = outdatedCard ? 'A newer or different MCPortal is running. Reconnect and open a new room card to load its interface.'
        : available ? `MCPortal ${update.recommendedVersion}: ${update.status === 'update_required' ? 'update required for sync' : 'update available'}.${update.stale ? ' Last confirmed while online.' : ''}`
        : `New in MCPortal ${update.installedVersion}: ${update.highlights}`;
      fill(banner, el('span', null, label), el('div', {class:'who-actions'},
        uiButton({label:available || outdatedCard ? 'Upgrade guide' : 'What’s new', size:'compact', onClick:()=>{ if(release) dismissRelease(); void openLink(available || outdatedCard ? update.upgradeUrl : update.releaseNotesUrl); }}),
        update.status === 'update_required' || outdatedCard ? null : uiButton({label:'Dismiss', size:'compact', onClick:()=>{
          if (available && update.recommendedVersion) void saveUpdatePreferences({dismissedVersion:update.recommendedVersion});
          else dismissRelease();
        }})));
    }
    drawUpdateSettings();
  }
  function drawUpdateSettings() {
    const u = currentUpdate;
    const target = $('updateSettings');
    if (!u) { fill(target, el('p', {class:'muted'}, 'Version details will appear when the room connects.')); return; }
    const status = u.status === 'unchecked' ? 'Not checked yet.' : u.status === 'unavailable' ? 'Couldn’t check for updates. Try again when online.'
      : u.status === 'update_required' ? `Update to ${u.recommendedVersion} to keep syncing.`
      : u.status === 'update_available' ? `${u.recommendedVersion} is available.${u.dismissed ? ' The room notice is dismissed for this version.' : ''}`
      : u.mode === 'hosted' ? 'Updates arrive through this hosted connection.' : 'Up to date at the last successful check.';
    const automatic = uiToggle({label:'Check automatically', checked:u.automatic, hint:'Once a day while you use MCPortal. Sends no room or account data.', onChange:automatic=>{ void saveUpdatePreferences({automatic}); }});
    automatic.control.disabled = updateBusy;
    fill(target, el('p', null, `MCPortal ${u.installedVersion} · ${u.mode === 'hosted' ? 'Hosted' : 'This computer'}`),
      el('p', null, status), u.checkedAt ? el('p', {class:'muted'}, `Last successful check: ${new Date(u.checkedAt).toLocaleString()}${u.stale ? ' (out of date)' : ''}`) : null,
      u.mode === 'local' ? automatic.element : null,
      el('div', {class:'who-actions'},
        u.mode === 'local' ? uiButton({label:'Check now', busy:updateBusy, onClick:()=>{ void refreshUpdates(true); }}) : null,
        uiButton({label:'Upgrade guide', onClick:()=>{ void openLink(u.upgradeUrl); }}),
        uiButton({label:'What’s new', onClick:()=>{ dismissRelease(); void openLink(u.releaseNotesUrl); }})),
      el('p', {class:'muted'}, u.highlights),
      updateError ? el('p', {class:'error', role:'alert'}, updateError) : null);
  }
