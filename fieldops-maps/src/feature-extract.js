import {loadLibrary,loadLocalBoundaries} from './public-data.js';
import {escapeHTML} from './explore-dialogs.js';

// Extract is a copy operation. Keep multipart geometry, holes and attributes intact.
export function extractedFeature(feature){
 if(!feature?.geometry)throw Error('Select a point, line or shape on the map.');
 const copy=structuredClone(feature);delete copy.id;if(copy.properties)delete copy.properties._fieldmaps_group;return copy;
}
export function installFeatureExtract({L,map,canCreate,onResult,notify,getScope=()=>null}){
 const pane=map.createPane('feature-extract');pane.style.zIndex='649';pane.style.pointerEvents='none';const boundaryPane=map.getPane?.('boundary-extract')||map.createPane('boundary-extract');boundaryPane.style.zIndex='648';
 const panel=document.createElement('section');panel.className='field-tools-panel';panel.hidden=true;
 panel.setAttribute('aria-label','Extract feature');
 panel.innerHTML='<div class="info-heading"><strong>Extract</strong><button data-close aria-label="Close Extract">×</button></div><label>Source<select data-source><option value="existing">Existing map features</option><option value="auto">Boundaries for this zoom</option><option value="countries">Countries</option><option value="states">States / provinces</option><option value="local">Local administrative areas</option><option value="buildings">Buildings</option></select></label><p data-instructions>Click an existing point, line or shape to copy it. Its original layer stays unchanged.</p><button type="button" data-load hidden>Load boundaries in this view</button><small data-source-note></small><label>Name<input data-name maxlength="160" value="Extracted feature"></label><div data-selected>No feature selected</div><p class="error" role="alert"></p><button data-copy class="primary" disabled>Create editable copy</button>';
 document.querySelector('.map-area').append(panel);
 let selected=null,preview=null,saving=false,generation=0,boundaries=null,abort=null,scope=null;
 const q=s=>panel.querySelector(s);
 function clearPreview(){if(preview)map.removeLayer(preview);preview=null;}
 function reset(){generation++;abort?.abort();abort=null;if(boundaries)map.removeLayer(boundaries);boundaries=null;clearPreview();selected=null;saving=false;panel.hidden=true;panel.inert=false;q('[data-load]').disabled=false;q('[data-copy]').disabled=true;q('.error').textContent='';}
 q('[data-close]').onclick=()=>{if(!saving)reset();};
 q('[data-copy]').onclick=async()=>{
  if(!selected||saving||!canCreate())return;if(scope!==getScope()){q('.error').textContent='The project changed. Reopen Extract.';return;}
  const token=generation;saving=true;panel.inert=true;
  try{await onResult({type:'FeatureCollection',features:[extractedFeature(selected)]},q('[data-name]').value.trim()||'Extracted feature');if(token===generation){reset();notify('Editable copy added. The source feature is unchanged.');}}
  catch(e){if(token===generation)q('.error').textContent=e.message;}
  finally{if(token===generation){saving=false;panel.inert=false;}}
 };
 const api={get active(){return !panel.hidden;},reset,open(){if(!canCreate())return;reset();scope=getScope();panel.hidden=false;q('[data-selected]').textContent='No feature selected';},select(layer,feature){
  if(panel.hidden||saving||!canCreate())return;
  try{selected=extractedFeature(feature);clearPreview();preview=L.geoJSON(selected,{pane:'feature-extract',style:{color:'#eaa51d',weight:4,fillOpacity:.15},pointToLayer:(_f,ll)=>L.circleMarker(ll,{pane:'feature-extract',interactive:false,radius:9,color:'#eaa51d',fillOpacity:.5}),interactive:false}).addTo(map);
   q('[data-name]').value=String(feature.properties?.name||layer.name||'Extracted feature').slice(0,160);
   q('[data-selected]').innerHTML=`<strong>${escapeHTML(layer.name)}</strong><br>${escapeHTML(feature.geometry.type)} · original geometry and attributes`;
   q('[data-copy]').disabled=false;
  }catch(e){q('.error').textContent=e.message;}
 }};
 q('[data-source]').onchange=()=>{generation++;abort?.abort();if(boundaries)map.removeLayer(boundaries);boundaries=null;selected=null;clearPreview();q('[data-copy]').disabled=true;q('[data-selected]').textContent='No feature selected';q('.error').textContent='';const existing=q('[data-source]').value==='existing';q('[data-load]').hidden=existing;q('[data-load]').disabled=false;q('[data-instructions]').textContent=existing?'Click an existing point, line or shape to copy it. Its original layer stays unchanged.':'Load boundaries, hover to highlight, then click one to select an editable copy.';q('[data-source-note]').textContent=existing?'':'Countries/states: Natural Earth, public domain, generalised with limited state coverage. Local areas/buildings: © OpenStreetMap contributors, ODbL. Loading sends this map view to the free boundary service. Coverage varies; these are not cadastral survey boundaries.';};
 q('[data-load]').onclick=async()=>{
  const token=++generation;abort?.abort();abort=new AbortController();const signal=abort.signal;q('[data-load]').disabled=true;q('.error').textContent='';selected=null;clearPreview();q('[data-copy]').disabled=true;if(boundaries)map.removeLayer(boundaries);boundaries=null;
  try{let kind=q('[data-source]').value;if(kind==='auto'){const z=map.getZoom();kind=z<5?'countries':z<8?'states':z<15?'local':'buildings';}
   const b=map.getBounds();const fc=['countries','states'].includes(kind)?await loadLibrary(kind,{signal}):await loadLocalBoundaries(kind,[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],{signal:AbortSignal.any([signal,AbortSignal.timeout(35000)])});
   if(token!==generation||panel.hidden)return;if(scope!==getScope()||!canCreate())throw Error('The project changed. Reopen Extract.');
   q('[data-selected]').textContent=fc.features.length?`${fc.features.length} ${kind} loaded. Hover and click a boundary.`:'No complete boundaries found here. Try another source or area.';
   boundaries=L.geoJSON(fc,{pane:'boundary-extract',style:{color:'#617c91',weight:1,fillOpacity:.06},onEachFeature:(feature,shape)=>{const title=document.createElement('span');title.textContent=String(feature.properties?.name||'Boundary');shape.bindTooltip(title);shape.on('mouseover',()=>shape.setStyle({color:'#eaa51d',weight:3,fillOpacity:.2}));shape.on('mouseout',()=>shape.setStyle({color:'#617c91',weight:1,fillOpacity:.06}));shape.on('click',()=>{if(scope===getScope())api.select({name:feature.properties?.name||kind},feature);});}}).addTo(map);
  }catch(error){if(token===generation&&!signal.aborted)q('.error').textContent=error.message;}finally{if(token===generation)q('[data-load]').disabled=false;}
 };
 return api;
}
