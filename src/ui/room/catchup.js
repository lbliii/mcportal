  /** @type {CatchupSession | null} */
  let catchupSession = null;
  let catchupGeneration = 0;
  $('btnCatchup').addEventListener('click', () => openCatchup());
  async function openCatchup() {
    const generation = ++catchupGeneration;
    enterExperience('catchup');
    $('experiences').replaceChildren(el('p', { class: 'experience-muted', role: 'status' }, 'Opening your reading session…'));
    try {
      const { session } = (await callTool('catch_up', { action: 'open' })).structuredContent;
      if (generation === catchupGeneration && experience === 'catchup') showCatchup(session);
    } catch (error) { if (generation === catchupGeneration && experience === 'catchup') $('experiences').replaceChildren(el('p', { class: 'error', role: 'alert' }, errorText(error)), el('button', { class: 'btn', onclick: () => openCatchup() }, 'Try again')); }
  }
  /** @param {CatchupSession | null} session */
  function showCatchup(session) {
    catchupSession = session;
    enterExperience('catchup');
    const head = el('header', { class: 'experience-heading' }, el('span', { class: 'experience-kicker' }, 'A LITTLE READING. A REAL FINISH.'), el('h1', null, 'Catch up, then step away'),
      el('p', null, 'A small session from your retrieved unseen stories. New arrivals can wait.'));
    $('experiences').replaceChildren(head);
    if (session) {
      const count = session.stories.length;
      $('experiences').append(el('div', { class: 'catchup-progress' }, el('progress', { max: Math.max(1,count), value: session.cursor, 'aria-label': 'Catch-up progress' }), el('span', null, `${session.cursor} of ${count} stories`)),
        el('p', { class: 'experience-muted' }, `Captured ${new Date(session.startedAt).toLocaleString()}. Coverage is limited to the items retrieved from the selected sources.`));
      if (session.failures.length) $('experiences').append(el('section', { class: 'catchup-failures' }, el('h2', null, 'Sources that could not load'), ...session.failures.map(message => el('p', { class: 'error' }, message))));
      if (session.finishedAt) $('experiences').append(el('section', { class: 'catchup-end' }, el('span', { class: 'experience-kicker' }, 'YOU HAVE REACHED THE END'), el('h2', null, count ? 'A good place to stop.' : 'No unseen stories in this retrieved set.'),
        el('p', null, count ? (session.acknowledgedAt ? 'Your captured set is acknowledged. Finishing this session does not mark articles as read.' : 'Your session is finished. Acknowledgment is pending; retry below to update source attention.') : 'Refresh your sources later, or choose different ones for a new session.'),
        !session.acknowledgedAt ? el('button', { class: 'btn', onclick: () => advanceCatchup('end') }, 'Retry acknowledging this session') : null,
        el('button', { class: 'btn', onclick: () => $('btnExperienceRoom').click() }, 'Return to your room')));
      else {
        const story = session.stories[session.cursor];
        $('experiences').append(el('article', { class: 'catchup-story' }, el('span', { class: 'experience-kicker' }, `${story.source} · STORY ${session.cursor + 1}`), el('h2', null, story.item.title),
          story.item.summary ? el('p', null, story.item.summary) : null, el('p', { class: 'experience-muted' }, story.item.meta.join(' · ')),
          el('div', { class: 'experience-row' }, el('button', { class: 'btn primary', onclick: () => openCapturedStory(story) }, 'Read this story'),
            saveButton(story.item, story.source, 'ib save'), el('button', { class: 'btn', onclick: () => advanceCatchup('finish') }, 'Next story'), el('button', { class: 'link-btn', onclick: () => advanceCatchup('skip') }, 'Skip'))),
          el('button', { class: 'link-btn catchup-finish', onclick: () => advanceCatchup('end') }, 'Finish this catch-up now'));
      }
    }
    if (!session || session.finishedAt) $('experiences').append(catchupStartForm());
  }
  function catchupStartForm() {
    const count = el('select', { 'aria-label': 'Stories in your catch-up session' }, [3,10,20,30].map(n => el('option', { value: n }, `${n} stories`))); count.value = '10';
    const specs = state.profile?.columns.flatMap(c => c.panels).filter(p => p.source !== 'saved' && p.source !== 'clips' && p.source !== 'upcoming' && p.source !== 'changes') || [];
    const sources = specs.map(p => { const input = el('input', { type: 'checkbox', value: p.id, checked: true }); return { input, label: el('label', null, input, p.title || p.id) }; });
    const go = el('button', { class: 'btn primary', type: 'submit' }, 'Start a little catch-up');
    const status = el('p', { class: 'experience-muted', role: 'status' });
    const form = el('form', { class: 'catchup-start' }, el('h2', null, 'Choose a small session'), count,
      sources.length ? el('fieldset', null, el('legend', null, 'From your sources'), ...sources.map(s => s.label)) : el('p', null, 'Uses the sources in your room.'), go, status);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const selected = sources.filter(s => s.input.checked).map(s => s.input.value);
      if (sources.length && !selected.length) { status.textContent = 'Choose at least one source.'; return; }
      go.disabled = true; status.textContent = 'Capturing currently retrieved unseen stories…';
      try {
        const { session } = (await callTool('catch_up', { action: 'start', count: Number(count.value), ...(sources.length ? { portalIds: selected } : {}) })).structuredContent;
        if (experience === 'catchup') showCatchup(session);
      } catch (error) { status.textContent = errorText(error); go.disabled = false; }
    });
    return form;
  }
  /** @param {'skip' | 'finish' | 'end'} action */
  async function advanceCatchup(action) {
    const current = catchupSession;
    if (!current) return;
    for (const button of $$('.catchup-story button, .catchup-finish, .catchup-end button')) button.setAttribute('disabled', '');
    try {
      const { session } = (await callTool('catch_up', { action, sessionId: current.id, index: current.cursor })).structuredContent;
      if (experience === 'catchup') showCatchup(session);
    } catch (error) { toast(errorText(error)); openCatchup(); }
  }
  /** @param {CapturedStory} story */
  function openCapturedStory(story) {
    if (story.docs && story.item.url) {
      suspendExperience(); return openDocs({ docs: story.docs }, { url: story.item.url });
    }
    if (story.item.share || story.item.clip) {
      suspendExperience(); return openItem(story.item, { portalId: story.portalId, source: story.sourceKind, title: story.source, items: [story.item], provenance: { source: story.sourceKind, endpoint: story.item.url || '', ttlSeconds: 0 } });
    }
    if (story.item.url) return openLibraryHit({ ref: `url:${story.item.url}`, kind: 'page', title: story.item.title, source: story.source, url: story.item.url, tags: [], excerpt: story.item.summary || '', updatedAt: catchupSession?.startedAt || '', saved: state.saved.has(story.item.url), matched: [] });
    toast('This story has no readable address. You can skip it.');
  }
