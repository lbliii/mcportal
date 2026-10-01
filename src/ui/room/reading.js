  // room/reading.js: reading history, recorded from what the reader actually does
  // ------------------------------------------------------------ reading history
  // Opening an article records it as opened and picks up where the user left off: the
  // furthest point they reached, so scrolling back up to leave doesn't lose it. That
  // position is saved at most every POSITION_EVERY ms, and when they leave. Only the
  // "Mark as read" button marks it read; progress never implies read. The model reads
  // this back with list_reading and never records reading itself (docs/reading-state.md).
  const POSITION_EVERY = 15000;
  const MEASURE_AFTER = 250;
  /** Saves the open article's position, if it moved, and stops watching it. @type {(() => void) | null} */
  let stopReading = null;

  /**
   * Record and resume reading for the article now shown in `reader` (its blocks in `.body`).
   * Failures are quiet: history is a convenience, and a server may not keep it.
   * @param {string} url @param {string} title @param {HTMLElement} reader
   */
  async function trackReading(url, title, reader) {
    if (stopReading) stopReading();
    const body = reader.querySelector('.body');
    if (!body) return;
    const blocks = () => [...body.children];
    let read = false;
    let furthest = { block: 0, progress: 0 };
    let saved = '0:0';
    let measureTimer = 0;
    let saveTimer = 0;
    let lastSave = 0;

    // Where the user is: the first block on screen, and how much has been on screen.
    const position = () => {
      const box = reader.getBoundingClientRect();
      const top = Math.max(0, box.top), bottom = Math.min(window.innerHeight, box.bottom);
      const list = blocks();
      const first = Math.max(0, list.findIndex((b) => b.getBoundingClientRect().bottom > top + 1));
      let last = -1;
      list.forEach((b, i) => { if (b.getBoundingClientRect().top < bottom) last = i; });
      return { block: first, progress: list.length ? Math.round(((last + 1) / list.length) * 100) / 100 : 0 };
    };
    const save = () => {
      clearTimeout(saveTimer); saveTimer = 0;
      const key = `${furthest.block}:${furthest.progress}`;
      if (read || key === saved) return;
      saved = key; lastSave = Date.now();
      callTool('record_reading', { url, status: 'opened', progress: furthest.progress, anchor: { block: furthest.block } }).catch(() => {});
    };
    const measure = () => {
      clearTimeout(measureTimer); measureTimer = 0;
      if (!body.isConnected) return;
      const here = position();
      if (here.progress <= furthest.progress) return;
      furthest = here;
      if (!saveTimer) saveTimer = window.setTimeout(save, Math.max(1000, POSITION_EVERY - (Date.now() - lastSave)));
    };
    const onScroll = () => {
      if (!body.isConnected) { stop(); return; }
      if (!measureTimer) measureTimer = window.setTimeout(measure, MEASURE_AFTER);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') { measure(); save(); } };
    const stop = () => {
      if (stopReading !== stop) return;
      stopReading = null;
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('visibilitychange', onHide);
      if (measureTimer) measure();
      save();
    };
    stopReading = stop;

    const button = el('button', { class: 'btn mark-read', type: 'button' }, 'Mark as read');
    button.addEventListener('click', async () => {
      read = true;
      button.disabled = true; button.textContent = 'Read';
      try { await callTool('record_reading', { url, status: 'read', title }); }
      catch { read = false; button.disabled = false; button.textContent = 'Mark as read'; toast("Couldn't mark it as read"); }
    });
    body.after(el('div', { class: 'read-end' }, button));

    try {
      const { reading } = (await callTool('get_reading', { url })).structuredContent;
      if (stopReading !== stop) return;
      const block = reading && reading.status !== 'read' && reading.anchor ? reading.anchor.block ?? 0 : 0;
      const target = blocks()[block];
      if (reading && block > 0 && target) {
        target.scrollIntoView({ block: 'start' });
        furthest = { block, progress: reading.progress ?? 0 };
        saved = `${furthest.block}:${furthest.progress}`;
        toast('Picked up where you left off');
      }
      await callTool('record_reading', { url, status: 'opened', title });
    } catch {
      return;   // no reading history here: don't watch
    }
    if (stopReading !== stop) return;
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onHide);
  }
