  let uiFieldSequence = 0;
  /** Native controls share one visual contract; the caller supplies a label or uiField.
   * @template {'input'|'select'|'textarea'} T
   * @param {T} tag @param {Record<string, any> | null} [attrs] @param {...(Child|Child[])} children
   */
  function uiControl(tag, attrs, ...children) {
    const control = el(tag, attrs, ...children);
    control.classList.add('field'); control.dataset.ui = 'field';
    return control;
  }
  /** @type {WeakMap<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement, {setError:(message?:string)=>void}>} */
  const uiFields = new WeakMap();
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
    uiFields.set(control,{setError});
    control.addEventListener('input',()=>setError());
    control.addEventListener('change',()=>setError());
    setError();
    return { element, control, label, hint, error, setError };
  }
  /** Bind native validation and async submission. Server errors stay beside the form.
   * @param {HTMLFormElement} form
   * @param {{submit:HTMLButtonElement, onSubmit:()=>Promise<unknown>|void, pendingMessage?:string, validate?:()=>boolean}} options
   */
  function uiForm(form, options) {
    const events = new AbortController();
    const error = el('p',{class:'ui-form-error',role:'alert',hidden:true});
    const pending=el('div',{class:'ui-form-pending',role:'status',hidden:true});
    form.dataset.ui='form'; form.append(pending,error);
    let busy=false;
    /** @param {string} [message] */
    function setError(message='') { error.textContent=message; error.hidden=!message; }
    form.addEventListener('invalid',event=>{
      const control=event.target;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
        uiFields.get(control)?.setError(control.validationMessage);
      }
    },{capture:true,signal:events.signal});
    async function run() {
      if (busy || options.submit.disabled || !form.reportValidity() || options.validate?.()===false) return;
      const focused=form.contains(document.activeElement) ? document.activeElement : null;
      const controls=[...form.querySelectorAll('input,select,textarea,button')].filter(
        /** @returns {node is HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement} */ node=>node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement || node instanceof HTMLButtonElement);
      const disabled=controls.map(control=>control.disabled);
      busy=true; uiBusy(options.submit,true); form.setAttribute('aria-busy','true'); setError();
      controls.forEach(control=>{control.disabled=true;});
      const message=options.pendingMessage || 'Saving…';
      pending.replaceChildren(uiProgress({label:message,message}));pending.hidden=false;
      try { await options.onSubmit(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      finally {
        busy=false;
        controls.forEach((control,index)=>{control.disabled=disabled[index];});
        pending.hidden=true;pending.replaceChildren();
        uiBusy(options.submit,false); form.removeAttribute('aria-busy');
        if(document.activeElement===document.body && focused instanceof HTMLElement && focused.isConnected && focused.getClientRects().length) focused.focus({preventScroll:true});
      }
    }
    form.addEventListener('submit',event=>{event.preventDefault();void run();},{signal:events.signal});
    return {run,setError,destroy:()=>events.abort()};
  }
  /** @param {{label:string, name?:string, value:string, choices:{value:string,label:string}[], onChange?:(value:string)=>void}} options */
  function uiChoiceGroup(options) {
    const name=options.name || `ui-choice-${++uiFieldSequence}`;
    const inputs=options.choices.map(choice=>uiControl('input',{type:'radio',name,value:choice.value,checked:choice.value===options.value}));
    const element=el('fieldset',{class:'ui-choice-group','data-ui':'choiceGroup'},el('legend',{class:'ui-sr-only'},uiName(options.label)),
      inputs.map((input,index)=>el('label',{class:'ui-choice'},input,options.choices[index].label)));
    for (const input of inputs) input.addEventListener('change',()=>{if(input.checked)options.onChange?.(input.value);});
    return {element,inputs};
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
