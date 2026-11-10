export function installMap3D({map,getLayers,getBasemap,acceptFeature,onPick,canOpen=()=>true,doc=document,toast=()=>{},loadScene=()=>import('./scene3d-renderer.js'),baseURL=import.meta.env?.BASE_URL||'/maps/'}){
 const area=doc.querySelector('.map-area'),root=doc.createElement('section');root.className='map-3d';root.hidden=true;root.setAttribute('aria-label','3D map');
 root.innerHTML='<div class="scene-3d-canvas"></div><div class="scene-3d-controls"><button type="button" data-fit>Fit layers</button><button type="button" data-top>Top view</button><label>Height offset (m)<input type="number" step="0.5" value="0" min="-10000" max="10000" aria-label="3D height offset in metres"></label><label>View<select data-imagery aria-label="3D basemap"><option value="satellite">Satellite</option><option value="project">Project basemap</option></select></label><select data-feature aria-label="Go to 3D feature"><option value="">Go to feature…</option></select><span class="scene-terrain">Loading terrain…</span></div><p class="scene-3d-help">Drag to pan · right-drag or Ctrl+drag to orbit · scroll to zoom · touch: one finger pans, two fingers tilt and zoom. Heights use source values; offset adjusts the displayed model. Draw and measure in 2D.</p><p class="scene-3d-status" role="status" hidden></p>';
 area.append(root);
 const toggle=doc.createElement('button');toggle.type='button';toggle.className='square map-dimension-toggle';toggle.textContent='3D';toggle.setAttribute('aria-label','Switch to 3D');toggle.title='Switch to 3D';(doc.querySelector('.map-navigation')||area).append(toggle);const layersButton=doc.createElement('button');layersButton.type='button';layersButton.className='scene-layer-toggle';layersButton.textContent='Layers';layersButton.hidden=true;layersButton.setAttribute('aria-expanded','false');layersButton.onclick=()=>{const show=doc.body.classList.toggle('scene3d-show-layers');layersButton.setAttribute('aria-expanded',String(show));};area.append(layersButton);
 const canvas=root.querySelector('.scene-3d-canvas'),status=root.querySelector('[role=status]'),terrain=root.querySelector('.scene-terrain'),offset=root.querySelector('input'),featureSelect=root.querySelector('[data-feature]'),imagery=root.querySelector('[data-imagery]');let engine=null,active=false,opening=false,destroyed=false,revision=0,refreshTimer=null,lastError='';
 const prohibited=['open-drawing','open-annotation','open-measure','open-compare','identify'];const previousDisabled=new Map();
 function report(message,error=false){status.textContent=message;status.hidden=!message;status.classList.toggle('error',error);if(error)lastError=message;}
 function buttons(){toggle.textContent=active||opening?'2D':'3D';toggle.title=active||opening?'Switch to 2D':'Switch to 3D';toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-pressed',String(active));}
 function controls(enabled){for(const id of prohibited){const b=doc.getElementById(id);if(!b)continue;if(!enabled){previousDisabled.set(b,b.disabled);b.disabled=true;}else{if(previousDisabled.has(b)){b.disabled=previousDisabled.get(b);previousDisabled.delete(b);}}}}
 async function refresh(){
  if(!active||!engine)return;
  engine.basemap(imagery.value==='project'?getBasemap():{type:'satellite'});lastError='';
  const current=engine;await engine.sync(getLayers(),{accept:acceptFeature,heightOffset:Number(offset.value)||0,onProgress:message=>{if(!lastError)report(message);}});
  if(active&&engine===current){refreshFeatures();root.dataset.ready='true';root.dataset.features=String(engine.stats.reduce((n,s)=>n+s.features,0));for(const key of ['polygons','lines','points'])root.dataset[key]=String(engine.stats.reduce((n,s)=>n+s[key],0));}
 }
 async function open(){
  if(active||opening)return;if(!canOpen()){toast('Finish or save the current drawing before opening 3D.');return;}
  opening=true;const ticket=++revision;buttons();root.hidden=false;report('Loading 3D map…');
  try{
   globalThis.CESIUM_BASE_URL=baseURL+'cesium/';
   if(!doc.querySelector('link[data-cesium-style]')){const style=doc.createElement('link');style.rel='stylesheet';style.href=globalThis.CESIUM_BASE_URL+'Widgets/widgets.css';style.dataset.cesiumStyle='true';doc.head.append(style);}
   const {createScene3D}=await loadScene();if(ticket!==revision||destroyed)return;
   const created=await createScene3D(canvas,{onPick,onTerrain:available=>{terrain.textContent=available?'Terrain · Esri World Elevation':'Terrain unavailable · WGS 84 ellipsoid';},onError:message=>report(message,true)});
   if(ticket!==revision||destroyed){created.destroy();return;}
   engine=created;active=true;layersButton.hidden=false;area.classList.add('is-3d');doc.body.classList.add('viewing-3d');controls(false);opening=false;buttons();
   engine.basemap(imagery.value==='project'?getBasemap():{type:'satellite'});const center=map.getCenter();engine.fit(getLayers(),{lng:center.lng,lat:center.lat,range:Math.max(200,40075000/2**map.getZoom()*2)});
   await refresh();if(active){engine.fit(getLayers(),{lng:center.lng,lat:center.lat,range:Math.max(200,40075000/2**map.getZoom()*2)});engine.resize();root.dataset.ready='true';root.dataset.features=String(engine.stats.reduce((n,s)=>n+s.features,0));for(const key of ['polygons','lines','points'])root.dataset[key]=String(engine.stats.reduce((n,s)=>n+s[key],0));}
  }catch(error){close();toast('3D could not start: '+error.message+'. You can continue in 2D.');}
  finally{if(ticket===revision){opening=false;buttons();}}
 }
 function close(){
  revision++;const center=engine?.center;active=false;opening=false;clearTimeout(refreshTimer);engine?.destroy();engine=null;canvas.replaceChildren();root.hidden=true;delete root.dataset.ready;area.classList.remove('is-3d');doc.body.classList.remove('viewing-3d','scene3d-show-layers');layersButton.hidden=true;layersButton.setAttribute('aria-expanded','false');controls(true);buttons();
  map.invalidateSize({pan:false});if(center)map.setView([center.lat,center.lng],Math.max(2,Math.min(20,Math.log2(40075000/Math.max(100,center.height)/2))),{animate:false});
 }
 function refreshFeatures(){
  const selected=featureSelect.value;featureSelect.replaceChildren();const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent='Go to feature…';featureSelect.append(placeholder);let count=0;
  for(const layer of getLayers())for(const [index,feature] of (layer.fc?.features||[]).entries()){
   if(count>=2000)break;if(acceptFeature&&!acceptFeature(layer,feature))continue;if(layer.metadata?.style?.useKMLStyle&&feature.properties?._fieldmaps_kml_visible===false)continue;
   const name=feature.properties?.Name||feature.properties?.name||feature.properties?.['KML folder']?.split(' / ').at(-1);if(!name)continue;const option=doc.createElement('option');option.value=JSON.stringify([layer.id,index]);option.textContent=String(name).slice(0,140);featureSelect.append(option);count++;
  }
  if([...featureSelect.options].some(o=>o.value===selected))featureSelect.value=selected;
 }
 featureSelect.onchange=()=>{if(!featureSelect.value)return;const [id,index]=JSON.parse(featureSelect.value),layer=getLayers().find(l=>l.id===id);if(layer?.fc?.features[index])engine?.focusFeature(layer,layer.fc.features[index]);};
 imagery.onchange=()=>{engine?.basemap(imagery.value==='project'?getBasemap():{type:'satellite'});};
 function schedule(){if(!active)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(error=>report(error.message,true)),150);}
 toggle.onclick=()=>{if(active||opening)close();else void open();};
 root.querySelector('[data-fit]').onclick=()=>engine?.fit(getLayers());root.querySelector('[data-top]').onclick=()=>engine?.top();offset.onchange=schedule;
 const resize=new ResizeObserver(()=>engine?.resize());resize.observe(area);
 return {open,close,refresh:schedule,fit:()=>engine?.fit(getLayers()),zoomLayer:layer=>engine?.fit([layer]),focus:(layer,feature)=>engine?.focusFeature(layer,feature),get active(){return active;},destroy(){destroyed=true;close();resize.disconnect();root.remove();toggle.remove();layersButton.remove();}};
}
