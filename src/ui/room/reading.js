  // room/reading.js: reading history, recorded from what the reader actually does
  // ------------------------------------------------------------ reading history
  // Opening an article records it as opened and picks up where the user left off: the
  // furthest point they reached, so scrolling back up to leave doesn't lose it. That
  // position is saved at most every POSITION_EVERY ms, and when they leave. Scrolling is
  // watched from the moment the article shows, so a scroll while the history loads isn't
  // missed; positions are only sent once the stored one is known (so they never overwrite
  // it blind), and after the open is recorded (so the two writes can't cross). Only the
  // "Mark as read" button marks it read; progress never implies read. The model reads
  // this back with list_reading and never records reading itself (docs/explanation/reading.md).
  const POSITION_EVERY = 15000;
  const MEASURE_AFTER = 250;
  /** Saves the open article's position, if it moved, and stops watching it. @type {(() => void) | null} */
  let stopReading = null;
  /** Writes from the previous reader settle before another view resumes its saved position. @type {Promise<unknown>} */
  let readingWrites = Promise.resolve();

  let continueGeneration = 0;
  /** Show recent unfinished reading without changing the user's portals or layout. */
  async function refreshContinueReading() {
    const generation = ++continueGeneration;
    let strip = $first('.continue-reading');
    if (!strip) {
      strip = el('section', { class: 'continue-reading', 'aria-label': 'Continue reading', hidden: true });
      $('grid').before(strip);
    }
    strip.setAttribute('aria-busy', 'true');
    try {
      await readingWrites.catch(() => {});
      const { reading } = (await callTool('list_reading', { unfinished: true, limit: 4 })).structuredContent;
      if (generation !== continueGeneration) return;
      const items = reading.filter((r) => isHttpUrl(r.url));
      strip.replaceChildren(el('div', { class: 'continue-head' },
        el('h2', null, 'Continue reading'), el('span', { class: 'continue-count' }, `${items.length} unfinished`)),
        el('ul', null, items.map((r) => {
          const progress = Math.max(0, Math.min(100, Math.round((r.progress ?? 0) * 100)));
          const source = new URL(r.url).hostname.replace(/^www\./, '');
          const title = r.title || r.url;
          return el('li', null,
            el('button', { class: 'continue-item', type: 'button', title, onclick: () => continueReading(r) },
              el('span', { class: 'continue-source' }, source),
              el('span', { class: 'continue-title' }, title),
              el('span', { class: 'continue-meta' },
                el('span', { class: 'continue-percent' }, `${progress}% read`),
                el('span', null, `Opened ${ago(r.lastOpenedAt)}`)),
              el('span', { class: 'continue-progress', 'aria-hidden': 'true' },
                el('span', { style: `width:${progress}%` }))));
        })));
      strip.hidden = !items.length;
    } catch { if (generation === continueGeneration) strip.hidden = true; }   // older servers may not have reading history
    finally { if (generation === continueGeneration) strip.setAttribute('aria-busy', 'false'); }
  }

  /** @param {ToolResults['list_reading']['reading'][number]} reading */
  function continueReading(reading) {
    // Prefer the original docs portal, including pages not among its current first items.
    const specs = state.profile?.columns.flatMap((column) => column.panels) ?? [];
    const docs = specs.find((spec) => {
      if (spec.source !== 'docs') return false;
      const portal = state.portals.get(spec.id);
      if (portal?.items.some((item) => item.url?.split('#')[0] === reading.url)) return true;
      if (!spec.config || !('url' in spec.config) || typeof spec.config.url !== 'string') return false;
      try {
        const toc = spec.config.toc;
        let site = new URL(toc?.url || spec.config.url);
        const page = new URL(reading.url);
        // GitHub indexes use web URLs, but their pages are read from the raw host.
        if (site.hostname === 'github.com') {
          const [owner, repo, kind, ref, ...folder] = site.pathname.split('/').filter(Boolean);
          if (kind !== 'tree' || !ref) return false;
          site = new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${folder.join('/')}`);
        } else if (toc || /\/(?:llms\.txt|objects\.inv|sitemap(?:_index)?\.xml)$/i.test(site.pathname)) {
          // A TOC file names its directory, not a subtree beneath the filename.
          site = new URL('.', site);
        }
        return site.origin === page.origin && (page.pathname === site.pathname || page.pathname.startsWith(site.pathname.replace(/\/$/, '') + '/'));
      } catch { return false; }
    });
    if (docs) return openDocs({ portalId: docs.id }, { url: reading.url });
    const portal = [...state.portals.values()].find((p) => p.items.some((item) => item.url === reading.url)) ?? [...state.portals.values()][0];
    if (portal) return openReader({ id: reading.url, url: reading.url, title: reading.title || reading.url, meta: [] }, portal);
    return loadArticleCard(reading.url);
  }

  /**
   * Record and resume reading for the article now shown in `reader` (its blocks in `.body`).
   * Failures are quiet: history is a convenience, and a server may not keep it.
   * @param {string} url @param {string} title @param {HTMLElement} reader
   * @param {boolean} [resume]  pick up where the user left off (not when a handoff already placed them)
   */
  async function trackReading(url, title, reader, resume = true) {
    if (stopReading) stopReading();
    const body = reader.querySelector('.body');
    if (!(body instanceof HTMLElement)) return;
    const blocks = () => logicalBlocks(body);
    let read = false;
    let ready = false;   // the stored position is known: saves may go out
    /** @type {Promise<unknown>} */
    let recorded = Promise.resolve();   // the open being recorded; position saves follow it
    let furthest = { block: 0, progress: 0 };
    let saved = '0:0';
    let measureTimer = 0;
    let saveTimer = 0;
    let lastSave = 0;

    // Where the user is: the first block on screen, and how much has been on screen.
    const position = () => {
      const box = reader.getBoundingClientRect();
      const top = readerVisibleTop(reader), bottom = Math.min(window.innerHeight, box.bottom);
      const list = blocks();
      const first = Math.max(0, list.findIndex((b) => b.getBoundingClientRect().bottom > top + 1));
      let last = -1;
      list.forEach((b, i) => { if (b.getBoundingClientRect().top < bottom) last = i; });
      return { block: first, progress: list.length ? Math.round(((last + 1) / list.length) * 100) / 100 : 0 };
    };
    const save = () => {
      clearTimeout(saveTimer); saveTimer = 0;
      const key = `${furthest.block}:${furthest.progress}`;
      if (!ready || read || key === saved) return;
      saved = key; lastSave = Date.now();
      const update = { url, status: 'opened', progress: furthest.progress, anchor: { block: furthest.block, heading: headingAnchorAt(body, furthest.block) } };
      recorded = recorded.then(() => callTool('record_reading', update)).catch(() => {});
      readingWrites = recorded;
    };
    const queueSave = () => {
      if (!saveTimer) saveTimer = window.setTimeout(save, Math.max(1000, POSITION_EVERY - (Date.now() - lastSave)));
    };
    const measure = () => {
      clearTimeout(measureTimer); measureTimer = 0;
      if (!body.isConnected) return;
      const here = position();
      if (here.progress <= furthest.progress && here.block <= furthest.block) return;
      furthest = { block: Math.max(furthest.block, here.block), progress: Math.max(furthest.progress, here.progress) };
      body.dataset.furthest = String(furthest.block);
      queueSave();
    };
    const onScroll = () => {
      if (!body.isConnected) { stop(); return; }
      if (!measureTimer) measureTimer = window.setTimeout(measure, MEASURE_AFTER);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') { measure(); save(); } };
    const detach = () => {
      stopReading = null;
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('visibilitychange', onHide);
    };
    const stop = () => {
      if (stopReading !== stop) return;
      detach();
      if (measureTimer) measure();
      save();
    };
    stopReading = stop;
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onHide);

    const button = el('button', { class: 'btn mark-read', type: 'button', disabled: true }, 'Mark as read');
    button.addEventListener('click', async () => {
      read = true;
      clearTimeout(saveTimer); saveTimer = 0;
      button.disabled = true; button.textContent = 'Read';
      const completed = recorded.then(() => callTool('record_reading', { url, status: 'read', title }));
      readingWrites = completed.catch(() => {});
      try { await completed; refreshContinueReading(); }
      catch { read = false; button.disabled = false; button.textContent = 'Mark as read'; toast("Couldn't mark it as read"); }
    });
    body.after(el('div', { class: 'read-end' }, button));

    try {
      await readingWrites.catch(() => {});
      const { reading } = (await callTool('get_reading', { url })).structuredContent;
      if (stopReading !== stop) return;
      const anchor = reading && reading.status !== 'read' ? reading.anchor : null;
      const block = resolveBlock(body, anchor);
      const target = blocks()[block];
      if (reading && reading.status !== 'read') {
        furthest = { block: Math.max(0, Math.min(block, blocks().length - 1)), progress: reading.progress ?? 0 };
        saved = `${furthest.block}:${furthest.progress}`;
      }
      if (resume && reading && block > 0 && target) {
        target.scrollIntoView({ block: 'start' });
        toast('Picked up where you left off');
      }
      ready = true;
      recorded = callTool('record_reading', { url, status: 'opened', title });
      readingWrites = recorded.catch(() => {});
      if (`${furthest.block}:${furthest.progress}` !== saved) queueSave();   // scrolled while the history loaded
      await recorded;
      if (stopReading === stop) button.disabled = false;
    } catch {
      // no reading history here: stop watching
      clearTimeout(measureTimer); clearTimeout(saveTimer);
      if (stopReading === stop) detach();
    }
  }
