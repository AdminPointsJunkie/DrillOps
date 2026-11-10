export function coordinateInput(text,mode='latlon',zone=55,datum=2020){
 const values=text.trim().split(/[\s,]+/);if(values.length!==2||values.some(v=>!v||!Number.isFinite(Number(v))))throw Error('Enter two numeric coordinates, without thousands separators.');
 const [a,b]=values.map(Number);
 if(mode==='latlon'){if(Math.abs(a)>90||Math.abs(b)>180)throw Error('Latitude must be −90 to 90 and longitude −180 to 180.');return {lat:a,lng:b};}
 if(!Number.isInteger(zone)||zone<48||zone>58||![1994,2020].includes(datum)||a<100000||a>900000||b<0||b>10000000)throw Error('Check the MGA zone, datum, easting and northing.');
 return {x:a,y:b,epsg:(datum===2020?7800:28300)+zone};
}
export function clusterPhotos(items,project,size=64){
 const cells=new Map();
 for(const item of items){const p=project(item);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;const key=`${Math.floor(p.x/size)}:${Math.floor(p.y/size)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);}
 return [...cells.values()];
}
export function pinScope(user,workspace,project){return user&&project?JSON.stringify([user,workspace||'',project]):null;}
export function createPersonalPinStore(indexedDB=globalThis.indexedDB){
 let connection;
 const open=()=>connection??=new Promise((resolve,reject)=>{if(!indexedDB)return reject(Error('This browser cannot save local photos.'));const r=indexedDB.open('fieldmaps-personal-pins',1);r.onupgradeneeded=()=>{r.result.createObjectStore('pins',{keyPath:['scope','id']}).createIndex('scope','scope');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{connection=null;reject(r.error);};});
 async function run(mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('pins',mode);let result;const request=action(tx.objectStore('pins'));request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Browser storage could not be updated.'));});}
 return {
  list:scope=>scope?run('readonly',s=>s.index('scope').getAll(scope)):Promise.resolve([]),
  async save(scope,pin){if(!scope)throw Error('Sign in and choose a project first.');if(!pin.id||!pin.name?.trim()||!Number.isFinite(pin.lat)||!Number.isFinite(pin.lng)||Math.abs(pin.lat)>90||Math.abs(pin.lng)>180)throw Error('Invalid pin.');if(pin.photos?.length>10)throw Error('Choose up to 10 photos per pin.');await run('readwrite',s=>s.put({...pin,scope}));},
  async remove(scope,id){if(!scope)throw Error('Choose a project first.');await run('readwrite',s=>s.delete([scope,id]));}
 };
}
