// Testing data stays on this device. This adapter never changes cloud access policies.
export function createLocalWorkspace(indexedDB = globalThis.indexedDB) {
 const ready = new Promise((resolve,reject) => {
  const request=indexedDB.open('fieldops-maps-testing',1);
  request.onupgradeneeded=()=>{for(const name of ['maps','layers','files'])request.result.createObjectStore(name,{keyPath:'id'});};
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
  let action='select',payload,filter;
  const execute=()=>result(async()=>{
   if(action==='insert'){const row={id:crypto.randomUUID(),created_at:new Date().toISOString(),...payload};await put(table,row);return [row];}
   const rows=(await all(table)).filter(r=>!filter||r[filter[0]]===filter[1]);
   if(action==='delete'){for(const row of rows)await operation(table,'readwrite',s=>s.delete(row.id));}
   if(action==='update'){for(const row of rows){Object.assign(row,payload);await put(table,row);}}
   return rows;
  });
  const query={delete(){action='delete';return query;},select(){return query;},insert(value){action='insert';payload=value;return query;},update(value){action='update';payload=value;return query;},
   eq(key,value){filter=[key,value];return query;},order(){return execute();},then(ok,bad){return execute().then(ok,bad);},
   async single(){const response=await execute();if(response.error)return response;if(response.data.length!==1)return {data:null,error:Error('Project no longer exists. Refresh and try again.')};return {data:response.data[0],error:null};}};
  return query;
 }
 return {
  from,
  auth:{onAuthStateChange(callback){queueMicrotask(()=>callback('INITIAL_SESSION',{user:{id:'local-testing'}}));}},
  rpc(name,args){return result(async()=>{
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
