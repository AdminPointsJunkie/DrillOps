import test from 'node:test';
import assert from 'node:assert/strict';
import {repairDXFHatches} from '../src/dxf-hatches.js';
const square=(x,y,size=1)=>[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const feature=(rings,properties={})=>({type:'Feature',properties:{EntityHandle:'test',SubClasses:'AcDbEntity:AcDbHatch',name:'Keep me',...properties},geometry:{type:'Polygon',coordinates:rings}});
test('disjoint hatch loops become two areas without losing attributes or coordinates',async()=>{
 const rings=[square(0,0),square(2,0)],fc={features:[feature(rings,{_drillops_geometry_note:'Existing note'})]};
 const count=await repairDXFHatches(fc,async input=>({features:input.features.map(f=>({...f,geometry:{type:'MultiPolygon',coordinates:rings.map(r=>[r])}}))}));
 assert.equal(count,1);assert.equal(fc.features.length,1);assert.deepEqual(fc.features[0].geometry.coordinates,[[rings[0]],[rings[1]]]);
 assert.equal(fc.features[0].properties.EntityHandle,'test');assert.equal(fc.features[0].properties.name,'Keep me');assert.match(fc.features[0].properties._drillops_geometry_note,/Existing note; CAD hatch/);
 assert.equal(await repairDXFHatches(fc,()=>assert.fail('already valid')),0);
});
test('valid hatch holes and invalid non-hatch polygons are unchanged',async()=>{
 const fc={features:[feature([square(0,0,10),square(2,2)]),feature([square(0,0),square(20,0)],{SubClasses:'AcDbEntity:AcDbPolyline'})]},before=structuredClone(fc);
 assert.equal(await repairDXFHatches(fc,()=>assert.fail('not eligible')),0);assert.deepEqual(fc,before);
});
test('incomplete, invalid or collapsed repairs do not partly mutate the collection',async()=>{
 for(const mode of ['missing','duplicate','invalid','line','error']){
  const fc={features:[feature([square(0,0),square(2,0)]),feature([square(10,0),square(12,0)])]},before=structuredClone(fc);
  await assert.rejects(repairDXFHatches(fc,async input=>{
   if(mode==='error')throw Error('Network');
   const features=input.features.map(f=>({...f,geometry:{type:'MultiPolygon',coordinates:f.geometry.coordinates.map(r=>[r])}}));
   if(mode==='missing')features.pop();if(mode==='duplicate')features[1].properties=features[0].properties;
   if(mode==='invalid')features[1].geometry=input.features[1].geometry;
   if(mode==='line')features[1].geometry={type:'LineString',coordinates:[[0,0],[1,1]]};
   return {features};
  }));assert.deepEqual(fc,before);
 }
});

test('bundled GDAL repairs detached hatch loops and retraced shell-hole bridges',async()=>{
 const {default:init}=await import('gdal3.js/node.js');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const folder=await mkdtemp(join(tmpdir(),'fieldmaps-hatches-')),G=await init();
 try{
  const bridge=[[0,0],[10,0],[10,10],[0,10],[0,0],[2,2],[2,4],[4,4],[4,2],[2,2],[0,0]];
  const fc={features:[feature([square(20,0),square(22,0)]),feature([bridge],{EntityHandle:'bridge'})]};
  const count=await repairDXFHatches(fc,async input=>{
   const path=join(folder,'hatches.geojson');await writeFile(path,JSON.stringify(input));
   const dataset=(await G.open(path)).datasets[0];
   try{const out=await G.ogr2ogr(dataset,['-f','GeoJSON','-makevalid'],'hatches_test_valid');return JSON.parse(new TextDecoder().decode(await G.getFileBytes(out)));}
   finally{await G.close(dataset);}
  });
  assert.equal(count,2);assert.equal(fc.features.length,2);
  assert.equal(fc.features[0].geometry.type,'MultiPolygon');assert.equal(fc.features[0].geometry.coordinates.length,2);
  assert.equal(fc.features[1].geometry.type,'Polygon');assert.equal(fc.features[1].geometry.coordinates.length,2);
  assert.equal(await repairDXFHatches(fc,()=>assert.fail('valid after real engine repair')),0);
 }finally{await rm(folder,{recursive:true,force:true});}
});
