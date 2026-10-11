  /** Native details: Enter/Space toggle, no redundant ARIA or focus trap.
   * A shared name creates an exclusive accordion; omit it for independent sections.
   * @param {{label:string, open?:boolean, name?:string, className?:string, meta?:string}} options
   * @param {...(Child|Child[])} children
   */
  function uiDisclosure(options, ...children) {
    return el('details', {class:`ui-disclosure ${options.className || ''}`, 'data-ui':'disclosure', open:options.open, name:options.name},
      el('summary', null, el('span',{class:'ui-disclosure-marker','aria-hidden':'true'}), el('span', null, uiName(options.label)), options.meta ? el('span',{class:'ui-disclosure-meta'},options.meta) : null), ...children);
  }
