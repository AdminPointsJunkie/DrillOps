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
