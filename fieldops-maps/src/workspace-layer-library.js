import {validateDWG} from './dwg-import.js';
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
export function createWorkspaceLibrary({db,getWorkspace,getUser,canManage,canSave=canManage,getScope,local=false}){
 const workspace=()=>getWorkspace()?.id||(local?'local-library':null);
 const assertScope=scope=>{if(scope!==getScope())throw Error('The project or workspace changed. Reopen the library.');};
 const bucket=()=>db.storage.from('layer-library');
 const manageRow=row=>row.created_by===getUser()?.id||(row.visibility!=='private'&&row.workspace_id===workspace()&&canManage());
 return {
  canManage:manageRow,
  async defaultVisibility(){if(local)return getWorkspace()?.library_default_visibility||'project';const scope=getScope();const r=await db.from('workspaces').select('library_default_visibility').eq('id',workspace()).single();if(r.error)throw r.error;assertScope(scope);return r.data.library_default_visibility||'project';},
  async sharing(row,action='list',email=null,recipient=null){const scope=getScope();const r=await db.rpc('library_share_access',{p_layer:row.id,p_action:action,p_email:email,p_recipient:recipient});if(r.error)throw r.error;assertScope(scope);return r.data;},
  async list(){
   const scope=getScope(),id=workspace();if(!id)return [];
   const rows=[];for(let offset=0;;offset+=500){const r=await db.from('workspace_layer_library').select('*').order('created_at',{ascending:false}).range(offset,offset+499);if(r.error)throw r.error;assertScope(scope);rows.push(...r.data);if(r.data.length<500)break;}
   if(local)return rows.filter(r=>r.created_by===getUser()?.id||r.workspace_id===id&&r.visibility!=='private');
   const shares=await db.from('library_layer_shares').select('layer_id').eq('user_id',getUser()?.id);if(shares.error)throw shares.error;assertScope(scope);
   const direct=new Set(shares.data.map(r=>r.layer_id));return rows.map(r=>({...r,shared_direct:direct.has(r.id)}));
  },
  async save(layer,details){
   const scope=getScope(),workspace_id=workspace();if(!workspace_id||!canSave())throw Error('Project editing access is required to save library layers.');
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
   assertScope(scope);if(!canSave())throw Error('Project access changed.');
   const row={id,workspace_id,visibility:details.visibility==='private'?'private':'project',name:details.name.trim(),description:(details.description||'').trim(),category:(details.category||'').trim()||'General',kind,presentation:libraryPresentation(layer),asset_path:blob?`${workspace_id}/${id}/data`:null,asset_bytes:blob?.size||0,feature_count:kind==='vector'?layer.fc.features.length:0,archived:false,created_by:getUser()?.id};
   if(!row.name||row.name.length>160)throw Error('Enter a layer name up to 160 characters.');
   if(blob){const r=await bucket().upload(row.asset_path,blob,{contentType:blob.type});if(r.error)throw r.error;}
   try{assertScope(scope);const r=await db.from('workspace_layer_library').insert(row).select().single();if(r.error)throw r.error;return r.data;}
   catch(error){if(blob)await bucket().remove([row.asset_path]);throw error;}
  },
  async listDrawings(){
   const scope=getScope(),id=workspace();if(!id)return [];
   const rows=[];for(let offset=0;;offset+=500){const r=await db.from('workspace_layer_library').select('*').eq('workspace_id',id).eq('archived',false).order('created_at',{ascending:false}).range(offset,offset+499);if(r.error)throw r.error;assertScope(scope);rows.push(...r.data.filter(row=>row.presentation?.drawing?.format==='DWG'));if(r.data.length<500)break;}return rows;
  },
  async saveDrawing(file,details){
   const scope=getScope(),workspace_id=workspace();if(!workspace_id||!canManage())throw Error('Workspace admin access is required to upload library drawings.');
   await validateDWG(file);assertScope(scope);
   const id=crypto.randomUUID(),row={id,workspace_id,name:details.name.trim(),description:(details.description||'').trim(),category:(details.category||'').trim()||'CAD drawings',kind:'vector',presentation:{drawing:{format:'DWG',filename:file.name}},asset_path:`${workspace_id}/${id}/data`,asset_bytes:file.size,feature_count:0,archived:false,created_by:getUser()?.id};
   if(!row.name||row.name.length>160)throw Error('Enter a drawing name up to 160 characters.');
   if(!canManage())throw Error('Workspace access changed.');
   const upload=await bucket().upload(row.asset_path,file,{contentType:'application/acad'});if(upload.error)throw upload.error;
   try{assertScope(scope);if(!canManage())throw Error('Workspace access changed.');const r=await db.from('workspace_layer_library').insert(row).select().single();if(r.error)throw r.error;return r.data;}
   catch(error){await bucket().remove([row.asset_path]);throw error;}
  },
  async loadDrawing(row,{allowArchived=false}={}){
   const scope=getScope();if(local&&row.workspace_id!==workspace())throw Error('Choose a drawing in this workspace.');
   const r=await db.from('workspace_layer_library').select('*').eq('id',row.id).single();if(r.error)throw r.error;
   const current=r.data;if(!current||(current.archived&&!(allowArchived&&manageRow(row)))||current.presentation?.drawing?.format!=='DWG')throw Error('This library drawing is no longer available.');
   if(current.asset_path!==`${current.workspace_id}/${current.id}/data`)throw Error('The drawing source is invalid.');
   const result=await bucket().download(current.asset_path);if(result.error)throw result.error;assertScope(scope);
   const file=new File([result.data],current.presentation.drawing.filename,{type:'application/acad'});await validateDWG(file);return file;
  },
  async load(row){
   if(row.presentation?.drawing)return {drawing:true,name:row.name,files:[await this.loadDrawing(row,{allowArchived:true})]};
   const scope=getScope();if(local&&row.workspace_id!==workspace())throw Error('Choose a layer in this workspace.');
   const current=await db.from('workspace_layer_library').select('*').eq('id',row.id).single();if(current.error)throw current.error;assertScope(scope);row=current.data;
   const layer={...structuredClone(row.presentation),id:crypto.randomUUID(),name:row.name,kind:row.kind==='tiles'?'raster':row.kind,saved:false,visible:true,files:[]};
   layer.metadata={...layer.metadata,library:{id:row.id,name:row.name,saved_at:row.created_at}};
   if(row.asset_path){const r=await bucket().download(row.asset_path);if(r.error)throw r.error;assertScope(scope);if(row.kind==='vector')layer.fc=libraryFeatures(JSON.parse(await r.data.text()));else layer.blob=r.data;}
   assertScope(scope);return layer;
  },
  async archive(row,archived){if(!manageRow(row))throw Error('Only the layer owner or project admin can archive this layer.');const scope=getScope();const r=await db.from('workspace_layer_library').update({archived}).eq('id',row.id).select().single();if(r.error)throw r.error;assertScope(scope);return r.data;}
 };
}
