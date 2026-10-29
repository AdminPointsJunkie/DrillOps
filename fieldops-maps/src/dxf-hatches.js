import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
const reader=new GeoJSONReader();
const valid=g=>{try{const shape=reader.read(g);return !shape.isEmpty()&&new IsValidOp(shape).isValid();}catch{return false;}};
const hatch=f=>String(f.properties?.SubClasses||'').split(':').includes('AcDbHatch');
const area=g=>g?.type==='Polygon'||g?.type==='MultiPolygon';

// CAD hatch loops can encode disjoint shells or retraced bridges between shell and hole.
// Repair only invalid hatch areas, using GEOS through the existing GDAL engine.
// Stage every replacement before mutating the collection; failed repairs lose no features.
export async function repairDXFHatches(fc,makeValid){
 const indices=[];
 for(const [i,f] of (fc.features||[]).entries())if(hatch(f)&&area(f.geometry)&&!valid(f.geometry))indices.push(i);
 if(!indices.length)return 0;
 const input={type:'FeatureCollection',features:indices.map(i=>({type:'Feature',properties:{_repair_index:i},geometry:structuredClone(fc.features[i].geometry)}))};
 const output=await makeValid(input),replacements=new Map();
 if(output?.features?.length!==indices.length)throw Error('CAD hatch repair returned an incomplete result. No features were removed.');
 for(const f of output.features){
  const i=f.properties?._repair_index;
  if(!indices.includes(i)||replacements.has(i)||!area(f.geometry)||!valid(f.geometry))throw Error('A CAD hatch could not be repaired as a valid area. No features were removed.');
  replacements.set(i,f.geometry);
 }
 for(const [i,geometry] of replacements){
  const feature=fc.features[i];feature.geometry=geometry;
  const note='CAD hatch boundary repaired for GIS polygon validity';
  feature.properties={...feature.properties,_drillops_geometry_note:[feature.properties?._drillops_geometry_note,note].filter(Boolean).join('; ')};
 }
 return replacements.size;
}
