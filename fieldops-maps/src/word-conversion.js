export const isWordDocument=file=>/\.docx?$/i.test(file.name);
// Open synchronously from the file-picker/drop gesture. The separate page isolates
// LibreOffice without changing the map's authentication, tile or popup headers.
export function startWordConversion({progress=()=>{}}={}){
 const id=crypto.randomUUID(),channel=new BroadcastChannel('fieldmaps-office-'+id),url=new URL(`office/index.html#${id}`,new URL(import.meta.env?.BASE_URL||'/maps/',location.origin));
 let pending=null,closed=false,ready=false,resolveReady,rejectReady;
 const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});readyPromise.catch(()=>{});
 const popup=window.open(url.href,'_blank','popup,width=720,height=520');
 let timer;const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>cancel('The converter did not respond. Please try again.'),300000);};arm();const ping=setInterval(()=>{if(!ready)channel.postMessage({type:'ping'});},500);
 channel.onmessage=({data})=>{
  if(data.type==='ready'){ready=true;resolveReady();clearInterval(ping);}
  else if(data.type==='progress')progress(data.message,data.value);
  else if(data.type==='error')cancel(data.message||'The Word document could not be converted.');
  else if(data.type==='result'&&pending){const current=pending;pending=null;clearTimeout(timer);current.resolve(new File([data.bytes],data.name,{type:'application/pdf'}));}
 };
 function cancel(message='PDF conversion cancelled. Your Word file was not uploaded.'){
  if(closed)return;channel.postMessage({type:'cancel'});pending?.reject(Error(message));pending=null;rejectReady(Error(message));finish();
 }
 function finish(){if(closed)return;closed=true;clearTimeout(timer);clearInterval(ping);channel.postMessage({type:'finish'});channel.close();}
 return {url:url.href,popup,open:()=>window.open(url.href,'_blank','popup,width=720,height=520'),cancel,finish,async convert(file){
  if(closed)throw Error('Conversion cancelled.');await readyPromise;if(closed)throw Error('Conversion cancelled.');if(pending)throw Error('Wait for the current document to finish.');arm();
  const bytes=new Uint8Array(await file.arrayBuffer());if(closed)throw Error('Conversion cancelled.');return new Promise((resolve,reject)=>{pending={resolve,reject};channel.postMessage({type:'convert',name:file.name,bytes});});
 }};
}
