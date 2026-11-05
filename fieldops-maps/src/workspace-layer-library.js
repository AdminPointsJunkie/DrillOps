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
  async list(){
   const scope=getScope(),id=workspace();if(!id)return [];
   const {data,error}=await db.from('workspace_layer_library').select('*').eq('workspace_id',id).order('created_at',{ascending:false});if(error)throw error;
   let projects=db.from('maps').select('id,name,workspace_id');if(!local)projects=projects.eq('workspace_id',id);
   const result=await projects;if(result.error)throw result.error;assertScope(scope);
   const maps=new Map((result.data||[]).map(p=>[p.id,p]));let source=[];
   if(maps.size){
    if(local){const r=await db.from('layers').select('*');if(r.error)throw r.error;source=r.data||[];}
    else {const ids=[...maps.keys()];for(let start=0;start<ids.length;start+=100){for(let offset=0;;offset+=500){const r=await db.from('layers').select('*').in('map_id',ids.slice(start,start+100)).order('id').range(offset,offset+499);if(r.error)throw r.error;assertScope(scope);source.push(...r.data);if(r.data.length<500)break;}}}
    source=source.filter(l=>maps.has(l.map_id)&&!isLocalGeoTIFF(l));
   }
   assertScope(scope);return [...data,...source.map(l=>({id:'project:'+l.id,source_layer_id:l.id,source_project_id:l.map_id,workspace_id:id,name:l.name,description:'From '+maps.get(l.map_id).name,category:'Project layers',kind:l.metadata?.xyz?'tiles':l.kind,presentation:libraryPresentation(l),created_at:l.created_at,archived:false}))];
  },
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
   if(row.source_layer_id){
    const project=await db.from('maps').select('id,workspace_id').eq('id',row.source_project_id).single();if(project.error)throw project.error;
    if(!local&&project.data?.workspace_id!==workspace())throw Error('Choose a layer in this workspace.');
    const result=await db.from('layers').select('*').eq('id',row.source_layer_id).single();if(result.error)throw result.error;const source=result.data;
    if(!source||source.map_id!==row.source_project_id)throw Error('The source layer is no longer available.');
    assertScope(scope);const copy={...libraryPresentation(source),id:crypto.randomUUID(),name:source.name,kind:source.kind,saved:false,visible:true,files:[]};
    copy.metadata={...copy.metadata,library:{source_layer_id:source.id,source_project_id:source.map_id}};
    if(source.kind==='vector'){const r=await db.rpc('layer_geojson',{p_layer_id:source.id});if(r.error)throw r.error;copy.fc=libraryFeatures(r.data);}
    else if(!source.metadata?.xyz){const r=await db.storage.from('gis-files').download(source.raster_path);if(r.error)throw r.error;copy.blob=r.data;}
    assertScope(scope);return copy;
   }
   const layer={...structuredClone(row.presentation),id:crypto.randomUUID(),name:row.name,kind:row.kind==='tiles'?'raster':row.kind,saved:false,visible:true,files:[]};
   layer.metadata={...layer.metadata,library:{id:row.id,name:row.name,saved_at:row.created_at}};
   if(row.asset_path){const r=await bucket().download(row.asset_path);if(r.error)throw r.error;assertScope(scope);if(row.kind==='vector')layer.fc=libraryFeatures(JSON.parse(await r.data.text()));else layer.blob=r.data;}
   assertScope(scope);return layer;
  },
  async archive(row,archived){if(row.source_layer_id)throw Error('Manage project layers in their source project.');if(!canManage()||row.workspace_id!==workspace())throw Error('Workspace admin access required.');const r=await db.from('workspace_layer_library').update({archived}).eq('id',row.id).select().single();if(r.error)throw r.error;return r.data;}
 };
}
