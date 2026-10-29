import test from 'node:test';
import assert from 'node:assert/strict';
import {splitDXFSections} from '../src/dxf-sections.js';
import {styleControls,vectorStyle} from '../src/layer-style.js';
import {moveVertex} from '../src/geometry-edit.js';
const feature=(geometry,id)=>({type:'Feature',id,properties:{EntityHandle:id,Layer:'Survey',height:42},geometry});
const polygon={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]};
const input=()=>({id:'source',name:'Drawing',kind:'vector',color:'#147d72',opacity:.85,visible:true,source_crs:'EPSG:4326',files:[{name:'drawing.dxf'}],metadata:{format:'DXF',source_layer:'entities',source_names:['drawing.dxf'],style:{pointSize:12}},fc:{type:'FeatureCollection',features:[feature({type:'Point',coordinates:[1,1,42]},'P'),feature({type:'MultiPoint',coordinates:[[1,1,42],[2,2,43]]},'MP'),feature({type:'LineString',coordinates:[[0,0,1],[1,1,2]]},'L'),feature({type:'MultiLineString',coordinates:[[[2,2],[3,3]]]},'ML'),feature(polygon,'S'),feature({type:'MultiPolygon',coordinates:[polygon.coordinates]},'MS')]}});
test('DXF sections keep all points, lines, polygons, properties, heights and source settings',()=>{
 const source=input(),before=structuredClone(source);let id=0;const parts=splitDXFSections(source,{newID:()=>String(++id)});
 assert.deepEqual(parts.map(p=>p.name),['Drawing — Points','Drawing — Lines','Drawing — Shapes']);assert.deepEqual(parts.map(p=>p.feature_count),[2,2,2]);
 assert.equal(new Set(parts.map(p=>p.id)).size,3);assert.deepEqual(parts.flatMap(p=>p.fc.features),source.fc.features);assert.deepEqual(source,before);
 for(const p of parts){assert.equal(p.source_crs,source.source_crs);assert.equal(p.metadata.source_layer,'entities');assert.deepEqual(p.files,source.files);}
 assert.equal(parts[0].sourceUpload,parts[1].sourceUpload);parts[0].sourceUpload.paths=['uploaded-once'];assert.deepEqual(parts[2].sourceUpload.paths,['uploaded-once']);
});
test('section geometry and symbology can be edited independently with appropriate controls',()=>{
 const parts=splitDXFSections(input()),[point,line,shape]=parts;
 point.fc.features[0].geometry=moveVertex(point.fc.features[0].geometry,[],[1.5,1.5]);point.metadata.style.symbol='diamond';point.metadata.style.pointSize=24;
 line.metadata.style.lineWidth=5;line.metadata.style.lineStyle='dashed';shape.metadata.style.fillColor='#ff0000';shape.metadata.style.fillOpacity=.4;
 assert.equal(point.fc.features[0].geometry.coordinates[2],42);assert.equal(line.metadata.style.pointSize,12);assert.equal(shape.metadata.style.lineWidth,undefined);
 assert.match(styleControls(point),/Point symbol/);assert.doesNotMatch(styleControls(point),/Fill colour/);
 assert.match(styleControls(line),/Line.*style/);assert.doesNotMatch(styleControls(line),/Point symbol/);
 assert.match(styleControls(shape),/Fill colour/);assert.doesNotMatch(styleControls(shape),/Point symbol/);
 assert.equal(vectorStyle(line,line.fc.features[0]).weight,5);assert.equal(vectorStyle(shape,shape.fc.features[0]).fillColor,'#ff0000');
});
test('nested geometry collections split without discarding any component or attributes',()=>{
 const source=input();source.fc.features=[feature({type:'GeometryCollection',geometries:[{type:'Point',coordinates:[1,1]},{type:'GeometryCollection',geometries:[polygon,{type:'LineString',coordinates:[[0,0],[1,1]]}]}]},'mixed')];
 const parts=splitDXFSections(source);assert.deepEqual(parts.map(p=>p.feature_count),[1,1,1]);assert.ok(parts.every(p=>p.fc.features[0].properties.EntityHandle==='mixed'));
});
test('source-settings rebuild retains only the chosen section and its name',()=>{
 const source=input();source.name='Renamed lines';const parts=splitDXFSections(source,{only:'line'});
 assert.equal(parts.length,1);assert.equal(parts[0].id,source.id);assert.equal(parts[0].name,'Renamed lines');assert.equal(parts[0].metadata.dxf_geometry,'line');assert.deepEqual(parts[0].fc.features.map(f=>f.id),['L','ML']);
});
test('empty sections are omitted; unsupported geometry fails without silently discarding it',()=>{
 const source=input();source.fc.features=source.fc.features.slice(0,1);assert.equal(splitDXFSections(source).length,1);
 assert.throws(()=>splitDXFSections(source,{only:'shape'}),/no shapes/);
 source.fc.features.push(feature({type:'Unknown',coordinates:[0,0]},'bad'));const before=structuredClone(source);assert.throws(()=>splitDXFSections(source),/No features were skipped/);assert.deepEqual(source,before);
 const csv=input();csv.metadata.format='CSV';assert.deepEqual(splitDXFSections(csv),[csv]);
});
