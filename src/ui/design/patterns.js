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
      options.title ? el('h3', null, options.title) : null, kind === 'loading' ? uiProgress({label:options.message, message:options.message}) : el('p', null, options.message), options.action || null);
  }
  /** A contextual action tray in document flow. Product code owns visibility and dismissal.
   * @param {{label:string, hidden?:boolean, className?:string}} options @param {...(Child|Child[])} children */
  function uiTray(options, ...children) {
    const tray=uiToolbar(options,...children);
    tray.classList.add('ui-tray'); tray.dataset.ui='tray'; tray.hidden=Boolean(options.hidden);
    return tray;
  }
  /** A destination in application navigation; prose links retain their underline.
   * @param {{label:string, href:string, current?:boolean, className?:string, onClick?:(event:MouseEvent)=>void}} options */
  function uiNavLink(options) {
    return el('a',{class:`ui-nav-link ${options.className || ''}`,href:options.href,'data-ui':'navigationLink',
      'aria-current':options.current?'page':undefined,onclick:options.onClick},uiName(options.label));
  }
  /** @typedef {{label:string,onClick:()=>void}} UIPageAction */
  /** Document paging keeps direction and the destination visible. Absent ends are omitted.
   * @param {{previous?:UIPageAction, next?:UIPageAction, className?:string}} options */
  function uiPager(options) {
    /** @param {'previous'|'next'} direction @param {UIPageAction | undefined} action */
    function action(direction, action) {
      if (!action) return null;
      const button=uiButton({label:action.label,emphasis:'quiet',onClick:action.onClick,className:direction==='previous'?'prev':'next'});
      button.prepend(el('small',null,direction==='previous'?'Previous':'Next'));
      return button;
    }
    return el('nav',{class:`ui-pager ${options.className || ''}`,'data-ui':'pager','aria-label':'Document pages'},action('previous',options.previous),action('next',options.next));
  }
