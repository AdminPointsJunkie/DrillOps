import proj4 from 'proj4';
import {openDEM} from './lidar-dem.js';
import {rasterProjection} from './raster-sample.js';

export const IRONBARK_DEM_URL='https://tiles.drillops.com.au/ironbark-dem-2024/catalog.json';
function webURL(value,base){
 const url=new URL(value,base);
 if(url.username||url.password||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw Error('Use an HTTPS DEM URL without account credentials.');
 return url.href;
}
const boundsOK=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3];
export function validateDEMCatalog(data,url){
 if(data?.type!=='fieldmaps-dem-catalog'||data.version!==1||!boundsOK(data.bbox)||!Array.isArray(data.tiles)||!data.tiles.length||data.tiles.length>1000)throw Error('This URL is not a supported DEM collection.');
 const tiles=data.tiles.map(t=>{
  if(!boundsOK(t.bounds)||!boundsOK(t.bbox)||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<2||t.height<2)throw Error('Invalid DEM tile bounds or dimensions.');
  const code=Number(String(t.crs||data.crs).replace('EPSG:',''));
  return {...t,url:webURL(t.href,url),code,projection:rasterProjection(code)};
 });
 return {...data,tiles};
}
export async function openCloudDEM(url,{datum='',loadDEM=openDEM,fetcher=fetch}={}){
 url=webURL(url);const controller=new AbortController();
 const response=await fetcher(url,{signal:controller.signal});
 if(!response.ok)throw Error(`Could not load DEM collection (${response.status}).`);
 const limit=2*1024*1024;
 if(Number(response.headers?.get('Content-Length'))>limit){controller.abort();throw Error('DEM collection is too large.');}
 let text='';
 if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>limit){await reader.cancel();throw Error('DEM collection is too large.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
 else text=await response.text();
 if(text.length>limit)throw Error('DEM collection is too large.');
 const catalog=validateDEMCatalog(JSON.parse(text),url),opened=new Map();let closed=false;
 async function get(tile){
  if(closed)throw Error('DEM closed.');
  if(!opened.has(tile.url))opened.set(tile.url,loadDEM(tile.url,{band:tile.band||1,units:catalog.units||'metres',datum:datum||catalog.verticalDatum||'Unknown'}).then(d=>{if(closed){d.dispose();throw Error('DEM closed.');}return d;}).catch(e=>{opened.delete(tile.url);throw e;}));
  return opened.get(tile.url);
 }
 async function sample(ll){
  if(closed)throw Error('DEM closed.');
  for(const tile of [...catalog.tiles].reverse()){
   const [x,y]=proj4('EPSG:4326',tile.projection,ll),b=tile.bounds;
   if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;
   const value=await (await get(tile)).sample(ll);if(value!==null)return value;
  }return null;
 }
 const [west,south,east,north]=catalog.bbox;
 // A bounded geographic inspection mesh; native resolution remains available through sample().
 const coordinate=(x,y)=>[west+x/63*(east-west),north+y/63*(south-north)];
 return {name:catalog.name||'Cloud DEM',width:64,height:64,code:catalog.tiles[0].code,datum:datum||catalog.verticalDatum||'Unknown',
  units:catalog.units||'metres',coordinate,sample,catalog,get,url,cloud:true,bounds:catalog.bbox,
  dispose(){closed=true;controller.abort();for(const p of opened.values())p.then(d=>d.dispose()).catch(()=>{});opened.clear();}};
}

export function elevationColor(z,min,max,mode='colour'){
 if(!Number.isFinite(z))return [0,0,0,0];
 const v=Math.max(0,Math.min(1,(z-min)/(max-min||1)));
 if(mode==='grey')return [Math.round(255*v),Math.round(255*v),Math.round(255*v),255];
 const stops=[[35,72,116],[66,136,115],[174,186,112],[172,129,91],[249,247,239]],p=v*4,i=Math.min(3,Math.floor(p)),u=p-i;
 return [...stops[i].map((a,k)=>Math.round(a+(stops[i+1][k]-a)*u)),255];
}

// One bounded viewport image. Pan/zoom selects overview windows; no whole-DEM reads.
export function cloudDEMOverlay({L,map,dem,settings,pane,onStatus=()=>{}}){
 let overlay=null,closed=false,generation=0,running=false,queued=false,lastGrid=null;
 async function render(){
  generation++;queued=true;if(running||closed)return;
  running=true;
  try{while(queued&&!closed){
   queued=false;const token=generation,b=map.getBounds(),size=map.getSize();
   const width=Math.max(2,Math.min(640,Math.round(size.x))),height=Math.max(2,Math.round(width*size.y/size.x));
   const h=Math.min(640,height),w=height>640?Math.max(2,Math.round(width*640/height)):width;
   const nw=map.project([b.getNorth(),b.getWest()],0),se=map.project([b.getSouth(),b.getEast()],0);
   const longitude=new Float64Array(w),latitude=new Float64Array(h);
   for(let x=0;x<w;x++)longitude[x]=map.unproject([nw.x+(x+.5)/w*(se.x-nw.x),nw.y],0).lng;
   for(let y=0;y<h;y++)latitude[y]=map.unproject([nw.x,nw.y+(y+.5)/h*(se.y-nw.y)],0).lat;
   const grid=new Float32Array(w*h).fill(NaN),pxs=new Float64Array(w*h),pys=new Float64Array(w*h);let lastProjection='';onStatus('Loading visible elevation blocks…');
   for(const tile of dem.catalog.tiles){
    if(closed||token!==generation)break;
    const bb=tile.bbox;if(bb[2]<b.getWest()||bb[0]>b.getEast()||bb[3]<b.getSouth()||bb[1]>b.getNorth())continue;
    const transform=proj4('EPSG:4326',tile.projection),corners=[[b.getWest(),b.getSouth()],[b.getEast(),b.getSouth()],[b.getWest(),b.getNorth()],[b.getEast(),b.getNorth()]].map(ll=>transform.forward(ll));
    const native=[Math.max(tile.bounds[0],Math.min(...corners.map(p=>p[0]))),Math.max(tile.bounds[1],Math.min(...corners.map(p=>p[1]))),Math.min(tile.bounds[2],Math.max(...corners.map(p=>p[0]))),Math.min(tile.bounds[3],Math.max(...corners.map(p=>p[1])))];
    if(!boundsOK(native))continue;
    const dx=(Math.max(...corners.map(p=>p[0]))-Math.min(...corners.map(p=>p[0])))/w,dy=(Math.max(...corners.map(p=>p[1]))-Math.min(...corners.map(p=>p[1])))/h;
    const rw=Math.max(2,Math.min(640,Math.ceil((native[2]-native[0])/dx))),rh=Math.max(2,Math.min(640,Math.ceil((native[3]-native[1])/dy)));
    const preview=await (await dem.get(tile)).readPreview(native,rw,rh),data=preview.data,actual=preview.bbox;
    if(closed||token!==generation)break;
    if(lastProjection!==tile.projection){for(let y=0;y<h;y++){
     if(y%32===0){await new Promise(resolve=>setTimeout(resolve,0));if(closed||token!==generation)break;}
     for(let x=0;x<w;x++){const p=transform.forward([longitude[x],latitude[y]]);pxs[y*w+x]=p[0];pys[y*w+x]=p[1];}
    }lastProjection=tile.projection;}
    if(closed||token!==generation)break;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     const px=pxs[y*w+x],py=pys[y*w+x],cx=Math.floor((px-actual[0])/(actual[2]-actual[0])*rw),cy=Math.floor((actual[3]-py)/(actual[3]-actual[1])*rh);
     if(cx>=0&&cx<rw&&cy>=0&&cy<rh&&Number.isFinite(data[cy*rw+cx]))grid[y*w+x]=data[cy*rw+cx];
    }
   }
   if(closed||token!==generation)continue;
   lastGrid={grid,w,h,b};paint();onStatus('Elevation layer ready · analysis uses full-resolution cells.');
  }}catch(e){if(!closed)onStatus('Elevation display: '+e.message);}finally{running=false;}
 }
 function paint(){
  if(!lastGrid||closed)return;const {grid,w,h,b}=lastGrid,s=settings(),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d'),im=ctx.createImageData(w,h);
  const good=Array.from(grid).filter(Number.isFinite);if(!good.length){overlay?.remove();overlay=null;return;}
  const min=Number.isFinite(s.min)?s.min:good.reduce((a,v)=>Math.min(a,v),Infinity),max=Number.isFinite(s.max)?s.max:good.reduce((a,v)=>Math.max(a,v),-Infinity);
  for(let i=0;i<grid.length;i++)im.data.set(elevationColor(grid[i],min,max,s.mode),i*4);
  ctx.putImageData(im,0,0);overlay?.remove();overlay=L.imageOverlay(canvas.toDataURL(),b,{...(pane?{pane}:{}),opacity:s.opacity??.7,interactive:false}).addTo(map);
 }
 const move=()=>void render();map.on('moveend',move);void render();
 return {repaint:paint,dispose(){closed=true;generation++;map.off('moveend',move);overlay?.remove();}};
}
