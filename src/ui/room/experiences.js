  /** @type {{url: string, locator: import('../evidence.ts').PassageLocator} | null} */
  let pendingKeptLocator = null;
  /** @param {string} name */
  function enterExperience(name) {
    navigation.enterExperience(name);
    root.classList.add('experience-view');
    root.classList.remove('article-view', 'welcome-view');
    $('grid').hidden = true; $('welcome').hidden = true; $('reader').hidden = true; $('experiences').hidden = false;
    $('roomName').textContent = state.profile?.name || 'your reading';
    for (const button of $$('.experience-nav button')) {
      button.removeAttribute('aria-current');
      if (button.id === (name === 'recall' ? 'btnRecall' : name === 'compare' ? 'btnCompare' : name === 'catchup' ? 'btnCatchup' : name === 'changes' ? 'btnChanges' : name === 'upcoming' ? 'btnUpcoming' : name === 'desk' || name === 'collections' ? 'btnCollections' : '')) button.setAttribute('aria-current', 'page');
    }
    setStatus('');
  }
  function leaveExperience() {
    navigation.leaveExperience();
    root.classList.remove('experience-view');
    $('experiences').hidden = true;
    for (const button of $$('.experience-nav button')) button.removeAttribute('aria-current');
    $('btnExperienceRoom').setAttribute('aria-current', 'page');
  }
  function suspendExperience() {
    navigation.suspendExperience();
    $('experiences').hidden = true;
  }
  function restoreExperience() {
    const previous = navigation.takeExperienceReturn();
    if (!previous || !navigation.experience) return false;
    enterExperience(navigation.experience);
    navigation.restorePosition(previous);
    return true;
  }
  $('btnRecall').addEventListener('click', () => showRecall());
  $('btnExperienceRoom').addEventListener('click', async () => {
    leaveExperience();
    await closeReader();
  });

  /** A kept page uses the existing docs or article reader, regardless of room open-in preference. @param {LibraryHit} hit */
  async function openLibraryHit(hit, atPassage = false) {
    suspendExperience();
    if (stopReading) stopReading();
    if (atPassage && hit.url && hit.locator) pendingKeptLocator = { url: hit.url.split('#')[0], locator: hit.locator };
    if ((!hit.clipId || atPassage) && hit.docs && hit.url) return openDocs({ docs: hit.docs }, { url: hit.url });
    const reader = $('reader');
    const generation = navigation.begin('reader');
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    renderReader(readerTop(hit.url || '', true), el('h1', null, hit.title), el('p', { class: 'byline' }, 'Opening…'));
    try {
      if (hit.clipId && !atPassage) {
        const { clip } = (await callTool('get_clip', { id: hit.clipId })).structuredContent;
        if (!navigation.owns(generation)) return;
        renderReader(...clipNodes(clip, true));
      } else if (hit.url) {
        const { article } = (await callTool('read_article', { url: hit.url })).structuredContent;
        if (!navigation.owns(generation)) return;
        renderReader(...articleNodes(article, hit.source, true));
        trackReading(article.url, article.title, reader);
      } else throw new Error('This item has no readable source.');
    } catch (error) {
      if (!navigation.owns(generation)) return;
      renderReader(...present([readerTop(hit.url || '', true), el('h1', null, hit.title), el('p', { class: 'error', role: 'alert' }, errorText(error)),
        hit.url ? el('button', { class: 'btn', onclick: () => openLink(hit.url || '') }, 'Open the original') : null]));
    }
  }

  /** Only a unique retained text match resolves a passage; obsolete block numbers never guess. @param {HTMLElement} body */
  function applyKeptLocator(body) {
    const pending = pendingKeptLocator;
    if (!pending) return false;
    pendingKeptLocator = null;
    const generation = navigation.token();
    passageDigest(body).then(digest => {
      if (!body.isConnected || !navigation.owns(generation)) return;
      const result = body.dataset.passageUrl?.split('#')[0] === pending.url
        ? resolvePassageTexts(passageTexts(body), pending.locator, digest)
        : { status: 'unavailable' };
      if ('block' in result && result.block !== undefined) {
        logicalBlocks(body)[result.block]?.scrollIntoView({ block: 'start' });
        toast(result.status === 'exact' ? 'Returned to your kept passage' : 'Passage relocated in the current version');
      } else body.before(el('p', { class: 'handoff-note', role: 'status' }, result.status === 'ambiguous'
        ? 'This passage occurs more than once. Your retained quote is available in Recall; no exact location was chosen.'
        : 'The original passage could not be located in this version. Your retained quote is still available in Recall.'));
    });
    return true;
  }

  /** Date-only events stay visible for their entire local day. @param {import('../watches-state.ts').WatchedEvent} event */
  function eventIsPast(event) {
    if (!event.allDay) return Date.parse(event.startsAt) < Date.now();
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return date.format(new Date(event.startsAt)) < date.format(new Date());
  }
