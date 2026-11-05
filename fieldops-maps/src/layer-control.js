import {featureAppearance} from './attribute-style.js';
import {installPanelDragging} from './panel-drag.js';
import {geometryKinds,layerStyle,lineStyles} from './layer-style.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colour=value=>/^#[0-9a-f]{6}$/i.test(value)?value:'#78958a';
export function legendSymbol(layer,override={}){
 const sample=layer.fc?.features.find(f=>!f.properties?.Text)||layer.fc?.features[0];
 layer=featureAppearance(layer,sample);
 const style={...layerStyle(layer),...override},color=colour(override.color||layer.color),kinds=geometryKinds(layer.fc);
 let shape;
 if(layer.kind==='raster')shape='<rect x="3" y="3" width="18" height="18" rx="3" fill="none"/><path d="m4 18 6-7 4 4 3-3 4 6" fill="none"/>';
 else if(kinds.has('line'))shape=`<path d="M2 12h20" fill="none" stroke-width="${Math.max(2,style.lineWidth)}" ${lineStyles[style.lineStyle]?`stroke-dasharray="${lineStyles[style.lineStyle]}"`:''}/>`;
 else if(kinds.has('shape'))shape=`<path d="m4 5 14-2 3 16-17 2Z" fill="${colour(style.fillColor)}" fill-opacity="${style.fillOpacity}"/>`;
 else shape=({square:'<rect x="6" y="6" width="12" height="12"/>',triangle:'<path d="m12 4 8 15H4Z"/>',diamond:'<path d="m12 3 9 9-9 9-9-9Z"/>',cross:'<path d="M12 4v16M4 12h16" fill="none" stroke-width="4"/>'})[style.symbol]||'<circle cx="12" cy="12" r="7"/>';
 return `<svg viewBox="0 0 24 24" width="24" height="24" fill="${color}" stroke="${color}" stroke-width="2" aria-hidden="true">${shape}</svg>`;
}
export function legendContents(layer){
 const rules=layer.metadata?.style?.rules;
 if(!['categorized','graduated'].includes(rules?.mode)||!rules.classes?.length)return '';
 return `<div class="legend-field">${esc(rules.field)}</div>`+rules.classes.map(c=>`<div class="legend-entry">${legendSymbol(layer,c)}<span>${esc(c.label??`${c.min} – ${c.max}`)}</span></div>`).join('');
}
export function installLayerControl({getLayers,canEdit,isBusy,onComponents=()=>{},onBasemap,onTable,onAttributes,onVisibility,onCopy,onDuplicate,onError=()=>{},doc=document}){
 const root=doc.querySelector('#layers'),sidebar=doc.querySelector('#sidebar'),tabs=sidebar.querySelector('.tabs');
 const dragging=installPanelDragging(doc);
 sidebar.classList.add('felt-layer-control');doc.body.classList.add('felt-workspace');
 let selected=null,mode='list',returnFocus=null;
 const old=tabs.querySelector('.active'),count=old.querySelector('#layer-count');
 const tablist=doc.createElement('div');tablist.className='layer-view-tabs';tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label','Layer display');
 for(const [id,label] of [['legend','Legend'],['list','List']]){const b=doc.createElement('button');b.type='button';b.textContent=label;b.id='layer-tab-'+id;b.dataset.view=id;b.setAttribute('role','tab');b.setAttribute('aria-controls','layers');tablist.append(b);}
 old.replaceWith(tablist);tabs.insertBefore(count,tablist.nextSibling);
 root.setAttribute('role','tabpanel');
 const grip=doc.createElement('button');grip.type='button';grip.className='panel-drag-handle';grip.dataset.panelDrag='';grip.textContent='⠿';grip.title='Drag to move layers';grip.setAttribute('aria-label','Move layers panel (drag or use arrow keys)');tabs.append(grip);

 const basemap=doc.querySelector('#basemap');
 if(basemap){const footer=doc.createElement('div');footer.className='felt-basemap';if(onBasemap){const b=doc.createElement('button');b.type='button';b.textContent='◉  Basemap';b.onclick=onBasemap;footer.append(b);}else{const picker=basemap.cloneNode(true);picker.id='layer-basemap';picker.setAttribute('aria-label','Layer panel basemap');picker.onchange=()=>{basemap.value=picker.value;basemap.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));};footer.append(picker);}sidebar.append(footer);}


 const menu=doc.createElement('div');menu.className='layer-context-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Layer options');doc.body.append(menu);
 function close(focus=false){menu.hidden=true;returnFocus?.setAttribute('aria-expanded','false');if(focus&&returnFocus?.isConnected)returnFocus.focus();}
 function select(card){selected=card.dataset.id;for(const row of root.querySelectorAll('.layer-card'))row.classList.toggle('selected',row===card);}
 function setMode(value){mode=value;sidebar.dataset.layerView=mode;root.setAttribute('aria-labelledby','layer-tab-'+mode);for(const b of tablist.children){b.setAttribute('aria-selected',String(b.dataset.view===mode));b.tabIndex=b.dataset.view===mode?0:-1;}close();}
 tablist.onclick=e=>{if(e.target.dataset.view)setMode(e.target.dataset.view);};
 tablist.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setMode(e.key==='Home'?'legend':e.key==='End'?'list':mode==='list'?'legend':'list');doc.querySelector('#layer-tab-'+mode).focus();}};
 function open(card,x,y,trigger){
  const layer=getLayers().find(l=>l.id===card.dataset.id);if(!layer||isBusy()||layer.saving)return;
  close();select(card);returnFocus=trigger||card;returnFocus.setAttribute('aria-expanded','true');
  menu.replaceChildren();const menuHeading=doc.createElement('div');menuHeading.className='context-drag-heading';menuHeading.dataset.panelDrag='';menuHeading.textContent=layer.name;menuHeading.title='Drag to move menu';menu.append(menuHeading);
  const custom=(label,run,{key='',edit=false,parent=menu,danger=false}={})=>{if(edit&&!canEdit(layer))return;const b=doc.createElement('button');b.type='button';b.innerHTML=esc(label)+(key?'<kbd>'+esc(key)+'</kbd>':'');b.classList.toggle('danger',danger);b.setAttribute('role','menuitem');b.onclick=async()=>{close(true);if(isBusy()||layer.saving||!getLayers().includes(layer)||(edit&&!canEdit(layer)))return;try{await run();}catch(error){onError(error);}};parent.append(b);};
  const action=(label,selector,options={})=>{if(card.querySelector(selector))custom(label,()=>card.querySelector(selector)?.click(),options);};
  const separator=()=>menu.append(doc.createElement('hr'));
  const visibility=async(mode)=>{for(const other of [...getLayers()]){const visible=mode==='only'?other===layer:mode==='others'?other!==layer:other.visible===false;if(mode==='toggle'&&other!==layer)continue;if((other.visible!==false)===visible)continue;if(onVisibility)await onVisibility(other,visible);else root.querySelector(`[data-id="${other.id}"] [data-action="visibility"]`)?.click();}};
  action('Zoom to fit','[data-action="zoom"]',{key:'F'});
  custom(layer.visible===false?'Show':'Hide',()=>visibility('toggle'),{key:'H'});
  custom('Show only this',()=>visibility('only'));custom('Show others',()=>visibility('others'));separator();
  if(layer.kind==='vector'){custom('Open table',()=>onTable?onTable(layer):card.querySelector('[data-open-table]')?.click(),{key:'T'});if(onAttributes)custom('Edit attributes…',()=>onAttributes(layer),{edit:true});}
  action('Export…','[data-action="export"]');separator();
  if(onCopy&&layer.kind==='vector')custom('Copy',()=>onCopy(layer),{key:'⌘ C'});
  if(onDuplicate)custom('Duplicate',()=>onDuplicate(layer),{key:'⌘ D',edit:true});
  action('Delete','[data-action="remove"]',{key:'⌫',edit:true,danger:true});separator();
  const submenu=label=>{const d=doc.createElement('details'),summary=doc.createElement('summary');summary.textContent=label;d.append(summary);menu.append(d);return d;};
  if(canEdit(layer)){const group=submenu('Group'),membership=card.querySelector('[data-membership]');if(membership)for(const option of membership.options)custom(option.textContent,()=>{const current=card.querySelector('[data-membership]');if(current){current.value=option.value;current.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));}},{edit:true,parent:group});action('Organise…','[data-layer-options="organise"]',{edit:true,parent:group});}
  const more=submenu('Actions');
  for(const [label,selector] of [['Edit layer…','[data-action="settings"]'],['Edit geometry…','[data-action="geometry"]'],['Style…','[data-layer-options="style"]'],['Edit tile link…','[data-action="edit-xyz"]'],['Save layer','[data-action="save"]']])action(label,selector,{edit:true,parent:more});
  menu.hidden=false;const box=menu.getBoundingClientRect(),win=doc.defaultView;menu.style.left=Math.max(8,Math.min(x,win.innerWidth-box.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,win.innerHeight-box.height-8))+'px';menu.querySelector('button')?.focus();
 }
 root.addEventListener('contextmenu',e=>{const card=e.target.closest('.layer-card');if(!card||e.target.closest('[data-layer-panel],input,select'))return;e.preventDefault();open(card,e.clientX,e.clientY,card.querySelector('.layer-more'));});
 root.addEventListener('click',e=>{const card=e.target.closest('.layer-card');if(!card)return;select(card);const more=e.target.closest('.layer-more');if(more){const r=more.getBoundingClientRect();open(card,r.left,r.bottom+4,more);}else if(e.target.closest('.layer-top strong')){const layer=getLayers().find(l=>l.id===card.dataset.id);if(layer&&canEdit(layer)&&!isBusy()&&!layer.saving)card.querySelector('[data-layer-options="style"]')?.click();}});
 root.addEventListener('keydown',e=>{const card=e.target.closest('.layer-card');if(!card||e.target.closest('[data-layer-panel],input,select'))return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=card.getBoundingClientRect();open(card,r.left+30,r.top+30,card);}else if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(card);card.querySelector('[data-layer-options="style"]')?.click();}});
 root.addEventListener('keydown',e=>{const card=e.target.closest('.layer-card');if(!card||e.target.closest('input,textarea,select,[contenteditable=true],[data-layer-panel]')||e.altKey||e.shiftKey)return;const layer=getLayers().find(l=>l.id===card.dataset.id);if(!layer||isBusy()||layer.saving)return;const key=e.key.toLowerCase(),mod=e.metaKey||e.ctrlKey;let run;if(mod&&key==='c'&&onCopy&&layer.kind==='vector')run=()=>onCopy(layer);else if(mod&&key==='d'&&onDuplicate&&canEdit(layer))run=()=>onDuplicate(layer);else if(!mod&&key==='f')run=()=>card.querySelector('[data-action="zoom"]')?.click();else if(!mod&&key==='h')run=()=>onVisibility?onVisibility(layer,layer.visible===false):card.querySelector('[data-action="visibility"]')?.click();else if(!mod&&key==='t'&&onTable)run=()=>onTable(layer);else if(!mod&&['delete','backspace'].includes(key)&&canEdit(layer))run=()=>card.querySelector('[data-action="remove"]')?.click();if(run){e.preventDefault();e.stopPropagation();Promise.resolve().then(run).catch(onError);}});
 menu.onkeydown=e=>{const items=[...menu.querySelectorAll('button')],index=items.indexOf(doc.activeElement);if(e.key==='Escape'){e.preventDefault();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}else if(e.key==='Tab')close();};
 doc.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))close();});doc.defaultView.addEventListener('resize',()=>close());doc.addEventListener('scroll',()=>close(),true);
 function refresh(){
  close();
  if(!root.querySelector('.felt-section-heading')){
   const headings=doc.createElement('div');headings.className='felt-section-headings';
   for(const label of ['Annotations','Layers']){const b=doc.createElement('button');b.type='button';b.className='felt-section-heading';b.textContent='▾  '+label;b.setAttribute('aria-expanded','true');b.onclick=()=>{const collapsed=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!collapsed));b.textContent=(collapsed?'▸  ':'▾  ')+label;root.classList.toggle('hide-'+label.toLowerCase(),collapsed);};headings.append(b);}
   root.prepend(headings);root.classList.remove('hide-annotations','hide-layers');
  }
  for(const card of root.querySelectorAll('.layer-card')){
   const layer=getLayers().find(l=>l.id===card.dataset.id);if(!layer)continue;
   card.tabIndex=0;card.setAttribute('aria-label',layer.name);card.classList.toggle('selected',selected===layer.id);
   const top=card.querySelector('.layer-top'),symbol=top.querySelector('.geometry-symbol');symbol.innerHTML=legendSymbol(layer);
   if(!top.querySelector('.layer-more')){const b=doc.createElement('button');b.type='button';b.className='layer-more';b.textContent='⋯';b.setAttribute('aria-label','Options for '+layer.name);b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');top.append(b);top.append(top.querySelector('.layer-visibility'));}
   let legend=card.querySelector('.layer-key');if(!legend){legend=doc.createElement('div');legend.className='layer-key';card.append(legend);}legend.innerHTML=legendContents(layer);
   const panel=card.querySelector('[data-layer-panel="style"]');
   if(panel&&!panel.querySelector('.felt-inspector-tabs')){
    const bar=doc.createElement('div');bar.className='felt-inspector-toolbar';bar.innerHTML='<button data-action="zoom" title="Show on map" aria-label="Show layer on map">⌖</button><button data-action="geometry" title="Edit geometry" aria-label="Edit layer geometry">＋</button><button data-layer-options="organise" title="Organise layer" aria-label="Organise layer">▧</button><button class="inspector-more" title="Layer options" aria-label="More layer options">⋯</button>';
    bar.querySelector('.inspector-more').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();open(card,r.left,r.bottom,e.currentTarget);};
    const nav=doc.createElement('div');nav.className='felt-inspector-tabs';nav.innerHTML='<button class="current inspector-style">Style</button><button data-open-filter>Filter</button><button class="inspector-components">Components</button><button class="inspector-data">Data</button>';
    nav.querySelector('.inspector-components').onclick=onComponents;
    const showData=show=>{panel.querySelector('.style-fields')?.toggleAttribute('hidden',show);panel.querySelector('.felt-general-heading')?.toggleAttribute('hidden',show);panel.querySelector('.layer-data')?.remove();nav.querySelector('.inspector-style').classList.toggle('current',!show);nav.querySelector('.inspector-data').classList.toggle('current',show);if(!show)return;const data=doc.createElement('div');data.className='layer-data';const fields=new Set((layer.fc?.features||[]).flatMap(f=>Object.keys(f.properties||{}))),files=layer.files?.map(f=>f.name)||[];data.innerHTML='<h3>File</h3><dl>'+[['Status',layer.saved?'Saved':'Unsaved'],['Updated',layer.updated_at?new Date(layer.updated_at).toLocaleString():'—'],['File type',layer.metadata?.format||layer.metadata?.source_type||layer.kind],['File name',files.join(', ')||layer.original_paths?.map(p=>p.split('/').pop()).join(', ')||layer.name]].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><h3>Info</h3><dl>'+[['Created',layer.created_at?new Date(layer.created_at).toLocaleString():'—'],['Created by',layer.owner_name||layer.created_by||'—'],['Features',layer.fc?.features.length??'—'],['Attributes',fields.size]].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>';if(onAttributes&&canEdit(layer)){const edit=doc.createElement('button');edit.textContent='Edit attributes';edit.onclick=()=>onAttributes(layer);data.append(edit);}panel.append(data);};
    nav.querySelector('.inspector-data').onclick=()=>showData(true);nav.querySelector('.inspector-style').onclick=()=>showData(false);
    const heading=panel.querySelector('.inspector-heading');heading?.after(bar,nav);
    const general=doc.createElement('h3');general.className='felt-general-heading';general.textContent='General';nav.after(general);
   }
   const title=top.querySelector('strong');title.title=layer.name+' · Right-click for options';
  }
  dragging.refresh();
 }
 setMode(mode);refresh();return {refresh};
}
