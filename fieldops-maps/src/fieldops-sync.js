// Preserve original snapshots: the server merges these against current web/mobile data.
export function editLayerPayload(layer) {
 return {name:layer.name,source_crs:layer.source_crs,vertical_datum:layer.vertical_datum||'Unknown',metadata:structuredClone(layer.metadata||{}),original_paths:structuredClone(layer.original_paths||[])};
}
export function uniqueEditedFeatures(features,base) {
 const known=new Set(base.map(f=>String(f.id))),seen=new Set();
 return features.map(feature=>{const copy=structuredClone(feature),id=String(copy.id);
  if(copy.id===undefined||!known.has(id)||seen.has(id))delete copy.id;else seen.add(id);
  return copy;
 });
}
export async function mergeVectorEdits(db,old,next,payload){
 const {data,error}=await db.rpc('merge_vector_edits',{
  p_layer_id:old.id,p_layer:editLayerPayload(payload),p_base_layer:editLayerPayload(old),
  p_base_features:structuredClone(old.fc.features),p_features:uniqueEditedFeatures(next.fc.features,old.fc.features)
 });
 if(error)throw error;
 if(!data?.layer||data.fc?.type!=='FeatureCollection'||!Array.isArray(data.fc.features))throw Error('The save result was incomplete. Refresh before retrying.');
 return data;
}

export async function mergeVectorWithReview(db,old,next,payload,resolve){
 const {mergeFeatureSnapshots}=await import('./field-edit-conflicts.js');
 let base=old,proposed=next,values=payload;
 for(let attempt=0;attempt<3;attempt++){
  try{return await mergeVectorEdits(db,base,proposed,values);}
  catch(error){
   if(error.code!=='40001')throw error;
   const [layer,features]=await Promise.all([db.from('layers').select('*').eq('id',old.id).single(),db.rpc('layer_geojson',{p_layer_id:old.id})]);
   if(layer.error)throw layer.error;if(features.error)throw features.error;
   const remote={...layer.data,fc:features.data};
   const merge=mergeFeatureSnapshots(base.fc.features,uniqueEditedFeatures(proposed.fc.features,base.fc.features),remote.fc.features);
   const props=value=>{const p=editLayerPayload(value);delete p.metadata.data_revision;return p;};
   const settings=mergeFeatureSnapshots([{id:'settings',properties:props(base)}],[{id:'settings',properties:props(values)}],[{id:'settings',properties:props(remote)}]);
   await resolve([...merge.conflicts,...settings.conflicts]);
   values={...values,...settings.features()[0].properties};base=remote;proposed={...proposed,fc:{type:'FeatureCollection',features:merge.features()}};
  }
 }
 throw Error('This layer is still changing on another device. Your edits remain unsaved; try again after the other editor finishes.');
}
