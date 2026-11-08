// Import has already committed. Retry only its readback, never the import.
export async function readSavedVector(db,layer){
 const {data:fc,error}=await db.rpc('layer_geojson',{p_layer_id:layer.id});
 if(error)throw error;
 if(fc?.type!=='FeatureCollection'||!Array.isArray(fc.features))throw Error('The saved layer could not be read. Retry to reload it.');
 const {data:row,error:metadataError}=await db.from('layers').select('metadata').eq('id',layer.id).single();
 if(metadataError)throw metadataError;
 layer.fc=fc;layer.metadata=row.metadata;layer.saveError=null;
}
