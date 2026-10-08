  /** @param {string} id @returns {PortalView} */
  function portalViewPreference(id) { return state.profile?.columns.flatMap(c => c.panels).find(p => p.id === id)?.view || 'default'; }
  /** @param {PortalResult} portal @returns {PortalView[]} */
  function supportedPortalViews(portal) {
    const spec = state.profile?.columns.flatMap(c => c.panels).find(p => p.id === portal.portalId);
    return ['default', 'list', 'cards', 'gallery', ...(portal.source === 'clips' ? ['quotes'] : []), ...(spec?.source === 'github' && spec.config.mode === 'releases' ? ['changelog'] : [])].filter((view) => view === 'default' || view === 'list' || view === 'cards' || view === 'gallery' || view === 'quotes' || view === 'changelog');
  }
  /** @param {PortalResult} portal */
  function portalViewSelector(portal) {
    const select = el('select', { class: 'portal-view-select', 'aria-label': `Presentation for ${portal.title}`, title: 'Choose how this portal presents its material' }, supportedPortalViews(portal).map(view => el('option', { value: view }, view === 'default' ? 'View' : view[0].toUpperCase() + view.slice(1))));
    select.value = portalViewPreference(portal.portalId);
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        const { profile } = (await callTool('arrange_room', { view: [{ portal: portal.portalId, view: select.value }] })).structuredContent;
        state.profile = profile;
        redrawPortal(portal.portalId);
        if (profile.layout === 'river') toast('River uses one list. This view applies when the portal is shown separately.');
      } catch (error) { select.value = portalViewPreference(portal.portalId); toast(errorText(error)); }
      finally { select.disabled = false; }
    });
    return select;
  }
  /** @param {PortalResult} portal @param {Item[]} items @returns {HTMLElement | null} */
  function portalViewItems(portal, items) {
    const view = portalViewPreference(portal.portalId);
    if (view === 'default' || !supportedPortalViews(portal).includes(view)) return null;
    const wrap = el('div', { class: `portal-view-items portal-view-${view}` });
    for (const item of items) {
      if (view === 'quotes' && item.clip?.kind !== 'quote') continue;
      if (view === 'quotes' || (view === 'gallery' && item.clip?.kind === 'image')) {
        const body = el('div', { class: 'portal-clip-body' }, item.summary || item.title);
        const card = el('article', { class: 'portal-clip-card' }, body, el('button', { class: 'link-btn', onclick: () => openItem(item, portal) }, item.title));
        wrap.append(watchNew(card, item, portal));
        if (item.clip) callTool('get_clip', { id: item.clip.id }).then(({ structuredContent: { clip } }) => {
          if (!body.isConnected) return;
          body.replaceChildren(...present(clipBody(clip.data)));
          for (const img of body.querySelectorAll('img')) img.alt = item.title;
          if (clip.source.url) body.append(el('small', { class: 'experience-muted' }, clip.source.title || new URL(clip.source.url).hostname));
          if (clip.tags.length) body.append(el('small', { class: 'experience-muted' }, clip.tags.map(tag => `#${tag}`).join(' ')));
        }).catch(() => { if (body.isConnected) body.textContent = 'This clip is unavailable.'; });
      } else if (view === 'changelog' && item.release) {
        wrap.append(watchNew(el('article', { class: 'release-entry' }, el('small', { class: 'experience-kicker' }, item.release.repo), el('h3', null, item.release.version),
          el('p', { class: 'experience-muted' }, item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : 'Release date unavailable'), renderItem(item, portal, 'row')), item, portal));
      } else wrap.append(watchNew(renderItem(item, portal, view === 'list' || view === 'changelog' ? 'row' : 'tile', { color: portalColor(portal), media: view === 'gallery' }), item, portal));
    }
    if (!wrap.children.length) wrap.append(el('p', { class: 'empty' }, view === 'quotes' ? 'No quote clips match this portal. Choose another view or keep a quote.' : 'No material for this view yet.'));
    return wrap;
  }
