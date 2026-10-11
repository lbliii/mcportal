  /** Named native progress; omit value for indeterminate work. Never invent a percentage.
   * @param {{label:string, value?:number, max?:number, message?:string}} options
   */
  function uiProgress(options) {
    const max=options.max ?? 1;
    if (!Number.isFinite(max) || max<=0 || (options.value!==undefined && !Number.isFinite(options.value))) throw new Error('Invalid progress value');
    const progress=el('progress',{max,'aria-label':uiName(options.label)});
    if (options.value!==undefined) progress.value=Math.max(0,Math.min(max,options.value));
    const element=el('div',{class:'ui-progress','data-ui':'progress','data-variant':options.value===undefined?'indeterminate':'determinate'},progress,
      options.message ? el('span',null,options.message) : null);
    return element;
  }
  /** @param {{lines?:number}} [options] */
  function uiSkeleton(options={}) {
    return el('div',{class:'ui-skeleton','data-ui':'skeleton','aria-hidden':'true'},Array.from({length:options.lines ?? 3},()=>el('div')));
  }
  /** A bounded visible stack with a FIFO queue. Errors persist; transient messages pause
   * while hovered, focused or the document is hidden. Never move focus on arrival.
   * @param {HTMLElement} region
   */
  function uiToasts(region) {
    region.classList.add('ui-toasts'); region.dataset.ui='toasts'; region.removeAttribute('role');
    region.setAttribute('aria-label','Notifications');
    /** @typedef {{message:string,kind:UIToastKind}} Notice */
    /** @type {Notice[]} */ const queue=[];
    /** @type {Map<HTMLElement,{notice:Notice,pause:()=>void,resume:()=>void}>} */ const active=new Map();
    const events=new AbortController();
    const home=region.parentNode;
    function mount() { const modal=document.querySelector('dialog:modal'); (modal || home)?.appendChild(region); }
    function drain() {
      mount();
      while (active.size<3 && queue.length) {
        const notice=queue.shift(); if(!notice) break;
        const message=el('p',{role:notice.kind==='error'?'alert':'status','aria-atomic':'true'});
        const item=el('div',{class:'ui-toast','data-variant':notice.kind},message);
        const previous=document.activeElement;
        const dismiss=iconButton('close','Dismiss notification',()=>remove());
        item.append(dismiss); region.append(item);
        const style=getComputedStyle(region),minimum=parseFloat(style.getPropertyValue('--mp-toast-duration')),maximum=parseFloat(style.getPropertyValue('--mp-toast-max-duration'));
        let remaining=notice.kind==='error'?0:Math.max(minimum,Math.min(maximum,notice.message.length*65)), started=0;
        /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
        function pause() { if(timer!==undefined) {clearTimeout(timer);timer=undefined;remaining=Math.max(1,remaining-(Date.now()-started));} }
        function resume() { if(!remaining || timer!==undefined || document.hidden || item.matches(':hover') || item.contains(document.activeElement)) return; started=Date.now();timer=setTimeout(remove,remaining); }
        function remove() {
          const focused=item.contains(document.activeElement); pause(); active.delete(item); item.remove();
          if(focused) { const next=region.querySelector('button'); if(next instanceof HTMLElement) next.focus({preventScroll:true}); else if(previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) previous.focus({preventScroll:true}); }
          drain();
        }
        item.addEventListener('pointerenter',pause);item.addEventListener('pointerleave',resume);
        item.addEventListener('focusin',pause);item.addEventListener('focusout',()=>queueMicrotask(resume));
        active.set(item,{notice,pause,resume});
        // Populate an already-mounted live region, including identical messages after dismissal.
        requestAnimationFrame(()=>{if(item.isConnected) message.textContent=notice.message;});
        resume();
      }
    }
    document.addEventListener('visibilitychange',()=>{for(const entry of active.values()) document.hidden?entry.pause():entry.resume();},{signal:events.signal});
    document.addEventListener('close',mount,{capture:true,signal:events.signal});
    /** @param {string} message @param {UIToastKind} [kind] */
    function show(message,kind='info') {
      uiName(message);uiVariant(kind,UI_COMPONENTS.toast.variants,'toast kind');
      if ([...queue,...[...active.values()].map(entry=>entry.notice)].some(n=>n.kind===kind && n.message===message)) return;
      queue.push({message,kind});drain();
    }
    return {show,destroy:()=>{events.abort();queue.length=0;for(const entry of active.values())entry.pause();active.clear();region.replaceChildren();}};
  }
