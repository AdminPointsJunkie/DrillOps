import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDWG,convertDWG,preserveCADColours} from '../src/dwg-import.js';
import {splitDXFSections} from '../src/dxf-sections.js';
const drawing=()=>new File(['AC1032drawing'],'survey.dwg');
test('DWG validation rejects renamed non-CAD files, unsupported versions and excessive files',async()=>{
 await assert.rejects(validateDWG(new File(['not a drawing'],'x.dwg')),/not a recognised/);
 await assert.rejects(validateDWG(new File(['AC1009'],'old.dwg')),/version/);
 await assert.rejects(validateDWG({size:51*1024*1024}),/50 MB/);
 assert.equal(await validateDWG(drawing()),'AC1032');
});
test('DWG conversion preserves original filename and diagnostics, terminating its worker',async()=>{
 let terminated=0;
 const worker={postMessage(){queueMicrotask(()=>this.onmessage({data:{bytes:new TextEncoder().encode('DXF'),warnings:['Unsupported table'],entityCount:3}}));},terminate(){terminated++;}};
 const result=await convertDWG(drawing(),()=>{},{workerFactory:()=>worker});
 assert.equal(result.file.name,'survey.dxf');assert.equal(await result.file.text(),'DXF');assert.deepEqual(result.warnings,['Unsupported table']);assert.equal(terminated,1);
});
test('failed and stalled converters are terminated and never return a partial drawing',async()=>{
 for(const mode of ['error','timeout','empty']){
  let terminated=0;const worker={postMessage(){if(mode!=='timeout')queueMicrotask(()=>this.onmessage({data:mode==='error'?{error:'Unsupported drawing'}:{bytes:new Uint8Array()}}));},terminate(){terminated++;}};
  await assert.rejects(convertDWG(drawing(),()=>{},{workerFactory:()=>worker,timeout:10}));assert.equal(terminated,1);
 }
});
test('CAD colour extraction respects OGR colour and refuses executable or invalid strings',()=>{
 const fc={features:['PEN(c:#ff0080,w:1px)','BRUSH(fc:#00ff00);PEN(c:#123456ff)','LABEL(f:"Arial",c:#AABBCC,t:"Hi")','PEN(c:javascript:alert(1))'].map(OGR_STYLE=>({properties:{OGR_STYLE}}))};
 preserveCADColours(fc);assert.deepEqual(fc.features.map(f=>f.properties['CAD colour']),['#ff0080','#123456','#AABBCC',undefined]);
});
test('DWG sections share original DWG provenance and retain colours and CAD layer names',()=>{
 const file=drawing();const layer={id:'source',kind:'vector',name:'Survey',files:[file],metadata:{format:'DWG',cad_import:{reader:'ACadSharp'}},fc:{type:'FeatureCollection',features:[{type:'Feature',properties:{Layer:'Survey points','CAD colour':'#ff0000'},geometry:{type:'Point',coordinates:[153,-27]}},{type:'Feature',properties:{Layer:'Boundary'},geometry:{type:'LineString',coordinates:[[153,-27],[153.1,-27.1]]}}]}};
 const parts=splitDXFSections(layer);assert.equal(parts.length,2);assert.equal(parts[0].files[0],file);assert.equal(parts[0].sourceUpload,parts[1].sourceUpload);assert.equal(parts[0].fc.features[0].properties.Layer,'Survey points');assert.equal(parts[0].metadata.format,'DWG');
});

test('DWG imports preserve original named layers, mixed geometry, colours and shared source',()=>{
 const original=drawing(),point={type:'Feature',properties:{Layer:'Drill targets','CAD colour':'#ff0000',Text:'Hole 1'},geometry:{type:'Point',coordinates:[148,-22,99]}},line={type:'Feature',properties:{Layer:'Drill targets','CAD colour':'#00ff00'},geometry:{type:'LineString',coordinates:[[148,-22],[148.1,-22.1]]}},other={...structuredClone(point),properties:{Layer:'Lease boundary','CAD colour':'#0000ff'}};
 const source={id:'drawing',name:'Original drawing',kind:'vector',files:[original],source_crs:'EPSG:28355',metadata:{format:'DWG',source_layer:'entities',style:{labelField:'Text'},dxf_geometry:'point'},fc:{type:'FeatureCollection',features:[point,other,line]}};
 const parts=splitDXFSections(source);
 assert.deepEqual(parts.map(p=>p.name),['Drill targets','Lease boundary']);assert.deepEqual(parts.map(p=>p.feature_count),[2,1]);assert.deepEqual(parts[0].fc.features,[point,line]);
 assert.equal(parts[0].metadata.cad_layer,'Drill targets');assert.equal(parts[0].metadata.dxf_geometry,undefined);assert.equal(parts[0].metadata.source_layer,'entities');assert.equal(parts[0].source_crs,'EPSG:28355');
 assert.equal(parts[0].files[0],original);assert.equal(parts[0].sourceUpload,parts[1].sourceUpload);assert.notEqual(parts[0].id,parts[1].id);
 parts[0].fc.features[0].properties.Text='Changed';assert.equal(point.properties.Text,'Hole 1');
});
test('rebuilding a renamed DWG layer keeps only its original CAD layer; legacy geometry sections still rebuild',()=>{
 const source={id:'edited',name:'Renamed targets',kind:'vector',metadata:{format:'DWG'},fc:{type:'FeatureCollection',features:['Targets','Roads','Targets'].map((Layer,i)=>({type:'Feature',properties:{Layer},geometry:{type:'Point',coordinates:[148+i/100,-22]}}))}};
 const [part]=splitDXFSections(source,{cadLayer:'Targets'});assert.equal(part.id,'edited');assert.equal(part.name,'Renamed targets');assert.equal(part.feature_count,2);assert.ok(part.fc.features.every(f=>f.properties.Layer==='Targets'));
 assert.throws(()=>splitDXFSections(source,{cadLayer:'Missing'}),/no longer contains/);
 assert.equal(splitDXFSections(source,{only:'point'})[0].fc.features.length,3);
});

test('split DWG colours reach map features and the layer list, including existing saved layers',async()=>{
 const {legendSymbol}=await import('../src/layer-control.js'),{vectorStyle}=await import('../src/layer-style.js');
 const features=['#ff0000','#00ff00'].map((color,i)=>({type:'Feature',properties:{Layer:String(i),'CAD colour':color},geometry:{type:'Point',coordinates:[148+i/10,-22]}}));
 const source={kind:'vector',color:'#315d49',metadata:{format:'DWG',style:{rules:{mode:'expression',expressions:{color:'[CAD colour]'}}}},fc:{type:'FeatureCollection',features}};
 const parts=splitDXFSections(source);
 for(const [i,part] of parts.entries()){
  const expected=features[i].properties['CAD colour'];assert.equal(part.color,expected);assert.equal(vectorStyle(part,part.fc.features[0]).fillColor,expected);assert.ok(legendSymbol(part).includes(`fill="${expected}"`));
  const saved=JSON.parse(JSON.stringify(part));saved.color='#315d49';assert.ok(legendSymbol(saved).includes(`fill="${expected}"`));assert.equal(vectorStyle(saved,saved.fc.features[0]).fillColor,expected);
 }
});
