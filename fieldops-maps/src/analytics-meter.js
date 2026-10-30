// No URLs, query strings, file names, tokens or response bodies are collected.
export function createAnalyticsMeter({origin,fetcher=globalThis.fetch.bind(globalThis),context=()=>null,now=()=>performance.now()}={}){
 let queue=[],sending=false;
 function route(input){
  try{const u=new URL(typeof input==='string'?input:input.url);if(u.origin!==origin)return null;
   if(u.pathname.startsWith('/storage/v1/'))return 'storage';
   if(u.pathname.startsWith('/rest/v1/rpc/')){const name=u.pathname.split('/').pop();if(/analytics/.test(name))return null;return /^[a-z_]{1,64}$/.test(name)?'rpc:'+name:null;}
   if(u.pathname.startsWith('/rest/v1/'))return 'database';
  }catch{}return null;
 }
 async function fetch(input,init){
  const name=route(input),who=context(),start=now();let status=0,bytes=null;
  try{const response=await fetcher(input,init);status=response.status;
   const length=response.headers.get('content-length');if(length!==null&&/^\d+$/.test(length))bytes=Math.min(Number(length),1073741824);
   return response;
  }finally{
   if(name&&who?.userId&&context()?.userId===who.userId&&queue.length<200)queue.push({actor:who.userId,workspace:who.workspaceId||null,route:name,status,bytes,ms:Math.min(300000,Math.max(0,Math.round(now()-start)))});
  }
 }
 async function flush(db){
  if(sending)return;const userId=context()?.userId;
  queue=queue.filter(e=>e.actor===userId);if(!userId||!queue.length)return;
  sending=true;const batch=queue.splice(0,50).map(({actor,...e})=>e);
  try{await db.rpc('record_analytics',{p_events:batch});}catch{}finally{sending=false;}
 }
 return {fetch,flush,clear(){queue=[];}};
}
