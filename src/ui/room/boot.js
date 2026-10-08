  // room/boot.js: boot: ui/initialize handshake and first load
  // ------------------------------------------------------------ boot
  async function boot() {
    if (DEV) {
      root.classList.add('standalone');
      $('btnExpand').hidden = true;
      await loadRoom();
      return;
    }
    try {
      const init = await hostRequest('ui/initialize', {
        protocolVersion: '2026-01-26',
        appInfo: APP_INFO,
        clientInfo: APP_INFO,
        appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
        capabilities: {},
      }, 10000);
      hostCapabilities = (init && init.hostCapabilities) || {};
      applyHostContext(init && init.hostContext);
    } catch (error) {
      console.warn('[mcportal] ui/initialize failed', error);
    }
    $('btnOpenIn').hidden = !hostCapabilities.message;
    $('btnExpand').hidden = !canFullscreen;
    hostNotify('ui/notifications/initialized', {});
    // If the host opened us without running the tool (e.g. a restored view), fetch the
    // room ourselves. If it IS running the tool, wait for that result instead.
    const started = Date.now();
    const check = () => {
      if (gotInitialResult) return;
      if (toolRunning && Date.now() - started < 45000) { setTimeout(check, 1000); return; }
      docsArgs ? (root.classList.add('article-view'), openDocs(docsArgs, { card: true })) : spaceHandle !== null ? loadSpace(spaceHandle, true) : articleUrl ? loadArticleCard(articleUrl) : clipId ? (clipId[0] === 's' ? loadShareCard(clipId) : loadClipCard(clipId)) : loadRoom();
    };
    setTimeout(check, 3000);
  }
  boot().catch((error) => showAppError('Could not initialize the viewer', error));
