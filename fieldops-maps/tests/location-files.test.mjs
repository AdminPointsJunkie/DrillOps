import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
import {createLocalWorkspace} from '../src/local-workspace.js';
import {addLocationFiles,removeLocationFile,locationFiles,locationFilesPanel,validateFiles,FILE_LIMIT,attachmentPaths} from '../src/location-files.js';
import {pastedFeatures} from '../src/map-paste.js';
import {analyse} from '../src/analysis-engine.js';
import {transferProject} from '../src/cloud-transfer.js';
import {attributeFields} from '../src/attribute-style.js';

test('copy/paste and extraction retain attachment ownership paths for saving and publishing',()=>{
 const file={path:'owner/layer/attachments/id/plan.pdf',name:'Plan.pdf',size:12};
 const feature={type:'Feature',geometry:{type:'Point',coordinates:[153,-27]},properties:{name:'Hole',_fieldmaps_files:[file]}};
 const pasted=pastedFeatures(JSON.stringify(feature),{lng:154,lat:-28});
 assert.deepEqual(locationFiles(pasted.fc.features[0]),[file]);
 assert.deepEqual(attachmentPaths(pasted.fc,[file.path]),[file.path]);
 const extracted=analyse({operation:'extract',source:{type:'FeatureCollection',features:[feature]},target:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[152,-28],[154,-28],[154,-26],[152,-26],[152,-28]]]}}]}});
 assert.deepEqual(attachmentPaths(extracted,['source.csv']),['source.csv',file.path]);
});

test('files stay with their feature through reload, geometry edits and cloud transfer; removal retains published bytes',async()=>{
 const db=createLocalWorkspace(new IDBFactory()),cloud=createLocalWorkspace(new IDBFactory());
 const project=(await db.from('maps').insert({name:'Locations'}).single()).data;
 const fc={type:'FeatureCollection',features:[0,1].map(i=>({type:'Feature',properties:{name:`Hole ${i}`},geometry:{type:'Point',coordinates:[153+i,-27]}}))};
 let layer=(await db.from('layers').insert({name:'Holes',map_id:project.id,kind:'vector',source_crs:'EPSG:4326',fc}).single()).data;
 const save=async next=>{const {error}=await db.from('layers').update(next).eq('id',layer.id);if(error)throw error;layer=next;};
 await addLocationFiles({db,layer,feature:layer.fc.features[1],files:[new File(['site plan'],'Plan.pdf',{type:'application/pdf'})],userId:'owner',mapId:project.id,local:true,save});
 layer=(await db.from('layers').select().eq('id',layer.id).single()).data;
 assert.equal(locationFiles(layer.fc.features[0]).length,0);assert.equal(locationFiles(layer.fc.features[1]).length,1);
 assert.deepEqual(attributeFields(layer.fc),['name']);
 const attachment=locationFiles(layer.fc.features[1])[0];
 assert.equal(await (await db.storage.from('gis-files').download(attachment.path)).data.text(),'site plan');
 layer.fc.features[1].geometry.coordinates=[150,-28];await save(layer);
 const rpc=cloud.rpc;cloud.rpc=(name,args)=>name==='register_file_upload'?Promise.resolve({data:null}):rpc(name,args);
 const id=await transferProject(db,cloud,project,'cloud-owner');
 const remote=(await cloud.from('layers').select().eq('map_id',id).order()).data[0];
 const copied=locationFiles(remote.fc.features[1])[0];
 assert.notEqual(copied.path,attachment.path);assert.ok(remote.original_paths.includes(copied.path));
 assert.equal(await (await cloud.storage.from('gis-files').download(copied.path)).data.text(),'site plan');
 assert.deepEqual(remote.fc.features[1].geometry.coordinates,[150,-28]);
 await removeLocationFile({layer,feature:layer.fc.features[1],path:attachment.path,save});
 assert.equal(locationFiles(layer.fc.features[1]).length,0);assert.ok(layer.original_paths.includes(attachment.path));
 assert.equal((await db.storage.from('gis-files').download(attachment.path)).error,null);
});

test('validation and upload errors never save attachment references; stale features are rejected',async()=>{
 assert.throws(()=>validateFiles([{name:'large',size:FILE_LIMIT+1}]),/50 MB/);
 assert.throws(()=>validateFiles([{name:'empty',size:0}]),/empty/);
 assert.throws(()=>validateFiles(Array.from({length:7},()=>({name:'large',size:FILE_LIMIT}))),/300 MB/);
 const feature={properties:{}},layer={id:'layer',fc:{features:[feature]}};let saved=false;
 const args={layer,feature,files:[new File(['ok'],'file.txt')],local:true,db:{storage:{from:()=>({upload:async()=>({error:Error('Offline')})})}},save:async()=>saved=true};
 await assert.rejects(addLocationFiles(args),/Offline/);assert.equal(saved,false);assert.equal(locationFiles(feature).length,0);
 await assert.rejects(addLocationFiles({...args,feature:{}}),/changed/);
});

test('attachment panel escapes names, supports downloads and prevents operator writes',async()=>{
 const {document}=new JSDOM().window;
 const feature={properties:{_fieldmaps_files:[{name:'<img src=x onerror=alert(1)>',path:'owner/file',size:12}]}};
 let downloaded=false;
 const panel=locationFilesPanel({document,layer:{},feature,canEdit:()=>false,download:async()=>downloaded=true});
 assert.equal(panel.querySelector('input'),null);assert.equal(panel.querySelector('img'),null);
 assert.equal(panel.querySelectorAll('button').length,1);panel.querySelector('button').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(downloaded,true);
 const editable=locationFilesPanel({document,layer:{},feature,canEdit:()=>true,remove:async()=>{throw Error('Access denied');}});
 editable.querySelectorAll('button')[1].click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(editable.querySelector('[role=status]').textContent,/Access denied/);assert.equal(editable.querySelector('button').disabled,false);
});
