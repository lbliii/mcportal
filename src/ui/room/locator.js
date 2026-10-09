  /** Whitespace-normalized source text, shared by capture, matching and digest input.
   * @param {string} text
   */
  function normalizePassageText(text) { return text.replace(/\s+/g, ' ').trim(); }

  /** Resolve retained text conservatively; a numeric block never disambiguates repeated text.
   * @param {string[]} blocks @param {import('../evidence.ts').PassageLocator} locator
   * @param {string} [digest] @param {string} [revision]
   * @returns {{status: 'exact' | 'relocated' | 'ambiguous' | 'unavailable', block?: number}}
   */
  function resolvePassageTexts(blocks, locator, digest, revision) {
    const texts = blocks.map(normalizePassageText), whole = texts.join(' '), quote = normalizePassageText(locator.text);
    if (!quote) return { status: 'unavailable' };
    /** @type {number[]} */
    const offsets = [];
    for (let offset = whole.indexOf(quote); offset >= 0; offset = whole.indexOf(quote, offset + 1)) offsets.push(offset);
    if (!offsets.length) return { status: 'unavailable' };
    const context = offsets.filter(offset => (!locator.prefix || whole.slice(0, offset).endsWith(locator.prefix))
      && (!locator.suffix || whole.slice(offset + quote.length).startsWith(locator.suffix)));
    const candidates = context.length ? context : offsets;
    if (candidates.length !== 1) return { status: 'ambiguous' };
    const offset = candidates[0];
    let start = 0;
    const block = texts.findIndex(text => { const end = start + text.length; const contains = offset >= start && offset < end; start = end + 1; return contains; });
    if (block < 0) return { status: 'unavailable' };
    const changed = (locator.digest !== undefined && locator.digest !== digest)
      || (locator.revision !== undefined && locator.revision !== revision)
      || (locator.block !== undefined && locator.block !== block) || !context.length;
    return { status: changed ? 'relocated' : 'exact', block };
  }

  /** Authored text only: generated buttons and media controls are excluded.
   * @param {HTMLElement} body
   */
  function passageTexts(body) {
    return logicalBlocks(body).map(node => normalizePassageText(readerTextRuns(node).map(run => run.map(t => t.textContent).join('')).join(' ')));
  }

  /** Digest promises are tied to the rendered representation, never to account identity.
   * @type {WeakMap<HTMLElement, Promise<string | undefined>>}
   */
  const passageDigests = new WeakMap();
  /** @param {HTMLElement} body */
  function passageDigest(body) {
    let pending = passageDigests.get(body);
    if (!pending) {
      pending = globalThis.crypto?.subtle
        ? crypto.subtle.digest('SHA-256', new TextEncoder().encode(passageTexts(body).join(' ')))
          .then(bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('')).catch(() => undefined)
        : Promise.resolve(undefined);
      passageDigests.set(body, pending);
    }
    return pending;
  }

  /** Capture bounded surroundings from the selected block; repeated text within that block
   * omits context rather than inventing which occurrence the user intended.
   * @param {HTMLElement} body @param {number} block @param {string} selected
   * @returns {import('../evidence.ts').PassageLocator}
   */
  function capturePassageLocator(body, block, selected) {
    const texts = passageTexts(body), text = normalizePassageText(selected).slice(0, 300), local = texts[block] || '';
    const locator = { text, block, ...(headingAt(body, block) ? { heading: headingAt(body, block) } : {}) };
    const at = local.indexOf(text);
    if (at < 0 || local.indexOf(text, at + 1) >= 0) return locator;
    const offset = texts.slice(0, block).reduce((n, t) => n + t.length + 1, 0) + at;
    const whole = texts.join(' ');
    return { ...locator, prefix: whole.slice(Math.max(0, offset - 120), offset), suffix: whole.slice(offset + text.length, offset + text.length + 120) };
  }
