import {releaseCache} from './release-cache.js';
export async function publishedProjects(db){
 const {data,error}=await db.rpc('maps_published_projects');if(error)throw error;return data||[];
}
async function legacyPublishedLayers(db,project){
 const {data,error}=await db.from('map_releases').select('*').eq('id',project.release_id).single();if(error)throw error;
 if(!data||data.map_id!==project.id)throw Error('Published project is unavailable. Refresh your project list.');
 const loaded=[];
 try{for(const item of data.manifest.layers||[]){const l=structuredClone(item);if(l.kind==='raster'&&!l.metadata?.xyz){const result=await db.storage.from('gis-files').download(l.raster_path);if(result.error)throw result.error;l.url=URL.createObjectURL(result.data);}l.saved=true;l.crsLabel=l.metadata?.crs_label;l.feature_count=l.fc?.features.length;loaded.push(l);}}
 catch(error){for(const l of loaded)if(l.url?.startsWith('blob:'))URL.revokeObjectURL(l.url);throw error;}
 return {layers:loaded,project:{...project,...data.manifest.project,layer_layout:data.manifest.layer_layout,last_synced_at:data.published_at,published_version:data.version}};
}

export async function publishedLayers(db,project,{userId,cache=releaseCache}={}){
 if(!userId)return legacyPublishedLayers(db,project);
 const epoch=cache.generation;
 const key=`${userId}:${project.id}`;
 const {data:manifest,error}=await db.rpc('maps_release_manifest',{p_map_id:project.id});
 if(error||!manifest){await cache.remove(key);throw error||Error('Published project access is no longer available.');}
 const previous=await cache.get(key),stored={release:manifest.id,layers:{},files:{}};
 const loaded=[];let bytes=0;
 const save=async()=>{if(cache.generation===epoch&&bytes<25*1024*1024)await cache.put(key,stored);};
 try{for(const entry of manifest.layers){
  let item=previous?.layers?.[entry.id];
  if(item?.hash!==entry.hash){const r=await db.rpc('maps_release_layer',{p_release:manifest.id,p_layer:entry.id});if(r.error)throw r.error;item={hash:entry.hash,data:r.data};}
  stored.layers[entry.id]=item;bytes+=JSON.stringify(item).length*2;
  const l=structuredClone(item.data);l.saved=true;l.crsLabel=l.metadata?.crs_label;l.feature_count=l.fc?.features.length;
  if(l.kind==='raster'&&!l.metadata?.xyz){
   const get=async()=>{let blob=previous?.files?.[l.raster_path];if(!blob){const r=await db.storage.from('gis-files').download(l.raster_path);if(r.error)throw r.error;blob=r.data;}stored.files[l.raster_path]=blob;bytes+=blob.size;l.url=URL.createObjectURL(blob);delete l._load;await save();};
   const group=(manifest.layer_layout||[]).find(n=>typeof n!=='string'&&n.children?.includes(l.id));
   if(l.visible===false||group?.visible===false)l._load=get;else await get();
  }
  loaded.push(l);
 }
 if(cache.generation!==epoch)throw Error('Account changed while opening the map.');
 await save();
 }catch(error){await cache.remove(key);for(const l of loaded)if(l.url?.startsWith('blob:'))URL.revokeObjectURL(l.url);throw error;}
 return {layers:loaded,project:{...project,...manifest.project,release_id:manifest.id,layer_layout:manifest.layer_layout,last_synced_at:manifest.published_at,published_version:manifest.version}};
}
