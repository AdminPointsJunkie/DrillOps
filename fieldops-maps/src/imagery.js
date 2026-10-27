const service='https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const cache=new Map();
async function loadImage(z,x,y){
 const key=`${z}/${y}/${x}`;
 if(!cache.has(key)){
  // Missing-tile responses do not always carry CORS headers. Image loading
  // still reports failure, allowing a parent fallback without fetching pixels.
  const request=new Promise((resolve,reject)=>{
   const image=new Image();
   const timeout=setTimeout(()=>{image.onload=image.onerror=null;reject(Error('Satellite imagery request timed out.'));},15000);
   image.onload=()=>{clearTimeout(timeout);resolve(image);};
   image.onerror=()=>{clearTimeout(timeout);resolve(null);};
   image.src=`${service}/tile/${key}?blankTile=false`;
  }).catch(error=>{cache.delete(key);throw error;});
  cache.set(key,request);
  if(cache.size>256)cache.delete(cache.keys().next().value);
 }
 return cache.get(key);
}

export async function availableImagery(coords,load=loadImage){
 const start=Math.min(coords.z,19);
 for(let z=start;z>=Math.max(0,start-6);z--){
  const scale=2**(coords.z-z),x=Math.floor(coords.x/scale),y=Math.floor(coords.y/scale);
  const image=await load(z,x,y);
  if(image)return {image,sx:(coords.x-x*scale)*image.width/scale,sy:(coords.y-y*scale)*image.height/scale,
   width:image.width/scale,height:image.height/scale,sourceZoom:z};
 }
 throw Error('No satellite imagery is available here.');
}

export function imageryLayer(L){
 const CoverageLayer=L.GridLayer.extend({
  createTile(coords,done){
   const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
   availableImagery(coords).then(tile=>{
    canvas.getContext('2d').drawImage(tile.image,tile.sx,tile.sy,tile.width,tile.height,0,0,256,256);
    done(null,canvas);
   }).catch(error=>{console.warn('Satellite tile:',error.message);done(error,canvas);});
   return canvas;
  },
 });
 return new CoverageLayer({maxZoom:22,maxNativeZoom:19,tileSize:256,
  attribution:'Tiles © Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'});
}
