  let uiFieldSequence = 0;
  /**
   * @template {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} T
   * @param {T} control
   * @param {{label:string, hint?:string, id?:string, compact?:boolean, hiddenLabel?:boolean}} options
   */
  function uiField(control, options) {
    control.id ||= `ui-field-${++uiFieldSequence}`;
    control.classList.add('field'); control.dataset.ui = 'field';
    const label = el('label', { for:control.id, class:options.hiddenLabel ? 'ui-sr-only' : 'ui-field-label' }, uiName(options.label));
    const hint = el('p', { id:`${control.id}-hint`, class:'ui-field-hint', hidden:!options.hint }, options.hint || '');
    const error = el('p', { id:`${control.id}-error`, class:'ui-field-error', role:'alert', hidden:true });
    const described = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const element = el('div', { class:`ui-field${options.compact ? ' ui-setting' : ''}`, id:options.id, 'data-ui':options.compact ? 'settingsRow' : 'fieldGroup' }, label, control, hint, error);
    /** Preserve consumer descriptions when hints/errors change. @param {string} [message] */
    function setError(message = '') {
      error.textContent = message; error.hidden = !message;
      if (message) control.setAttribute('aria-invalid','true'); else control.removeAttribute('aria-invalid');
      const ids = [...described, ...(options.hint ? [hint.id] : []), ...(message ? [error.id] : [])];
      if (ids.length) control.setAttribute('aria-describedby',ids.join(' ')); else control.removeAttribute('aria-describedby');
    }
    setError();
    return { element, control, label, hint, error, setError };
  }
  /** @param {{label:string, checked?:boolean, id?:string, hint?:string, onChange?:(checked:boolean)=>void}} options */
  function uiToggle(options) {
    const control = el('input', { type:'checkbox', id:options.id }); control.checked = Boolean(options.checked);
    control.dataset.ui = 'toggle';
    const field = uiField(control, { label:options.label, ...(options.hint ? {hint:options.hint} : {}), compact:true });
    control.dataset.ui = 'toggle'; field.element.classList.add('ui-toggle');
    control.addEventListener('change', () => options.onChange?.(control.checked));
    return field;
  }
