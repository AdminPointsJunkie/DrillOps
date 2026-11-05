const MAX_DWG=50*1024*1024;
export async function validateDWG(file){
 if(!file.size||file.size>MAX_DWG)throw Error('DWG files must be between 1 byte and 50 MB.');
 const signature=await file.slice(0,6).text();
 if(!/^AC10\d{2}$/.test(signature))throw Error('This file is not a recognised DWG drawing. Export it as DXF from your CAD application.');
 if(!['AC1014','AC1015','AC1018','AC1021','AC1024','AC1027','AC1032'].includes(signature))throw Error('This DWG version is not supported. Save it as AutoCAD 2018 DWG or DXF and try again.');
 return signature;
}
export async function convertDWG(file,progress=()=>{},{workerFactory=()=>new Worker(import.meta.env.BASE_URL+'dwg/convert-worker.js',{type:'module'}),timeout=120000}={}){
 await validateDWG(file);
 progress('Loading DWG reader…');
 const bytes=await file.arrayBuffer();
 return new Promise((resolve,reject)=>{
  const worker=workerFactory();let timer;
  const finish=(error,result)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve(result);};
  timer=setTimeout(()=>finish(Error('DWG conversion took too long. Export a smaller drawing or a 2D DXF and try again.')),timeout);
  worker.onerror=()=>finish(Error('The DWG reader could not run. Use a current browser or export this drawing as DXF.'));
  worker.onmessage=({data})=>{
   if(data.progress){progress(data.progress);return;}
   if(data.error){if(import.meta.env?.DEV)console.warn(data.detail);finish(Error(data.error));return;}
   if(!(data.bytes instanceof Uint8Array)||!data.bytes.length||data.bytes.length>100*1024*1024){finish(Error('The DWG conversion did not produce a usable drawing. Export a 2D DXF instead.'));return;}
   finish(null,{file:new File([data.bytes],file.name.replace(/\.dwg$/i,'.dxf'),{type:'application/dxf'}),warnings:Array.isArray(data.warnings)?data.warnings.slice(0,100).map(String):[],entityCount:data.entityCount,reader:'ACadSharp 3.8.37'});
  };
  worker.postMessage({bytes},[bytes]);
 });
}
// GDAL resolves ByLayer/ByBlock colours into OGR styles during block expansion.
export function preserveCADColours(fc){
 for(const feature of fc.features||[]){
  const props=feature.properties??={};
  const colour=String(props.OGR_STYLE||'').match(/(?:^|[,(;])c:(#[0-9a-f]{6})(?:[0-9a-f]{2})?(?=[,)])/i)?.[1];
  if(colour)props['CAD colour']=colour;
 }
 return fc;
}
