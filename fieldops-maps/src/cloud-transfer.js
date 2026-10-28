export const CLOUD_FILE_LIMIT=50*1024*1024;
const checked=async request=>{const result=await request;if(result.error)throw result.error;return result.data;};

// The local copy and stable destination IDs survive a failed or interrupted transfer.
export async function transferProject(local,cloud,project,userId,progress=()=>{},workspaceId=null){
 const layers=await checked(local.from('layers').select('*').eq('map_id',project.id).order('created_at'));
 const originals=l=>l.metadata?.source_names?.length
  ?(l.original_paths||[]).slice(0,l.metadata.source_names.length)
  :(l.original_paths||[]).filter(p=>p!==l.raster_path&&!p.endsWith('/display.png'));
 for(const layer of layers){
  for(const path of [...originals(layer),...(layer.raster_path?[layer.raster_path]:[])]){
   const blob=await checked(local.storage.from('gis-files').download(path));
   if(blob.size>CLOUD_FILE_LIMIT)throw Error(`${layer.name}: ${path.split('/').at(-1)} exceeds the current 50 MB cloud file limit. This project remains safely in browser storage.`);
  }
 }
 const exports={...project.cloud_exports};
 const destinationKey=workspaceId?`${userId}:${workspaceId}`:userId;
 const destination=exports[destinationKey]||{id:crypto.randomUUID(),layers:{}};
 for(const layer of layers)destination.layers[layer.id]??=crypto.randomUUID();
 exports[destinationKey]=destination;
 await checked(local.from('maps').update({cloud_exports:exports}).eq('id',project.id));
 project.cloud_exports=exports;
 const existing=await checked(cloud.from('maps').select('*').eq('id',destination.id));
 if(!existing.length)await checked(cloud.from('maps').insert({id:destination.id,...(workspaceId?{workspace_id:workspaceId}:{}),name:project.name,default_crs:project.default_crs||null,default_crs_label:project.default_crs_label||null}));
 let count=0;
 for(const layer of layers){
  const id=destination.layers[layer.id];progress(`Saving layer ${++count} of ${layers.length}: ${layer.name}`);
  if((await checked(cloud.from('layers').select('id').eq('id',id))).length)continue;
  const paths=[];
  for(const [i,path] of originals(layer).entries()){
   const blob=await checked(local.storage.from('gis-files').download(path));
   const filename=layer.metadata?.source_names?.[i]||path.split('/').at(-1);
   const target=`${userId}/${id}/${i}_${filename.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
   await checked(cloud.storage.from('gis-files').upload(target,blob,{upsert:true,contentType:blob.type||'application/octet-stream'}));paths.push(target);
  }
  const payload={id,map_id:destination.id,name:layer.name,kind:layer.kind,source_crs:layer.source_crs,
   vertical_datum:layer.vertical_datum||'Unknown',metadata:{...layer.metadata,source_names:layer.metadata?.source_names||originals(layer).map(p=>p.split('/').at(-1))},
   color:layer.color,opacity:layer.opacity??.85,visible:layer.visible!==false,bounds:layer.bounds,original_paths:paths};
  if(layer.kind==='vector'){
   const fc=await checked(local.rpc('layer_geojson',{p_layer_id:layer.id}));
   await checked(cloud.rpc('import_vector',{p_layer:payload,p_features:fc.features}));
  }else{
   if(!layer.metadata?.xyz){
    const blob=await checked(local.storage.from('gis-files').download(layer.raster_path));
    payload.raster_path=`${userId}/${id}/display.png`;
    await checked(cloud.storage.from('gis-files').upload(payload.raster_path,blob,{upsert:true,contentType:'image/png'}));
   }
   await checked(cloud.from('layers').insert(payload));
  }
 }
 const remap=nodes=>nodes.flatMap(n=>typeof n==='string'?(destination.layers[n]?[destination.layers[n]]:[]):[{...n,children:remap(n.children||[])}]);
 const layout=remap(project.layer_layout||layers.map(l=>l.id));
 // Only set layout at transfer time; subsequent clicks must not reset cloud edits.
 if(!destination.complete)await checked(cloud.from('maps').update({layer_layout:layout}).eq('id',destination.id));
 destination.complete=true;
 await checked(local.from('maps').update({cloud_exports:exports}).eq('id',project.id));
 return destination.id;
}
