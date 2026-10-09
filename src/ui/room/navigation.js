  // Navigation owns request lifetimes and return positions. Views own their DOM and data.
  // Retiring a view flushes reading writes before removing content, and cancels selection UI.
  const navigation = (() => {
    let epoch = 0, owner = 'room', experienceName = '';
    /** @typedef {{x: number, y: number, focus: Element | null, positions: Array<{node: HTMLElement, left: number, top: number}>}} ReturnPosition */
    /** @type {ReturnPosition | null} */
    let room = null;
    /** @type {ReturnPosition | null} */
    let suspended = null;
    /** @param {HTMLElement[]} nodes @returns {ReturnPosition} */
    const capture = (nodes) => ({x: window.scrollX, y: window.scrollY, focus: document.activeElement,
      positions: nodes.map(node => ({node, left: node.scrollLeft, top: node.scrollTop}))});
    /** @param {ReturnPosition} position */
    const restore = (position) => {
      for (const {node, left, top} of position.positions) { node.scrollLeft = left; node.scrollTop = top; }
      if (position.focus instanceof HTMLElement || position.focus instanceof SVGElement) position.focus.focus({preventScroll: true});
      window.scrollTo(position.x, position.y);
    };
    /** @param {string} next */
    const begin = (next) => {
      if (stopReading) stopReading();
      hidePassageBar();
      document.getSelection()?.removeAllRanges();
      owner = next;
      return ++epoch;
    };
    return {
      begin,
      token: () => epoch,
      /** @param {number} token */
      owns: (token) => token === epoch,
      /** @param {string} name */
      is: (name) => owner === name,
      get experience() { return experienceName; },
      get hasReturn() { return suspended !== null; },
      rememberRoom() { if (!$('grid').hidden && !room) room = capture([$('grid'), ...$$('.items, .shelf-row', $('grid'))]); },
      restoreRoom() { if (room) { const previous = room; room = null; restore(previous); } },
      /** @param {string} name */
      enterExperience(name) { this.rememberRoom(); begin(`experience:${name}`); experienceName = name; suspended = null; },
      leaveExperience() { experienceName = ''; suspended = null; },
      suspendExperience() { if (experienceName) suspended = capture([$('experiences')]); },
      takeExperienceReturn() { const previous = suspended; suspended = null; return previous; },
      restorePosition: restore,
      teardown() { begin('closed'); experienceName = ''; suspended = null; room = null; },
    };
  })();
  function rememberRoomNavigation() { navigation.rememberRoom(); }
