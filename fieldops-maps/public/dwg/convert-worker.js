// The reader runs in a disposable worker. Drawings never leave this browser.
// addEventListener avoids .NET mistaking this worker for one of its own pthread workers.
// https://github.com/dotnet/runtime/issues/114918
self.addEventListener('message',async({data})=>{
 try{
  const {dotnet}=await import('./runtime/dotnet.js');
  self.postMessage({progress:'Preparing DWG reader…'});
  const runtime=await dotnet.create();
  const api=await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  self.postMessage({progress:'Converting DWG geometry and layers…'});
  const input=new Uint8Array(data.bytes);let binary='';
  for(let i=0;i<input.length;i+=32768)binary+=String.fromCharCode(...input.subarray(i,i+32768));
  const result=JSON.parse(api.DwgConvert.ConvertDrawing(btoa(binary)));
  const decoded=atob(result.dxf),bytes=new Uint8Array(decoded.length);
  for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
  self.postMessage({bytes,warnings:result.warnings,entityCount:result.entityCount},[bytes.buffer]);
 }catch(error){
  console.warn('DWG conversion failed',error);
  self.postMessage({detail:String(error),error:'This DWG could not be converted safely. It may contain unsupported or damaged CAD objects. Export a 2D DXF from your CAD application and try again.'});
 }
},{once:true});
