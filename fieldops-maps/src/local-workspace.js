// Testing data stays on this device. This adapter never changes cloud access policies.
export function createLocalWorkspace(indexedDB = globalThis.indexedDB) {
 const ready = new Promise((resolve,reject) => {
  const request=indexedDB.open('fieldops-maps-testing',4);
  request.onupgradeneeded=()=>{for(const name of ['maps','layers','files','trash','layer_data_versions','map_style_presets','workspace_layer_library'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(Error('Browser storage is unavailable. Allow site storage to save test projects.'));
 });
 async function operation(store,mode,run){
  const db=await ready;
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,mode), request=run(tx.objectStore(store));let result;
   request.onsuccess=()=>result=request.result;
   tx.oncomplete=()=>resolve(result);
   tx.onerror=tx.onabort=()=>reject(Error(tx.error?.name==='QuotaExceededError'?'Browser storage is full. Free space before saving more layers.':tx.error?.message||'Could not save browser data.'));
  });
 }
 const all=table=>operation(table,'readonly',s=>s.getAll());
 const put=(table,row)=>operation(table,'readwrite',s=>s.put(row));
 const result=async fn=>{try{return {data:await fn(),error:null};}catch(error){return {data:null,error};}};
 function from(table){
  let action='select',payload,filters=[],bounds=null;
  const execute=()=>result(async()=>{
   if(action==='insert'){const row={id:crypto.randomUUID(),created_at:new Date().toISOString(),...payload};await put(table,row);return [row];}
   let rows=(await all(table)).filter(r=>filters.every(([key,value])=>r[key]===value));if(bounds)rows=rows.slice(bounds[0],bounds[1]+1);
   if(action==='delete'){
    if(table==='maps'){
     const db=await ready,ids=new Set(rows.map(row=>row.id));
     await new Promise((resolve,reject)=>{
      const tx=db.transaction(['maps','layers','trash'],'readwrite');
      for(const id of ids)tx.objectStore('maps').delete(id);
      for(const store of ['layers','trash']){const cursor=tx.objectStore(store).openCursor();cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;if(ids.has(item.value.map_id))item.delete();item.continue();};}
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||Error('Could not delete project.'));
     });
    }else for(const row of rows)await operation(table,'readwrite',s=>s.delete(row.id));
   }
   if(action==='update'){for(const row of rows){Object.assign(row,payload);await put(table,row);}}
   return rows;
  });
  const query={delete(){action='delete';return query;},select(){return query;},insert(value){action='insert';payload=value;return query;},update(value){action='update';payload=value;return query;},
   eq(key,value){filters.push([key,value]);return query;},order(){return query;},range(start,end){bounds=[start,end];return query;},then(ok,bad){return execute().then(ok,bad);},
   async single(){const response=await execute();if(response.error)return response;if(response.data.length!==1)return {data:null,error:Error('Project no longer exists. Refresh and try again.')};return {data:response.data[0],error:null};}};
  return query;
 }
 async function layerBin(args){
  const db=await ready;
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(['maps','layers','trash'],'readwrite'),maps=tx.objectStore('maps'),layers=tx.objectStore('layers'),trash=tx.objectStore('trash');let output,error;
   const requests=[maps.getAll(),layers.getAll(),trash.getAll()],values=[];let count=0;
   requests.forEach((request,index)=>request.onsuccess=()=>{values[index]=request.result;if(++count!==3)return;
    try{
     const [projects,active,deleted]=values,now=Date.now(),live=deleted.filter(r=>new Date(r.expires_at).getTime()>now);
     deleted.filter(r=>!live.includes(r)).forEach(r=>trash.delete(r.id));
     const item=live.find(r=>r.id===args.p_layer),action=args.p_action;
     if(action==='list')output=live.map(r=>({id:r.id,name:r.layer.name,map_id:r.map_id,project:projects.find(p=>p.id===r.map_id)?.name,deleted_at:r.deleted_at,expires_at:r.expires_at,can_change:true}));
     else if(action==='empty'){live.forEach(r=>trash.delete(r.id));output={};}
     else if(action==='trash'){
      const layer=active.find(l=>l.id===args.p_layer),project=projects.find(p=>p.id===layer?.map_id);if(!layer||!project)throw Error('Layer not found. Refresh and try again.');
      trash.add({id:layer.id,map_id:layer.map_id,layer,deleted_at:new Date(now).toISOString(),expires_at:new Date(now+30*86400000).toISOString()});layers.delete(layer.id);
      project.layer_layout=(project.layer_layout||[]).filter(n=>n!==layer.id).map(n=>typeof n==='string'?n:{...n,children:n.children.filter(id=>id!==layer.id)});maps.put(project);output={id:layer.id,map_id:layer.map_id};
     }else if(action==='purge'){if(!item)throw Error('Deleted layer not found.');trash.delete(item.id);output={id:item.id};}
     else if(action==='restore'){
      if(!item)throw Error('Deleted layer is no longer available.');const project=projects.find(p=>p.id===(args.p_target||item.map_id));if(!project)throw Error('Destination project not found.');
      layers.add({...item.layer,map_id:project.id});project.layer_layout=[...(project.layer_layout||[]),item.id];maps.put(project);trash.delete(item.id);output={id:item.id,map_id:project.id};
     }else throw Error('Unknown basket action.');
    }catch(e){error=e;tx.abort();}
   });
   tx.oncomplete=()=>resolve(output);tx.onerror=tx.onabort=()=>reject(error||tx.error||Error('Could not update Recently deleted.'));
  });
 }
 async function dataWorkflow(name,args){
  const db=await ready;return new Promise((resolve,reject)=>{
   const tx=db.transaction(['layers','layer_data_versions'],'readwrite'),ls=tx.objectStore('layers'),vs=tx.objectStore('layer_data_versions');let output,error;
   const a=ls.getAll(),b=vs.getAll();let count=0;for(const request of [a,b])request.onsuccess=()=>{if(++count<2)return;try{
    if(name==='apply_map_style'){const selected=args.p_ids.map(id=>a.result.find(l=>l.id===id));if(selected.some(l=>!l))throw Error('A layer is unavailable');for(const l of selected)ls.put({...l,color:args.p_style.color,opacity:args.p_style.opacity,metadata:{...l.metadata,style:{...args.p_style.style,view:l.metadata?.style?.view,popup:l.metadata?.style?.popup}}});}
    else{const old=a.result.find(l=>l.id===args.p_layer_id);if(!old)throw Error('Layer unavailable');if((old.metadata?.data_revision||'')!==(args.p_expected||''))throw Error('Layer data changed. Refresh and review again.');
     const restore=args.p_restore?b.result.find(v=>v.id===args.p_restore&&v.layer_id===old.id):null;if(args.p_restore&&!restore)throw Error('Previous version unavailable');
     const token=crypto.randomUUID(),id=crypto.randomUUID(),layer={...(restore?.layer||args.p_layer),name:old.name,metadata:{...(restore?.layer||args.p_layer).metadata,style:old.metadata?.style,data_revision:token}},features=restore?.features||args.p_features;
     vs.put({id,layer_id:old.id,created_at:new Date().toISOString(),layer:old,features:old.fc.features});for(const v of b.result.filter(v=>v.layer_id===old.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(2))vs.delete(v.id);
     ls.put({...old,...layer,fc:{type:'FeatureCollection',features},feature_count:features.length});output={version:id,data_revision:token,layer,features};}
   }catch(e){error=e;tx.abort();}};
   tx.oncomplete=()=>resolve(output);tx.onerror=tx.onabort=()=>reject(error||tx.error);
  });
 }
 return {
  from,
  auth:{onAuthStateChange(callback){queueMicrotask(()=>callback('INITIAL_SESSION',{user:{id:'local-testing'}}));}},
  rpc(name,args){return result(async()=>{
   if(name==='maps_supporting_file'){const m=(await all('maps')).find(m=>m.id===args.p_map);if(!m)throw Error('Map unavailable');const files=m.supporting_files||[],f=args.p_file,group=String(f.group??'').trim();if(group.length>80)throw Error('Keep headings to 80 characters or fewer.');
    if(args.p_action==='remove')m.supporting_files=files.filter(item=>item.path!==f.path);
    else if(args.p_action==='group'||args.p_action==='rename_group')m.supporting_files=files.map(item=>(args.p_action==='group'?item.path===f.path:(item.group||'')===f.previous)?{...item,group}:item);
    else if(args.p_action==='rename'){const name=String(f.name??'').trim();if(!name||name.length>240||/[\\/]/.test(name))throw Error('Enter a valid file name');if(!files.some(i=>i.path===f.path))throw Error('File unavailable');m.supporting_files=files.map(i=>i.path===f.path?{...i,name}:i);}
    else if(args.p_action==='move'){const item=files.find(i=>i.path===f.path);if(!item)throw Error('File unavailable');if(f.before===f.path)return files;const rest=files.filter(i=>i.path!==f.path),at=f.before?rest.findIndex(i=>i.path===f.before):rest.length;if(at<0)throw Error('Destination file unavailable');rest.splice(at,0,{...item,group});m.supporting_files=rest;}
    else if(args.p_action==='remove_group'){if(!f.previous)throw Error('Choose a named group');m.supporting_files=files.filter(i=>(i.group||'')!==f.previous);}
    else if(args.p_action==='add')m.supporting_files=files.some(item=>item.path===f.path)?files:[...files,{...f,...(group?{group}:{})}];
    else throw Error('Unknown supporting-file action');await put('maps',m);return m.supporting_files;}


   if(name==='maps_layer_bin')return layerBin(args);
   if(['replace_vector_versioned','apply_map_style'].includes(name))return dataWorkflow(name,args);
   if(name==='import_vector'){const id=crypto.randomUUID();await put('layers',{id,created_at:new Date().toISOString(),visible:true,opacity:.85,...args.p_layer,feature_count:args.p_features.length,fc:{type:'FeatureCollection',features:args.p_features}});return id;}
   if(name==='layer_geojson'){const row=await operation('layers','readonly',s=>s.get(args.p_layer_id));if(!row)throw Error('Layer not found.');return row.fc;}
   throw Error('Unsupported local operation.');
  });},
  storage:{from(){return {
   upload(path,blob){return result(async()=>{await put('files',{id:path,blob});return {path};});},
   download(path){return result(async()=>{const row=await operation('files','readonly',s=>s.get(path));if(!row)throw Error('Saved file not found.');return row.blob;});},
   remove(paths){return result(async()=>{for(const path of paths)await operation('files','readwrite',s=>s.delete(path));return paths;});},
  };}},
 };
}
