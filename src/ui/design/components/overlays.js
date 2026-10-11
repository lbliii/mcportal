  /** Bind a native modal. The caller owns content and persistence; this owns focus and dismissal.
   * @param {HTMLDialogElement} panel
   * @param {{trigger:HTMLButtonElement, closeButton:HTMLButtonElement, variant?:UIDialogVariant, onOpen?:()=>void, onClose?:()=>void}} options
   */
  function uiDialog(panel, options) {
    if (!panel.getAttribute('aria-label') && !panel.getAttribute('aria-labelledby')) throw new Error('Dialog needs a name');
    panel.dataset.variant=uiVariant(options.variant || 'modal',UI_COMPONENTS.dialog.variants,'dialog variant');
    const events = new AbortController();
    /** @type {HTMLElement | null} */ let opener = null;
    panel.classList.add('ui-dialog'); panel.dataset.ui = 'dialog'; options.trigger.setAttribute('aria-haspopup','dialog');
    options.trigger.setAttribute('aria-controls',panel.id); options.trigger.setAttribute('aria-expanded','false');
    function open() {
      if (panel.open) return;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : options.trigger;
      options.onOpen?.(); panel.showModal(); options.trigger.setAttribute('aria-expanded','true');
      options.closeButton.focus({preventScroll:true});
    }
    function close() { if (panel.open) panel.close(); }
    options.trigger.addEventListener('click',open,{signal:events.signal});
    options.closeButton.addEventListener('click',close,{signal:events.signal});
    panel.addEventListener('keydown',event=>{
      if (event.key !== 'Tab') return;
      const focusable=[...panel.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(
        /** @returns {node is HTMLElement} */ node=>node instanceof HTMLElement && node.tabIndex>=0 && !node.matches(':disabled') && !node.closest('[hidden],[inert]') && Boolean(node.getClientRects().length));
      const first=focusable[0], last=focusable.at(-1);
      if (event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
      else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
    },{signal:events.signal});
    function restore() {
      options.trigger.setAttribute('aria-expanded','false'); options.onClose?.();
      if (opener?.isConnected && opener.getClientRects().length) opener.focus({preventScroll:true});
    }
    panel.addEventListener('close',restore,{signal:events.signal});
    return {open,close,destroy:()=>{const wasOpen=panel.open; events.abort(); close(); if (wasOpen) restore();}};
  }
  /** Native popover menu with arrow navigation and focus return; usable by pointer and touch.
   * @param {HTMLElement} panel @param {HTMLButtonElement} trigger
   */
  function uiMenu(panel, trigger) {
    if (!panel.getAttribute('aria-label') && !panel.getAttribute('aria-labelledby')) throw new Error('Menu needs a name');
    const events = new AbortController();
    let lastOnOpen = false;
    panel.classList.add('ui-menu'); panel.dataset.ui = 'menu'; panel.setAttribute('role','menu'); panel.setAttribute('popover','auto');
    trigger.setAttribute('aria-haspopup','menu'); trigger.setAttribute('aria-controls',panel.id);
    trigger.setAttribute('popovertarget',panel.id); trigger.setAttribute('aria-expanded','false');
    const items = () => [...panel.querySelectorAll('button')].filter(button => !button.disabled && !button.closest('[hidden]'));
    function close() { if (panel.matches(':popover-open')) panel.hidePopover(); }
    panel.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      for (const button of panel.querySelectorAll('button')) { button.setAttribute('role','menuitem'); button.tabIndex=-1; }
      const anchor = trigger.getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mp-tooltip-inset'));
      const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mp-tooltip-offset'));
      panel.style.left = `${Math.max(inset, Math.min(anchor.left, innerWidth - panel.offsetWidth - inset))}px`;
      panel.style.top = `${anchor.bottom + gap}px`;
    }, {signal:events.signal});
    panel.addEventListener('toggle',()=>{
      const open = panel.matches(':popover-open'); trigger.setAttribute('aria-expanded',String(open));
      if (open) {
        const box = panel.getBoundingClientRect();
        const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mp-tooltip-inset'));
        panel.style.left = `${Math.max(inset,Math.min(box.left,innerWidth-box.width-inset))}px`;
        panel.style.top = `${Math.max(inset,Math.min(box.top,innerHeight-box.height-inset))}px`;
        items().at(lastOnOpen ? -1 : 0)?.focus({preventScroll:true});
      } else if (panel.contains(document.activeElement)) trigger.focus({preventScroll:true});
    }, {signal:events.signal});
    trigger.addEventListener('keydown',event=>{
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); lastOnOpen = event.key === 'ArrowUp'; if (!panel.matches(':popover-open')) panel.showPopover(); else items()[0]?.focus(); }
    },{signal:events.signal});
    panel.addEventListener('keydown',event=>{
      const choices=items(), index=choices.findIndex(button=>button === document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.focus({preventScroll:true}); }
      else if (event.key === 'Tab') close();
      else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
        choices[next]?.focus();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const ordered=[...choices.slice(index+1),...choices.slice(0,index+1)];
        ordered.find(button=>button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
      }
    },{signal:events.signal});
    panel.addEventListener('click',event=>{if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) close();},{signal:events.signal});
    // Native popovers dismiss on outside clicks. Closing on focusout races native
    // focus transitions and scrolling; Tab and Escape are handled explicitly above.
    return {close,destroy:()=>{close();events.abort();}};
  }
  let uiPopoverSequence=0;
  /** Rich, nonmodal content uses ordinary Tab and native radio/input keys, never menu roles.
   * @param {HTMLElement} panel @param {HTMLElement} trigger
   * @param {{bindTrigger?:boolean, initialFocus?:HTMLElement, onClose?:()=>void}} [options]
   */
  function uiPopover(panel,trigger,options={}) {
    if(!panel.getAttribute('aria-label') && !panel.getAttribute('aria-labelledby')) throw new Error('Popover needs a name');
    panel.id ||= `ui-popover-${++uiPopoverSequence}`;
    panel.classList.add('ui-popover');panel.dataset.ui='popover';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.tabIndex=-1;
    trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');trigger.setAttribute('popovertarget',panel.id);
    const events=new AbortController();let frame=0,disposed=false;
    function position() {
      if(!panel.matches(':popover-open')) return;
      if(!trigger.isConnected || !trigger.getClientRects().length) {close(false);return;}
      const anchor=trigger.getBoundingClientRect(),box=panel.getBoundingClientRect(),style=getComputedStyle(document.documentElement);
      const inset=parseFloat(style.getPropertyValue('--mp-panel-padding')),gap=parseFloat(style.getPropertyValue('--mp-tooltip-offset'));
      const width=document.documentElement.clientWidth,height=innerHeight;
      panel.style.left=`${Math.max(inset,Math.min(anchor.left,width-box.width-inset))}px`;
      const below=anchor.bottom+gap, above=anchor.top-box.height-gap;
      panel.style.top=`${Math.max(inset,Math.min(below+box.height<=height-inset?below:above,height-box.height-inset))}px`;
    }
    function schedule() {cancelAnimationFrame(frame);frame=requestAnimationFrame(position);}
    const resize=new ResizeObserver(schedule);resize.observe(panel);resize.observe(trigger);
    function open() {
      if(disposed || panel.matches(':popover-open')) return;
      panel.showPopover();trigger.setAttribute('aria-expanded','true');position();
      const first=options.initialFocus || panel.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)');
      (first instanceof HTMLElement ? first : panel).focus({preventScroll:true});
    }
    function close(restore=true) {
      if(!panel.matches(':popover-open')) return;
      if(restore && trigger.isConnected)trigger.focus({preventScroll:true});
      panel.hidePopover();trigger.setAttribute('aria-expanded','false');
    }
    if(options.bindTrigger!==false) trigger.addEventListener('click',event=>{event.preventDefault();panel.matches(':popover-open')?close():open();},{signal:events.signal});
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}},{signal:events.signal});
    panel.addEventListener('toggle',()=>{
      const isOpen=panel.matches(':popover-open');trigger.setAttribute('aria-expanded',String(isOpen));
      if(!isOpen && !disposed) options.onClose?.();
    },{signal:events.signal});
    document.addEventListener('focusin',event=>{if(event.target instanceof Node && !panel.contains(event.target) && event.target!==trigger)close(false);},{signal:events.signal});
    window.addEventListener('resize',schedule,{signal:events.signal});document.addEventListener('scroll',schedule,{capture:true,signal:events.signal});
    return {open,close,destroy:()=>{disposed=true;close(false);events.abort();resize.disconnect();cancelAnimationFrame(frame);trigger.removeAttribute('popovertarget');trigger.removeAttribute('aria-controls');}};
  }
