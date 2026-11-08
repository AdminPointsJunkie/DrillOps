import earcut from 'earcut';
export function sourceGeometry(feature){return feature.properties?._fieldmaps_kml_original_geometry||feature.geometry;}
export function geometryParts(geometry,result=[]){
 if(!geometry)return result;
 const c=geometry.coordinates;
 switch(geometry.type){
  case 'GeometryCollection':geometry.geometries.forEach(g=>geometryParts(g,result));break;
  case 'MultiPoint':c.forEach(p=>result.push({type:'Point',coordinates:p}));break;
  case 'MultiLineString':c.forEach(p=>result.push({type:'LineString',coordinates:p}));break;
  case 'MultiPolygon':c.forEach(p=>result.push({type:'Polygon',coordinates:p}));break;
  case 'Point':case 'LineString':case 'Polygon':result.push({type:geometry.type,coordinates:c});break;
 }
 return result;
}
export function heightMode(layer,feature){
 const mode=feature.properties?.['KML altitude mode'];
 if(mode==='absolute')return 'absolute';if(mode==='relativeToGround')return 'relative';
 if(layer.metadata?.kml_import)return 'ground';
 const parts=geometryParts(sourceGeometry(feature));
 return parts.some(p=>(p.type==='Point'?[p.coordinates]:p.type==='LineString'?p.coordinates:p.coordinates.flat()).some(c=>c.length>2))?'absolute':'ground';
}
export function ecef([lon,lat,height=0]){
 const phi=lat*Math.PI/180,lambda=lon*Math.PI/180,e2=6.6943799901413165e-3,n=6378137/Math.sqrt(1-e2*Math.sin(phi)**2);
 return [(n+height)*Math.cos(phi)*Math.cos(lambda),(n+height)*Math.cos(phi)*Math.sin(lambda),(n*(1-e2)+height)*Math.sin(phi)];
}
// Triangulate in the face's own plane, including vertical tower panels. A map's
// longitude/latitude plane would collapse those panels and lose their geometry.
export function triangulateFace(rings,position=ecef){
 const points=[],holes=[];
 for(const ring of rings){
  const clean=ring.length>1&&ring[0].every((v,i)=>v===ring.at(-1)[i])?ring.slice(0,-1):ring;
  if(clean.length<3)continue;if(points.length)holes.push(points.length);points.push(...clean.map(position));
 }
 if(points.length<3)return {positions:[],indices:[]};
 const origin=points[0],local=points.map(p=>p.map((v,i)=>v-origin[i]));let normal=[0,0,0];
 const outerEnd=holes[0]||points.length;
 for(let i=0;i<outerEnd;i++){const a=local[i],b=local[(i+1)%outerEnd];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}
 const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),flat=local.flatMap(p=>p.filter((_,i)=>i!==axis));
 return {positions:points.flat(),indices:earcut(flat,holes,2)};
}
export const coordinateKey=c=>`${c[0]},${c[1]}`;
export function coordinateList(feature){return geometryParts(sourceGeometry(feature)).flatMap(p=>p.type==='Point'?[p.coordinates]:p.type==='LineString'?p.coordinates:p.coordinates.flat());}
export function displayedFeatures(layer,accept=()=>true){return (layer.fc?.features||[]).map((feature,index)=>({feature,index})).filter(({feature})=>(!layer.metadata?.style?.useKMLStyle||feature.properties?._fieldmaps_kml_visible!==false)&&accept(layer,feature));}
