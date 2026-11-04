import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import {validateGeometry} from './geometry-edit.js';
import {flatten,featureCollection,booleanPointInPolygon,distance,pointToLineDistance,polygonToLine,length,area,point,centroid} from '@turf/turf';
const reader=new GeoJSONReader(),writer=new GeoJSONWriter(),fc=featureCollection;
export function clipFeatures(source,mask){
 const boundary=reader.read(mask.geometry),features=[];
 for(const f of source.features){validateGeometry(f.geometry);const shape=reader.read(f.geometry),cut=OverlayOp.intersection(shape,boundary);if(cut.isEmpty())continue;
  const g=writer.write(cut),parts=g.type==='GeometryCollection'?g.geometries:[g];
  for(const geometry of parts){if(reader.read(geometry).getDimension()!==shape.getDimension())continue;features.push({...f,geometry});}
 }return fc(features);
}
function featureDistance(p,f){
 const g=f.geometry;if(g.type==='Point')return distance(p,f,{units:'meters'});
 if(g.type==='LineString')return pointToLineDistance(p,f,{units:'meters',method:'geodesic'});
 if(g.type==='Polygon'){if(booleanPointInPolygon(p,f))return 0;return Math.min(...flatten(polygonToLine(f)).features.map(l=>pointToLineDistance(p,l,{units:'meters',method:'geodesic'})));}
 throw Error('Nearest distance supports point, line and polygon targets.');
}
export function extendedAnalysis(operation,source,target,field,maskFor){
 if(operation==='validate')return fc(source.features.map((f,i)=>{let problem='';try{validateGeometry(f.geometry);}catch(e){problem=e.message;}let at;try{at=centroid(f);if(!at.geometry.coordinates.every(Number.isFinite))throw Error();}catch{at=point([0,0]);}at.geometry.coordinates=at.geometry.coordinates.map((v,i)=>Math.max(i?-90:-180,Math.min(i?90:180,v)));return {...at,properties:{...f.properties,source_row:i+1,geometry_valid:!problem,validation_message:problem||'Valid'}};}));
 if(!target?.features?.length)throw Error('Choose a second layer.');
 if(source.features.length*target.features.length>250000)throw Error('Too many feature pairs. Filter or split the inputs first.');
 if(operation==='nearest'){
  const targets=target.features.flatMap((f,index)=>flatten(fc([f])).features.map(part=>({...part,sourceIndex:index})));if(source.features.length*targets.length>250000)throw Error('Too many feature pairs. Split the inputs first.');if(!source.features.every(f=>f.geometry?.type==='Point'))throw Error('Choose a point layer as the source.');
  return fc(source.features.map(f=>{let metres=Infinity,index=-1;targets.forEach((t,i)=>{const value=featureDistance(f,t);if(value<metres){metres=value;index=i;}});return {...f,properties:{...f.properties,nearest_distance_m:metres,nearest_target_row:targets[index].sourceIndex+1,nearest_target:field?targets[index].properties?.[field]??null:null}};}));
 }
 if(operation==='summarize'){
  if(!source.features.every(f=>/Polygon$/.test(f.geometry?.type)))throw Error('Source must be polygon areas.');
  return fc(source.features.map(f=>{const clipped=clipFeatures(target,f),parts=flatten(clipped).features;let sum=0,numeric=0;for(const item of clipped.features){const value=item.properties?.[field];if(value!=null&&String(value).trim()!==''&&Number.isFinite(Number(value))){sum+=Number(value);numeric++;}}
   return {...f,properties:{...f.properties,matched_parts:clipped.features.length,total_length_m:parts.filter(p=>p.geometry.type==='LineString').reduce((s,p)=>s+length(p,{units:'meters'}),0),total_area_m2:parts.filter(p=>p.geometry.type==='Polygon').reduce((s,p)=>s+area(p),0),...(field?{value_sum:sum,value_count:numeric,value_mean:numeric?sum/numeric:null}:{})}};}));
 }
 throw Error('Unknown extended analysis');
}
