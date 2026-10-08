  // A store follow is previewed before confirmation; catalogue content stays inert.
  /** @param {boolean} store */
  function addMode(store) {
    invalidateSources();
    $('addStore').setAttribute('aria-pressed', String(store));
    $('addFeed').setAttribute('aria-pressed', String(!store));
    $('storeScope').hidden = !store;
    $('btnImportOpml').hidden = store;
    $('addInput').placeholder = store ? 'https://your-store.com' : 'Site, feed, channel or owner/repo…';
    $('addInput').setAttribute('aria-label', store ? 'Shopify store HTTPS address' : 'Site, feed, subreddit, channel or repo');
    $('addHint').textContent = store ? 'Preview a supported Shopify store, then choose to follow. Checks happen when you open Shop or refresh.' : 'Paste a site or feed and MCPortal finds what it can show.';
    $('addResults').replaceChildren();
  }
  function followStore() { addMode(true); toggleAdd(true); }
  for (const input of [$('storeCollection'), $('storeSales')]) input.addEventListener('input', invalidateSources);
  $('addStore').addEventListener('click', followStore);
  $('addFeed').addEventListener('click', () => addMode(false));

  /** @param {string} url */
  async function previewStore(url) {
    const generation = beginSourcePreview();
    $('addHint').textContent = 'Checking the public catalogue…';
    $('addResults').replaceChildren();
    try {
      const scope = { ...($('storeCollection').value.trim() ? { collection: $('storeCollection').value.trim() } : {}), salesOnly: $('storeSales').checked };
      const result = await callTool('watch', { kind: 'store', url, scope });
      if (generation !== sourceGeneration) return;
      if (result.structuredContent.preview) renderStorePreview(result.structuredContent.preview);
    } catch(error) { if (generation === sourceGeneration) $('addHint').textContent = errorText(error); }
    finally { if (generation === sourceGeneration) $('addResults').setAttribute('aria-busy', 'false'); }
  }
  /** @param {NonNullable<ToolResults['watch']['preview']>} preview */
  function renderStorePreview(preview) {
    toggleAdd(true); addMode(true);
    $('addInput').value=preview.origin; $('storeCollection').value=preview.scope.collection??''; $('storeSales').checked=preview.scope.salesOnly===true;
    const scope = preview.scope.collection ? `Collection: ${preview.scope.collection}` : 'Whole public catalogue';
    $('addHint').textContent = `${preview.displayName} · ${scope}${preview.scope.salesOnly ? ' · sales only' : ''}. ${preview.observedProducts} products retrieved${preview.partial ? '; partial catalogue' : ''}. Nothing followed yet.`;
    const button = el('button', { class: 'btn', type: 'button', onclick: async () => {
      button.disabled = true; button.textContent = 'Following…';
      try {
        const result = await callTool('watch', { kind: 'store', select: preview.select });
        if(result.structuredContent.profile) {
          const room = await callTool('open_room'); renderRoom(room.structuredContent);
          toggleAdd(false); $('addResults').replaceChildren(); toast('Store followed. This first collection is your baseline.');
        }
      } catch(error) { button.disabled = false; button.textContent = 'Follow this store'; toast(errorText(error)); }
    } }, 'Follow this store');
    $('addResults').replaceChildren(el('li', { class: 'shop-preview' },
      el('div', { class: 'shop-scope' }, preview.origin, el('p', null, 'Future refreshes compare observed products and prices. Large catalogues and variant lists may be partial.')),
      el('ul', { class: 'shop-grid' }, preview.preview.map(item => el('li', null, shopCard(item)))), button));
    primePictures($('addResults'));
  }
  /** A tool card can begin with a preview before it has loaded a room. @param {NonNullable<ToolResults['watch']['preview']>} preview */
  async function showStorePreview(preview) {
    try { renderRoom((await callTool('open_room')).structuredContent); }
    catch(error) { showAppError('Could not load your room', error); return; }
    root.classList.remove('article-view', 'welcome-view');
    $('welcome').hidden = true; $('grid').hidden = false;
    renderStorePreview(preview);
  }
  /** @param {Item} item */
  function shopCard(item) {
    const offer = item.offer;
    const card = el('article', { class: 'shop-card item' });
    const image = el('div', { class: 'shop-picture', ...(item.image ? { 'data-img': item.image.url } : {}) }, el('span', { class: 'shop-placeholder' }, 'Shop'));
    if(item.image) { image.append(el('img', { alt: '', loading: 'lazy' })); watchPicture(image); }
    card.append(el('button', { class: 'shop-open', type: 'button', onclick: () => openLink(item.url ?? '') }, image,
      el('span', { class: 'shop-store' }, offer?.store ?? ''), el('span', { class: 'shop-title' }, item.title)));
    if(offer) {
      const label = item.finding?.kind === 'price_drop' ? 'Price drop' : item.finding?.kind === 'sale' ? 'On sale' : item.finding?.kind === 'back' ? 'Back in stock' : item.finding ? 'New arrival' : '';
      card.append(el('div', { class: 'shop-price' }, offer.previousPrice ? el('del', null, `${offer.previousPrice} ${offer.currency}`) : null,
        el('strong', null, `${offer.amount} ${offer.currency}`), label ? el('span', { class: 'shop-finding' }, label) : null));
      card.append(el('div', { class: 'shop-stock' }, `${offer.availability === 'in_stock' ? 'In stock' : offer.availability === 'sold_out' ? 'Sold out' : 'Stock unknown'} · ${offer.variant}${offer.variantsPartial ? ' · partial variants' : ''}`));
      if(offer.observedAt) card.append(el('div', { class: 'shop-checked' }, `Observed ${new Date(offer.observedAt).toLocaleString()}`));
    }
    const save = saveButton(item, 'watches', 'btn shop-save');
    if(save) { save.append(el('span', null, 'Save')); card.append(save); }
    return card;
  }
  /** @param {PortalResult} portal @param {boolean} [full] */
  function renderShopPortal(portal, full = false) {
    const wrap = el('section', { class: full ? 'level shop' : 'portal shop', 'data-portal': portal.portalId });
    wrap.append(el('div', { class: 'portal-head' }, full ? roomBackButton(closePortal) : null,
      el(full ? 'h1' : 'button', full ? { class: 'level-title', tabindex: '-1' } : { class: 'portal-title', type: 'button', onclick: () => openPortal(portal.portalId) }, portal.title),
      el('span', { class: 'tools' }, el('button', { class: 'btn', type: 'button', onclick: followStore }, 'Follow store'), refreshButton(portal))));
    wrap.append(el('p', { class: 'shop-note' }, 'Recent products and changes from your stores. Checked on demand; prices and stock may change at the store.'));
    const watches = portal.watches ?? [];
    if(!watches.length) wrap.append(el('div', { class: 'empty' }, 'Follow a Shopify store to start your Shop. Preview it and choose a collection or sales only.'));
    if(portal.error) wrap.append(el('p', { class: 'error' }, portal.error));
    for(const watch of watches) {
      const status = watch.paused ? 'Paused' : watch.error ? `Refresh failed: ${watch.error}. Showing last observations.` : watch.checkedAt ? `Checked ${new Date(watch.checkedAt).toLocaleString()}` : 'Waiting for a check';
      const change = async (/** @type {boolean | undefined} */ paused) => {
        try { await callTool('unwatch', { id: watch.id, ...(paused === undefined ? {} : { paused }) }); await refreshPortal(portal.portalId); }
        catch(error) { toast(errorText(error)); }
      };
      const manage = el('details', { class: 'shop-manage' }, el('summary', null, `${watch.displayName}${watch.paused ? ' · paused' : ''}`),
        el('p', null, watch.origin, ` · ${watch.collection ? 'collection: ' + watch.collection : 'whole public catalogue'}${watch.salesOnly ? ' · sales only' : ''}`),
        el('p', { class: watch.error ? 'error' : 'shop-checked' }, `${status}${watch.partial ? ' · partial catalogue' : ''}`),
        el('button', { class: 'btn', type: 'button', onclick: () => change(!watch.paused) }, watch.paused ? 'Resume' : 'Pause'),
        el('button', { class: 'btn', type: 'button', onclick: () => change(undefined) }, 'Remove follow'));
      wrap.append(manage);
    }
    const visible = full ? portal.items : portal.items.slice(0, 6);
    if(visible.length) wrap.append(el('ul', { class: 'shop-grid' }, visible.map(item => el('li', null, watchNew(shopCard(item), item, portal)))));
    else if(watches.length) wrap.append(el('p', { class: 'empty' }, 'No products in the current scope. Check the store controls above for paused follows or refresh errors.'));
    if(visible.length < portal.items.length) wrap.append(el('button', { class: 'link-btn portal-more', type: 'button', onclick: () => openPortal(portal.portalId) }, `View all ${portal.items.length} retrieved products`));
    primePictures(wrap); return wrap;
  }
