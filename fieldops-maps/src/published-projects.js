export async function publishedProjects(db){
 const {data,error}=await db.rpc('maps_published_projects');if(error)throw error;return data||[];
}
export async function publishedLayers(db,project){
 const {data,error}=await db.from('map_releases').select('*').eq('id',project.release_id).single();if(error)throw error;
 if(!data||data.map_id!==project.id)throw Error('Published project is unavailable. Refresh your project list.');
 const loaded=[];
 try{for(const item of data.manifest.layers||[]){const l=structuredClone(item);if(l.kind==='raster'&&!l.metadata?.xyz){const result=await db.storage.from('gis-files').download(l.raster_path);if(result.error)throw result.error;l.url=URL.createObjectURL(result.data);}l.saved=true;l.crsLabel=l.metadata?.crs_label;l.feature_count=l.fc?.features.length;loaded.push(l);}}
 catch(error){for(const l of loaded)if(l.url?.startsWith('blob:'))URL.revokeObjectURL(l.url);throw error;}
 return {layers:loaded,project:{...project,...data.manifest.project,layer_layout:data.manifest.layer_layout,last_synced_at:data.published_at,published_version:data.version}};
}
