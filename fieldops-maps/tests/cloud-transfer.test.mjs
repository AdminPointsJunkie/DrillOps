import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createLocalWorkspace} from '../src/local-workspace.js';
import {transferProject,CLOUD_FILE_LIMIT} from '../src/cloud-transfer.js';

test('cloud transfer preserves source files, features, XYZ, styles and groups; retries without duplicates',async()=>{
 const local=createLocalWorkspace(new IDBFactory()),cloud=createLocalWorkspace(new IDBFactory());
 const project=(await local.from('maps').insert({name:'Survey',default_crs:'EPSG:7856'}).single()).data;
 await local.storage.from('gis-files').upload('local/source.csv',new Blob(['X,Y\n153,-27']));
 const fc=[{type:'Feature',properties:{name:'Hole 1'},geometry:{type:'Point',coordinates:[153,-27]}}];
 const vector=(await local.rpc('import_vector',{p_layer:{map_id:project.id,name:'Holes',kind:'vector',source_crs:'EPSG:4326',original_paths:['local/source.csv'],color:'#123456',opacity:.4,visible:false,metadata:{style:{labelField:'name'}}},p_features:fc})).data;
 const xyz=(await local.from('layers').insert({map_id:project.id,name:'Imagery',kind:'raster',source_crs:'EPSG:3857',metadata:{xyz:{url:'https://example.test/{z}/{x}/{y}.png'}}}).single()).data.id;
 project.layer_layout=[{id:'group-1',name:'Survey',visible:false,collapsed:true,children:[vector]},xyz];
 await local.from('maps').update({layer_layout:project.layer_layout}).eq('id',project.id);
 const rpc=cloud.rpc;let fail=true;
 cloud.rpc=(name,args)=>name==='register_file_upload'?Promise.resolve({data:null}):fail?(fail=false,Promise.resolve({error:Error('Network interrupted')})):rpc(name,args);
 await assert.rejects(transferProject(local,cloud,project,'owner-1'),/Network interrupted/);
 const id=await transferProject(local,cloud,project,'owner-1');
 const copied=(await cloud.from('layers').select('*').eq('map_id',id).order()).data;
 assert.equal(copied.length,2);
 const v=copied.find(l=>l.kind==='vector');
 assert.equal(v.opacity,.4);assert.equal(v.visible,false);assert.equal(v.metadata.style.labelField,'name');
 assert.deepEqual(v.fc.features,fc);
 assert.equal(await (await cloud.storage.from('gis-files').download(v.original_paths[0])).data.text(),'X,Y\n153,-27');
 const remote=(await cloud.from('maps').select('*').eq('id',id).single()).data;
 assert.equal(remote.layer_layout[0].children[0],v.id);assert.equal(remote.layer_layout[0].visible,false);
 await cloud.from('maps').update({layer_layout:[]}).eq('id',id);
 assert.equal(await transferProject(local,cloud,project,'owner-1'),id);
 assert.equal((await cloud.from('layers').select('*').order()).data.length,2);
 assert.deepEqual((await cloud.from('maps').select('*').eq('id',id).single()).data.layer_layout,[]);
 assert.equal((await local.from('layers').select('*').order()).data.length,2);
});

test('oversized originals stop transfer before creating any cloud project',async()=>{
 const local=createLocalWorkspace(new IDBFactory()),cloud=createLocalWorkspace(new IDBFactory());
 const project=(await local.from('maps').insert({name:'Large imagery'}).single()).data;
 await local.from('layers').insert({map_id:project.id,name:'Aerial',kind:'raster',original_paths:['big.png']});
 local.storage.from=()=>({download:async()=>({data:{size:CLOUD_FILE_LIMIT+1},error:null})});
 await assert.rejects(transferProject(local,cloud,project,'owner-1'),/50 MB/);
 assert.equal((await cloud.from('maps').select('*').order()).data.length,0);
});
