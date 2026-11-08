import test from 'node:test';
import assert from 'node:assert/strict';
import {draftLayers} from '../src/draft-projects.js';
const fc=id=>({type:'FeatureCollection',features:[{id,geometry:{type:'Point',coordinates:[148,-22,301.25]},properties:{_fieldmaps_kml_original_geometry:{type:'Point',coordinates:[148,-22,301.25]}}}]});
function fixture(){
 let rows=[{id:'a',kind:'vector',metadata:{data_revision:'a1'}},{id:'b',kind:'vector',metadata:{data_revision:'b1'}}],denied=false,lists=0;const reads=[],items=new Map();
 const cache={generation:0,get:async k=>structuredClone(items.get(k)),put:async(k,v)=>items.set(k,structuredClone(v)),remove:async k=>items.delete(k)};
 const db={from:()=>({select(){return this;},eq(){return this;},order:async()=>{lists++;return denied?{error:Error('Access denied')}:{data:structuredClone(rows)};}}),rpc:async(_,args)=>{reads.push(args.p_layer_id);return {data:fc(args.p_layer_id)};}};
 return {db,cache,reads,items,get lists(){return lists;},setRows:value=>rows=value,deny:()=>denied=true};
}
test('draft reopen checks live access and reuses only unchanged per-account revisions',async()=>{
 const f=fixture(),options={userId:'user',cache:f.cache};
 const first=await draftLayers(f.db,{id:'project'},options);assert.deepEqual(f.reads,['a','b']);first[0].fc.features[0].geometry.coordinates[2]=999;
 const next=await draftLayers(f.db,{id:'project'},options);assert.equal(f.lists,2);assert.deepEqual(f.reads,['a','b']);assert.equal(next[0].fc.features[0].geometry.coordinates[2],301.25);assert.deepEqual(next[0].fc.features[0].properties,fc('a').features[0].properties);
 f.setRows([{id:'a',kind:'vector',metadata:{data_revision:'a2'}},{id:'b',kind:'vector',metadata:{data_revision:'b1'}}]);await draftLayers(f.db,{id:'project'},options);assert.deepEqual(f.reads,['a','b','a']);
 await draftLayers(f.db,{id:'project'},{...options,userId:'another'});assert.deepEqual(f.reads,['a','b','a','a','b']);
 f.deny();await assert.rejects(draftLayers(f.db,{id:'project'},options),/Access denied/);assert.equal(f.items.has('draft:user:project'),false);
});
test('cold draft loading overlaps at most two requests and preserves layer order',async()=>{
 const f=fixture();f.setRows(['a','b','c'].map(id=>({id,kind:'vector'})));let active=0,maximum=0;const gates=new Map();
 f.db.rpc=(_,args)=>new Promise(resolve=>{active++;maximum=Math.max(active,maximum);gates.set(args.p_layer_id,()=>{active--;resolve({data:fc(args.p_layer_id)});});});
 const result=draftLayers(f.db,{id:'project'},{userId:'user',cache:f.cache});
 while(gates.size<2)await Promise.resolve();assert.deepEqual([...gates.keys()],['a','b']);gates.get('b')();
 while(!gates.has('c'))await Promise.resolve();gates.get('c')();gates.get('a')();
 const layers=await result;assert.equal(maximum,2);assert.deepEqual(layers.map(l=>l.id),['a','b','c']);
});
test('account changes discard completed draft loading and do not persist its data',async()=>{
 const f=fixture();f.db.rpc=async(_,args)=>{f.cache.generation++;return {data:fc(args.p_layer_id)};};
 await assert.rejects(draftLayers(f.db,{id:'project'},{userId:'user',cache:f.cache}),/Account changed/);assert.equal(f.items.size,0);
});
test('failed parallel opening cleans previews that finish after another request fails',async()=>{
 const f=fixture();f.setRows([{id:'bad',kind:'vector'},{id:'late',kind:'raster',raster_path:'image.png'}]);let finish;const revoked=[];const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 URL.createObjectURL=()=> 'blob:late';URL.revokeObjectURL=url=>revoked.push(url);
 f.db.rpc=async()=>({error:Error('Read failed')});f.db.storage={from:()=>({download:()=>new Promise(resolve=>finish=()=>resolve({data:new Blob(['image'])}))})};
 try{const result=draftLayers(f.db,{id:'project'},{userId:'user',cache:f.cache});while(!finish)await Promise.resolve();finish();await assert.rejects(result,/Read failed/);assert.deepEqual(revoked,['blob:late']);assert.equal(f.items.size,0);}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
});
test('legacy layers use the live project revision and invalidate after a project change',async()=>{
 const f=fixture(),options={userId:'user',cache:f.cache};f.setRows([{id:'old',kind:'vector',project_revision:{draft_revision:7}}]);
 await draftLayers(f.db,{id:'project'},options);await draftLayers(f.db,{id:'project'},options);assert.deepEqual(f.reads,['old']);
 f.setRows([{id:'old',kind:'vector',project_revision:{draft_revision:8}}]);await draftLayers(f.db,{id:'project'},options);assert.deepEqual(f.reads,['old','old']);
});
