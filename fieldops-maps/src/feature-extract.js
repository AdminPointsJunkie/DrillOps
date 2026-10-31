import {escapeHTML} from './explore-dialogs.js';

// Extract is a copy operation. Keep multipart geometry, holes and attributes intact.
export function extractedFeature(feature){
 if(!feature?.geometry)throw Error('Select a point, line or shape on the map.');
 const copy=structuredClone(feature);delete copy.id;if(copy.properties)delete copy.properties._fieldmaps_group;return copy;
}
export function installFeatureExtract({L,map,canCreate,onResult,notify}){
 const pane=map.createPane('feature-extract');pane.style.zIndex='649';pane.style.pointerEvents='none';
 const panel=document.createElement('section');panel.className='field-tools-panel';panel.hidden=true;
 panel.setAttribute('aria-label','Extract feature');
 panel.innerHTML='<div class="info-heading"><strong>Extract</strong><button data-close aria-label="Close Extract">×</button></div><p>Click an existing point, line or shape to copy it. Its original layer stays unchanged.</p><label>Name<input data-name maxlength="160" value="Extracted feature"></label><div data-selected>No feature selected</div><p class="error" role="alert"></p><button data-copy class="primary" disabled>Create editable copy</button>';
 document.querySelector('.map-area').append(panel);
 let selected=null,preview=null,saving=false,generation=0;
 const q=s=>panel.querySelector(s);
 function clearPreview(){if(preview)map.removeLayer(preview);preview=null;}
 function reset(){generation++;clearPreview();selected=null;saving=false;panel.hidden=true;panel.inert=false;q('[data-copy]').disabled=true;q('.error').textContent='';}
 q('[data-close]').onclick=()=>{if(!saving)reset();};
 q('[data-copy]').onclick=async()=>{
  if(!selected||saving||!canCreate())return;
  const token=generation;saving=true;panel.inert=true;
  try{await onResult({type:'FeatureCollection',features:[extractedFeature(selected)]},q('[data-name]').value.trim()||'Extracted feature');if(token===generation){reset();notify('Editable copy added. The source feature is unchanged.');}}
  catch(e){if(token===generation)q('.error').textContent=e.message;}
  finally{if(token===generation){saving=false;panel.inert=false;}}
 };
 return {get active(){return !panel.hidden;},reset,open(){if(!canCreate())return;reset();panel.hidden=false;q('[data-selected]').textContent='No feature selected';},select(layer,feature){
  if(panel.hidden||saving||!canCreate())return;
  try{selected=extractedFeature(feature);clearPreview();preview=L.geoJSON(selected,{pane:'feature-extract',style:{color:'#eaa51d',weight:4,fillOpacity:.15},pointToLayer:(_f,ll)=>L.circleMarker(ll,{pane:'feature-extract',interactive:false,radius:9,color:'#eaa51d',fillOpacity:.5}),interactive:false}).addTo(map);
   q('[data-name]').value=String(feature.properties?.name||layer.name||'Extracted feature').slice(0,160);
   q('[data-selected]').innerHTML=`<strong>${escapeHTML(layer.name)}</strong><br>${escapeHTML(feature.geometry.type)} · original geometry and attributes`;
   q('[data-copy]').disabled=false;
  }catch(e){q('.error').textContent=e.message;}
 }};
}
