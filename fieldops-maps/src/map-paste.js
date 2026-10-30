import {validateCollection} from './geo.js';
export function pastedFeatures(text,at){
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(!['FeatureCollection','Feature','Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'].includes(value?.type))return null;
 const fc=value.type==='FeatureCollection'?structuredClone(value):{type:'FeatureCollection',features:[value.type==='Feature'?structuredClone(value):{type:'Feature',properties:{},geometry:structuredClone(value)}]};
 const bounds=validateCollection(fc),anchor=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],delta=[at.lng-anchor[0],at.lat-anchor[1]];
 function move(g){if(!['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'].includes(g.type))throw Error('Paste points, lines or polygons as GeoJSON.');if(g.type==='GeometryCollection'){g.geometries.forEach(move);return;}function walk(c){if(typeof c[0]==='number'){c[0]+=delta[0];c[1]+=delta[1];}else c.forEach(walk);}walk(g.coordinates);delete g.bbox;}
 fc.features.forEach(f=>{move(f.geometry);delete f.bbox;delete f.id;});delete fc.bbox;return {fc,bounds:validateCollection(fc)};
}
