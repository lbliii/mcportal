  // room/reader-tools.js: page-local find and reading comfort, shared by articles and docs.
  // Preferences last for this open view's session; neither queries nor settings leave the card.
  const readerComfort = { size: 'standard', measure: 'comfortable' };

  /** Preserve the visible content block while typography or the controls reflow.
   * @param {HTMLElement} body @param {() => void} change
   */
  function keepReaderPlace(body, change) {
    const reader = $('reader');
    const anchor = logicalBlocks(body).find((node) => node.getBoundingClientRect().bottom > readerVisibleTop(reader));
    const offset = anchor ? anchor.getBoundingClientRect().top - readerVisibleTop(reader) : 0;
    change();
    requestAnimationFrame(() => {
      if (!anchor?.isConnected) return;
      const delta = anchor.getBoundingClientRect().top - readerVisibleTop(reader) - offset;
      if (root.classList.contains('fullscreen')) window.scrollBy(0, delta);
      else reader.scrollTop += delta;
    });
  }

  /** @param {HTMLElement} body @param {HTMLHeadingElement} title */
  function applyReaderComfort(body, title) {
    const reader = $('reader');
    const font = readerComfort.size === 'larger' ? '1.25rem' : readerComfort.size === 'large' ? '1.125rem' : '1rem';
    body.style.setProperty('--mp-reader-font', font); title.style.setProperty('--mp-reader-font', font);
    body.style.setProperty('--mp-reader-measure', readerComfort.measure === 'focused' ? '60ch' : '72ch');
    reader.style.setProperty('--mp-reader-width', readerComfort.measure === 'focused' ? '38rem' : '44rem');
  }

  /** Authored text runs: keep inline emphasis together, and separate table cells and line breaks.
   * @param {HTMLElement} block @returns {Text[][]}
   */
  function readerTextRuns(block) {
    /** @type {Text[][]} */
    const runs = [[]];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node instanceof Element && node.matches('.code-head, button, figure a, .reader-media, .callout-label')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node instanceof Element && node.matches('br, th, td, .callout-label, .figure-caption, .figure-credit')) runs.push([]);
      if (node instanceof Text && node.length) runs[runs.length - 1].push(node);
    }
    return runs.filter((run) => run.length);
  }

  /** Add controls only after authored content is available.
   * @param {HTMLElement} top @param {HTMLElement} body @param {HTMLHeadingElement} title
   */
  function readerTools(top, body, title) {
    applyReaderComfort(body, title);
    const findToggle = el('button', { class: 'btn reader-find-toggle', 'aria-expanded': 'false', 'aria-controls': 'readerFind' }, 'Find');
    const comfortToggle = el('button', { class: 'btn reader-comfort-toggle', 'aria-expanded': 'false', 'aria-controls': 'readerComfort' }, 'Reading');
    const input = el('input', { type: 'search', class: 'reader-find-input', placeholder: 'Find in this page', 'aria-label': 'Find in this page', maxlength: '200', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const count = el('span', { class: 'reader-find-count', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, 'Enter text to find');
    const previous = el('button', { class: 'btn', 'aria-label': 'Previous match', disabled: true }, 'Previous');
    const next = el('button', { class: 'btn', 'aria-label': 'Next match', disabled: true }, 'Next');
    const closeFind = el('button', { class: 'btn', 'aria-label': 'Close find' }, 'Close');
    const find = el('div', { id: 'readerFind', class: 'reader-panel reader-find', hidden: true, role: 'search', 'aria-label': 'Find in this page' }, input, count, previous, next, closeFind);
    const size = el('select', { 'aria-label': 'Reading text size' },
      el('option', { value: 'standard' }, 'Standard'), el('option', { value: 'large' }, 'Large'), el('option', { value: 'larger' }, 'Larger'));
    const measure = el('select', { 'aria-label': 'Reading line width' }, el('option', { value: 'comfortable' }, 'Comfortable'), el('option', { value: 'focused' }, 'Focused'));
    size.value = readerComfort.size; measure.value = readerComfort.measure;
    const reset = el('button', { class: 'btn' }, 'Reset');
    const closeComfort = el('button', { class: 'btn', 'aria-label': 'Close reading settings' }, 'Close');
    const comfort = el('div', { id: 'readerComfort', class: 'reader-panel reader-comfort', hidden: true, role: 'group', 'aria-label': 'Reading settings' },
      el('label', null, 'Text size', size), el('label', null, 'Line width', measure), reset, closeComfort,
      el('small', null, 'Applies to articles and docs in this open session.'));
    top.append(findToggle, comfortToggle, find, comfort);

    /** @type {HTMLElement[][]} One match may span several inline marks. */
    let matches = [];
    let current = -1;
    let capped = false;
    function clearMatches() {
      for (const group of matches) for (const mark of group) { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); parent?.normalize(); }
      matches = []; current = -1; capped = false;
    }
    function updateCount() {
      count.textContent = !input.value ? 'Enter text to find' : !matches.length ? 'No matches' : `${current + 1} of ${matches.length}${capped ? '+' : ''}`;
      previous.disabled = next.disabled = !matches.length;
    }
    /** @param {number} direction */
    function move(direction) {
      if (!matches.length) return;
      matches[current]?.forEach((mark) => mark.classList.remove('current'));
      current = (current + direction + matches.length) % matches.length;
      matches[current].forEach((mark) => mark.classList.add('current'));
      const mark = matches[current][0];
      // Reveal overflowed code/table matches too, then align within the reader's own scroll area.
      for (const container of [mark.closest('pre'), mark.closest('.table-wrap')]) {
        if (!(container instanceof HTMLElement)) continue;
        container.scrollLeft += mark.getBoundingClientRect().left - container.getBoundingClientRect().left - 24;
        if (container.classList.contains('table-wrap')) container.scrollTop += mark.getBoundingClientRect().top - container.getBoundingClientRect().top - 48;
      }
      const reader = $('reader');
      if (root.classList.contains('fullscreen')) mark.scrollIntoView({ block: 'start', behavior: 'auto' });
      else reader.scrollTop += mark.getBoundingClientRect().top - readerVisibleTop(reader) - 12;
      updateCount();
    }
    function search() {
      clearMatches();
      const query = input.value;
      if (query) {
        const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
        for (const block of [title, ...logicalBlocks(body)]) {
          for (const run of readerTextRuns(block)) {
            const text = run.map((node) => node.data).join('');
            /** @type {Array<{ start: number, end: number, group: HTMLElement[] }>} */
            const spans = [];
            for (const hit of text.matchAll(pattern)) {
              if (matches.length >= 1000) { capped = true; break; }
              /** @type {HTMLElement[]} */
              const group = [];
              matches.push(group); spans.push({ start: hit.index, end: hit.index + hit[0].length, group });
            }
            let offset = 0;
            for (const node of run) {
              const length = node.length;
              // Work backwards so splitting text never changes later match offsets.
              for (const hit of spans.toReversed()) {
                const start = Math.max(0, hit.start - offset), end = Math.min(length, hit.end - offset);
                if (end <= start) continue;
                node.splitText(end);
                const part = node.splitText(start);
                const mark = el('mark', { class: 'reader-find-hit' });
                part.replaceWith(mark); mark.append(part); hit.group.push(mark);
              }
              offset += length;
            }
            if (capped) break;
          }
          if (capped) break;
        }
      }
      move(1); updateCount();
    }
    /** @param {boolean} open @param {boolean} [returnFocus] */
    function toggleFind(open, returnFocus = true) {
      keepReaderPlace(body, () => {
        if (open) for (const outline of top.querySelectorAll('details')) outline.open = false;
        find.hidden = !open; findToggle.setAttribute('aria-expanded', String(open));
        comfort.hidden = true; comfortToggle.setAttribute('aria-expanded', 'false');
        if (!open) { clearMatches(); input.value = ''; updateCount(); }
      });
      if (open) { input.focus({ preventScroll: true }); input.select(); }
      else if (returnFocus) findToggle.focus({ preventScroll: true });
    }
    /** @param {boolean} open @param {boolean} [returnFocus] */
    function toggleComfort(open, returnFocus = true) {
      toggleFind(false, false);
      keepReaderPlace(body, () => {
        if (open) for (const outline of top.querySelectorAll('details')) outline.open = false;
        comfort.hidden = !open; comfortToggle.setAttribute('aria-expanded', String(open));
      });
      if (open) size.focus({ preventScroll: true });
      else if (returnFocus) comfortToggle.focus({ preventScroll: true });
    }
    function changeComfort() {
      keepReaderPlace(body, () => { readerComfort.size = size.value; readerComfort.measure = measure.value; applyReaderComfort(body, title); });
    }
    findToggle.addEventListener('click', () => toggleFind(find.hidden));
    comfortToggle.addEventListener('click', () => toggleComfort(comfort.hidden));
    closeFind.addEventListener('click', () => toggleFind(false));
    closeComfort.addEventListener('click', () => toggleComfort(false));
    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1); } });
    previous.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
    size.addEventListener('change', changeComfort); measure.addEventListener('change', changeComfort);
    reset.addEventListener('click', () => { size.value = 'standard'; measure.value = 'comfortable'; changeComfort(); });
    top.addEventListener('toggle', (e) => {
      if (e.target instanceof HTMLDetailsElement && e.target.open) toggleFind(false, false);
    }, true);
    // Keep this listener on the current view: replacing its content also retires shortcuts.
    $('reader').onkeydown = (e) => {
      if (e.defaultPrevented || !body.isConnected || $('reader').hidden) return;
      if (e.key === 'Escape' && passageBar) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.altKey && !e.shiftKey) { e.preventDefault(); toggleFind(true); }
      if (e.key === 'Escape' && (!find.hidden || !comfort.hidden)) {
        e.preventDefault();
        if (!find.hidden) toggleFind(false); else toggleComfort(false);
      }
    };
  }
