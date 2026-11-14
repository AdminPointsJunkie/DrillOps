// Scope is /maps/office/ only. Map tiles, authentication and the main page are unaffected.
const VERSION='office-2.7.2-fm3',RUNTIME=new URL('./runtime-2.7.2-fm3/',self.location).href;
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function isolated(response){
 const headers=new Headers(response.headers);headers.set('Cross-Origin-Opener-Policy','same-origin');headers.set('Cross-Origin-Embedder-Policy','require-corp');headers.set('Cross-Origin-Resource-Policy','same-origin');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function asset(url,event){
 const cache=await caches.open(VERSION);let response=await cache.match(url);
 if(!response){response=await fetch(url);if(!response.ok)throw Error('Conversion engine download failed');event.waitUntil(cache.put(url,response.clone()).catch(()=>{}));}
 return response;
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
 if(event.request.method!=='GET')return;
 event.respondWith((async()=>{
  if(url.href.startsWith(RUNTIME)&&/soffice\.(wasm|data)$/.test(url.pathname)){
   const response=await asset(url.href+'.gz.bin',event);
   return isolated(new Response(response.body.pipeThrough(new DecompressionStream('gzip')),{headers:{'Content-Type':url.pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'}}));
  }
  if(url.href.startsWith(RUNTIME))return isolated(await asset(url.href,event));
  return isolated(await fetch(event.request));
 })());
});
