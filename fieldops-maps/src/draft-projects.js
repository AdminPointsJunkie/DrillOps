import {releaseCache} from './release-cache.js';

// Always recheck the accessible live layer list. Reuse only exact vector data
// whose server revision still matches, keeping mutable editor data separate.
export async function draftLayers(db,project,{userId,cache=releaseCache,concurrency=2}={}){
 const epoch=cache.generation,key=`draft:${userId}:${project.id}`;
 const {data,error}=await db.from('layers').select('*,project_revision:maps(draft_revision)').eq('map_id',project.id).order('created_at');
 if(error){await cache.remove(key);throw error;}
 const previous=userId?await cache.get(key):null,stored={layers:{}},loaded=new Array(data.length);let next=0,failed=false;
 try{
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(concurrency,data.length)},async()=>{
   while(!failed&&next<data.length){const index=next++,{project_revision,...l}=data[index];try{
    if(l.kind==='vector'){
     const revision=l.metadata?.data_revision||(Number.isFinite(project_revision?.draft_revision)?`project:${project_revision.draft_revision}`:null),prior=previous?.layers?.[l.id];
     if(revision&&prior?.revision===revision)l.fc=structuredClone(prior.fc);
     else{const result=await db.rpc('layer_geojson',{p_layer_id:l.id});if(result.error)throw result.error;if(result.data?.type!=='FeatureCollection'||!Array.isArray(result.data.features))throw Error('The saved layer could not be read. Retry opening the project.');l.fc=result.data;}
     if(revision)stored.layers[l.id]={revision,fc:l.fc};
    }else if(!l.metadata?.xyz){const result=await db.storage.from('gis-files').download(l.raster_path);if(result.error)throw result.error;l.url=URL.createObjectURL(result.data);}
    l.saved=true;l.crsLabel=l.metadata?.crs_label;loaded[index]=l;
    }catch(error){failed=true;throw error;}
   }
  }));
  const rejection=outcomes.find(r=>r.status==='rejected');if(rejection)throw rejection.reason;
  if(cache.generation!==epoch)throw Error('Account changed while opening the project.');
  if(userId){const bytes=JSON.stringify(stored).length*2;if(bytes<64*1024*1024)await cache.put(key,stored);else await cache.remove(key);}
  return loaded;
 }catch(error){
  // All in-flight workers have settled before removing their preview URLs.
  await cache.remove(key);for(const l of loaded)if(l?.url?.startsWith('blob:'))URL.revokeObjectURL(l.url);throw error;
 }
}
