export const imagePattern=/\.(png|jpe?g|webp|gif|bmp|heic|heif|svg|pdf)$/i;
export const IMAGE_LIMIT=20*1024*1024;
const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not render image.')),'image/png'));
export function imageBounds({lng,lat,width,rotation=0},ratio){
 if(![lng,lat,width,rotation,ratio].every(Number.isFinite)||Math.abs(lat)>80||Math.abs(lng)>180||width<=0||width>1000000||ratio<=0)throw Error('Enter a valid location and width between 1 and 1,000,000 metres. Image annotations must be between 80°S and 80°N.');
 const rad=rotation*Math.PI/180,w=width,h=width/ratio;
 const dx=(Math.abs(Math.cos(rad))*w+Math.abs(Math.sin(rad))*h)/2;
 const dy=(Math.abs(Math.sin(rad))*w+Math.abs(Math.cos(rad))*h)/2;
 // Leaflet image overlays use Web Mercator: compute the rectangle in that plane.
 const r=6378137,x=r*lng*Math.PI/180,y=r*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360)),scale=1/Math.cos(lat*Math.PI/180);
 const lon=x=>x/r*180/Math.PI,latitude=y=>(2*Math.atan(Math.exp(y/r))-Math.PI/2)*180/Math.PI;
 const bounds=[lon(x-dx*scale),latitude(y-dy*scale),lon(x+dx*scale),latitude(y+dy*scale)];
 if(bounds[0]<-180||bounds[2]>180)throw Error('This annotation crosses the date line. Move it or reduce its width.');return bounds;
}
async function bitmap(blob){
 const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}
}
export async function readImages(file,files=[file]){
 if(file.size>IMAGE_LIMIT)throw Error('Images and PDFs must be 20 MB or smaller.');
 const name=file.name.replace(/\.[^.]+$/,''),format=file.name.split('.').at(-1).toUpperCase();
 const make=(blob,width,height,page,gps)=>({name:page?`${name} — Page ${page}`:name,layerName:page?String(page):undefined,kind:'raster',format,files,image:{blob,width,height,gps},source:'EPSG:4326',count:0,hasTransform:true,info:{size:[width,height]}});
 if(format==='PDF'){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
  const pdf=await task.promise;try{if(pdf.numPages>25)throw Error('Import a PDF of up to 25 pages.');const items=[];
   for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){const page=await pdf.getPage(pageNo),size=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(1536/size.width,1536/size.height)});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;items.push(make(await toBlob(canvas),canvas.width,canvas.height,pageNo));page.cleanup();}
   return items;
  }finally{await task.destroy();}
 }
 let blob=file,gps;try{const exifr=await import('exifr');gps=await exifr.gps(file);}catch{}
 if(['HEIC','HEIF'].includes(format)){const {heicTo}=await import('heic-to/csp');blob=await heicTo({blob:file,type:'image/png'});}
 if(format==='SVG'){
  const doc=new DOMParser().parseFromString(await file.text(),'image/svg+xml');if(doc.querySelector('parsererror'))throw Error('Invalid SVG image.');
  for(const el of doc.querySelectorAll('script,foreignObject,iframe,object,embed'))el.remove();
  for(const el of doc.querySelectorAll('*'))for(const attr of [...el.attributes])if(/^on/i.test(attr.name)||(/href$/i.test(attr.name)&&!attr.value.startsWith('#')))el.removeAttribute(attr.name);
  blob=new Blob([new XMLSerializer().serializeToString(doc)],{type:'image/svg+xml'});
 }
 const img=await bitmap(blob);if(img.width*img.height>80000000)throw Error('This image is too large. Resize it below 80 megapixels.');
 const scale=Math.min(1,1536/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
 return [make(await toBlob(canvas),canvas.width,canvas.height,undefined,gps)];
}
export async function convertImage(item,settings){
 const placement=settings.image;const {width,height}=item.image;const bounds=imageBounds(placement,width/height);
 const img=await bitmap(item.image.blob),rad=placement.rotation*Math.PI/180,canvas=document.createElement('canvas');
 canvas.width=Math.ceil(Math.abs(Math.cos(rad))*width+Math.abs(Math.sin(rad))*height);canvas.height=Math.ceil(Math.abs(Math.sin(rad))*width+Math.abs(Math.cos(rad))*height);
 const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rad);ctx.drawImage(img,-width/2,-height/2,width,height);
 return {blob:await toBlob(canvas),bounds};
}
