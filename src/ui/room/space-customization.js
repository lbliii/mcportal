  // Adapted from #94: keep the editor mounted, redraw only the preview, and never
  // repeat a committed mutation when a preview refresh fails.
  /** @param {Space} space @param {() => void} refresh
   * @param {(section:'sources'|'people',save:(input:Record<string,unknown>)=>Promise<boolean>)=>HTMLElement} sectionSettings */
  function spaceCustomization(space, refresh, sectionSettings) {
    const panel=el('section',{id:'spaceCustomization',class:'space-owner-panel','aria-label':'Customize Space',hidden:true});
    const toggle=uiButton({label:'Customize',icon:'settings',className:'space-customize-toggle'});
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',panel.id);
    const close=iconButton('close','Close customization',()=>setOpen(false));
    const status=el('div',{class:'space-owner-status',role:'status','aria-live':'polite'});
    const retry=uiButton({label:'Retry',className:'space-owner-retry',onClick:()=>{if(failed)void save(failed.input,failed.refreshOnly);}});retry.hidden=true;
    const bar=uiToolbar({label:'Space actions',className:'space-owner-bar'},
      space.link ? iconButton('external','Open public Space',()=>openLink(space.link || '')) : null,
      iconButton('copy','Copy Space link',()=>copySpaceLink(space.link || ''),{disabled:!space.link}),toggle);
    const preview=el('div',{class:'space-owner-preview'});
    const layout=uiSplitPane({className:'space-owner-layout',main:preview,aside:panel});
    const sections={appearance:el('div',{class:'space-owner-section'}),content:el('div',{class:'space-owner-section'}),visibility:el('div',{class:'space-owner-section'})};
    const tabs=uiTabs({id:'spaceSettings',label:'Customization',items:[{label:'Appearance',panel:sections.appearance},{label:'Content',panel:sections.content},{label:'Visibility',panel:sections.visibility}]});
    panel.append(uiToolbar({label:'Customization controls',className:'space-owner-head'},el('h2',null,'Customize'),close),tabs.element,status,retry);
    /** @param {boolean} open */
    function setOpen(open) {
      panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
      if(open){const active=tabs.list.querySelector('button[aria-selected=true]');if(active instanceof HTMLElement)active.focus();}else toggle.focus();
    }
    toggle.addEventListener('click',()=>setOpen(panel.hidden));
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);}});
    let busy=false;
    /** @type {{input:Record<string,unknown>,refreshOnly:boolean}|undefined} */
    let failed;
    /** @param {Record<string,unknown>} input @param {boolean} [refreshOnly] */
    async function save(input,refreshOnly=false) {
      if(busy || failed?.refreshOnly && !refreshOnly)return false;
      busy=true;failed=undefined;retry.hidden=true;panel.classList.remove('save-error');
      panel.querySelectorAll('[data-refresh-disabled]').forEach(n=>{if(n.getAttribute('data-refresh-disabled')==='false')n.removeAttribute('disabled');n.removeAttribute('data-refresh-disabled');});
      const focus=document.activeElement,top=panel.getBoundingClientRect().top;
      const controls=[...panel.querySelectorAll('button,input,select,textarea')].filter(
        /** @returns {n is HTMLButtonElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} */ n=>n instanceof HTMLButtonElement || n instanceof HTMLInputElement || n instanceof HTMLSelectElement || n instanceof HTMLTextAreaElement);
      const disabled=controls.map(n=>n.disabled);
      controls.forEach(n=>{if(n!==close)n.disabled=true;});panel.setAttribute('aria-busy','true');
      status.replaceChildren(uiProgress({label:refreshOnly?'Updating preview…':'Saving…',message:refreshOnly?'Updating preview…':'Saving…'}));
      let committed=refreshOnly;
      try {
        if(!refreshOnly){await callTool('set_public_profile',input);committed=true;}
        const updated=(await callTool('open_space',{})).structuredContent.space;
        Object.keys(space).forEach(key=>Reflect.deleteProperty(space,key));Object.assign(space,updated);
        refresh();sync(focus);status.textContent='Saved';return true;
      } catch(error) {
        sync(focus);failed={input,refreshOnly:committed};panel.classList.add('save-error');
        status.replaceChildren(uiFeedback({kind:'error',message:`${committed?'Saved, but the preview could not update.':'Could not save.'} ${errorText(error)}`}));
        retry.hidden=false;return false;
      } finally {
        busy=false;controls.forEach((n,i)=>{n.disabled=disabled[i];});panel.removeAttribute('aria-busy');
        // A committed write needs a successful refresh before another mutation.
        if(failed?.refreshOnly)panel.querySelectorAll('input[type=checkbox],select,[data-mutation],.space-section-settings button').forEach(n=>{n.setAttribute('data-refresh-disabled',String(n.hasAttribute('disabled')));n.setAttribute('disabled','');});
        retry.disabled=false;
        if(!panel.hidden && (document.activeElement===document.body || panel.contains(document.activeElement)))$('reader').scrollTop+=panel.getBoundingClientRect().top-top;
        if(document.activeElement===document.body && focus instanceof HTMLElement && focus.isConnected && !panel.hidden)focus.focus({preventScroll:true});
      }
    }
    /** @param {string} label @param {string[]} values @param {(value:string)=>Record<string,unknown>} patch */
    function choice(label,values,patch) {
      const control=uiControl('select',{'aria-label':label},values.map(value=>el('option',{value},value.replace(/-/g,' '))));
      control.addEventListener('change',()=>void save(patch(control.value)));
      sections.appearance.append(uiSettingsRow(control,{label}).element);return control;
    }
    const ink=choice('Palette',spaceInks.sets.map(s=>s.name),value=>({ink:value}));
    const format=choice('Format',spaceInks.formats,value=>({format:value}));
    const motif=choice('Cover',spaceInks.motifs,value=>({motif:value}));
    const shuffle=uiButton({label:'Shuffle cover',icon:'refresh',onClick:()=>void save({reroll:true})});shuffle.dataset.mutation='';
    sections.appearance.append(shuffle);
    const title=uiControl('input',{type:'text','aria-label':'Space title',maxlength:60,value:space.spaceTitle || '',placeholder:`@${space.handle}`});
    const topics=uiControl('input',{type:'text','aria-label':'Topics',value:space.frequency?.join(', ') || ''});
    const travelers=uiControl('input',{type:'text','aria-label':'Fellow travelers',value:(space.travelers || []).map(p=>p.handle).join(', ')});
    const submit=uiButton({label:'Save profile',type:'submit',emphasis:'primary'});submit.dataset.mutation='';
    const form=el('form',{class:'space-owner-section'},uiField(title,{label:'Space title'}).element,
      uiField(topics,{label:'Topics',hint:'Up to four, separated by commas.'}).element,
      uiField(travelers,{label:'Fellow travelers',hint:'Up to six handles, separated by commas.'}).element,submit);
    // This owner coordinator handles all mutations, including native form submission.
    form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())void save({spaceTitle:title.value,frequency:topics.value.split(',').map(s=>s.trim()).filter(Boolean),travelers:travelers.value.split(',').map(s=>s.trim()).filter(Boolean)});});
    sections.content.append(form);
    const stamps=uiDisclosure({label:'Visible stamps',className:'space-owner-stamps'});
    const stampBoxes=spaceInks.stamps.map(name=>{
      const toggle=uiToggle({label:name,onChange:checked=>{const hidden=new Set(space.hiddenStamps?.map(String) || []);checked?hidden.delete(name):hidden.add(name);void save({hiddenStamps:[...hidden]});}});
      stamps.append(toggle.element);return {name,control:toggle.control};
    });sections.content.append(stamps);
    const publicSetting=uiToggle({label:'Public Space',hint:'Anyone with the link can read public posts. Followers-only posts stay with your followers.',onChange:value=>void save({public:value})});
    const listed=uiToggle({label:'Include in discovery',hint:'Suggest your Space to readers with similar interests.',onChange:value=>void save({listed:value})});
    publicSetting.control.setAttribute('aria-label','Public Space');listed.control.setAttribute('aria-label','Include in discovery');
    const curation=el('div',{class:'space-owner-section'});
    sections.visibility.append(publicSetting.element,listed.element,curation,el('p',{class:'space-owner-help'},'Copies, screenshots and feed caches made while public cannot be recalled.'));
    /** @param {Element|null} [focused] */
    function sync(focused=document.activeElement) {
      ink.value=space.cover?.ink || 'atomic';format.value=space.format || 'paperback';motif.value=space.cover?.motif || 'arches';
      publicSetting.control.checked=!space.private;listed.control.checked=Boolean(space.listed);
      stampBoxes.forEach(({name,control})=>{control.checked=!space.hiddenStamps?.some(stamp=>stamp===name);});
      const open=[...curation.querySelectorAll('details')].map(n=>n.open);
      const label=curation.contains(focused) ? focused?.getAttribute('aria-label') : null;
      curation.replaceChildren(sectionSettings('sources',save),sectionSettings('people',save));
      curation.querySelectorAll('details').forEach((n,i)=>{n.open=Boolean(open[i]);});
      if(label && document.activeElement===document.body){
        const alternate=label.replace(/^(Pin|Unpin|Hide|Show) /,word=>word==='Pin '?'Unpin ':word==='Unpin '?'Pin ':word==='Hide '?'Show ':'Hide ');
        const next=curation.querySelector(`[aria-label="${CSS.escape(label)}"],[aria-label="${CSS.escape(alternate)}"]`);
        if(next instanceof HTMLElement)next.focus({preventScroll:true});
      }
    }
    sync();
    return {bar,layout,panel,preview,save};
  }
