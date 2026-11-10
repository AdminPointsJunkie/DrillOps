import * as C from 'cesium';
import {openTerrainXYZ} from './lidar-xyz.js';
// Heightmap vertices are sampled at tile edges in Web Mercator (not pixel centres).
export function xyzTerrainProvider(settings,bounds,fallback,onError=()=>{},options={}){
 const scheme=new C.WebMercatorTilingScheme(),active=new Set();let closed=false,warned=false;
 const provider=new C.CustomHeightmapTerrainProvider({tilingScheme:scheme,width:33,height:33,credit:'Project elevation XYZ',callback:async(x,y,level)=>{
  if(closed)throw Error('Terrain source closed.');
  const source=openTerrainXYZ({...settings,zoom:Math.min(level,settings.zoom)},bounds,options),heights=new Float32Array(33*33),missing=[],positions=[],indices=[];active.add(source);let tileFailed=false;
  try{for(let row=0;row<33;row++)for(let col=0;col<33;col++){
   if(closed)throw Error('Terrain source closed.');
   const lon=(x+col/32)/2**level*360-180,merc=Math.PI*(1-2*(y+row/32)/2**level),lat=Math.atan(Math.sinh(merc))*180/Math.PI,index=row*33+col;let z=null;
   if(!tileFailed&&lon>=bounds[0]&&lon<=bounds[2]&&lat>=bounds[1]&&lat<=bounds[3])try{z=await source.sample([lon,lat]);}catch(error){tileFailed=true;if(!warned&&!closed){warned=true;onError('Project terrain tiles failed; using global terrain where available. '+error.message);} }
   if(Number.isFinite(z))heights[index]=z;else{missing.push(index);positions.push(C.Cartographic.fromDegrees(lon,lat));indices.push(index);}
  }
  if(missing.length){if(fallback){let samples;try{samples=await C.sampleTerrain(fallback,Math.min(level,14),positions);}catch{samples=positions;for(const p of samples)p.height=0;}for(let i=0;i<indices.length;i++)heights[indices[i]]=Number.isFinite(samples[i].height)?samples[i].height:0;}if(!warned&&!closed){warned=true;onError('Outside project terrain coverage or missing tiles: using global terrain, or the ellipsoid where global heights are unavailable.');}}
  return heights;
  }finally{active.delete(source);source.dispose();}
 }});
 return {provider,dispose(){closed=true;for(const source of active)source.dispose();active.clear();}};
}
