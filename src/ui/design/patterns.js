  /** @param {{label:string, className?:string}} options @param {...(Child|Child[])} children */
  function uiToolbar(options, ...children) {
    return el('div', {class:`ui-toolbar ${options.className || ''}`, role:'group', 'aria-label':uiName(options.label), 'data-ui':'toolbar'}, ...children);
  }
  /** @template {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} T
   * @param {T} control @param {{label:string, hint?:string, id?:string}} options */
  function uiSettingsRow(control, options) { return uiField(control, {...options, compact:true}); }
  /** @param {{className?:string}} options @param {...(Child|Child[])} children */
  function uiMetadata(options, ...children) {
    return el('div', {class:`ui-metadata ${options.className || ''}`, 'data-ui':'metadata'}, ...children);
  }
  /** @param {{label:string, icon:string, count?:string|number, pressed?:boolean, onClick:(event:MouseEvent)=>void}} options */
  function uiMetadataAction(options) {
    return el('button', {type:'button', class:'mi', 'data-ui':'metadataAction', 'data-tooltip':'', 'aria-label':uiName(options.label),
      'aria-pressed':options.pressed === undefined ? undefined : String(options.pressed), onclick:options.onClick}, icon(options.icon), options.count ?? null);
  }
  /** @param {{title:string, heading?:'h2'|'h3', description?:string, meta?:Child|Child[], actions?:Child[], children?:Child[], className?:string}} options */
  function uiCard(options) {
    return el('article', {class:`ui-card ${options.className || ''}`, 'data-ui':'card'},
      el(options.heading || 'h2', null, options.title), options.description ? el('p', null, options.description) : null,
      options.meta ? uiMetadata({}, options.meta) : null, ...(options.children || []),
      options.actions?.length ? uiToolbar({label:`${options.title} actions`}, options.actions) : null);
  }
  /** @param {{kind:UIFeedbackKind, message:string, title?:string, action?:HTMLButtonElement}} options */
  function uiFeedback(options) {
    const kind = uiVariant(options.kind, UI_COMPONENTS.feedback.variants, 'feedback kind');
    return el('div', {class:`ui-feedback ui-feedback-${kind}`, 'data-ui':'feedback', 'data-variant':kind,
      role:kind === 'error' ? 'alert' : kind === 'loading' || kind === 'success' ? 'status' : undefined},
      options.title ? el('h3', null, options.title) : null, el('p', null, options.message), options.action || null);
  }
