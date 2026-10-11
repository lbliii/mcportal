  /** A passive status/tag pill. Never add click handlers or tabindex.
   * @param {{label:string, tone?:UIBadgeTone, className?:string}} options */
  function uiBadge(options) {
    const tone=uiVariant(options.tone || 'neutral',UI_COMPONENTS.badge.variants,'badge tone');
    return el('span',{class:`ui-badge ${options.className || ''}`,'data-ui':'badge','data-variant':tone},uiName(options.label));
  }
  /** A selectable pill; its label stays constant and its checkmark reserves space.
   * @param {{label:string, selected?:boolean, disabled?:boolean, className?:string, onChange?:(selected:boolean)=>void}} options */
  function uiChip(options) {
    let selected=Boolean(options.selected);
    const button=uiButton({label:options.label,size:'compact',emphasis:'quiet',className:`ui-chip ${options.className || ''}`,pressed:selected,disabled:options.disabled,
      onClick:()=>{setSelected(button.getAttribute('aria-pressed')!=='true');options.onChange?.(selected);}});
    button.dataset.ui='chip'; button.setAttribute('aria-label',options.label);
    /** @param {boolean} value */
    function setSelected(value) { selected=value;button.setAttribute('aria-pressed',String(value)); }
    return {element:button,setSelected};
  }
