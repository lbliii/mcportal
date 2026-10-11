  /** @param {string} label */
  function uiName(label) {
    if (!label.trim()) throw new Error('Controls need an accessible name');
    return label;
  }
  /** @param {string} value @param {readonly string[]} allowed @param {string} kind */
  function uiVariant(value, allowed, kind) {
    if (!allowed.includes(value)) throw new Error(`Unsupported ${kind}: ${value}`);
    return value;
  }
  /**
   * @typedef {{label:string, emphasis?:UIButtonVariant, size?:UIButtonSize, type?:'button'|'submit'|'reset', icon?:string, disabled?:boolean, busy?:boolean, pressed?:boolean, id?:string, className?:string, onClick?:(event:MouseEvent)=>void}} UIButtonOptions
   * @param {UIButtonOptions} options
   */
  function uiButton(options) {
    const emphasis = uiVariant(options.emphasis || 'neutral', UI_COMPONENTS.button.variants, 'button emphasis');
    const size = uiVariant(options.size || 'default', UI_COMPONENTS.button.sizes, 'button size');
    return el('button', { type:options.type || 'button', class:['btn', emphasis === 'neutral' ? '' : emphasis, size === 'compact' ? 'sm' : '', options.className || ''].filter(Boolean).join(' '),
      'data-ui':'button', 'data-variant':emphasis, 'data-size':size, id:options.id,
      disabled:options.disabled || options.busy, 'aria-busy':options.busy ? 'true' : undefined,
      'data-was-disabled':options.busy ? String(Boolean(options.disabled)) : undefined,
      'aria-pressed':options.pressed === undefined ? undefined : String(options.pressed), onclick:options.onClick },
    options.icon ? icon(options.icon) : null, uiName(options.label));
  }
  /** @typedef {{size?:UIIconButtonSize, className?:string, pressed?:boolean, disabled?:boolean}} UIIconOptions */
  /** @param {string} name @param {string} label @param {(event:MouseEvent)=>void} onClick @param {UIIconOptions} [options] */
  function iconButton(name, label, onClick, options = {}) {
    const size = uiVariant(options.size || 'compact', UI_COMPONENTS.iconButton.sizes, 'icon size');
    return el('button', { type:'button', class:`ib${size === 'compact' ? ' sm' : ''}${options.className ? ' ' + options.className : ''}`, 'data-ui':'iconButton', 'data-size':size,
      'data-tooltip':'', 'aria-label':uiName(label), disabled:options.disabled,
      'aria-pressed':options.pressed === undefined ? undefined : String(options.pressed), onclick:onClick }, icon(name));
  }
  /** Busy state prevents repeated submission without changing the action's label/geometry. @param {HTMLButtonElement} button @param {boolean} busy */
  function uiBusy(button, busy) {
    if (busy && button.getAttribute('aria-busy') !== 'true') { button.dataset.wasDisabled = String(button.disabled); button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    else if (!busy && button.getAttribute('aria-busy') === 'true') { button.disabled = button.dataset.wasDisabled === 'true'; button.removeAttribute('aria-busy'); delete button.dataset.wasDisabled; }
  }
