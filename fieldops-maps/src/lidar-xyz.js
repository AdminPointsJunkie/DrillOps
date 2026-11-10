import {xyzSettings} from './xyz.js';
export function terrainXYZSettings(input){
 const base=xyzSettings({...input,minZoom:0,maxZoom:input.zoom});
 if(!['terrain-rgb','terrarium'].includes(input.encoding))throw Error('Choose Terrain-RGB or Terrarium encoding.');
 if(/\{[sr]\}/.test(base.url))throw Error('Use a single tile host and explicit tile size; remove {s} and {r}.');
 const tileSize=Number(input.tileSize||256);if(![256,512].includes(tileSize))throw Error('Terrain tiles must be 256 or 512 pixels square.');
 const noData=input.noData===''||input.noData==null?null:Number(input.noData);if(noData!==null&&!Number.isFinite(noData))throw Error('NoData must be a number or blank.');
 return {url:base.url,zoom:base.maxZoom,tileSize,encoding:input.encoding,noData,datum:String(input.datum||'Unknown')};
}
export function decodeElevation(r,g,b,encoding){return encoding==='terrain-rgb'?-10000+(r*65536+g*256+b)*.1:r*256+g+b/256-32768;}
export function worldPixel([lon,lat],zoom,size){if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>85.05112878||Math.abs(lon)>180)return null;const sin=Math.sin(lat*Math.PI/180),scale=size*2**zoom;return [(lon+180)/360*scale-.5,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale-.5];}
async function loadTile(url,signal){
 const response=await fetch(url,{signal,mode:'cors',credentials:'omit'});
 if(response.status===404||response.status===204)return null;
 if(!response.ok)throw Error(`Terrain tile request failed (${response.status}). Check the URL and browser-safe key.`);
 const blob=await response.blob();if(!['image/png','image/webp','application/octet-stream',''].includes(blob.type))throw Error('Use lossless PNG or WebP elevation tiles, not JPEG or a terrain mesh service.');
 const bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};}finally{bitmap.close();}
}
export function openTerrainXYZ(input,bounds,{readTile=loadTile}={}){
 const settings=terrainXYZSettings(input),{zoom,tileSize,encoding,noData}=settings,n=2**zoom,cache=new Map(),controller=new AbortController();let count=0,disposed=false;
 if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||bounds[0]<-180||bounds[2]>180||bounds[1]<-85.05112878||bounds[3]>85.05112878)throw Error('Zoom to your site within Web Mercator coverage before loading terrain XYZ. Views crossing the date line are not supported.');
 async function tile(x,y){if(disposed)throw Error('Terrain source closed.');x=(x%n+n)%n;if(y<0||y>=n)return null;const key=`${x}/${y}`;
  if(!cache.has(key)){if(++count>512)throw Error('Terrain request limit reached. Reload at a lower zoom or use a smaller area (512 tiles per session).');const url=settings.url.replaceAll('{z}',zoom).replaceAll('{x}',x).replaceAll('{y}',y);const timeout=new AbortController(),abort=()=>timeout.abort();controller.signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);
   const pending=readTile(url,timeout.signal).then(image=>{if(image&&(image.width!==tileSize||image.height!==tileSize||image.data.length!==tileSize*tileSize*4))throw Error(`Tile dimensions differ from ${tileSize} × ${tileSize}. Choose the correct tile size.`);return image;}).catch(error=>{cache.delete(key);throw error;}).finally(()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);});cache.set(key,pending);if(cache.size>64)cache.delete(cache.keys().next().value);
  }return cache.get(key);
 }
 async function cell(x,y){const image=await tile(Math.floor(x/tileSize),Math.floor(y/tileSize));if(!image)return null;const px=(x%tileSize+tileSize)%tileSize,py=(y%tileSize+tileSize)%tileSize,i=(py*tileSize+px)*4;if(image.data[i+3]!==255)return null;const z=decodeElevation(...image.data.slice(i,i+3),encoding);return noData!==null&&Math.abs(z-noData)<1e-7?null:z;}
 async function sample(ll){const p=worldPixel(ll,zoom,tileSize);if(!p)return null;const [x,y]=p,x0=Math.floor(x),y0=Math.floor(y),dx=x-x0,dy=y-y0;let value=0;
  for(const [cx,cy,w] of [[x0,y0,(1-dx)*(1-dy)],[x0+1,y0,dx*(1-dy)],[x0,y0+1,(1-dx)*dy],[x0+1,y0+1,dx*dy]])if(w>1e-10){const z=await cell(cx,cy);if(z===null)return null;value+=w*z;}return value;
 }
 const [west,south,east,north]=bounds;
 return {name:`${encoding} XYZ · z${zoom}`,code:3857,width:64,height:64,datum:settings.datum,units:'metres',settings,coordinate:(x,y)=>[west+(east-west)*x/63,north-(north-south)*y/63],sample,dispose(){disposed=true;controller.abort();cache.clear();}};
}
