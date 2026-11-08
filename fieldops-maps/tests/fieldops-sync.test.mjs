import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeVectorEdits,uniqueEditedFeatures} from '../src/fieldops-sync.js';
const feature=(id,name)=>({type:'Feature',id,geometry:{type:'Point',coordinates:[153,-27]},properties:{name}});
test('web saves send the original snapshot and use the merged result',async()=>{
 const old={id:'layer',name:'Points',source_crs:'EPSG:4326',metadata:{data_revision:'before'},fc:{type:'FeatureCollection',features:[feature(1,'base')]}};
 const next=structuredClone(old);next.fc.features[0].properties.name='local';
 const merged={layer:{...old,metadata:{data_revision:'after'}},fc:{type:'FeatureCollection',features:[{...feature(1,'local'),properties:{name:'local',notes:'mobile'}}]}};
 let called;
 const result=await mergeVectorEdits({rpc:async(name,args)=>{called={name,args};return {data:merged};}},old,next,next);
 assert.equal(called.name,'merge_vector_edits');assert.equal(called.args.p_base_features[0].properties.name,'base');
 assert.equal(called.args.p_features[0].properties.name,'local');assert.equal(result.fc.features[0].properties.notes,'mobile');
 assert.equal(old.fc.features[0].properties.name,'base');assert.equal(old.metadata.data_revision,'before');
});
test('conflicts preserve the local edit and never retry as unconditional replacement',async()=>{
 const old={id:'layer',fc:{features:[feature(1,'base')]}},next={fc:{features:[feature(1,'local')]}};
 let calls=0;await assert.rejects(mergeVectorEdits({rpc:async()=>{calls++;return {error:Error('Feature changed on another device')};}},old,next,{}),/changed/);
 assert.equal(calls,1);assert.equal(next.fc.features[0].properties.name,'local');
});
test('split shapes keep the original ID once; copies become new features',()=>{
 const a=feature(1,'one'),parts=[a,structuredClone(a),feature(99,'imported')];
 const result=uniqueEditedFeatures(parts,[a]);assert.equal(result[0].id,1);assert.equal(result[1].id,undefined);assert.equal(result[2].id,undefined);assert.equal(parts[1].id,1);
});

import {mergeFeatureSnapshots,resolveEditConflicts} from '../src/field-edit-conflicts.js';
import {JSDOM} from 'jsdom';
test('web conflict review preserves independent edits and resolves only the conflicting field',()=>{
 const base=[{...feature(1,'original'),properties:{name:'original',notes:'old'}}];
 const local=structuredClone(base),remote=structuredClone(base);local[0].properties.name='mine';remote[0].properties.name='theirs';remote[0].properties.notes='remote note';
 const result=mergeFeatureSnapshots(base,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].field,'name');
 result.conflicts[0].choose('local');assert.deepEqual(result.features()[0].properties,{name:'mine',notes:'remote note'});
 assert.equal(base[0].properties.name,'original');
});
test('web conflict review retains remote additions and detects delete-versus-edit',()=>{
 const a=feature(1,'A'),changed=feature(1,'Changed'),added=feature(2,'Added');
 const result=mergeFeatureSnapshots([a],[],[changed,added]);assert.equal(result.conflicts.length,1);
 result.conflicts[0].choose('remote');assert.equal(result.features().length,2);
 result.conflicts[0].choose('local');assert.deepEqual(result.features(),[added]);
});
test('web conflict dialog escapes values and cancelling retains unsaved changes',async()=>{
 const dom=new JSDOM('<body></body>'),doc=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
 let choices=0;const promise=resolveEditConflicts([{label:'<img src=x onerror=alert(1)>',field:'name',local:'<script>bad</script>',remote:'safe',choose:()=>choices++}],doc);
 assert.equal(doc.querySelector('img'),null);assert.equal(doc.querySelector('script'),null);
 doc.querySelector('button').click();await assert.rejects(promise,/still available/);assert.equal(choices,0);assert.equal(doc.querySelector('dialog'),null);dom.window.close();
});
