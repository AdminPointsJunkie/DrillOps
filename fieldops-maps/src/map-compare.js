export function installMapCompare({L,map,getLayers,getLayer,getPane,isVisible,onDisplay=()=>{},onChange=()=>{}}){
 const root=map.getContainer().parentElement,doc=root.ownerDocument;
 const panel=doc.createElement('section'),divider=doc.createElement('div');
 panel.className='map-compare-panel';panel.hidden=true;panel.setAttribute('aria-label','Compare layers');
 panel.innerHTML='<div class="compare-heading"><strong>Compare</strong><button type="button" data-reset title="Reset selections" aria-label="Reset comparison">↺</button><button type="button" data-close aria-label="Close comparison">×</button></div><p>Select which layers appear on each side, then drag the divider.</p><div data-choices></div><small>The basemap is shared. Comparison does not change saved layers.</small>';
 divider.className='map-compare-divider';divider.hidden=true;
 divider.innerHTML='<button type="button" role="slider" aria-label="Comparison divider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-orientation="horizontal">‹ ›</button>';
 root.append(panel,divider);L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);L.DomEvent.disableClickPropagation(divider);
 const handle=divider.querySelector('button'),choices=panel.querySelector('[data-choices]'),selected=new Map(),original=new Map();
 let active=false,position=50,drag=null;
 const supported=l=>l.kind==='vector'||l.kind==='raster';
 function remember(l){const pane=getPane(l);if(pane&&!original.has(pane))original.set(pane,{clip:pane.style.clip,visibility:pane.style.visibility,layer:getLayer(l),id:l.id});return pane;}
 function clip(){
  if(!active)return;
  const size=map.getSize(),a=map.containerPointToLayerPoint([0,0]),b=map.containerPointToLayerPoint([size.x,size.y]),x=a.x+size.x*position/100;
  for(const l of getLayers().filter(supported)){
   const pane=remember(l),overlay=getLayer(l),s=selected.get(l.id)||{left:false,right:false};if(!pane||!overlay)continue;
   const show=s.left||s.right;pane.style.visibility=show?'visible':'hidden';
   if(show&&!map.hasLayer(overlay))overlay.addTo(map);
   pane.style.clip=s.left&&s.right?original.get(pane).clip:s.left?`rect(${a.y}px, ${x}px, ${b.y}px, ${a.x}px)`:`rect(${a.y}px, ${b.x}px, ${b.y}px, ${x}px)`;
  }
  divider.style.left=position+'%';handle.setAttribute('aria-valuenow',String(Math.round(position)));handle.setAttribute('aria-valuetext',`${Math.round(position)}% from left`);
 }
 function render(){
  choices.replaceChildren();const layers=getLayers().filter(supported);
  if(!layers.length){const p=doc.createElement('p');p.className='compare-empty';p.textContent='This map has no layers to compare yet.';choices.append(p);return;}
  const table=doc.createElement('table'),head=doc.createElement('tr');
  for(const title of ['Layer','Left','Right']){const th=doc.createElement('th');th.textContent=title;th.scope='col';head.append(th);}const thead=doc.createElement('thead');thead.append(head);table.append(thead);
  const body=doc.createElement('tbody');
  for(const l of layers){const row=doc.createElement('tr'),name=doc.createElement('th');name.scope='row';name.textContent=l.name;row.append(name);
   for(const side of ['left','right']){const cell=doc.createElement('td'),input=doc.createElement('input');input.type='checkbox';input.checked=!!selected.get(l.id)?.[side];input.dataset.layer=l.id;input.dataset.side=side;input.setAttribute('aria-label',`${l.name} on ${side}`);input.onchange=()=>{selected.set(l.id,{...selected.get(l.id),[side]:input.checked});clip();onDisplay();};cell.append(input);row.append(cell);}body.append(row);
  }table.append(body);choices.append(table);
 }
 function refresh(){if(!active)return;const layers=getLayers().filter(supported),ids=new Set(layers.map(l=>l.id));for(const id of selected.keys())if(!ids.has(id))selected.delete(id);for(const l of layers)if(!selected.has(l.id))selected.set(l.id,{left:false,right:false});render();clip();onDisplay();}
 function finishDrag(){if(!drag)return;const previous=drag;drag=null;if(previous.panEnabled)map.dragging.enable();try{handle.releasePointerCapture?.(previous.id);}catch{}}
 function close(){
  if(!active)return;finishDrag();active=false;
  const layers=getLayers();for(const [pane,s] of original){pane.style.clip=s.clip;pane.style.visibility=s.visibility;const l=layers.find(l=>l.id===s.id);if(!l)continue;const overlay=getLayer(l);if(!overlay)continue;if(isVisible(l)&&!map.hasLayer(overlay))overlay.addTo(map);else if(!isVisible(l)&&map.hasLayer(overlay))map.removeLayer(overlay);}
  original.clear();selected.clear();panel.hidden=divider.hidden=true;onDisplay();onChange(false);
 }
 function reset(){selected.clear();position=50;const visible=getLayers().filter(l=>supported(l)&&isVisible(l));visible.forEach((l,i)=>selected.set(l.id,{left:i===0||visible.length===1,right:i>0||visible.length===1}));refresh();}
 function open(){if(active){panel.hidden=false;return;}active=true;panel.hidden=divider.hidden=false;reset();onChange(true);handle.focus();}
 function move(e){if(!drag||e.pointerId!==drag.id)return;const rect=map.getContainer().getBoundingClientRect();position=Math.max(0,Math.min(100,(e.clientX-rect.left)/Math.max(1,rect.width)*100));clip();e.preventDefault();}
 handle.addEventListener('pointerdown',e=>{if(e.button!==0||drag)return;e.preventDefault();e.stopPropagation();drag={id:e.pointerId,panEnabled:map.dragging.enabled()};map.dragging.disable();handle.setPointerCapture?.(e.pointerId);});
 handle.addEventListener('pointermove',move);for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,finishDrag);
 handle.addEventListener('keydown',e=>{const next={ArrowLeft:position-2,ArrowRight:position+2,Home:0,End:100}[e.key];if(next===undefined)return;e.preventDefault();position=Math.max(0,Math.min(100,next));clip();});
 panel.querySelector('[data-close]').onclick=close;panel.querySelector('[data-reset]').onclick=reset;
 root.addEventListener('keydown',e=>{if(active&&e.key==='Escape'){e.stopPropagation();close();}});map.on('move zoom zoomend resize',clip);
 return {open,close,refresh,get active(){return active;},includes:id=>active&&!!(selected.get(id)?.left||selected.get(id)?.right),rekey(oldID,newID){if(selected.has(oldID)){selected.set(newID,selected.get(oldID));selected.delete(oldID);}for(const value of original.values())if(value.id===oldID)value.id=newID;}};
}
