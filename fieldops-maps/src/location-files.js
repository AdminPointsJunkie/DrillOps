import {registerUpload} from './upload-meter.js';

export const FILES_PROPERTY='_fieldmaps_files';
export const FILE_LIMIT=50*1024*1024;
export function locationFiles(feature){
 const files=feature?.properties?.[FILES_PROPERTY];
 return Array.isArray(files)?files.filter(f=>f&&typeof f.path==='string'&&typeof f.name==='string'):[];
}
export function attachmentPaths(fc,paths=[]){
 return [...new Set([...paths,...(fc?.features||[]).flatMap(locationFiles).map(file=>file.path)])];
}
export function validateFiles(files){
 if(!files.length)throw Error('Choose at least one file.');
 if(files.length>20)throw Error('Choose up to 20 files at a time.');
 for(const file of files){if(!file.size)throw Error(`${file.name} is empty.`);if(file.size>FILE_LIMIT)throw Error(`${file.name} exceeds the 50 MB file limit.`);}
 if(files.reduce((sum,f)=>sum+f.size,0)>300*1024*1024)throw Error('Choose up to 300 MB at a time.');
}
export async function addLocationFiles({db,layer,feature,files,userId,mapId,local=false,save,progress=()=>{}}){
 validateFiles(files);
 const index=layer.fc.features.indexOf(feature);
 if(index<0)throw Error('This location has changed. Select it again.');
 const next={...layer,fc:structuredClone(layer.fc),original_paths:[...(layer.original_paths||[])]};
 const attachments=[...locationFiles(feature)];
 for(const file of files){
  progress(`Uploading ${file.name}…`);
  const path=`${userId}/${layer.id}/attachments/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-160)||'file'}`;
  if(!local)await registerUpload(db,mapId,path);
  const {error}=await db.storage.from('gis-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(error)throw error;
  next.original_paths.push(path);
  attachments.push({path,name:file.name,size:file.size,type:file.type||'application/octet-stream',uploaded_at:new Date().toISOString()});
 }
 next.fc.features[index].properties={...feature.properties,[FILES_PROPERTY]:attachments};
 // Never delete on an uncertain save response: the server may have committed.
 await save(next);
 return index;
}
export async function removeLocationFile({layer,feature,path,save}){
 const index=layer.fc.features.indexOf(feature);
 if(index<0)throw Error('This location has changed. Select it again.');
 const next={...layer,fc:structuredClone(layer.fc)};
 next.fc.features[index].properties={...feature.properties,[FILES_PROPERTY]:locationFiles(feature).filter(f=>f.path!==path)};
 // Retain bytes and ownership references for existing published releases.
 await save(next);return index;
}

export function locationFilesPanel({document,layer,feature,canEdit,upload,remove,download}){
 const panel=document.createElement('section');panel.className='location-files';
 const heading=document.createElement('h3');heading.textContent='Attachments';panel.append(heading);
 const list=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(list);
 let working=false;
 async function run(action){if(working)return;working=true;panel.querySelectorAll('button,input').forEach(el=>el.disabled=true);status.textContent='Working…';try{await action(message=>status.textContent=message);status.textContent='';}catch(error){status.textContent=error.message||'Could not complete this action. Try again.';}finally{working=false;panel.querySelectorAll('button,input').forEach(el=>el.disabled=false);}}
 const files=locationFiles(feature);
 if(!files.length){const empty=document.createElement('p');empty.textContent='No files attached to this location.';list.append(empty);}
 for(const file of files){
  const row=document.createElement('div');row.className='location-file';
  const name=document.createElement('span');name.textContent=`${file.name} · ${file.size>=1048576?(file.size/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil((file.size||0)/1024))+' KB'}`;
  const get=document.createElement('button');get.type='button';get.textContent='Download';get.setAttribute('aria-label',`Download ${file.name}`);get.onclick=()=>run(()=>download(file));row.append(name,get);
  if(canEdit(layer)){const del=document.createElement('button');del.type='button';del.textContent='Remove';del.setAttribute('aria-label',`Remove ${file.name}`);del.onclick=()=>run(()=>remove(file));row.append(del);}
  list.append(row);
 }
 if(canEdit(layer)){
  const label=document.createElement('label');label.textContent='Attach files';const input=document.createElement('input');input.type='file';input.multiple=true;input.setAttribute('aria-label','Attach files to this location');label.append(input);panel.append(label);
  const hint=document.createElement('p');hint.textContent='Up to 50 MB per file. Save the layer first. SYNC shares attachments with operators.';panel.append(hint);
  input.onchange=()=>{const files=Array.from(input.files||[]);if(files.length)void run(progress=>upload(files,progress));input.value='';};
 }
 panel.append(status);return panel;
}
