  // Owner controls live beside the Space. Only the preview is redrawn after a save.
  /** @param {Space} space @param {() => void} refresh */
  function spaceCustomization(space, refresh) {
    const panel = el('section', { id: 'spaceCustomization', class: 'space-owner-panel', 'aria-label': 'Customize your Space', hidden: true });
    const toggle = el('button', { class: 'btn space-customize-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'spaceCustomization' }, icon('space'), ' Customize');
    const close = el('button', { class: 'btn space-owner-close', type: 'button', 'aria-label': 'Close customization' }, 'Close');
    const status = el('span', { class: 'space-owner-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, 'Changes save as you go.');
    const retry = el('button', { class: 'btn space-owner-retry', type: 'button', hidden: true }, 'Retry');
    const layout = el('div', { class: 'space-owner-layout' }, panel);
    const bar = el('div', { class: 'space-owner-bar' }, el('div', { class: 'space-owner-label' }, el('strong', null, 'Your Space'), el('span', null, 'Only you see these controls')),
      el('div', { class: 'space-owner-actions' },
        space.link ? el('button', { class: 'btn space-owner-quiet', type: 'button', onclick: () => openLink(space.link || '') }, 'View public Space') : null,
        el('button', { class: 'btn space-owner-quiet', type: 'button', disabled: !space.link, onclick: () => copySpaceLink(space.link || '') }, 'Copy link to your space'), toggle));
    /** @type {Array<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>} */
    const controls = [];
    /** @type {Record<string, HTMLButtonElement>} */
    const tabs = {};
    /** @type {Record<string, HTMLDivElement>} */
    const sections = {};
    let active = 'appearance';
    let busy = false;
    /** @type {{ input: Record<string, unknown>; refreshOnly: boolean } | undefined} */
    let failed;

    /** @param {string} name @param {boolean} [focus] */
    function selectTab(name, focus = false) {
      active = name;
      for (const [key, tab] of Object.entries(tabs)) {
        tab.setAttribute('aria-selected', String(key === name)); tab.tabIndex = key === name ? 0 : -1;
        sections[key].hidden = key !== name;
      }
      if (focus) tabs[name].focus({ preventScroll: true });
    }
    /** @param {boolean} open */
    function setOpen(open) {
      panel.hidden = !open; layout.classList.toggle('is-editing', open);
      toggle.setAttribute('aria-expanded', String(open));
      (open ? tabs[active] : toggle).focus();
    }
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    close.addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } });
    const tablist = el('div', { class: 'space-owner-tabs', role: 'tablist', 'aria-label': 'Customization sections' });
    for (const [name, label] of [['appearance', 'Appearance'], ['content', 'Content'], ['visibility', 'Visibility']]) {
      const tab = el('button', { type: 'button', role: 'tab', id: `space-tab-${name}`, 'aria-controls': `space-settings-${name}`, 'aria-selected': String(name === active), tabindex: name === active ? '0' : '-1' }, label);
      tabs[name] = tab;
      tab.addEventListener('click', () => selectTab(name));
      tab.addEventListener('keydown', (event) => {
        const names = Object.keys(tabs), i = names.indexOf(name);
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        selectTab(event.key === 'Home' ? names[0] : event.key === 'End' ? names.at(-1) || name : names[(i + (event.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length], true);
      });
      tablist.append(tab);
      sections[name] = el('div', { id: `space-settings-${name}`, class: 'space-owner-section', role: 'tabpanel', 'aria-labelledby': tab.id, hidden: name !== active });
    }
    panel.append(el('div', { class: 'space-owner-head' }, el('h2', null, 'Customize your Space'), close), tablist, ...Object.values(sections), el('div', { class: 'space-owner-feedback' }, status, retry));

    /** Keep a save serialized, and retry a failed refresh without repeating a committed write.
     * @param {Record<string, unknown>} input @param {boolean} [refreshOnly]
     */
    async function save(input, refreshOnly = false) {
      if (busy) return false;
      busy = true; failed = undefined; retry.hidden = true;
      const focus = document.activeElement;
      controls.forEach((control) => { control.disabled = true; });
      panel.setAttribute('aria-busy', 'true'); panel.classList.remove('save-error');
      status.textContent = refreshOnly ? 'Updating preview…' : 'Saving…';
      let committed = refreshOnly;
      try {
        if (!refreshOnly) {
          await callTool('set_public_profile', input); committed = true;
        }
        const updated = (await callTool('open_space', {})).structuredContent.space;
        // Optional fields disappear when a setting is cleared; don't keep stale values.
        Object.keys(space).forEach((key) => Reflect.deleteProperty(space, key));
        Object.assign(space, updated);
        refresh(); sync(); status.textContent = 'Saved';
        return true;
      } catch (error) {
        if (!committed) { refresh(); sync(); }
        failed = { input, refreshOnly: committed };
        status.textContent = committed ? `Saved, but the preview couldn’t update. ${errorText(error)}` : `Couldn’t save. ${errorText(error)}`;
        panel.classList.add('save-error'); retry.hidden = false;
        return false;
      } finally {
        busy = false; controls.forEach((control) => { control.disabled = false; }); panel.removeAttribute('aria-busy');
        // Restore focus lost to disabling a control; don't pull it back from a new task.
        if (focus instanceof HTMLElement && focus.isConnected && panel.contains(focus) && document.activeElement === document.body && !panel.hidden) focus.focus({ preventScroll: true });
      }
    }
    retry.addEventListener('click', () => { if (failed) void save(failed.input, failed.refreshOnly); });

    /** @param {string} label @param {HTMLElement} control @param {string} [help] */
    function field(label, control, help) {
      return el('div', { class: 'space-owner-field' }, el('label', null, el('span', null, label), control), help ? el('p', { class: 'space-owner-help' }, help) : null);
    }
    const palette = el('div', { class: 'space-owner-palettes', role: 'group', 'aria-label': 'Color palette' });
    const paletteName = el('span', { class: 'space-owner-help' });
    /** @type {Array<{ name: string; button: HTMLButtonElement }>} */
    const inks = [];
    for (const set of spaceInks.sets) {
      const button = el('button', { class: 'space-owner-palette', type: 'button', 'aria-label': `${set.name.replace(/-/g, ' ')} palette`, title: set.name.replace(/-/g, ' '), style: `--palette:${set.colors[1]}` }, el('span', { class: 'space-owner-check' }, icon('check')));
      controls.push(button); inks.push({ name: set.name, button }); palette.append(button);
      button.addEventListener('click', () => void save({ ink: set.name }));
    }
    const formats = el('div', { class: 'space-owner-formats', role: 'group', 'aria-label': 'Page layout' });
    /** @type {Array<{ name: string; button: HTMLButtonElement }>} */
    const formatButtons = [];
    for (const name of spaceInks.formats) {
      const button = el('button', { class: 'btn space-owner-format', type: 'button', 'data-space-format-choice': name }, icon('check'), name[0].toUpperCase() + name.slice(1));
      controls.push(button); formatButtons.push({ name, button }); formats.append(button);
      button.addEventListener('click', () => void save({ format: name }));
    }
    const motif = el('select', { 'aria-label': 'Cover artwork' }, spaceInks.motifs.map((name) => el('option', { value: name }, name[0].toUpperCase() + name.slice(1))));
    controls.push(motif); motif.addEventListener('change', () => void save({ motif: motif.value }));
    const reroll = el('button', { class: 'btn', type: 'button', onclick: () => void save({ reroll: true }) }, icon('refresh'), ' Shuffle composition');
    controls.push(reroll);
    sections.appearance.append(el('div', { class: 'space-owner-field' }, el('strong', null, 'Color palette'), palette, paletteName),
      el('div', { class: 'space-owner-field' }, el('strong', null, 'Page layout'), formats), field('Cover artwork', motif), reroll,
      el('p', { class: 'space-owner-help' }, 'Appearance changes save automatically. Your posts stay in place.'));

    const title = el('input', { type: 'text', 'aria-label': 'Space title', maxlength: '60', value: space.spaceTitle || '', placeholder: `@${space.handle}` });
    const topics = el('input', { type: 'text', 'aria-label': 'Transmitting on topics', value: space.frequency?.join(', ') || '', placeholder: 'Up to four topics, separated by commas' });
    const travelers = el('input', { type: 'text', 'aria-label': 'Fellow travelers', value: (space.travelers || []).map((person) => person.handle).join(', '), placeholder: 'Up to six handles, separated by commas' });
    const words = el('button', { class: 'btn primary', type: 'button' }, 'Save profile');
    controls.push(words);
    words.addEventListener('click', () => void save({ spaceTitle: title.value, frequency: topics.value.split(',').map((s) => s.trim()).filter(Boolean), travelers: travelers.value.split(',').map((s) => s.trim()).filter(Boolean) }));
    /** @type {Array<{ name: string; box: HTMLInputElement }>} */
    const stampBoxes = [];
    const stamps = el('details', { class: 'space-owner-stamps' }, el('summary', null, 'Visible stamps'));
    for (const name of spaceInks.stamps) {
      const box = el('input', { type: 'checkbox' }); controls.push(box); stampBoxes.push({ name, box });
      box.addEventListener('change', () => {
        /** @type {Set<string>} */
        const hidden = new Set(space.hiddenStamps || []); box.checked ? hidden.delete(name) : hidden.add(name);
        void save({ hiddenStamps: [...hidden] });
      });
      stamps.append(el('label', null, box, name));
    }
    sections.content.append(field('Space title', title, 'Leave blank to use your handle.'), field('Topics', topics), field('Fellow travelers', travelers), words, stamps);

    const publicBox = el('input', { type: 'checkbox', 'aria-label': 'Public Space' });
    const listed = el('input', { type: 'checkbox', 'aria-label': 'Include me in discovery' });
    controls.push(publicBox, listed);
    publicBox.addEventListener('change', () => void save({ public: publicBox.checked }));
    listed.addEventListener('change', () => void save({ listed: listed.checked }));
    sections.visibility.append(
      el('div', { class: 'space-owner-setting' }, el('label', null, publicBox, 'Public Space'), el('p', { class: 'space-owner-help' }, 'Anyone with your link can read your public posts. Followers-only posts stay with your followers.')),
      el('div', { class: 'space-owner-setting' }, el('label', null, listed, 'Include me in discovery'), el('p', { class: 'space-owner-help' }, 'Let MCPortal suggest you to readers with similar interests. Your Space can be public without appearing in discovery.')),
      el('p', { class: 'space-owner-help' }, 'Visibility changes save automatically. Copies, screenshots and feed caches made while public cannot be recalled.'));

    function sync() {
      inks.forEach(({ name, button }) => button.setAttribute('aria-pressed', String(name === (space.cover?.ink || 'atomic'))));
      paletteName.textContent = (space.cover?.ink || 'atomic').replace(/-/g, ' ');
      formatButtons.forEach(({ name, button }) => button.setAttribute('aria-pressed', String(name === (space.format || 'paperback'))));
      motif.value = space.cover?.motif || 'arches'; publicBox.checked = !space.private; listed.checked = Boolean(space.listed);
      stampBoxes.forEach(({ name, box }) => { box.checked = !space.hiddenStamps?.some((stamp) => stamp === name); });
    }
    sync();
    return { bar, layout, panel, save };
  }
