  // A reader returns to the exact experience DOM, query and scroll position it left.
  let experience = '';
  /** @type {{x: number, y: number, top: number, focus: Element | null} | null} */
  let experienceReturn = null;
  /** @type {{url: string, locator: import('../evidence.ts').PassageLocator} | null} */
  let pendingKeptLocator = null;
  /** @param {string} name */
  function enterExperience(name) {
    if (stopReading) stopReading();
    readerGeneration++;
    if (!experience) rememberRoomNavigation();
    experience = name;
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
    experience = ''; experienceReturn = null;
    root.classList.remove('experience-view');
    $('experiences').hidden = true;
    for (const button of $$('.experience-nav button')) button.removeAttribute('aria-current');
    $('btnExperienceRoom').setAttribute('aria-current', 'page');
  }
  function suspendExperience() {
    experienceReturn = { x: window.scrollX, y: window.scrollY, top: $('experiences').scrollTop, focus: document.activeElement };
    $('experiences').hidden = true;
  }
  function restoreExperience() {
    if (!experienceReturn || !experience) return false;
    const previous = experienceReturn; experienceReturn = null;
    enterExperience(experience);
    $('experiences').scrollTop = previous.top;
    if (previous.focus instanceof HTMLElement) previous.focus.focus({ preventScroll: true });
    window.scrollTo(previous.x, previous.y);
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
    const generation = ++readerGeneration;
    $('grid').hidden = true; reader.hidden = false; reader.scrollTop = 0; window.scrollTo(0, 0);
    reader.replaceChildren(readerTop(hit.url || '', true), el('h1', null, hit.title), el('p', { class: 'byline' }, 'Opening…'));
    try {
      if (hit.clipId && !atPassage) {
        const { clip } = (await callTool('get_clip', { id: hit.clipId })).structuredContent;
        if (generation !== readerGeneration) return;
        reader.replaceChildren(...clipNodes(clip, true));
        const back = reader.querySelector('button');
        if (back) back.setAttribute('aria-label', 'Back to your reading experience');
      } else if (hit.url) {
        const { article } = (await callTool('read_article', { url: hit.url })).structuredContent;
        if (generation !== readerGeneration) return;
        reader.replaceChildren(...articleNodes(article, hit.source, true));
        trackReading(article.url, article.title, reader);
      } else throw new Error('This item has no readable source.');
    } catch (error) {
      if (generation !== readerGeneration) return;
      reader.replaceChildren(...present([readerTop(hit.url || '', true), el('h1', null, hit.title), el('p', { class: 'error', role: 'alert' }, errorText(error)),
        hit.url ? el('button', { class: 'btn', onclick: () => openLink(hit.url || '') }, 'Open the original') : null]));
    }
  }

  /** Only a unique retained text match resolves a passage; obsolete block numbers never guess. @param {HTMLElement} body */
  function applyKeptLocator(body) {
    const pending = pendingKeptLocator;
    if (!pending) return false;
    pendingKeptLocator = null;
    const normalize = (/** @type {string} */ text) => text.replace(/\s+/g, ' ').trim();
    const blocks = [...body.children], texts = blocks.map(b => normalize(b.textContent || ''));
    const whole = texts.join(' '), hint = normalize(pending.locator.text), offset = whole.indexOf(hint);
    if (body.dataset.passageUrl?.split('#')[0] === pending.url && offset >= 0 && whole.indexOf(hint, offset + 1) < 0) {
      let start = 0;
      const index = texts.findIndex(text => { const end = start + text.length; const contains = offset >= start && offset <= end; start = end + 1; return contains; });
      if (blocks[index]) { blocks[index].scrollIntoView({ block: 'start' }); toast('Returned to your kept passage'); return true; }
    }
    body.before(el('p', { class: 'handoff-note', role: 'status' }, 'The original passage could not be located in this version. Your retained quote is still available in Recall.'));
    return true;
  }

  /** Date-only events stay visible for their entire local day. @param {import('../watches-state.ts').WatchedEvent} event */
  function eventIsPast(event) {
    if (!event.allDay) return Date.parse(event.startsAt) < Date.now();
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return date.format(new Date(event.startsAt)) < date.format(new Date());
  }
