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
  const demoTabs=uiTabs({id:'demo',label:'Example sources',items:[
    {label:'Source one',panel:el('div',null,el('p',null,'The first source stays mounted when you switch.'))},
    {label:'Unavailable',disabled:true,panel:el('div',null,'Unavailable source')},
    {label:'Source two',panel:el('div',null,el('p',null,'The second source has its own reading position.'))}]});
  section('Tabs',demoTabs.element,el('p',null,'Arrows move focus; Enter or Space selects. Tab enters the active panel. Wide comparisons show every source as a named region.'));
  section('Pills',el('div',{class:'samples'},
    uiBadge({label:'Tag'}),uiBadge({label:'New',tone:'accent'}),uiBadge({label:'Saved',tone:'success'}),uiBadge({label:'Check delayed',tone:'warning'}),uiBadge({label:'Failed',tone:'error'}),
    uiChip({label:'Select'}).element,uiChip({label:'Saved',selected:true}).element,uiChip({label:'Unavailable',disabled:true}).element),
    el('p',null,'Badges describe. Chips select. Only the interactive pill gets a target, a focus stop and a selected state.'));
  section('Disclosures and accordions',uiDisclosure({label:'Independent details'},el('p',null,'This section can remain open alongside other disclosures.')),
    uiDisclosure({label:'First accordion section',name:'demo-accordion'},el('p',null,'Only one section in this named group stays open.')),
    uiDisclosure({label:'Second accordion section',name:'demo-accordion'},el('p',null,'Enter and Space use native disclosure behavior.')));
  const tray=uiTray({label:'Selected material example'},el('span',null,'2 selected'),uiButton({label:'Compare'}),uiButton({label:'Clear',emphasis:'quiet'}));
  section('Trays and drawers',tray,el('p',null,'A selection tray stays in the page. A drawer contains a task or preferences and uses modal focus when the rest of the page is unavailable.'));
  const drawerTrigger=uiButton({label:'Open drawer',id:'demo-drawer-trigger'}),drawerClose=iconButton('close','Close drawer',()=>{});
  const drawer=el('dialog',{id:'demo-drawer','aria-label':'Example drawer'},uiToolbar({label:'Drawer controls'},el('strong',null,'Settings'),drawerClose),uiToggle({label:'Show source details'}).element);
  uiDialog(drawer,{trigger:drawerTrigger,closeButton:drawerClose,variant:'drawer'});
  catalogue.append(drawerTrigger,drawer);
  section('Segmented choices',uiChoiceGroup({label:'Example view',value:'list',choices:[{value:'list',label:'List'},{value:'cards',label:'Cards'}]}).element,el('p',null,'A mutually exclusive setting uses native radios, not tab semantics.'));
  const documentExample=el('div',{class:'ui-document','data-ui':'document'},
    el('h2',null,'A readable document'),el('p',null,'Compact chrome surrounds comfortable reading. ',el('a',{href:'https://www.w3.org/WAI/ARIA/apg/patterns/tabs/'},'Content references remain underlined.')),
    el('h3',null,'Code and evidence'),el('p',null,'Use ',el('code',null,'uiButton()'),' for an action.'),el('pre',null,el('code',null,'const room = await openRoom();')),
    el('blockquote',null,el('p',null,'A quoted passage stays distinct from controls.')),
    el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':'Example data'},el('table',null,el('thead',null,el('tr',null,el('th',{scope:'col'},'Control'),el('th',{scope:'col'},'Minimum'))),el('tbody',null,el('tr',null,el('td',null,'Compact action'),el('td',null,'24px'))))));
  section('Documents and navigation',el('nav',{'aria-label':'Example contents'},uiNavLink({label:'Overview',href:'#document-example',current:true}),uiNavLink({label:'Installation',href:'#document-example'})),documentExample,
    uiPager({previous:{label:'Overview',onClick:()=>{}},next:{label:'Installation and configuration',onClick:()=>{}}}));
  documentExample.id='document-example';
  const draft=uiField(uiControl('input',{id:'demo-form-name',required:true,type:'url',placeholder:'https://example.com'}),{label:'Source address',hint:'A public URL.'});
  const notes=uiField(uiControl('textarea',{rows:2,placeholder:'Optional notes'}),{label:'Notes (optional)'});
  const submit=uiButton({id:'demo-form-submit',label:'Save source',type:'submit',emphasis:'primary'});
  const form=el('form',{id:'demo-form',class:'sample-settings'},draft.element,notes.element,submit);
  uiForm(form,{submit,onSubmit:async()=>{await new Promise(resolve=>setTimeout(resolve,350));throw new Error('Could not save. Your draft is kept; try again.');}});
  section('Async forms',form,el('div',{class:'samples'},
    uiField(uiControl('input',{value:'Unavailable',disabled:true}),{label:'Disabled field'}).element,
    uiField(uiControl('input',{value:'Retained address',readonly:true}),{label:'Read-only field'}).element,
    uiField(uiControl('input',{type:'file',accept:'.json'}),{label:'Import file'}).element),
    el('p',null,'Native validation names the field. Failed submissions keep drafts and show a persistent message. Busy actions preserve their label.'));
  const richTrigger=uiButton({label:'Sharing options',id:'demo-popover-trigger'});
  const richChoice=uiChoiceGroup({label:'Sharing audience',value:'public',choices:[{value:'public',label:'Public'},{value:'followers',label:'Followers only'}]});
  const richClose=iconButton('close','Close sharing options',()=>rich.close());
  const richPanel=el('div',{id:'demo-popover','aria-label':'Sharing options'},el('div',{class:'ui-popover-close'},richClose),richChoice.element,
    uiField(uiControl('input',{id:'demo-popover-note'}),{label:'Note (optional)'}).element,uiButton({label:'Done',onClick:()=>rich.close()}));
  const rich=uiPopover(richPanel,richTrigger);
  section('Rich popovers',richTrigger,richPanel,el('p',null,'Forms use normal Tab and radio arrow keys. Escape and outside interaction dismiss; content stays within the viewport.'));
  const notices=el('div',{id:'demo-toasts'});document.body.append(notices);const toasts=uiToasts(notices);
  section('Toasts and progress',uiToolbar({label:'Notification examples'},
    uiButton({label:'Show confirmation',onClick:()=>toasts.show('Source saved.','success')}),
    uiButton({label:'Show failure',onClick:()=>toasts.show('Could not save. Retry from the source form.','error')})),
    uiProgress({label:'Reading session',value:2,max:10,message:'2 of 10 stories'}),
    uiProgress({label:'Completed session',value:10,max:10,message:'10 of 10 stories'}),
    uiFeedback({kind:'loading',message:'Looking for sources…'}),uiSkeleton(),
    el('p',null,'Three notices at most; additional notices queue. Errors remain until dismissed. Confirmations pause while hovered, focused or the document is hidden. Progress never invents a percentage.'));
  section('Component contracts',...Object.entries(UI_COMPONENTS).map(([name, component])=>uiDisclosure({label:`${name} · ${component.status}`,className:'contract'},el('p',null,component.purpose),el('code',null,component.example))));
  section('Coverage inventory',el('p',null,'Shared means reusable production code. Local means a defined product composition with migration work recorded. Reserved means no current product need; do not invent a one-off when it arrives.'),
    ...UI_INVENTORY.map(item=>uiDisclosure({label:`${item.name} · ${item.coverage}`,className:'contract'},el('p',null,item.definition),el('p',null,`Variants: ${item.variants.join(', ')}. States: ${item.states.join(', ')}.`),el('p',null,item.keyboard),el('p',null,item.followUp))));
  const measurements=el('output',{id:'measurements'}); section('Rendered sizes', measurements);
  function measure() { measurements.textContent=[...document.querySelectorAll('[data-measure]')].map(n=>`${n.getAttribute('data-measure')}: ${Math.round(n.getBoundingClientRect().width)} × ${Math.round(n.getBoundingClientRect().height)}px`).join('\n'); }
  new ResizeObserver(measure).observe(document.body); measure();
})();
