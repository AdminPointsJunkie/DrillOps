import {isLocalGeoTIFF} from './data-policy.js';
export const LIBRARY_LIMIT=50*1024*1024;
export function libraryPresentation(layer){
 const result={};for(const key of ['source_crs','vertical_datum','crsLabel','color','opacity','bounds','metadata'])if(layer[key]!==undefined)result[key]=structuredClone(layer[key]);
 result.metadata??={};delete result.metadata.analysis;delete result.metadata.library;delete result.metadata.component;return result;
}
export function libraryFeatures(fc){
 if(fc?.type!=='FeatureCollection'||!Array.isArray(fc.features))throw Error('This layer has no loaded map data.');
 const copy=structuredClone(fc);for(const feature of copy.features){if(feature.properties){delete feature.properties._fieldmaps_files;}}
 return copy;
}
export function createWorkspaceLibrary({db,getWorkspace,getUser,canManage,getScope,local=false}){
 const workspace=()=>getWorkspace()?.id||(local?'local-library':null);
 const assertScope=scope=>{if(scope!==getScope())throw Error('The project or workspace changed. Reopen the library.');};
 const bucket=()=>db.storage.from('layer-library');
 return {
  async list(){const id=workspace();if(!id)return [];const {data,error}=await db.from('workspace_layer_library').select('*').eq('workspace_id',id).order('created_at',{ascending:false});if(error)throw error;return data;},
  async save(layer,details){
   const scope=getScope(),workspace_id=workspace();if(!workspace_id||!canManage())throw Error('Workspace admin access is required to save library layers.');
   if(isLocalGeoTIFF(layer))throw Error('Local-only imagery cannot be shared in the library.');
   const id=crypto.randomUUID(),kind=layer.metadata?.xyz?'tiles':layer.kind;
   let blob=null;
   if(kind==='vector')blob=new Blob([JSON.stringify(libraryFeatures(layer.fc))],{type:'application/geo+json'});
   else if(kind==='raster'){
    if(layer.blob)blob=layer.blob;
    else if(layer.raster_path){const r=await db.storage.from('gis-files').download(layer.raster_path);if(r.error)throw r.error;blob=r.data;}
    else throw Error('Save this imagery to the project first.');
   }
   if(blob?.size>LIBRARY_LIMIT)throw Error('Library layers can be up to 50 MB.');
   assertScope(scope);if(!canManage())throw Error('Workspace access changed.');
   const row={id,workspace_id,name:details.name.trim(),description:details.description.trim(),category:details.category.trim()||'General',kind,presentation:libraryPresentation(layer),asset_path:blob?`${workspace_id}/${id}/data`:null,asset_bytes:blob?.size||0,feature_count:kind==='vector'?layer.fc.features.length:0,archived:false,created_by:getUser()?.id};
   if(!row.name||row.name.length>160)throw Error('Enter a layer name up to 160 characters.');
   if(blob){const r=await bucket().upload(row.asset_path,blob,{contentType:blob.type});if(r.error)throw r.error;}
   try{assertScope(scope);const r=await db.from('workspace_layer_library').insert(row).select().single();if(r.error)throw r.error;return r.data;}
   catch(error){if(blob)await bucket().remove([row.asset_path]);throw error;}
  },
  async load(row){
   const scope=getScope();if(row.workspace_id!==workspace())throw Error('Choose a layer in this workspace.');
   const layer={...structuredClone(row.presentation),id:crypto.randomUUID(),name:row.name,kind:row.kind==='tiles'?'raster':row.kind,saved:false,visible:true,files:[]};
   layer.metadata={...layer.metadata,library:{id:row.id,name:row.name,saved_at:row.created_at}};
   if(row.asset_path){const r=await bucket().download(row.asset_path);if(r.error)throw r.error;assertScope(scope);if(row.kind==='vector')layer.fc=libraryFeatures(JSON.parse(await r.data.text()));else layer.blob=r.data;}
   assertScope(scope);return layer;
  },
  async archive(row,archived){if(!canManage()||row.workspace_id!==workspace())throw Error('Workspace admin access required.');const r=await db.from('workspace_layer_library').update({archived}).eq('id',row.id).select().single();if(r.error)throw r.error;return r.data;}
 };
}
