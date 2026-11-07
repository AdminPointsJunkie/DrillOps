/* Short-lived, memory-only read reuse. No persisted records, no auth or write caching. */
(function(root){
 function createReadCache({fetcher,identity,now=Date.now,ttl=30000,maxEntries=8}){
  const cache=new Map(),pending=new Map();let owner='',generation=0;
  const paths=new Set(['/activity-report-data','/activities','/filters','/clients','/projects','/contractors','/costing']);
  function clear(){generation++;cache.clear();pending.clear();}
  async function read(input,options={}){
   const user=await identity();if(user!==owner){clear();owner=user;}
   const url=new URL(typeof input==='string'?input:input.url,root.location?.href||'http://localhost');
   const method=String(options.method||(typeof input!=='string'&&input.method)||'GET').toUpperCase();
   if(method!=='GET'&&method!=='HEAD'){
    clear();try{return await fetcher(input,options);}finally{clear();}
   }
   if(!user||method!=='GET'||!paths.has(url.pathname)||options.signal)return fetcher(input,options);
   url.searchParams.delete('_');url.searchParams.sort();const key=url.href;
   const hit=cache.get(key);if(hit&&now()-hit.at<ttl){cache.delete(key);cache.set(key,hit);return hit.response.clone();}
   if(pending.has(key))return (await pending.get(key)).clone();
   const version=generation;
   const request=(async()=>{
    const response=await fetcher(input,options);
    if(response.ok&&response.headers.get('content-type')?.includes('application/json')){
     const bytes=await response.clone().arrayBuffer();
     if(version===generation&&user===owner&&bytes.byteLength<=16*1024*1024){
      cache.set(key,{at:now(),response:new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers})});
      while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
     }
    }
    return response;
   })();
   pending.set(key,request);
   try{return (await request).clone();}finally{if(pending.get(key)===request)pending.delete(key);}
  }
  return {fetch:read,clear};
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={createReadCache};return;}
 const authenticatedFetch=root.fetch.bind(root),apiOrigin=new URL(API).origin;
 const cache=createReadCache({fetcher:authenticatedFetch,identity:async()=>{
  // A cache hit still requires the current authenticated session and token lifetime.
  const session=loadStoredAuthSession();if(!session)return '';
  if(authSession?.access_token!==session.access_token)authSession=session;
  return await accessToken();
 }});
 root.fetch=function(input,options={}){
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  return url.origin===apiOrigin?cache.fetch(input,options):authenticatedFetch(input,options);
 };
 root.invalidateEosReads=()=>cache.clear();
 root.refreshEosPage=function(page){cache.clear();triggerPageLoad(page||document.querySelector('.page.active')?.id.replace('page-','')||'app-home');};
 root.addEventListener('storage',event=>{if(event.key===AUTH_STORAGE_KEY)cache.clear();});
})(typeof globalThis!=='undefined'?globalThis:this);
