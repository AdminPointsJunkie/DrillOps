import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import LineMerger from 'jsts/org/locationtech/jts/operation/linemerge/LineMerger.js';
import {measureDistance} from './explore-data.js';
const reader=new GeoJSONReader(),writer=new GeoJSONWriter();
const clone=x=>structuredClone(x);
export function vertices(geometry){const out=[];function walk(c,path=[]){if(typeof c[0]==='number')out.push({coordinate:c,path});else c.forEach((p,i)=>walk(p,[...path,i]));}if(geometry?.coordinates)walk(geometry.coordinates);return out;}
export function validateGeometry(g){
 if(!g||!['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(g.type))throw Error('Use point, line or polygon geometry.');
 const points=vertices(g);if(!points.length||points.some(({coordinate:c})=>c.length<2||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90))throw Error('Coordinates are outside the map.');
 const shape=reader.read(g);if(shape.isEmpty()||!new IsValidOp(shape).isValid())throw Error('Invalid shape: check crossing edges and duplicate vertices.');
 if(shape.getDimension()===1&&shape.getLength()===0)throw Error('A line needs distinct points.');
 return g;
}
export function circleGeometry(center,edge){
 const radius=measureDistance([center,edge]),r=radius/6371008.8,lat=center[1]*Math.PI/180,lon=center[0]*Math.PI/180;
 if(radius<.01)throw Error('Click away from the centre to set a radius.');
 const ring=Array.from({length:96},(_,i)=>{const b=i*2*Math.PI/96,p=Math.asin(Math.sin(lat)*Math.cos(r)+Math.cos(lat)*Math.sin(r)*Math.cos(b)),l=lon+Math.atan2(Math.sin(b)*Math.sin(r)*Math.cos(lat),Math.cos(r)-Math.sin(lat)*Math.sin(p));return [l*180/Math.PI,p*180/Math.PI];});ring.push([...ring[0]]);return validateGeometry({type:'Polygon',coordinates:[ring]});
}
export function drawGeometry(type,points){
 const p=clone(points);if(type==='rectangle'){if(p.length!==2)throw Error('Click two opposite corners.');const [a,b]=p;return validateGeometry({type:'Polygon',coordinates:[[a,[b[0],a[1]],b,[a[0],b[1]],a]]});}if(type==='circle'){if(p.length!==2)throw Error('Click a centre, then a point on the circle.');return circleGeometry(...p);}
 if(p.length<(type==='point'?1:type==='line'?2:3))throw Error('Add more positions before finishing.');
 return validateGeometry(type==='point'?{type:'Point',coordinates:p[0]}:type==='line'?{type:'LineString',coordinates:p}:{type:'Polygon',coordinates:[[...p,[...p[0]]]]});
}
function parts(g){if(g.type.startsWith('Multi'))return g.coordinates.map(coordinates=>({type:g.type.slice(5),coordinates}));return [g];}
export function editOperation(mode,features,tool){
 if(!features.length)throw Error('Select at least one feature first.');
 features.forEach(f=>validateGeometry(f.geometry));const geometries=features.map(f=>reader.read(f.geometry));
 if(mode==='merge'){
  if(features.length<2)throw Error('Select two or more features to merge.');
  if(new Set(geometries.map(g=>g.getDimension())).size!==1)throw Error('Merge features of the same geometry type.');
  let result=geometries.reduce((a,b)=>OverlayOp.union(a,b));
  if(result.getDimension()===1){const merger=new LineMerger();merger.add(result);result=result.getFactory().buildGeometry(merger.getMergedLineStrings());}
  return [{...clone(features[0]),geometry:writer.write(result)}];
 }
 validateGeometry(tool);const cutter=reader.read(tool),out=[];
 for(let i=0;i<features.length;i++){
  const source=geometries[i];let results;
  if(mode==='cut'&&source.getDimension()===2){
   const polygonizer=new Polygonizer();polygonizer.add(OverlayOp.union(source.getBoundary(),cutter));
   results=polygonizer.getPolygons().toArray().filter(p=>OverlayOp.intersection(p,source).getArea()>p.getArea()*.999999);
  }else if(mode==='cut'&&source.getDimension()!==1)throw Error('Cut works on lines and polygons.');
  else results=[mode==='inside'?OverlayOp.intersection(source,cutter):OverlayOp.difference(source,cutter)];
  for(const result of results)if(!result.isEmpty())for(const g of parts(writer.write(result)))if(reader.read(g).getDimension()===source.getDimension())out.push({...clone(features[i]),geometry:validateGeometry(g)});
 }
 if(!out.length)throw Error('This would remove every selected feature. Use Delete selected if intended.');
 return out;
}
export function moveVertex(geometry,path,coordinate){
 const g=clone(geometry);if(g.type==='Point'){g.coordinates=[...coordinate.slice(0,2),...g.coordinates.slice(2)];return validateGeometry(g);}
 let parent=g.coordinates;for(const i of path.slice(0,-1))parent=parent[i];const index=path.at(-1),closed=/Polygon/.test(g.type);coordinate=[...coordinate.slice(0,2),...parent[index].slice(2)];parent[index]=coordinate;
 if(closed&&(index===0||index===parent.length-1)){parent[0]=[...coordinate];parent[parent.length-1]=[...coordinate];}
 return validateGeometry(g);
}
export function snapCoordinate(coordinate,candidates,project,tolerance=12){const p=project(coordinate);let best=coordinate,distance=tolerance;for(const c of candidates){const q=project(c),d=Math.hypot(q.x-p.x,q.y-p.y);if(d<=distance){best=c;distance=d;}}return best.slice(0,2);}
