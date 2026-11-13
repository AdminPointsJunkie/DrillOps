import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').split('async function offerRemoveMergedSources')[1].split('\nfunction groupSelectedLayers')[0];
function setup({accept=true,failSave=false,changeScope=false}={}){
 const originals=[{id:'a'},{id:'b'}],merged={id:'merged'},layers=[...originals,merged],calls=[];let scope='map';
 const context={layers,analysisScope:()=>scope,canCreate:()=>true,canEditLayer:()=>true,confirm:()=>{calls.push('prompt');return accept;},saveLayer:async layer=>{calls.push('save');if(failSave)throw Error('Offline');layer.saved=true;if(changeScope)scope='other';},trashLayer:async layer=>{calls.push(layer.id);layers.splice(layers.indexOf(layer),1);},toast:message=>calls.push(message),errorText:e=>e.message};
 vm.createContext(context);vm.runInContext('async function offerRemoveMergedSources'+source+';this.run=offerRemoveMergedSources;',context);
 return {calls,layers,merged,run:()=>context.run(merged,originals,'map')};
}
test('keeping originals does not save or delete anything',async()=>{const f=setup({accept:false});await f.run();assert.deepEqual(f.calls,['prompt']);assert.equal(f.layers.length,3);});
test('removing originals saves merged data before deleting sources',async()=>{const f=setup();await f.run();assert.deepEqual(f.calls.slice(0,4),['prompt','save','a','b']);assert.deepEqual(f.layers,[f.merged]);});
test('failed save keeps every original layer',async()=>{const f=setup({failSave:true});await f.run();assert.equal(f.layers.length,3);assert.match(f.calls.at(-1),/remaining originals kept/);});
test('changing maps during save never deletes source layers',async()=>{const f=setup({changeScope:true});await f.run();assert.equal(f.layers.length,3);assert.match(f.calls.at(-1),/access changed/);});
