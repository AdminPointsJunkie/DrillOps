// Persistent cache is an optimisation only. Every open still checks live server access.
export function createReleaseCache(indexedDB=globalThis.indexedDB){
 let ready,generation=0;
 const db=()=>ready??=new Promise((resolve,reject)=>{if(!indexedDB)return reject(Error('No browser cache'));const r=indexedDB.open('fieldmaps-release-cache',1);r.onupgradeneeded=()=>r.result.createObjectStore('items');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 async function run(mode,action){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('items',mode),r=action(tx.objectStore('items'));let value;r.onsuccess=()=>value=r.result;tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error);});}
 return {get generation(){return generation;},async get(key){try{return await run('readonly',s=>s.get(key));}catch{return null;}},async put(key,value){try{await run('readwrite',s=>s.put(value,key));const keys=await run('readonly',s=>s.getAllKeys());for(const stale of keys.filter(k=>k!==key).slice(0,Math.max(0,keys.length-8)))await run('readwrite',s=>s.delete(stale));}catch{}},async clear(){generation++;try{await run('readwrite',s=>s.clear());}catch{}},async remove(key){try{await run('readwrite',s=>s.delete(key));}catch{}}};
}
export const releaseCache=createReleaseCache();
