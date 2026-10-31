import {booleanIntersects,bboxPolygon} from '@turf/turf';
import {featureBounds} from './explore-data.js';
import {escapeHTML as esc} from './explore-dialogs.js';

export function selectionInBounds(layers,bounds,isVisible=()=>true,acceptFeature=()=>true){
 const mask=bboxPolygon(bounds),hits=[];
 const overlaps=b=>b&&b[0]<=bounds[2]&&b[2]>=bounds[0]&&b[1]<=bounds[3]&&b[3]>=bounds[1];
 for(const layer of layers){
  if(!isVisible(layer)||layer.metadata?.xyz)continue;
  if(layer.kind==='raster'){if(overlaps(layer.bounds))hits.push({layer,index:null});continue;}
  for(const [index,feature] of (layer.fc?.features||[]).entries()){
   if(!acceptFeature(layer,feature)||!overlaps(featureBounds(feature)))continue;
   try{if(booleanIntersects(feature,mask))hits.push({layer,index});}catch{/* Ignore unsupported geometry, never select its whole bounding box. */}
  }
 }
 return hits;
}
export function installMapSelection({L,map,getLayers,isVisible,canEdit,onInspect,onEdit,onGroup,onAttributes,onConvert,onActivate,acceptFeature=()=>true,notify}){
 const root=document.querySelector('.map-area'),canvas=map.getContainer();
 const button=document.createElement('button');button.id='map-select-tool';button.className='square';button.type='button';button.textContent='↖';button.title='Select features (V)';button.setAttribute('aria-label','Select features');button.setAttribute('aria-pressed','false');
 document.querySelector('.map-tools').prepend(button);
 const panel=document.createElement('section');panel.className='field-tools-panel selection-panel';panel.hidden=true;panel.setAttribute('aria-label','Selected map features');
 panel.innerHTML='<div class="info-heading"><strong data-count>Selection</strong><button data-close aria-label="Clear selection">×</button></div><p>Click to select. Shift-click adds or removes items. Drag a box to select across visible layers. Hold Space to pan.</p><div data-items></div><div class="drawing-actions"><button data-inspect>Details</button><button data-edit>Edit geometry</button><button data-attributes>Attributes</button><button data-group>Group layers</button><button data-convert>Create layer from selection</button><button data-export>Export selection</button></div><p class="error" role="alert"></p>';
 const selectionPane=map.createPane('map-selection');selectionPane.style.zIndex='649';selectionPane.style.pointerEvents='none';
 root.append(panel);const q=s=>panel.querySelector(s),overlay=L.layerGroup().addTo(map);
 let active=false,selected=[],start=null,box=null,draggingBefore=false,boxBefore=false,space=false,suppressClick=false;
 const key=s=>s.layer.id+':'+s.index;
 function render(){
  selected=selected.filter(s=>getLayers().includes(s.layer)&&isVisible(s.layer)&&(s.index===null||(s.layer.fc?.features[s.index]&&acceptFeature(s.layer,s.layer.fc.features[s.index]))));overlay.clearLayers();
  document.querySelectorAll('.layer-card').forEach(card=>card.classList.toggle('map-selected',selected.some(s=>s.layer.id===card.dataset.id)));
  for(const s of selected){if(s.index===null){const b=s.layer.bounds;L.rectangle([[b[1],b[0]],[b[3],b[2]]],{pane:'map-selection',color:'#eaa51d',weight:3,fillOpacity:.08,interactive:false}).addTo(overlay);}else L.geoJSON(s.layer.fc.features[s.index],{pane:'map-selection',interactive:false,style:{color:'#eaa51d',weight:5,fillOpacity:.18},pointToLayer:(_f,ll)=>L.circleMarker(ll,{pane:'map-selection',radius:9,color:'#eaa51d',weight:3,fillOpacity:.3,interactive:false})}).addTo(overlay);}
  q('[data-count]').textContent=selected.length?`${selected.length} selected`:'Select features';
  q('[data-items]').innerHTML=[...new Set(selected.map(s=>s.layer))].map(l=>`<div>${esc(l.name)}</div>`).join('');
  for(const name of ['inspect','edit'])q('[data-'+name+']').disabled=selected.length!==1||(name==='edit'&&!canEdit(selected[0]?.layer));
  const editable=selected.length&&selected.every(s=>canEdit(s.layer));q('[data-group]').disabled=!editable;q('[data-attributes]').disabled=!editable||selected.some(s=>s.index===null);q('[data-convert]').disabled=!editable||selected.some(s=>s.index===null);q('[data-export]').disabled=!selected.some(s=>s.index!==null);
 }
 function apply(hits,append=false){const next=new Map((append?selected:[]).map(s=>[key(s),s]));for(const s of hits)next.set(key(s),s);selected=[...next.values()];render();}
 function stopBox(){if(box){box.remove();box=null;}start=null;}
 function deactivate(){if(!active)return;active=false;space=false;stopBox();overlay.clearLayers();selected=[];panel.hidden=true;button.setAttribute('aria-pressed','false');root.classList.remove('map-selecting');if(draggingBefore)map.dragging.enable();if(boxBefore)map.boxZoom?.enable();document.querySelectorAll('.map-selected').forEach(el=>el.classList.remove('map-selected'));}
 function activate(){if(active)return;q('.error').textContent='';if(onActivate?.()===false)return;active=true;draggingBefore=!!map.dragging.enabled();boxBefore=!!map.boxZoom?.enabled();map.dragging.disable();map.boxZoom?.disable();root.classList.add('map-selecting');button.setAttribute('aria-pressed','true');panel.hidden=false;render();}
 button.onclick=()=>active?deactivate():activate();q('[data-close]').onclick=()=>{selected=[];render();};
 canvas.addEventListener('pointerdown',e=>{if(!active||space||e.button!==0||e.target.closest('.leaflet-control'))return;start={x:e.clientX,y:e.clientY,at:map.mouseEventToLatLng(e),append:e.shiftKey,pointer:e.pointerId};});
 canvas.addEventListener('pointermove',e=>{if(!start||!active)return;if(Math.hypot(e.clientX-start.x,e.clientY-start.y)<5&&!box)return;if(!box){canvas.setPointerCapture?.(e.pointerId);box=document.createElement('div');box.className='map-selection-box';canvas.append(box);}const rect=canvas.getBoundingClientRect();Object.assign(box.style,{left:Math.min(start.x,e.clientX)-rect.left+'px',top:Math.min(start.y,e.clientY)-rect.top+'px',width:Math.abs(start.x-e.clientX)+'px',height:Math.abs(start.y-e.clientY)+'px'});});
 canvas.addEventListener('pointerup',e=>{if(!start)return;if(box){const a=start.at,b=map.mouseEventToLatLng(e);apply(selectionInBounds(getLayers(),[Math.min(a.lng,b.lng),Math.min(a.lat,b.lat),Math.max(a.lng,b.lng),Math.max(a.lat,b.lat)],isVisible,acceptFeature),start.append);suppressClick=true;setTimeout(()=>suppressClick=false,0);e.preventDefault();}stopBox();});
 canvas.addEventListener('pointercancel',stopBox);
 document.addEventListener('keydown',e=>{if(e.target.closest?.('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;if(e.key.toLowerCase()==='v'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();activate();}if(!active)return;if(e.key==='Escape'){e.preventDefault();deactivate();}if(e.code==='Space'){e.preventDefault();space=true;stopBox();if(draggingBefore)map.dragging.enable();root.classList.remove('map-selecting');}});
 const endPan=()=>{space=false;stopBox();if(active){map.dragging.disable();root.classList.add('map-selecting');}};document.addEventListener('keyup',e=>{if(e.code==='Space')endPan();});document.defaultView?.addEventListener('blur',endPan);
 for(const [name,action] of Object.entries({inspect:()=>onInspect(selected[0]),edit:()=>{const s=selected[0];deactivate();onEdit(s);},group:()=>onGroup([...new Set(selected.map(s=>s.layer))]),attributes:()=>onAttributes(selected),convert:()=>onConvert(selected),export:()=>{
  const fc={type:'FeatureCollection',features:selected.filter(s=>s.index!==null).map(s=>structuredClone(s.layer.fc.features[s.index]))};const url=URL.createObjectURL(new Blob([JSON.stringify(fc)],{type:'application/geo+json'})),a=document.createElement('a');a.href=url;a.download='selected-features.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }}))q('[data-'+name+']').onclick=async()=>{try{await action();render();}catch(e){q('.error').textContent=e.message;notify(e.message);}};
 return {get active(){return active;},reset:deactivate,refresh:render,select(layer,index,event){if(!active||suppressClick)return;if(event?.shiftKey){const match=selected.findIndex(s=>s.layer===layer&&s.index===index);if(match>=0){selected.splice(match,1);render();}else apply([{layer,index}],true);}else apply([{layer,index}]);}};
}
