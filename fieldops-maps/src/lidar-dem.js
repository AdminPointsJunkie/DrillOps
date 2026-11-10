import {fromBlob} from 'geotiff';
import proj4 from 'proj4';
import {rasterProjection} from './raster-sample.js';
// Windowed reads keep the original grid resolution without decoding an entire DEM.
export async function openDEM(file,{units='metres',datum='Unknown',band=1}={}){
 const tiff=await fromBlob(file),image=await tiff.getImage(),keys=image.getGeoKeys()||{},fd=image.fileDirectory;
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
  if(!cache.has(key)){const x2=Math.min(width,tx+128),y2=Math.min(height,ty+128);cache.set(key,image.readRasters({window:[tx,ty,x2,y2],samples:[band-1]}).then(r=>({data:r[0],stride:x2-tx})));if(cache.size>32)cache.delete(cache.keys().next().value);}
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
 return {name:file.name,width,height,code,datum,units,coordinate,sample,dispose:()=>cache.clear()};
}
