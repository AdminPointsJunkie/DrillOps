import {availableImagery} from './imagery.js';
import * as C from 'cesium';
import {geometryParts,sourceGeometry,triangulateFace,heightMode,ecef,coordinateList,coordinateKey,displayedFeatures} from './scene3d-model.js';
import {vectorStyle,layerStyle} from './layer-style.js';
const terrainURL='https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';
const imageryURL='https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const escapeCredit=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colour=(value,alpha=1)=>C.Color.fromCssColorString(value||'#147d72').withAlpha(Math.max(0,Math.min(1,alpha)));
export async function createScene3D(container,{onPick,onTerrain,onError}={}){
 const viewer=new C.Viewer(container,{baseLayer:false,baseLayerPicker:false,animation:false,timeline:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,requestRenderMode:true,maximumRenderTimeChange:Infinity,terrainProvider:new C.EllipsoidTerrainProvider(),contextOptions:{webgl:{preserveDrawingBuffer:true}}});
 viewer.scene.screenSpaceCameraController.tiltEventTypes=[C.CameraEventType.RIGHT_DRAG,{eventType:C.CameraEventType.LEFT_DRAG,modifier:C.KeyboardEventModifier.CTRL},C.CameraEventType.PINCH];
 viewer.scene.screenSpaceCameraController.zoomEventTypes=[C.CameraEventType.WHEEL,C.CameraEventType.PINCH];
 viewer.scene.globe.depthTestAgainstTerrain=true;viewer.scene.globe.baseColor=C.Color.fromCssColorString('#dce2dc');
 viewer.scene.backgroundColor=C.Color.fromCssColorString('#101b25');viewer.scene.highDynamicRange=false;
 let destroyed=false,terrainReady=false,generation=0,basemapKey='',baseImagery=null,offset=0;const cache=new Map(),terrainHeights=new Map();
 const handler=new C.ScreenSpaceEventHandler(viewer.scene.canvas);
 handler.setInputAction(event=>{const picked=viewer.scene.pick(event.position),id=picked?.id;if(id?.feature&&id?.layer)onPick?.(id.layer,id.feature);},C.ScreenSpaceEventType.LEFT_CLICK);
 const terrainPromise=(async()=>{
  try{
   const provider=await C.ArcGISTiledElevationTerrainProvider.fromUrl(terrainURL);
   if(destroyed)return;viewer.terrainProvider=provider;terrainReady=true;onTerrain?.(true);viewer.scene.requestRender();
  }catch(error){if(!destroyed){onTerrain?.(false);onError?.('Terrain could not load. The globe is using the WGS 84 ellipsoid.');}}
 })();
 function basemap(state={type:'satellite'}){
  const key=JSON.stringify(state);if(key===basemapKey)return;basemapKey=key;if(baseImagery){viewer.imageryLayers.remove(baseImagery,true);baseImagery=null;}
  let url=imageryURL,credit='Tiles © Esri, Vantor, Earthstar Geographics and the GIS User Community',maximumLevel=19;
  if(state.type==='solid'){viewer.scene.globe.baseColor=colour(state.color||'#e8e8e8');viewer.scene.requestRender();return;}
  if(state.type==='street'){url='https://tile.openstreetmap.org/{z}/{x}/{y}.png';credit='© OpenStreetMap contributors';}
  if(['light','dark'].includes(state.type)){url=`https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${state.type==='dark'?'Dark':'Light'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`;maximumLevel=16;}
  if(state.type==='custom'&&state.custom){url=state.custom.url.replace('{r}','');credit=escapeCredit(state.custom.attribution);maximumLevel=state.custom.maxZoom;}
  const provider=new C.UrlTemplateImageryProvider({url,credit,maximumLevel});
  if(url===imageryURL)provider.requestImage=(x,y,z)=>availableImagery({x,y,z}).then(tile=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.getContext('2d').drawImage(tile.image,tile.sx,tile.sy,tile.width,tile.height,0,0,256,256);return canvas;});
  baseImagery=viewer.imageryLayers.addImageryProvider(provider,0);viewer.scene.requestRender();
 }
 async function groundHeights(layer,entries,ticket){
  const missing=new Map();for(const {feature} of entries)if(heightMode(layer,feature)!=='absolute')for(const c of coordinateList(feature))if(!terrainHeights.has(coordinateKey(c)))missing.set(coordinateKey(c),C.Cartographic.fromDegrees(c[0],c[1]));
  if(!missing.size)return;
  await terrainPromise;if(ticket!==generation||destroyed)return;
  if(!terrainReady)throw Error('This layer needs ground heights. Retry when terrain is available, or use 2D.');
  const pairs=[...missing];for(let i=0;i<pairs.length;i+=2000){
   const batch=pairs.slice(i,i+2000),samples=await C.sampleTerrain(viewer.terrainProvider,16,batch.map(([,p])=>p));
   if(ticket!==generation||destroyed)return;
   for(let j=0;j<batch.length;j++){if(!Number.isFinite(samples[j].height))throw Error('Terrain heights are unavailable for part of this layer.');terrainHeights.set(batch[j][0],samples[j].height);}
  }
 }
 function remove(record){if(record?.root&&!record.root.isDestroyed())viewer.scene.primitives.remove(record.root);if(record?.imagery)viewer.imageryLayers.remove(record.imagery,true);}
 async function buildLayer(layer,entries,ticket){
  if(layer.kind==='raster'||layer.metadata?.xyz){
   let provider;
   if(layer.metadata?.xyz){const s=layer.metadata.xyz;provider=new C.UrlTemplateImageryProvider({url:s.url.replace('{r}',''),credit:escapeCredit(s.attribution),maximumLevel:s.maxZoom});}
   else if(layer.url&&layer.bounds){const [w,s,e,n]=layer.bounds;provider=await C.SingleTileImageryProvider.fromUrl(layer.url,{rectangle:C.Rectangle.fromDegrees(w,s,e,n)});}
   if(!provider)return {};
   if(ticket!==generation||destroyed)return {};
   const imagery=viewer.imageryLayers.addImageryProvider(provider);imagery.alpha=layer.opacity??.8;return {imagery};
  }
  if(entries.reduce((n,{feature})=>n+coordinateList(feature).length,0)>1000000)throw Error('This layer exceeds one million 3D vertices. Hide it or split it into smaller layers.');
  await groundHeights(layer,entries,ticket);if(ticket!==generation||destroyed)return {};
  const root=new C.PrimitiveCollection(),points=root.add(new C.PointPrimitiveCollection()),labels=root.add(new C.LabelCollection()),lineInstances=[],faceInstances=[],edgeInstances=[];
  let polygons=0,lines=0,pointCount=0;
  try{
   for(let fi=0;fi<entries.length;fi++){
    const {feature,index}=entries[fi],pick={layer,feature,index},style=vectorStyle(layer,feature),mode=heightMode(layer,feature),meshPositions=[],meshIndices=[],edgePositions=[],edgeIndices=[];
    const position=c=>ecef([c[0],c[1],(mode==='absolute'?(c[2]||0):terrainHeights.get(coordinateKey(c))+(mode==='relative'?(c[2]||0):0))+offset]);
    const cartesian=c=>C.Cartesian3.fromArray(position(c));
    function line(coords){if(coords.length<2)return;lines++;lineInstances.push(new C.GeometryInstance({id:pick,geometry:new C.PolylineGeometry({positions:coords.map(cartesian),width:Math.max(1,style.weight||1),vertexFormat:C.PolylineColorAppearance.VERTEX_FORMAT,arcType:C.ArcType.NONE}),attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(colour(style.color,style.opacity))}}));}
    const parts=geometryParts(sourceGeometry(feature));
    for(const part of parts){
     if(part.type==='Point'){pointCount++;points.add({id:pick,position:cartesian(part.coordinates),pixelSize:Math.max(4,layerStyle(layer).pointSize*.7),color:colour(feature.properties?.['icon-color']||style.fillColor,style.opacity),outlineColor:C.Color.WHITE,outlineWidth:1});}
     if(part.type==='LineString')line(part.coordinates);
     if(part.type==='Polygon'){
      polygons++;
      if(style.fillOpacity>0){const face=triangulateFace(part.coordinates,position),start=meshPositions.length/3;meshPositions.push(...face.positions);meshIndices.push(...face.indices.map(i=>i+start));}
      if(feature.properties?.['stroke-opacity']!==0)for(const ring of part.coordinates){
       lines++;const start=edgePositions.length/3;for(const c of ring)edgePositions.push(...position(c));for(let i=1;i<ring.length;i++)edgeIndices.push(start+i-1,start+i);
      }
     }
    }
    if(meshIndices.length){
     const values=new Float64Array(meshPositions),indices=meshPositions.length/3>65535?new Uint32Array(meshIndices):new Uint16Array(meshIndices);
     faceInstances.push(new C.GeometryInstance({id:pick,geometry:new C.Geometry({attributes:{position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values})},indices,primitiveType:C.PrimitiveType.TRIANGLES,boundingSphere:C.BoundingSphere.fromVertices(values)}),attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(colour(style.fillColor,style.fillOpacity))}}));
    }
    if(edgeIndices.length){const values=new Float64Array(edgePositions);edgeInstances.push(new C.GeometryInstance({id:pick,geometry:new C.Geometry({attributes:{position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values})},indices:edgePositions.length/3>65535?new Uint32Array(edgeIndices):new Uint16Array(edgeIndices),primitiveType:C.PrimitiveType.LINES,boundingSphere:C.BoundingSphere.fromVertices(values)}),attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(colour(style.color,style.opacity))}}));}
    const label=layer.metadata?.style?.labelField,value=label&&feature.properties?.[label],first=parts.find(p=>p.type==='Point');
    if(value&&first&&labels.length<500)labels.add({id:pick,position:cartesian(first.coordinates),text:String(value).slice(0,100),font:'13px sans-serif',fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new C.Cartesian2(10,-8),horizontalOrigin:C.HorizontalOrigin.LEFT,distanceDisplayCondition:new C.DistanceDisplayCondition(0,15000)});
    if(fi%25===24){await new Promise(resolve=>setTimeout(resolve,0));if(ticket!==generation||destroyed){root.destroy();return {};}}
   }
   if(faceInstances.length)root.add(new C.Primitive({geometryInstances:faceInstances,appearance:new C.PerInstanceColorAppearance({flat:true,translucent:true,closed:false,renderState:{depthTest:{enabled:true},cull:{enabled:false}}}),asynchronous:false}));
   if(edgeInstances.length)root.add(new C.Primitive({geometryInstances:edgeInstances,appearance:new C.PerInstanceColorAppearance({flat:true,translucent:true}),asynchronous:false}));
   if(lineInstances.length)root.add(new C.Primitive({geometryInstances:lineInstances,appearance:new C.PolylineColorAppearance({translucent:true}),asynchronous:false}));
   viewer.scene.primitives.add(root);return {root,stats:{features:entries.length,polygons,lines,points:pointCount}};
  }catch(error){if(!root.isDestroyed())root.destroy();throw error;}
 }
 async function sync(layers,{accept=()=>true,heightOffset=0,onProgress}={}){
  const ticket=++generation;if(offset!==heightOffset){offset=heightOffset;for(const record of cache.values())remove(record);cache.clear();}
  const wanted=new Set(layers.map(l=>l.id));for(const [id,record] of cache)if(!wanted.has(id)){remove(record);cache.delete(id);}
  for(const layer of layers){
   if(ticket!==generation||destroyed)return;
   const entries=displayedFeatures(layer,accept),key=JSON.stringify([layer.color,layer.opacity,layer.metadata?.style,entries.map(e=>e.index),layer.url]),prior=cache.get(layer.id);
   if(prior?.fc===layer.fc&&prior.key===key)continue;
   onProgress?.(`Loading ${layer.name} in 3D…`);
   try{const next=await buildLayer(layer,entries,ticket);if(ticket!==generation||destroyed){remove(next);return;}remove(prior);cache.set(layer.id,{...next,fc:layer.fc,key});}
   catch(error){if(ticket===generation&&!destroyed)onError?.(`${layer.name}: ${error.message}`);}
  }
  if(!destroyed){viewer.scene.requestRender();onProgress?.('');}
 }
 function fit(layers,view){
  const coordinates=layers.flatMap(layer=>(layer.fc?.features||[]).flatMap(feature=>{const mode=heightMode(layer,feature);return coordinateList(feature).map(c=>[c[0],c[1],(mode==='absolute'?(c[2]||0):(terrainHeights.get(coordinateKey(c))||0)+(mode==='relative'?(c[2]||0):0))+offset]);})).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1]));
  let center,radius;
  if(coordinates.length){const sphere=C.BoundingSphere.fromPoints(coordinates.map(c=>C.Cartesian3.fromDegrees(c[0],c[1],c[2]||0)));center=sphere.center;radius=Math.max(100,sphere.radius*2.5);}
  else{center=C.Cartesian3.fromDegrees(view?.lng||134,view?.lat||-25);radius=view?.range||1500000;}
  viewer.camera.lookAt(center,new C.HeadingPitchRange(0,-Math.PI/4,radius));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();
 }
 function focusFeature(layer,feature){
  const mode=heightMode(layer,feature),coords=coordinateList(feature),points=coords.map(c=>C.Cartesian3.fromDegrees(c[0],c[1],(mode==='absolute'?(c[2]||0):(terrainHeights.get(coordinateKey(c))||0)+(mode==='relative'?(c[2]||0):0))+offset));
  if(!points.length)return;const sphere=C.BoundingSphere.fromPoints(points);
  viewer.camera.lookAt(sphere.center,new C.HeadingPitchRange(0,-Math.PI/6,Math.max(100,sphere.radius*3)));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();
 }
 function focusView(view){const center=C.Cartesian3.fromDegrees(view.lng,view.lat);viewer.camera.lookAt(center,new C.HeadingPitchRange(viewer.camera.heading,-Math.PI/4,view.range));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();}
 function top(){const middle=new C.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2),ray=viewer.camera.getPickRay(middle),target=ray&&viewer.scene.globe.pick(ray,viewer.scene);if(target){const range=Math.max(100,C.Cartesian3.distance(viewer.camera.positionWC,target));viewer.camera.lookAt(target,new C.HeadingPitchRange(0,-Math.PI/2,range));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);}viewer.scene.requestRender();}
 return {viewer,basemap,sync,fit,focusFeature,focusView,top,resize:()=>{viewer.resize();viewer.scene.requestRender();},get stats(){return [...cache.values()].flatMap(r=>r.stats?[r.stats]:[]);},get center(){const ray=viewer.camera.getPickRay(new C.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2)),p=ray&&viewer.scene.globe.pick(ray,viewer.scene);if(!p)return null;const c=C.Cartographic.fromCartesian(p);return {lng:C.Math.toDegrees(c.longitude),lat:C.Math.toDegrees(c.latitude),height:viewer.camera.positionCartographic.height};},destroy(){destroyed=true;generation++;handler.destroy();cache.clear();viewer.destroy();}};
}
