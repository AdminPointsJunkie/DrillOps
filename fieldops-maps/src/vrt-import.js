const MAX_BYTES=250*1024*1024;
export async function prepareVRT(file,available=[]){
 const doc=new DOMParser().parseFromString(await file.text(),'application/xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='VRTDataset')throw Error('Invalid VRT dataset.');
 if(doc.querySelector('PixelFunctionCode,PixelFunctionType'))throw Error('VRT pixel functions are not supported in the browser. Export a GeoTIFF instead.');
 const references=[...doc.querySelectorAll('SourceFilename')];if(!references.length)throw Error('The VRT does not reference any source rasters.');
 const fetched=new Map();let total=0;
 for(const node of references){const path=node.textContent.trim();if(!fetched.has(path)){
  if(fetched.size>=25)throw Error('A browser VRT can reference up to 25 source rasters.');
  let source=available.find(f=>f.name===path||f.name===path.replace(/^\.\//,''));
  if(!source){
   let url;try{url=new URL(path.replace(/^\/vsicurl\//,''));}catch{throw Error(`Include ${path} in the upload, or use an HTTPS source URL in the VRT.`);}
   if(url.protocol!=='https:'||url.username||url.password)throw Error('VRT sources must use HTTPS URLs without embedded passwords.');
   const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error(`Could not download VRT source (${response.status}).`);
   if(Number(response.headers.get('Content-Length'))>MAX_BYTES-total)throw Error('VRT source rasters exceed the 250 MB browser limit.');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(total+size>MAX_BYTES)throw Error('VRT source rasters exceed the 250 MB browser limit.');chunks.push(value);}}catch(e){await reader.cancel();throw e;}
   source=new File(chunks,url.pathname.split('/').at(-1)||'source.tif');
  }
  total+=source.size;if(total>MAX_BYTES)throw Error('VRT source rasters exceed the 250 MB browser limit.');
  const ext=source.name.match(/\.[^.\/]+$/)?.[0]||'.tif';fetched.set(path,new File([source],`vrt_source_${fetched.size}${ext}`));
 }
 node.textContent=fetched.get(path).name;node.setAttribute('relativeToVRT','1');
 }
 return [new File([new XMLSerializer().serializeToString(doc)],file.name),...fetched.values()];
}
