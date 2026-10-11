  let uiTabsSerial = 0;
  /** Local content tabs. Arrows move focus; Enter/Space activate without fetching on focus.
   * overviewAbove presents every panel side by side when the component has enough space.
   * @param {{label:string, id?:string, className?:string, panelClassName?:string, overviewAbove?:number, items:Array<{label:string,panel:HTMLElement,disabled?:boolean}>}} options
   */
  function uiTabs(options) {
    if (!options.items.length || options.items.every(item=>item.disabled)) throw new Error('Tabs need an enabled panel');
    const id = options.id || `ui-tabs-${++uiTabsSerial}`;
    const events = new AbortController();
    let selected = options.items.findIndex(item=>!item.disabled), overview = false;
    const tabs = options.items.map((item, index)=>el('button', {type:'button', role:'tab', id:`${id}Tab${index}`, disabled:item.disabled,
      onclick:()=>select(index)}, uiName(item.label)));
    const list = el('div', {class:'ui-tablist', role:'tablist', 'aria-label':uiName(options.label)}, tabs);
    const panels = el('div', {class:`ui-tabpanels ${options.panelClassName || ''}`}, options.items.map(item=>item.panel));
    const element = el('div', {class:`ui-tabs ${options.className || ''}`, 'data-ui':'tabs'}, list, panels);
    options.items.forEach((item,index)=>{
      item.panel.id ||= `${id}Panel${index}`;
      tabs[index].setAttribute('aria-controls',item.panel.id);
    });
    function render() {
      list.hidden = overview;
      element.dataset.overview = String(overview);
      options.items.forEach((item,index)=>{
        tabs[index].tabIndex = index === selected ? 0 : -1;
        tabs[index].setAttribute('aria-selected',String(index === selected));
        item.panel.hidden = !overview && index !== selected;
        item.panel.classList.toggle('ui-tab-active',index === selected);
        item.panel.setAttribute('role',overview ? 'region' : 'tabpanel');
        item.panel.tabIndex = 0;
        if (overview) { item.panel.removeAttribute('aria-labelledby'); item.panel.setAttribute('aria-label',item.label); }
        else { item.panel.setAttribute('aria-labelledby',tabs[index].id); item.panel.removeAttribute('aria-label'); }
      });
    }
    /** @param {number} index */
    function select(index) {
      if (!options.items[index] || options.items[index].disabled) return;
      selected=index; render();
    }
    list.addEventListener('keydown',event=>{
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const enabled=tabs.filter(tab=>!tab.disabled), index=enabled.findIndex(tab=>tab===document.activeElement);
      const direction=(event.key==='ArrowRight'?1:-1)*(getComputedStyle(list).direction==='rtl'?-1:1);
      const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(index+direction+enabled.length)%enabled.length;
      tabs.forEach(tab=>{tab.tabIndex=tab===enabled[next]?0:-1;});
      enabled[next].focus({preventScroll:true}); enabled[next].scrollIntoView({block:'nearest',inline:'nearest'});
    },{signal:events.signal});
    list.addEventListener('focusout',event=>{if (!(event.relatedTarget instanceof Node) || !list.contains(event.relatedTarget)) tabs.forEach((tab,index)=>{tab.tabIndex=index===selected?0:-1;});},{signal:events.signal});
    render();
    const observer = options.overviewAbove === undefined ? null : new ResizeObserver(entries=>{
      const width=entries[0]?.contentRect.width || 0;
      if (!width) return; // Temporarily hidden readers retain their selected source.
      const next=width > (options.overviewAbove || 0);
      if (next === overview) return;
      const focus=document.activeElement;
      // Keep a focused source visible when the viewport narrows.
      if (!next) { const index=options.items.findIndex(item=>item.panel.contains(focus)); if(index>=0 && !options.items[index].disabled) selected=index; }
      overview=next; render();
      if (next && list.contains(focus)) options.items[selected].panel.focus({preventScroll:true});
    });
    observer?.observe(element);
    return {element, list, panels, select, destroy:()=>{events.abort();observer?.disconnect();}};
  }
