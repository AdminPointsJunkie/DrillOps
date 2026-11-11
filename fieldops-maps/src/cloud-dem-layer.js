// Lightweight layer adapter: defer GeoTIFF decoding code until a DEM is visible.
export function cloudDEMLayer(L,item,onError,{pane,loadModule=()=>import('./lidar-cog.js')}={}){
 const group=L.layerGroup();let revision=0,dem=null,display=null;
 group.getBounds=()=>L.latLngBounds([[item.bounds[1],item.bounds[0]],[item.bounds[3],item.bounds[2]]]);
 group.on('add',async()=>{
  const token=++revision;
  try{
   const {openCloudDEM,cloudDEMOverlay}=await loadModule();
   if(token!==revision)return;
   const loaded=await openCloudDEM(item.metadata.cloud_dem.url,{datum:item.metadata.cloud_dem.datum});
   if(token!==revision){loaded.dispose();return;}
   dem=loaded;display=cloudDEMOverlay({L,map:group._map,dem,pane,
    settings:()=>({...item.metadata.cloud_dem,opacity:item.opacity??item.metadata.cloud_dem.opacity??.7}),
    onStatus:text=>{if(token===revision&&text.startsWith('Elevation display:'))onError(text);}});
  }catch(e){if(token===revision)onError('Cloud DEM: '+e.message);}
 });
 group.on('remove',()=>{revision++;display?.dispose();display=null;dem?.dispose();dem=null;});
 return group;
}
