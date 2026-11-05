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
export function installLayerControl({getLayers,canEdit,isBusy,onComponents=()=>{},doc=document}){
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
 if(basemap){const footer=doc.createElement('div');footer.className='felt-basemap';footer.innerHTML='<span aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="m5 5 5-2 3 4-4 3 1 4-4 1-2-5m10 2 6-2 1 5-4 6-2-3z" fill="var(--felt-panel)"/></svg></span><label for="layer-basemap">Basemap</label>';const picker=basemap.cloneNode(true);picker.id='layer-basemap';picker.setAttribute('aria-label','Layer panel basemap');picker.value=basemap.value;picker.onchange=()=>{basemap.value=picker.value;basemap.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));};basemap.addEventListener('change',()=>picker.value=basemap.value);footer.append(picker);sidebar.append(footer);}

 const menu=doc.createElement('div');menu.className='layer-context-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Layer options');doc.body.append(menu);
 function close(focus=false){menu.hidden=true;returnFocus?.setAttribute('aria-expanded','false');if(focus&&returnFocus?.isConnected)returnFocus.focus();}
 function select(card){selected=card.dataset.id;for(const row of root.querySelectorAll('.layer-card'))row.classList.toggle('selected',row===card);}
 function setMode(value){mode=value;sidebar.dataset.layerView=mode;root.setAttribute('aria-labelledby','layer-tab-'+mode);for(const b of tablist.children){b.setAttribute('aria-selected',String(b.dataset.view===mode));b.tabIndex=b.dataset.view===mode?0:-1;}close();}
 tablist.onclick=e=>{if(e.target.dataset.view)setMode(e.target.dataset.view);};
 tablist.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setMode(e.key==='Home'?'legend':e.key==='End'?'list':mode==='list'?'legend':'list');doc.querySelector('#layer-tab-'+mode).focus();}};
 function open(card,x,y,trigger){
  const layer=getLayers().find(l=>l.id===card.dataset.id);if(!layer||isBusy()||layer.saving)return;
  close();select(card);returnFocus=trigger||card;returnFocus.setAttribute('aria-expanded','true');
  const actions=[['Show on map','[data-action="zoom"]',false],['Edit layer…','[data-action="settings"]',true],['Edit geometry…','[data-action="geometry"]',true],['Style…','[data-layer-options="style"]',true],['Organise…','[data-layer-options="organise"]',true],['Edit tile link…','[data-action="edit-xyz"]',true],['Export layer','[data-action="export"]',false],['Save layer','[data-action="save"]',true],['Move to Recently deleted','[data-action="remove"]',true]];
  menu.replaceChildren();const menuHeading=doc.createElement('div');menuHeading.className='context-drag-heading';menuHeading.dataset.panelDrag='';menuHeading.textContent=layer.name;menuHeading.title='Drag to move menu';menu.append(menuHeading);
  for(const [label,selector,edit] of actions){const target=card.querySelector(selector);if(!target||(edit&&!canEdit(layer)))continue;const b=doc.createElement('button');b.type='button';b.textContent=label;b.setAttribute('role','menuitem');b.onclick=()=>{close(true);if(!isBusy()&&!layer.saving&&(!edit||canEdit(layer)))target.click();};menu.append(b);}
  menu.hidden=false;const box=menu.getBoundingClientRect(),win=doc.defaultView;menu.style.left=Math.max(8,Math.min(x,win.innerWidth-box.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,win.innerHeight-box.height-8))+'px';menu.querySelector('button')?.focus();
 }
 root.addEventListener('contextmenu',e=>{const card=e.target.closest('.layer-card');if(!card||e.target.closest('[data-layer-panel],input,select'))return;e.preventDefault();open(card,e.clientX,e.clientY,card.querySelector('.layer-more'));});
 root.addEventListener('click',e=>{const card=e.target.closest('.layer-card');if(!card)return;select(card);const more=e.target.closest('.layer-more');if(more){const r=more.getBoundingClientRect();open(card,r.left,r.bottom+4,more);}else if(e.target.closest('.layer-top strong')){const layer=getLayers().find(l=>l.id===card.dataset.id);if(layer&&canEdit(layer)&&!isBusy()&&!layer.saving)card.querySelector('[data-layer-options="style"]')?.click();}});
 root.addEventListener('keydown',e=>{const card=e.target.closest('.layer-card');if(!card||e.target.closest('[data-layer-panel],input,select'))return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=card.getBoundingClientRect();open(card,r.left+30,r.top+30,card);}else if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(card);card.querySelector('[data-layer-options="style"]')?.click();}});
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
    const nav=doc.createElement('div');nav.className='felt-inspector-tabs';nav.innerHTML='<span class="current">Style</span><button data-open-filter>Filter</button><button class="inspector-components">Components</button><button data-open-table>Data</button>';
    nav.querySelector('.inspector-components').onclick=onComponents;
    const heading=panel.querySelector('.inspector-heading');heading?.after(bar,nav);
    const general=doc.createElement('h3');general.className='felt-general-heading';general.textContent='General';nav.after(general);
   }
   const title=top.querySelector('strong');title.title=layer.name+' · Right-click for options';
  }
  dragging.refresh();
 }
 setMode(mode);refresh();return {refresh};
}
