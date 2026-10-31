import {vectorStyle} from './layer-style.js';
import {mixedRoute} from './route-segments.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {lineDistanceText,bindLineDistance} from './line-distance.js';
import {measureDistance} from './explore-data.js';

export function openRoute({getLayers,canCreate,onResult,map,L,onlineRoute}){
 if(!canCreate())return;
 const layers=getLayers().filter(l=>l.fc?.features?.length&&l.fc.features.every(f=>['LineString','MultiLineString'].includes(f.geometry?.type)));
 const d=toolDialog('Route',`<p>Click the map to add your start, stops and destination. Drag a stop to move it. Hold Shift when adding a stop to draw that segment straight.</p><label>Routing<select name="routing"><option value="online">Online roads</option><option value="imported">Imported roads / tracks</option><option value="straight">Straight line</option></select></label><label data-online>Travel mode<select name="mode"><option value="driving">Driving</option><option value="cycling">Cycling</option><option value="walking">Walking</option></select></label><label data-imported hidden>Road / track layer<select name="source">${layers.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></label><small data-imported hidden>Uses shared road vertices, within 250 m of your two stops. Roads are treated as two-way; restrictions are not checked.</small><label data-online>Next segment<select name="next-leg"><option value="road">Follow roads</option><option value="straight">Straight line</option></select></label><div data-legs></div><output data-stops>Click the start position</output><div class="drawing-actions"><button type="button" data-undo>Undo stop</button><button type="button" data-clear>Clear</button><button type="button" data-calculate>Calculate route</button></div><label>Name<input name="name" value="Route" maxlength="160"></label><label>Colour<input name="color" type="color" value="#315d49"></label><label>Width<input name="width" type="range" min="1" max="12" value="4"></label><label>Opacity<input name="opacity" type="range" min="0" max="1" step="0.05" value="0.9"></label><label>Line pattern<select name="pattern"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label><label><input name="distance" type="checkbox" checked> Show distance</label><label><input name="endcaps" type="checkbox"> Show endpoints</label><output data-distance></output><small data-online>Online calculation sends only the chosen stops and travel mode to openrouteservice. Free-plan limits apply.</small><small data-online>© <a href="https://openrouteservice.org/" target="_blank" rel="noopener noreferrer">openrouteservice by HeiGIT</a> | © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · CC-BY-SA 4.0</small>`,{modal:false});
 d.classList.add('route-panel');const q=s=>d.querySelector(s);q('[type=submit]').textContent='Add route';q('[type=submit]').disabled=true;
 let points=[],legs=[],result=null,revision=0,closed=false,worker=null,cancelWorker=null,calculating=false,saving=false,timer=null;
 const cache=new Map();
 const routeRequest=async values=>{const key=JSON.stringify(values);if(cache.has(key))return structuredClone(cache.get(key));const value=await onlineRoute(values);if(!closed){if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,structuredClone(value));}return value;};
 const style=()=>({lineWidth:Number(q('[name=width]').value),lineStyle:q('[name=pattern]').value,distanceLabels:q('[name=distance]').checked,endCaps:q('[name=endcaps]').checked});
 const pane='route-preview';if(map.createPane){const p=map.getPane?.(pane)||map.createPane(pane);p.style.zIndex='649';}
 const preview=L.layerGroup().addTo(map),markers=L.layerGroup().addTo(map);
 function cancel(){clearTimeout(timer);revision++;worker?.terminate();worker=null;cancelWorker?.(Error('Route changed.'));cancelWorker=null;calculating=false;q('[data-calculate]').disabled=false;}
 function redraw(){
  q('[data-legs]').innerHTML=q('[name=routing]').value==='online'?legs.map((leg,i)=>`<label>Segment ${i+1} → ${i+2}<select data-leg="${i}"><option value="road" ${leg==='road'?'selected':''}>Follow roads</option><option value="straight" ${leg==='straight'?'selected':''}>Straight line</option></select></label>`).join(''):'';
  q('[data-legs]').querySelectorAll('select').forEach(select=>select.onchange=()=>{legs[Number(select.dataset.leg)]=select.value;changed();});
  preview.clearLayers();markers.clearLayers();q('[data-stops]').textContent=points.length?`${points.length} stops · click to add another`:'Click the start position';
  for(const [i,c] of points.entries()){
   const marker=L.marker([c[1],c[0]],{pane,draggable:!saving,icon:L.divIcon({className:'route-stop',html:String(i+1),iconSize:[24,24],iconAnchor:[12,12]})}).addTo(markers);
   marker.on('dragend',()=>{if(!canCreate()||saving||closed)return;const ll=marker.getLatLng();points[i]=[ll.lng,ll.lat];changed();});
  }
  if(result){L.geoJSON(result,{pane,interactive:false,onEachFeature:(f,l)=>bindLineDistance(l,f,style().distanceLabels),style:vectorStyle({color:q('[name=color]').value,opacity:Number(q('[name=opacity]').value),metadata:{style:style()}})}).addTo(preview);if(style().endCaps){const c=result.features[0].geometry.coordinates;for(const p of [c[0],c.at(-1)])L.circleMarker([p[1],p[0]],{pane,radius:5,color:q('[name=color]').value,weight:2,fillColor:'#fff',fillOpacity:Number(q('[name=opacity]').value),opacity:Number(q('[name=opacity]').value),interactive:false}).addTo(preview);}}
  q('[type=submit]').disabled=!result||calculating||saving;
  q('[data-distance]').textContent=result?lineDistanceText(result.features[0].geometry):'';
 }
 function changed(){cancel();result=null;q('.error').textContent='';redraw();if(points.length>=2&&q('[name=routing]').value!=='imported')timer=setTimeout(()=>q('[data-calculate]').click(),1800);}
 document.addEventListener('fieldmaps-units-change',redraw);
 const click=e=>{
  if(closed||saving||!canCreate())return;
  const max=q('[name=routing]').value==='imported'?2:25;
  if(points.length>=max){q('.error').textContent=`Use up to ${max} stops. Drag a stop to move it, or undo the last stop.`;return;}
  if(points.length)legs.push(q('[name=routing]').value==='online'&&(e.originalEvent?.shiftKey||q('[name=next-leg]').value==='straight')?'straight':'road');points.push([e.latlng.lng,e.latlng.lat]);changed();
 };
 map.on('click',click);
 q('[data-undo]').onclick=()=>{points.pop();legs.pop();changed();};q('[data-clear]').onclick=()=>{points=[];legs=[];changed();};
 q('[name=routing]').onchange=()=>{const online=q('[name=routing]').value==='online';d.querySelectorAll('[data-online]').forEach(e=>e.hidden=!online);d.querySelectorAll('[data-imported]').forEach(e=>e.hidden=q('[name=routing]').value!=='imported');changed();};
 q('[name=mode]').onchange=changed;q('[name=source]').onchange=changed;for(const name of ['color','width','opacity','pattern','distance','endcaps'])q('[name='+name+']').oninput=redraw;
 function imported(source){return new Promise((resolve,reject)=>{cancelWorker=reject;worker=new Worker(new URL('./analysis-worker.js',import.meta.url),{type:'module'});worker.onerror=e=>reject(Error(e.message||'Route calculation failed.'));worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);worker.postMessage({operation:'route',source:source.fc,origin:points[0],destination:points[1]});});}
 q('[data-calculate]').onclick=async()=>{
  if(calculating||saving||!canCreate())return;clearTimeout(timer);result=null;q('[type=submit]').disabled=true;q('.error').textContent='';
  if(points.length<2){q('.error').textContent='Click at least a start and destination on the map.';return;}
  const token=++revision;calculating=true;q('[data-calculate]').disabled=true;q('[data-distance]').textContent='Calculating…';
  try{
   let next;
   if(q('[name=routing]').value==='online'){
    if(!onlineRoute&&legs.some(l=>l!=='straight'))throw Error('Online routing has not been connected yet.');
    next=await mixedRoute(structuredClone(points),[...legs],q('[name=mode]').value,routeRequest,()=>!closed&&token===revision&&canCreate());
   }else if(q('[name=routing]').value==='straight'){next={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:structuredClone(points)},properties:{method:'Straight line',distance_m:measureDistance(points)}}]};
   }else{
    if(points.length!==2)throw Error('Imported-track routing uses two stops. Clear the extra stops first.');
    const source=layers.find(l=>l.id===q('[name=source]').value);if(!source)throw Error('Import a road or track line layer first.');
    next=await imported(source);
   }
   if(closed||token!==revision)return;if(!canCreate())throw Error('Project access changed. Reopen Route in the correct project.');
   if(next?.type!=='FeatureCollection'||!next.features?.length)throw Error('No route was returned.');
   result=next;
  }catch(e){if(!closed&&token===revision)q('.error').textContent=canCreate()?e.message:'Project access changed. Reopen Route in the correct project.';}
  finally{if(!closed&&token===revision){worker?.terminate();worker=null;cancelWorker=null;calculating=false;q('[data-calculate]').disabled=false;redraw();}}
 };
 q('form').onsubmit=async e=>{e.preventDefault();if(!result||calculating||saving||!canCreate())return;saving=true;d.inert=true;try{await onResult(result,q('[name=name]').value.trim()||'Route',{color:q('[name=color]').value,opacity:Number(q('[name=opacity]').value),metadata:{style:style(),routing:{waypoints:structuredClone(points),segments:q('[name=routing]').value==='online'?[...legs]:points.slice(1).map(()=>q('[name=routing]').value),mode:q('[name=routing]').value==='online'?q('[name=mode]').value:q('[name=routing]').value}}});d.close();}catch(error){q('.error').textContent=error.message;}finally{saving=false;d.inert=false;}};
 d.addEventListener('close',()=>{closed=true;document.removeEventListener('fieldmaps-units-change',redraw);cache.clear();cancel();map.off('click',click);map.removeLayer(preview);map.removeLayer(markers);});return d;
}
