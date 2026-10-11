(() => {
  const catalogue = document.getElementById('catalogue');
  if (!catalogue) throw new Error('Missing catalogue root');
  /** @param {string} title @param {...(Child|Child[])} children */
  function section(title, ...children) { catalogue?.append(el('section', null, el('h2', null, title), ...children)); }
  /** @param {HTMLElement} node @param {string} name */
  function measured(node, name) { node.dataset.measure = name; return node; }
  /** @param {string} id @param {string} label @param {string[][]} values @param {(value:string)=>void} change */
  function preference(id, label, values, change) {
    const select = el('select', {id}, values.map(([value, text])=>el('option', {value}, text)));
    select.addEventListener('change',()=>change(select.value));
    return uiField(select,{label}).element;
  }
  catalogue.append(el('div',{class:'samples'},
    preference('theme','Theme',[['light','Light'],['dark','Dark']],value=>{document.documentElement.dataset.theme=value;}),
    preference('targets','Targets',[['pointer','Pointer'],['touch','Touch preview']],value=>document.documentElement.toggleAttribute('data-touch',value==='touch')),
    preference('text','Text',[['100%','100%'],['200%','200%']],value=>{document.documentElement.style.fontSize=value;})));
  section('Buttons', el('div',{class:'samples'},
    measured(uiButton({label:'Save'}),'Button'), measured(uiButton({label:'Save',emphasis:'primary'}),'Primary'), measured(uiButton({label:'Delete',emphasis:'danger'}),'Danger'),
    uiButton({label:'Quiet', emphasis:'quiet'}), uiButton({label:'Compact',size:'compact'}), uiButton({label:'Selected',pressed:true}),
    uiButton({label:'Unavailable',disabled:true}), uiButton({label:'Saving',busy:true})),
    el('p',null,'Emphasis and state preserve size. Busy actions retain their label and prevent repeated submission.'));
  section('Icon and metadata actions', el('div',{class:'samples'},
    measured(iconButton('plus','Add source, compact',()=>{}),'Compact icon'), measured(iconButton('plus','Add source',()=>{},{size:'default'}),'Icon'),
    iconButton('bookmark','Saved',()=>{},{pressed:true}), iconButton('plus','Unavailable action',()=>{},{disabled:true}),
    measured(uiMetadataAction({icon:'comment',label:'3 comments, open discussion',count:3,onClick:()=>{}}),'Metadata')),
    el('p',null,'Familiar symbols have names and fast hints. Touch uses the same actions without depending on hover.'));
  const source = uiField(el('input',{id:'demo-source',placeholder:'example.com'}),{label:'Source',hint:'Enter a public feed or website.'});
  measured(source.control,'Field');
  section('Fields and validation', el('div',{class:'samples'},source.element,
    uiButton({label:'Show error',onClick:()=>source.setError('Enter a valid website address.')}),
    uiButton({label:'Clear error',onClick:()=>source.setError()})));
  const preferenceStatus = el('p',{role:'status'});
  const reading = uiSettingsRow(el('select',null,el('option',null,'In this room'),el('option',null,'In the conversation')),{label:'Open stories'});
  const details = uiToggle({label:'Show source details',hint:'Show where each source’s data comes from.',onChange:checked=>{preferenceStatus.textContent=checked?'Source details shown':'Source details hidden';}});
  section('Settings',el('div',{class:'sample-settings'},reading.element,details.element,preferenceStatus));
  const trigger=uiButton({label:'Open settings',id:'demo-dialog-trigger'}), close=iconButton('close','Close settings',()=>{});
  const panel=el('dialog',{id:'demo-dialog','aria-label':'Example settings'},uiToolbar({label:'Settings'},el('strong',null,'Settings'),close),uiToggle({label:'Show details'}).element);
  uiDialog(panel,{trigger,closeButton:close});
  const menuTrigger=uiButton({label:'More actions',id:'demo-menu-trigger'});
  const menu=el('div',{id:'demo-menu','aria-label':'Example actions'},uiButton({label:'Collections'}),uiButton({label:'Unavailable',disabled:true}),uiButton({label:'Page updates'}),uiButton({label:'Events'}));
  uiMenu(menu,menuTrigger);
  section('Overlays',uiToolbar({label:'Overlay examples'},trigger,menuTrigger),panel,menu,el('p',null,'Menus support arrows, Home/End and first-letter navigation. Modal focus returns to its opener. Escape dismisses the topmost hint first.'));
  section('Cards and feedback', uiCard({title:'Agents that remember',description:'A collection of kept reading.',meta:'4 kept · 2 live sources',actions:[uiButton({label:'Open collection'})]}),
    uiFeedback({kind:'empty',title:'Nothing here yet',message:'Save a link or keep a passage to start your library.'}),
    uiFeedback({kind:'loading',message:'Loading your collections…'}),
    uiFeedback({kind:'error',message:'Could not load collections.',action:uiButton({label:'Try again'})}),
    uiFeedback({kind:'success',message:'Collection saved.'}),uiFeedback({kind:'info',message:'Checks run while the server is available.'}));
  section('Component contracts',...Object.entries(UI_COMPONENTS).map(([name, component])=>el('details',{class:'contract'},el('summary',null,`${name} · ${component.status}`),el('p',null,component.purpose),el('code',null,component.example))));
  const measurements=el('output',{id:'measurements'}); section('Rendered sizes', measurements);
  function measure() { measurements.textContent=[...document.querySelectorAll('[data-measure]')].map(n=>`${n.getAttribute('data-measure')}: ${Math.round(n.getBoundingClientRect().width)} × ${Math.round(n.getBoundingClientRect().height)}px`).join('\n'); }
  new ResizeObserver(measure).observe(document.body); measure();
})();
