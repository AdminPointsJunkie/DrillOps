import {validateCollection} from './geo.js';
export const dxfSectionNames={point:'Points',line:'Lines',shape:'Shapes'};
export const geometrySection=g=>({Point:'point',MultiPoint:'point',LineString:'line',MultiLineString:'line',Polygon:'shape',MultiPolygon:'shape'})[g?.type];

export function splitDXFSections(layer,{only=null,cadLayer=null,newID=()=>crypto.randomUUID()}={}){
 if(layer.kind!=='vector'||!['DXF','DWG'].includes(layer.metadata?.format))return [layer];
 if(layer.metadata.format==='DWG'&&!only){
  const buckets=new Map(),sharedSource={paths:null};
  for(const feature of layer.fc.features){
   const name=String(feature.properties?.Layer??'0');
   if(cadLayer!==null&&name!==cadLayer)continue;
   if(!buckets.has(name))buckets.set(name,[]);
   const copy=structuredClone(feature);delete copy.bbox;buckets.get(name).push(copy);
  }
  if(!buckets.size)throw Error(cadLayer!==null?`The DWG no longer contains the CAD layer “${cadLayer}”. Import the drawing again to review its layers.`:'The DWG contains no model-space features.');
  return [...buckets].map(([name,features])=>{
   const fc={type:'FeatureCollection',features},metadata=structuredClone(layer.metadata);delete metadata.dxf_geometry;
   return {...layer,id:cadLayer!==null?layer.id:newID(),name:cadLayer!==null?layer.name:name||'Unnamed CAD layer',fc,bounds:validateCollection(fc),feature_count:features.length,metadata:{...metadata,cad_layer:name},sourceUpload:sharedSource};
  });
 }
 const buckets={point:[],line:[],shape:[]};
 for(const source of layer.fc.features){
  function visit(geometry){
   if(geometry?.type==='GeometryCollection'){
    if(!geometry.geometries?.length)throw Error('The DXF contains an empty geometry collection.');
    geometry.geometries.forEach(visit);return;
   }
   const section=geometrySection(geometry);if(!section)throw Error(`Unsupported DXF geometry: ${geometry?.type||'missing'}. No features were skipped.`);
   const feature=structuredClone(source);feature.geometry=structuredClone(geometry);delete feature.bbox;buckets[section].push(feature);
  }
  visit(source.geometry);
 }
 const sharedSource={paths:null};
 const parts=Object.entries(buckets).filter(([section,features])=>features.length&&(!only||section===only)).map(([section,features])=>{
  const fc={type:'FeatureCollection',features};
  return {...layer,id:only?layer.id:newID(),name:only?layer.name:`${layer.name} — ${dxfSectionNames[section]}`,
   fc,bounds:validateCollection(fc),feature_count:features.length,
   metadata:{...structuredClone(layer.metadata),dxf_geometry:section},sourceUpload:sharedSource};
 });
 if(!parts.length)throw Error(`The DXF contains no ${dxfSectionNames[only]?.toLowerCase()||'supported features'} after conversion.`);
 return parts;
}
