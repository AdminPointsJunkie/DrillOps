import test from 'node:test';import assert from 'node:assert/strict';
import {sourceGeometry,geometryParts,triangulateFace,ecef,heightMode,displayedFeatures} from '../src/scene3d-model.js';
test('3D uses preserved original geometry rather than its plan-view point',()=>{
 const original={type:'LineString',coordinates:[[148,-21,300],[148,-21,350]]},feature={geometry:{type:'Point',coordinates:[148,-21,300]},properties:{_fieldmaps_kml_original_geometry:original}};
 assert.equal(sourceGeometry(feature),original);assert.deepEqual(geometryParts(sourceGeometry(feature)),[original]);assert.ok(Math.abs(Math.hypot(...ecef(original.coordinates[1]).map((v,i)=>v-ecef(original.coordinates[0])[i]))-50)<1e-6);
});
test('vertical tower panels triangulate without collapsing to the map plane',()=>{
 const face=[[[148,-21,300],[148.0001,-21,300],[148.0001,-21,340],[148,-21,340],[148,-21,300]]],mesh=triangulateFace(face);
 assert.equal(mesh.positions.length,12);assert.equal(mesh.indices.length,6);
 const points=[0,1,2].map(i=>mesh.positions.slice(mesh.indices[i]*3,mesh.indices[i]*3+3)),a=points[1].map((v,i)=>v-points[0][i]),b=points[2].map((v,i)=>v-points[0][i]);assert.ok(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>300);
});
test('polygon holes are kept out of triangulated faces',()=>{
 const rings=[[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,0]],[[3,3,0],[3,7,0],[7,7,0],[7,3,0],[3,3,0]]],mesh=triangulateFace(rings,c=>c);let area=0;
 for(let i=0;i<mesh.indices.length;i+=3){const p=mesh.indices.slice(i,i+3).map(j=>mesh.positions.slice(j*3,j*3+3));area+=Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]))/2;}
 assert.equal(area,84);
});
test('height modes distinguish ground, relative and absolute altitude',()=>{
 const feature={geometry:{type:'Point',coordinates:[148,-21,300]},properties:{'KML altitude mode':'relativeToGround'}};assert.equal(heightMode({metadata:{kml_import:{}}},feature),'relative');feature.properties['KML altitude mode']='absolute';assert.equal(heightMode({},feature),'absolute');feature.properties={};assert.equal(heightMode({metadata:{kml_import:{}}},feature),'ground');assert.equal(heightMode({},feature),'absolute');
});
test('3D honours source visibility, filters, and all multipart components',()=>{
 const f=visible=>({properties:{_fieldmaps_kml_visible:visible},geometry:{type:'MultiPoint',coordinates:[[148,-21,1],[148,-21,2]]}}),layer={metadata:{style:{useKMLStyle:true}},fc:{features:[f(true),f(false)]}};
 assert.equal(displayedFeatures(layer).length,1);assert.equal(geometryParts(layer.fc.features[0].geometry).length,2);assert.equal(displayedFeatures(layer,()=>false).length,0);layer.metadata.style.useKMLStyle=false;assert.equal(displayedFeatures(layer).length,2);
});
