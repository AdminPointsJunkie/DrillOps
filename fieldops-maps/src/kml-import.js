import {kmlWithFolders} from '@tmcw/togeojson';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
const reader=new GeoJSONReader();
const valid=geometry=>new IsValidOp(reader.read(geometry)).isValid();
// A 3D surface can collapse or overlap itself in plan view. Keep every face and
// vertex as outlines where necessary; retain the original geometry for inspection.
export function projectKMLGeometry(geometry){
 if(valid(geometry))return geometry;
 if(geometry.type==='GeometryCollection')return {...geometry,geometries:geometry.geometries.map(projectKMLGeometry)};
 if(['MultiPolygon','MultiLineString'].includes(geometry.type))return {type:'GeometryCollection',geometries:geometry.coordinates.map(coordinates=>projectKMLGeometry({type:geometry.type==='MultiPolygon'?'Polygon':'LineString',coordinates}))};
 if(geometry.type==='Polygon')return {type:'GeometryCollection',geometries:geometry.coordinates.map(coordinates=>projectKMLGeometry({type:'LineString',coordinates}))};
 if(geometry.type==='LineString'&&geometry.coordinates.length&&geometry.coordinates.every(p=>p[0]===geometry.coordinates[0][0]&&p[1]===geometry.coordinates[0][1]))return {type:'Point',coordinates:geometry.coordinates[0]};
 throw Error('A KML geometry cannot be displayed safely in plan view.');
}
const plain=text=>String(text||'').replace(/<[^>]*>/g,'');
export function readKML(text,DOMParserClass=globalThis.DOMParser){
 const xml=new DOMParserClass().parseFromString(text,'application/xml');
 if(xml.querySelector('parsererror')||xml.documentElement.localName!=='kml')throw Error('This file is not valid KML.');
 // Screen/ground overlays and remote links do not represent editable vectors.
 const unsupported=['ScreenOverlay','GroundOverlay','NetworkLink','Tour','Model'];
 const omitted=Object.fromEntries(unsupported.map(type=>[type,xml.getElementsByTagName(type).length]));
 for(const type of unsupported)for(const node of [...xml.getElementsByTagName(type)])node.remove();
 const placemarks=[...xml.getElementsByTagName('Placemark')];
 const tree=kmlWithFolders(xml),features=[];let projected=0;
 function visit(node,path=[],visible=true){
  if(node.type==='folder'){path=[...path,plain(node.meta.name,xml)];visible=visible&&node.meta.visibility!=='0';}
  if(node.type==='Feature'){
   if(!node.geometry)throw Error('A KML placemark has no supported geometry.');
   const props=node.properties||{},geometry=projectKMLGeometry(node.geometry),source=placemarks[features.length];
   if(source){
    props['KML altitude mode']=[...new Set([...source.getElementsByTagName('altitudeMode')].map(n=>n.textContent))].join(', ')||'clampToGround';
    props['KML extrude']=[...source.getElementsByTagName('extrude')].some(n=>n.textContent==='1');
   }
   if(geometry!==node.geometry){props._fieldmaps_kml_original_geometry=node.geometry;props._fieldmaps_geometry_note='3D geometry shown in plan view; collapsed surfaces are outlines or points. Original geometry and heights retained.';projected++;}
   props.Name=plain(props.name||props.Name,xml);if(props.description!==undefined)props.Description=props.description;
   props['KML folder']=path.join(' / ');props._fieldmaps_kml_visible=visible&&props.visibility!==false;
   features.push({...node,properties:props,geometry});
  }
  for(const child of node.children||[])visit(child,path,visible);
 }
 visit(tree);
 if(!features.length)throw Error('No supported placemarks were found in this KML.');
 return {fc:{type:'FeatureCollection',features},details:{projected,omitted,folders:new Set(features.map(f=>f.properties['KML folder']).filter(Boolean)).size}};
}
