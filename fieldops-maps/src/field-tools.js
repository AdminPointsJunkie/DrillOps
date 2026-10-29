import {measureDistance,measureArea,distanceText,areaText,featureBounds} from './explore-data.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export const annotationTypes={note:'Note',marker:'Marker',highlighter:'Highlighter',text:'Text',link:'Link',video:'Video',arrow:'Access arrow',polygon:'Instruction area'};
const pointAnnotation=type=>['note','text','link','video'].includes(type);
export function annotationURL(value){
 let url;try{url=new URL(String(value).trim());}catch{throw Error('Enter a complete https:// link.');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Use an http or https link without embedded credentials.');
 return url.href;
}
export function annotationFeature(type,coordinates,note,options={}){
 if(!Object.hasOwn(annotationTypes,type))throw Error('Choose a supported annotation type.');
 const points=coordinates.map(c=>c.slice(0,2));
 if(points.length>1000)throw Error('Use up to 1,000 positions per annotation.');
 if(points.some(c=>c.length!==2||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90))throw Error('Invalid annotation coordinates.');
 if(points.length<(pointAnnotation(type)?1:type==='polygon'?3:2))throw Error(pointAnnotation(type)?'Click a position for the annotation.':type==='polygon'?'Click at least three positions for the area.':'Click at least two positions for the line.');
 const geometry=pointAnnotation(type)?{type:'Point',coordinates:points[0]}:type!=='polygon'?{type:'LineString',coordinates:points}:{type:'Polygon',coordinates:[[...points,points[0]]]};
 if(type==='polygon'&&measureArea(points)<.01)throw Error('The area needs at least three distinct, non-collinear positions.');
 if(type==='polygon'){
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const between=(a,b,c)=>c[0]>=Math.min(a[0],b[0])&&c[0]<=Math.max(a[0],b[0])&&c[1]>=Math.min(a[1],b[1])&&c[1]<=Math.max(a[1],b[1]);
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
   if(j===i+1||(i===0&&j===points.length-1))continue;
   const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length],ab=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
   if((ab*ad<0&&ca*cb<0)||(ab===0&&between(a,b,c))||(ad===0&&between(a,b,d))||(ca===0&&between(c,d,a))||(cb===0&&between(c,d,b)))throw Error('Area edges cross. Undo positions or redraw the boundary.');
  }
 }
 if(['arrow','marker','highlighter'].includes(type)&&measureDistance(points)<.01)throw Error('The arrow needs distinct positions.');
 return {type:'Feature',geometry,properties:{note,...(['link','video'].includes(type)?{url:annotationURL(options.url)}:{})}};
}
export function annotationLayer(L,layer,{pane,onClick=()=>{}}={}){
 const config=layer.metadata.annotation,colour=/^#[\da-f]{6}$/i.test(layer.color)?layer.color:'#315d49';
 const base=L.geoJSON(layer.fc,{pane,style:{color:colour,weight:config.type==='highlighter'?12:3,fillColor:colour,fillOpacity:.15*(layer.opacity??.85),opacity:config.type==='highlighter'?.35*(layer.opacity??.85):layer.opacity??.85,lineCap:'round',lineJoin:'round'},pointToLayer:(_f,ll)=>{
  if(['link','video'].includes(config.type))return L.marker(ll,{pane,opacity:layer.opacity??.85,icon:L.divIcon({className:'annotation-symbol',iconSize:[30,36],iconAnchor:[15,34],html:`<span style="background:${colour}">${config.type==='video'?'▶':config.type==='link'?'↗':'●'}</span>`})});
  return L.circleMarker(ll,{pane,radius:config.type==='text'?0:6,color:colour,fillColor:colour,fillOpacity:layer.opacity??.85,opacity:config.type==='text'?0:layer.opacity??.85});
 },onEachFeature:(f,l)=>{
  const text=document.createElement('span');text.textContent=f.properties?.note||layer.name;if(config.type==='text')text.style.color=colour;
  l.bindTooltip(text,{permanent:config.type!=='highlighter',direction:config.type==='text'?'center':'top',className:config.type==='text'?'annotation-label annotation-text':'annotation-label',pane,interactive:config.type==='text'});
  if(['link','video'].includes(config.type)){
   const content=document.createElement('div'),title=document.createElement('strong');title.textContent=layer.name;content.append(title);
   try{const url=annotationURL(f.properties?.url),anchor=document.createElement('a');anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent=config.type==='video'?'Open video ↗':'Open link ↗';content.append(document.createElement('br'),anchor);
    if(config.type==='video'&&/\.(mp4|webm|ogv)$/i.test(new URL(url).pathname)){const player=document.createElement('video');player.controls=true;player.preload='none';player.src=url;player.style.cssText='display:block;width:260px;max-width:100%;margin:10px 0';content.append(player);l.on('popupclose',()=>player.pause());}
   }catch{content.append(' Link unavailable.');}l.bindPopup(content,{maxWidth:300});
  }
  l.on('click',()=>onClick(f));
 }});
 if(config.type==='arrow')for(const f of layer.fc.features){const c=f.geometry.coordinates,a=c[c.length-2],b=c.at(-1);if(!a||!b)continue;const radians=Math.PI/180,dy=Math.log(Math.tan(Math.PI/4+b[1]*radians/2))-Math.log(Math.tan(Math.PI/4+a[1]*radians/2)),dx=(b[0]-a[0])*radians,rotation=Math.atan2(dx,dy)*180/Math.PI;const colour=/^#[\da-f]{6}$/i.test(layer.color)?layer.color:'#ce6359';L.marker([b[1],b[0]],{pane,interactive:false,opacity:layer.opacity??.85,icon:L.divIcon({className:'annotation-arrow',iconSize:[24,24],iconAnchor:[12,12],html:`<span style="color:${colour};transform:rotate(${rotation}deg)">▲</span>`})}).addTo(base);}
 return base;
}
export function editAnnotation(layer,{save,remove,canAnnotate}){
 if(!canAnnotate())return;
 const d=toolDialog('Edit annotation',`<label>Name<input name="name" required maxlength="160" value="${esc(layer.name)}"></label><label>Instruction / note<textarea name="note" required maxlength="1000">${esc(layer.fc.features[0]?.properties?.note||'')}</textarea></label>${['link','video'].includes(layer.metadata.annotation.type)?`<label>URL<input name="url" type="url" required value="${esc(layer.fc.features[0]?.properties?.url||'')}"></label>`:''}<label>Colour<input name="color" type="color" value="${esc(layer.color)}"></label><button type="button" data-delete>Delete annotation…</button>`),form=d.querySelector('form');
 form.onsubmit=async e=>{e.preventDefault();if(!canAnnotate())return;const button=form.querySelector('[type=submit]');button.disabled=true;try{await save(layer,{name:form.elements.name.value.trim(),note:form.elements.note.value.trim(),color:form.elements.color.value,...(form.elements.url?{url:annotationURL(form.elements.url.value)}:{})});d.close();}catch(error){d.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}};
 d.querySelector('[data-delete]').onclick=async()=>{if(!canAnnotate()||!window.confirm(`Delete annotation “${layer.name}”? The last SYNC version stays unchanged until you SYNC again.`))return;try{await remove(layer);d.close();}catch(error){d.querySelector('.error').textContent=error.message;}};return d;
}
export function installFieldTools({L,map,canAnnotate,hasProject,onAnnotation,notify}){
 const root=document.querySelector('.map-area');root.insertAdjacentHTML('beforeend',`<section class="field-tools-panel" hidden aria-label="Draw and measure"><div class="info-heading"><strong data-tool-title></strong><button data-tool-close aria-label="Close drawing tool">×</button></div><label>Tool<select data-tool-type></select></label><div data-annotation-fields><label>Name<input data-annotation-name maxlength="160" placeholder="e.g. South access"></label><label>Instruction / note<textarea data-annotation-note maxlength="1000" placeholder="Enter from the south gate"></textarea></label><label data-url-field hidden>URL<input type="url" data-annotation-url placeholder="https://…"><small>Links open in a new tab. Direct MP4, WebM and OGV links also play on the map.</small></label><label>Colour<input type="color" data-annotation-color value="#ce6359"></label></div><p data-tool-help>Click the map to add positions. Drag to pan.</p><output data-measure-result role="status"></output><p data-tool-error class="error" role="alert"></p><div class="drawing-actions"><button data-tool-undo>Undo point</button><button data-tool-finish class="primary">Finish</button><button data-tool-new>Clear / restart</button></div><small data-measure-note>Approximate horizontal distances and areas; terrain and RL are not included.</small></section>`);
 const panel=root.querySelector('.field-tools-panel'),q=s=>panel.querySelector(s);let mode='measure',points=[],overlay=null,drawing=false,saving=false,stroke=false,draggingBefore=false;
 const type=()=>q('[data-tool-type]').value;
 function clear(){stopStroke();if(overlay)map.removeLayer(overlay);overlay=null;points=[];q('[data-measure-result]').textContent='';q('[data-tool-error]').textContent='';}
 function finishDrawing(){stopStroke();drawing=false;root.classList.remove('drawing-map','annotation-selecting');}
 function start(){clear();drawing=true;root.classList.add('drawing-map');}
 function render(){if(overlay)map.removeLayer(overlay);const ll=points.map(([lng,lat])=>[lat,lng]),colour=mode==='measure'?'#3087ba':q('[data-annotation-color]').value;
  overlay=L.layerGroup().addTo(map);if(ll.length>1)(['area','polygon'].includes(type())&&ll.length>2?L.polygon(ll,{color:colour,weight:2,fillOpacity:.12,interactive:false}):L.polyline(ll,{color:colour,weight:type()==='highlighter'?12:3,opacity:type()==='highlighter'?.35:1,interactive:false})).addTo(overlay);for(const p of (['marker','highlighter'].includes(type())?[]:ll))L.circleMarker(p,{radius:4,color:colour,fillOpacity:1,interactive:false}).addTo(overlay);
  q('[data-measure-result]').textContent=['area','polygon'].includes(type())?areaText(measureArea(points)):pointAnnotation(type())?`${points.length?1:0} annotation position`:distanceText(measureDistance(points));
 }
 map.on('click',e=>{if(!drawing||saving||e.originalEvent?.shiftKey||['marker','highlighter'].includes(type()))return;if(pointAnnotation(type()))points=[];points.push([e.latlng.lng,e.latlng.lat]);render();});
 function chooseType(){q('[data-url-field]').hidden=!['link','video'].includes(type());q('[data-tool-help]').textContent=pointAnnotation(type())?'Click the map to place this annotation.':['marker','highlighter'].includes(type())?'Drag on the map to draw. Hold Shift to pan. Save annotation when finished.':'Click the map to add positions. Drag to pan.';start();}
 const canvas=map.getContainer?.();
 function selectionCursor(e){if(drawing)root.classList.toggle('annotation-selecting',!!e.shiftKey);}
 document.addEventListener('keydown',selectionCursor);document.addEventListener('keyup',selectionCursor);
 document.defaultView?.addEventListener('blur',()=>{root.classList.remove('annotation-selecting');stopStroke();});
 function stopStroke(){if(stroke&&draggingBefore)map.dragging?.enable();stroke=false;}
 canvas?.addEventListener('pointerdown',e=>{if(!drawing||saving||!['marker','highlighter'].includes(type())||e.shiftKey||e.button!==0)return;if(points.length){q('[data-tool-error]').textContent='Save this stroke or clear it before drawing another.';return;}e.preventDefault();stroke=true;draggingBefore=!!map.dragging?.enabled();map.dragging?.disable();canvas.setPointerCapture?.(e.pointerId);const p=map.mouseEventToLatLng(e);points.push([p.lng,p.lat]);render();});
 canvas?.addEventListener('pointermove',e=>{if(!stroke||points.length>=1000)return;const p=map.mouseEventToLatLng(e),last=points.at(-1);if(last[0]!==p.lng||last[1]!==p.lat){points.push([p.lng,p.lat]);render();}});
 canvas?.addEventListener('pointerup',stopStroke);canvas?.addEventListener('pointercancel',stopStroke);
 q('[data-tool-type]').onchange=chooseType;q('[data-annotation-color]').oninput=render;
 q('[data-tool-undo]').onclick=()=>{if(saving)return;points.pop();render();};q('[data-tool-new]').onclick=()=>{if(!saving)start();};
 q('[data-tool-close]').onclick=()=>{if(saving)return;clear();finishDrawing();panel.hidden=true;};
 q('[data-tool-finish]').onclick=async()=>{
  if(saving)return;q('[data-tool-error]').textContent='';
  try{
   if(mode==='measure'){if(points.length<(type()==='area'?3:2))throw Error('Add more positions before finishing.');finishDrawing();return;}
   if(!canAnnotate())throw Error('Only admins can save annotations.');
   const name=q('[data-annotation-name]').value.trim(),note=q('[data-annotation-note]').value.trim();if(!name||!note)throw Error('Enter a name and instruction / note.');
   const feature=annotationFeature(type(),points,note,{url:q('[data-annotation-url]').value});saving=true;q('[data-tool-finish]').disabled=true;
   await onAnnotation({name,color:q('[data-annotation-color]').value,type:type(),feature,bounds:featureBounds(feature)});clear();finishDrawing();panel.hidden=true;
  }catch(error){q('[data-tool-error]').textContent=error.message;}finally{saving=false;q('[data-tool-finish]').disabled=false;}
 };
 return {get drawing(){return drawing;},get pending(){return saving||(!panel.hidden&&mode==='annotation'&&points.length>0);},open(next,selected='note'){if(saving)return;if(drawing&&points.length)return notify('Save or clear the current drawing first.');if(next==='annotation'&&(!canAnnotate()||!hasProject()))return notify('An admin must select a saved project before adding annotations.');mode=next;panel.hidden=false;q('[data-tool-title]').textContent=mode==='measure'?'Measure':'Add annotation';q('[data-annotation-fields]').hidden=mode!=='annotation';q('[data-measure-note]').hidden=mode!=='measure';q('[data-tool-type]').innerHTML=(mode==='measure'?[['distance','Distance / track length'],['area','Area']]:Object.entries(annotationTypes)).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');q('[data-tool-finish]').textContent=mode==='measure'?'Finish measurement':'Save annotation';q('[data-annotation-name]').value='';q('[data-annotation-note]').value='';q('[data-annotation-url]').value='';if(next==='annotation'&&Object.hasOwn(annotationTypes,selected))q('[data-tool-type]').value=selected;q('[data-annotation-color]').value=selected==='highlighter'?'#e4b73c':'#ce6359';chooseType();},reset(){clear();finishDrawing();panel.hidden=true;}};
}
