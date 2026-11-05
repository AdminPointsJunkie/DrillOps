import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectionDeletion} from '../src/selection-delete.js';
import {createLocalWorkspace} from '../src/local-workspace.js';
import {IDBFactory} from 'fake-indexeddb';
const feature=(x,name)=>({type:'Feature',properties:{name,_fieldmaps_files:[{path:'source/attachment'}]},geometry:{type:'Point',coordinates:[x,1,99]}});
const layer=(id,xs)=>({id,name:id,kind:'vector',bounds:[0,1,10,1],metadata:{format:'DWG'},fc:{type:'FeatureCollection',features:xs.map((x,i)=>feature(x,`${id}-${i}`))}});
function setup(initial){
 let layers=initial,scope='project',editable=true,fail='',restores=0;
 const controller=createSelectionDeletion({getLayers:()=>layers,getScope:()=>scope,canEdit:()=>editable,
  replace:async(l,next)=>{if(l.id===fail)throw Error('Save failed');Object.assign(l,next);},
  remove:async l=>{if(l.id===fail)throw Error('Save failed');layers=layers.filter(item=>item!==l);return 'original location';},
  restore:async(l,location)=>{assert.equal(location,'original location');layers.push(l);restores++;}
 });
 return {controller,get layers(){return layers;},set scope(value){scope=value;},set editable(value){editable=value;},set fail(value){fail=value;},get restores(){return restores;}};
}
test('delete selected indices across layers, recompute extent, preserve attributes and undo in order',async()=>{
 const a=layer('a',[0,2,10]),b=layer('b',[3]),before=structuredClone(a.fc),h=setup([a,b]);
 const result=await h.controller.delete([{layer:a,index:0},{layer:a,index:2},{layer:a,index:2},{layer:b,index:0}]);
 assert.equal(result.count,3);assert.deepEqual(result.errors,[]);assert.deepEqual(a.bounds,[2,1,2,1]);assert.deepEqual(a.fc.features,[before.features[1]]);assert.deepEqual(h.layers,[a]);assert.equal(h.controller.canUndo,true);
 assert.equal((await h.controller.undo()).count,3);assert.deepEqual(a.fc,before);assert.deepEqual(a.bounds,[0,1,10,1]);assert.deepEqual(h.layers,[a,b]);assert.equal(h.restores,1);assert.equal(h.controller.canUndo,false);
});
test('failed layers keep their features while successful deletions remain undoable',async()=>{
 const a=layer('a',[0,2]),b=layer('b',[3]),h=setup([a,b]);h.fail='b';
 const result=await h.controller.delete([{layer:a,index:0},{layer:b,index:0}]);
 assert.equal(result.count,1);assert.match(result.errors[0],/b: Save failed/);assert.equal(b.fc.features.length,1);assert.equal(a.fc.features.length,1);
 h.fail='';await h.controller.undo();assert.equal(a.fc.features.length,2);
});
test('stale data, project changes, viewers and raster selections cannot be deleted or overwritten by undo',async()=>{
 const a=layer('a',[0,2]),h=setup([a]);h.editable=false;
 await assert.rejects(h.controller.delete([{layer:a,index:0}]),/editable/);h.editable=true;
 await assert.rejects(h.controller.delete([{layer:a,index:null}]),/editable/);await assert.rejects(h.controller.delete([{layer:a,index:99}]),/editable/);
 await h.controller.delete([{layer:a,index:0}]);h.scope='other';assert.equal(h.controller.canUndo,false);await assert.rejects(h.controller.undo(),/no longer/);
 h.scope='project';a.fc=structuredClone(a.fc);assert.equal(h.controller.canUndo,false);await assert.rejects(h.controller.undo(),/no longer/);
 assert.equal(a.fc.features.length,1);
});
test('deletions and undo persist through the existing saved-layer and Recently deleted paths',async()=>{
 const db=createLocalWorkspace(new IDBFactory()),{data:project}=await db.from('maps').insert({name:'Delete test'}).select().single();
 let layers=[];for(const l of [layer('a',[0,2]),layer('b',[3])]){const {data}=await db.rpc('import_vector',{p_layer:{name:l.name,kind:l.kind,bounds:l.bounds,metadata:l.metadata,map_id:project.id},p_features:l.fc.features});l.id=data;l.saved=true;layers.push(l);}
 const originals=[...layers],check=result=>{if(result.error)throw result.error;return result.data;};
 const controller=createSelectionDeletion({getLayers:()=>layers,getScope:()=>project.id,canEdit:()=>true,
  replace:async(l,values)=>{check(await db.from('layers').update({...values,feature_count:values.fc.features.length}).eq('id',l.id).select().single());Object.assign(l,values);},
  remove:async l=>{check(await db.rpc('maps_layer_bin',{p_action:'trash',p_layer:l.id}));layers=layers.filter(item=>item!==l);},
  restore:async l=>{check(await db.rpc('maps_layer_bin',{p_action:'restore',p_layer:l.id,p_target:project.id}));layers.push(l);}
 });
 await controller.delete(originals.map(l=>({layer:l,index:0})));
 assert.equal(check(await db.rpc('layer_geojson',{p_layer_id:originals[0].id})).features.length,1);
 assert.equal(check(await db.rpc('maps_layer_bin',{p_action:'list'})).length,1);
 await controller.undo();
 assert.equal(check(await db.rpc('layer_geojson',{p_layer_id:originals[0].id})).features.length,2);
 assert.equal(check(await db.rpc('layer_geojson',{p_layer_id:originals[1].id})).features.length,1);
 assert.equal(check(await db.rpc('maps_layer_bin',{p_action:'list'})).length,0);
});
