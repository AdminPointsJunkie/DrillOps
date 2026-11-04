import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
import {createLocalWorkspace} from '../src/local-workspace.js';
import {installLayerBin} from '../src/layer-bin.js';
test('removed layers stay removed after reopening, and restore to another project with their data',async()=>{
 const factory=new IDBFactory(),db=createLocalWorkspace(factory);
 const a=(await db.from('maps').insert({name:'A',layer_layout:[]}).single()).data,b=(await db.from('maps').insert({name:'B',layer_layout:[]}).single()).data;
 const id=(await db.rpc('import_vector',{p_layer:{map_id:a.id,name:'Survey',metadata:{style:{color:'red'}}},p_features:[{type:'Feature',properties:{name:'Point'},geometry:{type:'Point',coordinates:[153,-27]}}]})).data;
 await db.from('maps').update({layer_layout:[{id:'g',name:'Group',children:[id]}]}).eq('id',a.id);
 assert.equal((await db.rpc('maps_layer_bin',{p_action:'trash',p_layer:id})).error,null);
 const reopened=createLocalWorkspace(factory);
 assert.equal((await reopened.from('layers').select().eq('map_id',a.id)).data.length,0);
 const items=(await reopened.rpc('maps_layer_bin',{p_action:'list'})).data;assert.equal(items.length,1);assert.equal(new Date(items[0].expires_at)-new Date(items[0].deleted_at),30*86400000);
 assert.equal((await reopened.rpc('maps_layer_bin',{p_action:'restore',p_layer:id,p_target:b.id})).error,null);
 const restored=(await reopened.from('layers').select().eq('map_id',b.id)).data[0];assert.equal(restored.id,id);assert.equal(restored.metadata.style.color,'red');assert.equal(restored.fc.features[0].properties.name,'Point');
 assert.equal((await reopened.rpc('maps_layer_bin',{p_action:'list'})).data.length,0);
 await reopened.rpc('maps_layer_bin',{p_action:'trash',p_layer:id});await reopened.rpc('maps_layer_bin',{p_action:'purge',p_layer:id});assert.equal((await reopened.rpc('maps_layer_bin',{p_action:'list'})).data.length,0);assert.ok((await reopened.rpc('maps_layer_bin',{p_action:'restore',p_layer:id})).error);
});
test('expired local entries are purged on access and cannot be restored',async()=>{
 const db=createLocalWorkspace(new IDBFactory());const p=(await db.from('maps').insert({name:'P'}).single()).data;
 await db.from('trash').insert({id:'expired',map_id:p.id,layer:{name:'Expired'},deleted_at:'2000-01-01',expires_at:'2000-01-31'});
 assert.deepEqual((await db.rpc('maps_layer_bin',{p_action:'list'})).data,[]);assert.equal((await db.from('trash').select()).data.length,0);
});
test('basket restores to the chosen project, escapes names, and retains errors without losing items',async()=>{
 const dom=new JSDOM(''),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let rows=[{id:'a',map_id:'p',name:'<img src=x>',project:'Source',deleted_at:'2026-11-04',expires_at:'2026-12-04',can_change:true}],fail=false;const calls=[],changed=[];
 const db={rpc:async(_name,args)=>{calls.push(args);if(args.p_action==='list')return {data:rows};if(fail)return {error:Error('Offline')};rows=[];return {data:{map_id:args.p_target}};}};
 const ui=installLayerBin({db,doc,getWorkspace:()=>({id:'w'}),getProjects:()=>[{id:'p',name:'Source'},{id:'q',name:'Destination'}],canOpen:()=>true,isAdmin:()=>true,onChanged:async r=>changed.push(r)});
 try{await ui.open();assert.equal(doc.querySelector('img'),null);doc.querySelector('select').value='q';fail=true;await doc.querySelector('[data-restore]').onclick();assert.match(doc.querySelector('[data-message]').textContent,/Offline/);assert.ok(doc.querySelector('.bin-item'));fail=false;await doc.querySelector('[data-restore]').onclick();assert.equal(changed[0].map_id,'q');assert.equal(doc.querySelector('.bin-item'),null);assert.ok(calls.find(c=>c.p_action==='restore'&&c.p_target==='q'));}finally{dom.window.close();}
});
