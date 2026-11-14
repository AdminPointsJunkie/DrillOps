const id=location.hash.slice(1),status=document.querySelector('#status'),bar=document.querySelector('#progress');
let converter,stopped=false,working=false,finished=false;
const validSession=/^[a-f0-9-]{36}$/.test(id),channel=validSession?new BroadcastChannel('fieldmaps-office-'+id):null;
function cancelled(){if(stopped||finished)return;stopped=true;converter?.destroy();channel?.postMessage({type:'error',message:'PDF conversion cancelled. Your Word file was not uploaded.'});status.textContent='Conversion cancelled.';bar.hidden=true;}
document.querySelector('#cancel').onclick=cancelled;
channel&&(channel.onmessage=({data})=>{if(data.type==='cancel'||data.type==='finish'){cancelled();finished=true;channel.close();window.close();}});
function progress(message,value){status.textContent=message;if(Number.isFinite(value))bar.value=value;else bar.removeAttribute('value');channel?.postMessage({type:'progress',message,value});}
function fail(message){progress(message);bar.hidden=true;channel?.postMessage({type:'error',message});}
async function initialize(){
 if(!validSession)throw Error('Open the converter by choosing a Word file in Supporting Files.');
 if(!navigator.serviceWorker||!globalThis.DecompressionStream)throw Error('This browser cannot run the Word converter. Use a current desktop browser.');
 const registration=await navigator.serviceWorker.register('./isolation-sw.js',{scope:'./'});
 const installing=registration.installing;if(installing&&installing.state!=='activated')await new Promise((resolve,reject)=>{installing.addEventListener('statechange',()=>{if(installing.state==='activated')resolve();else if(installing.state==='redundant')reject(Error('The converter could not update. Please reopen it.'));});});
 await navigator.serviceWorker.ready;
 if(!crossOriginIsolated){
  if(sessionStorage.getItem('office-isolation-retry')===id)throw Error('Browser isolation could not start. Close this tab and try again.');
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  sessionStorage.setItem('office-isolation-retry',id);location.reload();return;
 }
 sessionStorage.removeItem('office-isolation-retry');if(stopped)return;
 addEventListener('pagehide',cancelled);
 channel.onmessage=async({data})=>{
  if(!data)return;
  if(data.type==='ping'){channel.postMessage({type:'ready'});return;}
  if(data.type==='cancel'){cancelled();return;}
  if(data.type==='finish'){finished=true;converter?.destroy();channel.close();window.close();return;}
  if(data.type!=='convert'||working||stopped)return;working=true;
  try{
   if(!/\.docx?$/i.test(data.name)||!(data.bytes instanceof Uint8Array)||!data.bytes.length||data.bytes.length>50*1024*1024)throw Error('Choose a Word document up to 50 MB.');
   if(!converter){
    progress('Downloading PDF conversion engine…',0);
    const manifest=await (await fetch('./runtime-2.7.2-fm3/manifest.json')).json(),total=manifest.files.reduce((n,f)=>n+f.compressedSize,0);let loaded=0;
    for(const file of manifest.files){const response=await fetch('./runtime-2.7.2-fm3/'+file.name+'.gz.bin');if(!response.ok)throw Error('Could not download the conversion engine.');const reader=response.body.getReader();while(true){const part=await reader.read();if(part.done)break;loaded+=part.value.length;progress(`Downloading conversion engine… ${Math.min(100,Math.round(loaded/total*100))}%`,Math.min(60,loaded/total*60));if(stopped){await reader.cancel();return;}}}
    progress('Starting the PDF conversion engine…',62);
    const {WorkerBrowserConverter,createWasmPaths}=await import('./runtime-2.7.2-fm3/browser.js');
    const base=new URL('./runtime-2.7.2-fm3/',location.href).href;
    converter=new WorkerBrowserConverter({...createWasmPaths(base),browserWorkerJs:base+'browser.worker.global.js',onProgress:info=>{if(!stopped)progress(info.message||'Converting to PDF…',undefined);}});
    await converter.initialize();
   }
   if(stopped)return;progress(`Converting ${data.name} to PDF…`,75);
   const converted=await converter.convert(data.bytes,{outputFormat:'pdf',filterOptions:JSON.stringify({UseLosslessCompression:{type:'boolean',value:'true'},ReduceImageResolution:{type:'boolean',value:'false'}})},data.name);
   if(stopped)return;
   if(!converted.data?.length||new TextDecoder().decode(converted.data.subarray(0,5))!=='%PDF-')throw Error('The converter did not produce a valid PDF.');
   progress('PDF ready. Saving to your map…',90);channel.postMessage({type:'result',bytes:converted.data,name:converted.filename});
  }catch(e){if(!stopped)fail(e.message||'The Word document could not be converted.');}finally{working=false;}
 };
 channel.postMessage({type:'ready'});progress('Waiting for your Word document…',0);
}
initialize().catch(e=>fail(e.message));
