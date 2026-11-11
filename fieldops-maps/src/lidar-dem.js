import {fromBlob,fromCustomClient} from 'geotiff';
import proj4 from 'proj4';
import {rasterProjection} from './raster-sample.js';
// Some CDNs initially ignore Range. Cancel that body and retry once; never accept a full file.
function rangeClient(url){return {async request({headers,signal}){
 const requested=/^bytes=(\d+)-(\d+)$/.exec(headers.Range);
 if(!requested)throw Error('A bounded elevation byte range is required.');
 const start=Number(requested[1]),end=Number(requested[2]);
 for(let attempt=0;attempt<2;attempt++){
  const response=await fetch(url,{headers,signal,...(attempt?{cache:'no-store'}:{})});
  if(response.status===200){await response.body?.cancel();if(!attempt)continue;throw Error('The DEM server does not support partial downloads.');}
  const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
  if(response.status!==206||!range||Number(range[1])!==start||Number(range[2])!==Math.min(end,Number(range[3])-1)){
   await response.body?.cancel();throw Error('The DEM server returned an invalid byte range.');
  }
  const length=Number(range[2])-start+1;
  return {ok:true,status:206,getHeader:name=>response.headers.get(name),async getData(){
   const reader=response.body.getReader(),data=new Uint8Array(length);let offset=0;
   while(true){const {done,value}=await reader.read();if(done)break;if(offset+value.length>length){await reader.cancel();throw Error('The DEM response exceeded its requested byte range.');}data.set(value,offset);offset+=value.length;}
   if(offset!==length)throw Error('The DEM byte range was incomplete.');return data.buffer;
  }};
 }
}};}
// Windowed reads keep the original grid resolution without decoding an entire DEM.
export async function openDEM(file,{units='metres',datum='Unknown',band=1}={}){
 const controller=new AbortController(),remote=typeof file==='string';
 let tiff;
 try{tiff=remote?await fromCustomClient(rangeClient(file),{allowFullFile:false,blockSize:65536,cacheSize:32},controller.signal):await fromBlob(file);}catch(error){controller.abort();throw error;}
 const image=await tiff.getImage(),keys=image.getGeoKeys()||{},fd=image.fileDirectory;
 if(fd.ModelTransformation)throw Error('Rotated GeoTIFFs must be reprojected to a north-up DEM first.');
 if([2,3,6].includes(fd.PhotometricInterpretation))throw Error('This is a colour image. Select a numeric elevation DEM, not imagery or hillshade.');
 if(!Number.isInteger(band)||band<1||band>image.getSamplesPerPixel())throw Error('That elevation band does not exist.');
 const code=keys.ProjectedCSTypeGeoKey||keys.GeographicTypeGeoKey,projection=rasterProjection(code);
 const width=image.getWidth(),height=image.getHeight(),origin=image.getOrigin(),resolution=image.getResolution();
 if(width<2||height<2||!resolution.slice(0,2).every(v=>Number.isFinite(v)&&v!==0))throw Error('The DEM needs a valid georeferenced grid of at least 2 × 2 cells.');
 const pointGrid=keys.GTRasterTypeGeoKey===2,shift=pointGrid?0:.5,rawNoData=image.getGDALNoData(),nodata=rawNoData==null?null:Number(rawNoData);
 const metadata=image.getGDALMetadata(band-1)||{},scale=Number(metadata.SCALE??metadata.Scale??1),offset=Number(metadata.OFFSET??metadata.Offset??0),factor=units==='feet'?.3048:1;
 if(!Number.isFinite(scale)||!Number.isFinite(offset))throw Error('Invalid DEM elevation scale or offset.');
 const cache=new Map();
 async function cell(x,y){
  const tx=Math.floor(x/128)*128,ty=Math.floor(y/128)*128,key=`${tx},${ty}`;
  if(controller.signal.aborted)throw Error('DEM closed.');
  if(!cache.has(key)){const x2=Math.min(width,tx+128),y2=Math.min(height,ty+128);cache.set(key,image.readRasters({window:[tx,ty,x2,y2],samples:[band-1],signal:controller.signal}).then(r=>({data:r[0],stride:x2-tx})).catch(e=>{cache.delete(key);throw e;}));if(cache.size>16)cache.delete(cache.keys().next().value);}
  const {data,stride}=await cache.get(key),v=data[(y-ty)*stride+x-tx];return !Number.isFinite(v)||(nodata!==null&&v===nodata)?null:(v*scale+offset)*factor;
 }
 const coordinate=(col,row)=>proj4(projection,'EPSG:4326',[origin[0]+(col+shift)*resolution[0],origin[1]+(row+shift)*resolution[1]]);
 async function sample(ll){const [x,y]=proj4('EPSG:4326',projection,ll);let c=(x-origin[0])/resolution[0]-shift,r=(y-origin[1])/resolution[1]-shift;
  // Small round-off tolerance at exact grid centres, never extrapolate outside.
  if(c< -1e-6||r< -1e-6||c>width-1+1e-6||r>height-1+1e-6)return null;c=Math.max(0,Math.min(width-1,c));r=Math.max(0,Math.min(height-1,r));
  const x0=Math.floor(c),y0=Math.floor(r),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),dx=c-x0,dy=r-y0;
  const corners=[[x0,y0,(1-dx)*(1-dy)],[x1,y0,dx*(1-dy)],[x0,y1,(1-dx)*dy],[x1,y1,dx*dy]].filter(v=>v[2]>1e-10);let z=0;
  for(const [cx,cy,w] of corners){const v=await cell(cx,cy);if(v===null)return null;z+=v*w;}return z;
 }
 // Display reads use an appropriate overview; analytical sampling above always uses image 0.
 async function readPreview(bbox,w,h){
  // Include at least one native pixel even when the map is zoomed past DEM resolution.
  bbox=[...bbox];for(const [a,b,r] of [[0,2,Math.abs(resolution[0])],[1,3,Math.abs(resolution[1])]])if(bbox[b]-bbox[a]<r){const mid=(bbox[a]+bbox[b])/2;bbox[a]=mid-r;bbox[b]=mid+r;}
  const data=await tiff.readRasters({bbox,width:w,height:h,samples:[band-1],interleave:true,fillValue:rawNoData??NaN,signal:controller.signal});
  return {bbox,data:Float32Array.from(data,v=>!Number.isFinite(v)||(nodata!==null&&v===nodata)?NaN:(v*scale+offset)*factor)};
 }
 return {name:remote?new URL(file).pathname.split('/').pop():file.name,width,height,code,datum,units,coordinate,sample,readPreview,projection,
  dispose:()=>{controller.abort();cache.clear();void tiff.close();}};
}
