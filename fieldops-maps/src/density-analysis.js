import {bbox,hexGrid,booleanPointInPolygon,featureCollection} from '@turf/turf';
const R=6378137,rad=Math.PI/180;
const project=([x,y])=>[R*x*rad,R*Math.log(Math.tan(Math.PI/4+y*rad/2))];
const unproject=([x,y])=>[x/R/rad,(2*Math.atan(Math.exp(y/R))-Math.PI/2)/rad];
export function hexSummary(source,size){
 if(!source.features.every(f=>f.geometry?.type==='Point'))throw Error('Choose a point layer.');if(!Number.isFinite(size)||size<10||size>100000)throw Error('Choose a hexagon side length from 10 to 100,000 metres.');
 const b=bbox(source),pad=size/111000*3/Math.max(.05,Math.cos((b[1]+b[3])/2*rad)),extent=[b[0]-pad,b[1]-pad,b[2]+pad,b[3]+pad];
 const width=(extent[2]-extent[0])*111000*Math.cos((b[1]+b[3])/2*rad),height=(extent[3]-extent[1])*111000;
 if(width*height/(size*size)>5000)throw Error('Choose larger hexagons or a smaller area (up to about 2,000 cells).');
 const grid=hexGrid(extent,size/1000,{units:'kilometers'});if(grid.features.length>2000||grid.features.length*source.features.length>5000000)throw Error('Choose larger cells or fewer points for this browser analysis.');
 grid.features.forEach(f=>f.properties={point_count:0});for(const p of source.features){const cell=grid.features.find(c=>booleanPointInPolygon(p,c));if(cell)cell.properties.point_count++;}
 return featureCollection(grid.features.filter(c=>c.properties.point_count));
}
export async function heatmapRaster(source,radius){
 if(!source.features.every(f=>f.geometry?.type==='Point'&&Math.abs(f.geometry.coordinates[1])<85))throw Error('Heatmaps require points between 85° south and north.');
 if(!Number.isFinite(radius)||radius<10||radius>100000)throw Error('Choose a smoothing radius from 10 to 100,000 metres.');
 const raw=bbox(source);if(raw[2]-raw[0]>180)throw Error('Split points that cross the date line.');
 const scale=1/Math.cos((raw[1]+raw[3])/2*rad),sigma=radius*scale,points=source.features.map(f=>project(f.geometry.coordinates));
 const b=[Math.min(...points.map(p=>p[0]))-3*sigma,Math.min(...points.map(p=>p[1]))-3*sigma,Math.max(...points.map(p=>p[0]))+3*sigma,Math.max(...points.map(p=>p[1]))+3*sigma];
 const w=384,h=Math.max(32,Math.min(384,Math.round(w*(b[3]-b[1])/(b[2]-b[0])))),dx=(b[2]-b[0])/w,dy=(b[3]-b[1])/h,rx=Math.ceil(3*sigma/dx),ry=Math.ceil(3*sigma/dy);
 if(points.length*Math.min(w,2*rx+1)*Math.min(h,2*ry+1)>25000000)throw Error('Use fewer points or a smaller radius for this browser heatmap.');
 const cells=new Float32Array(w*h);let peak=0;
 for(const [px,py] of points){const cx=(px-b[0])/dx,cy=(b[3]-py)/dy;for(let y=Math.max(0,Math.floor(cy-ry));y<Math.min(h,cy+ry);y++)for(let x=Math.max(0,Math.floor(cx-rx));x<Math.min(w,cx+rx);x++){const v=Math.exp(-(((x+.5-cx)*dx)**2+((y+.5-cy)*dy)**2)/(2*sigma*sigma));cells[y*w+x]+=v;peak=Math.max(peak,cells[y*w+x]);}}
 if(typeof OffscreenCanvas==='undefined')throw Error('This browser does not support background heatmap rendering. Use hexagon summaries instead.');
 const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(w,h);
 for(let i=0;i<cells.length;i++){const t=cells[i]/peak;pixels.data[i*4]=255;pixels.data[i*4+1]=Math.round(255*(1-t));pixels.data[i*4+2]=Math.round(80*(1-t));pixels.data[i*4+3]=Math.round(Math.min(1,t*4)*220);}
 ctx.putImageData(pixels,0,0);const lo=unproject(b.slice(0,2)),hi=unproject(b.slice(2));return {raster:true,blob:await canvas.convertToBlob({type:'image/png'}),bounds:[...lo,...hi],count:points.length};
}
