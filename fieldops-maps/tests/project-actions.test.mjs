import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function setup(){
 const dom=new JSDOM('<button id="save-draft"></button><button id="delete-project"></button><button id="save-project"></button><aside id="sidebar"></aside><div id="project-error"></div><dialog id="name-dialog" open></dialog><select id="map-select"><option value="one">One</option><option value="two">Two</option></select>',{runScripts:'outside-only'});
 const w=dom.window,calls=[];w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 Object.assign(w,{calls,confirm:()=>false,db:{from(table){calls.push(table);return {delete(){calls.push('delete');return this;},eq(key,id){calls.push([key,id]);return this;},select(){return this;},async single(){return w.response||{data:{id:'one'}};}};}}});
 w.eval(`const $=s=>document.querySelector(s);let busy=false,syncing=false,draftSaving=false,activeMap={id:'one',name:'Project One',last_synced_at:'unchanged'},user={id:'user'},layers=[],queue=[],geometryEditor={},fieldTools={},editingProject=true,maps=[activeMap,{id:'two'}];const LOCAL_TESTING=false;let readonly=false,admin=true,pending=false;const isReadOnly=()=>readonly,isAdmin=()=>admin,workspacePending=()=>pending;const toast=text=>calls.push(text),errorText=e=>e.message;const setBusy=value=>{busy=value;},refreshSaveStatus=()=>{},syncProject=()=>calls.push('refresh'),homeUI={refresh:()=>calls.push('home')};const clearMap=()=>calls.push('clear');const retrySaves=async()=>{calls.push('save layers');if(window.failSave)throw Error('Offline');};const saves={state:()=>({pending:false}),flush:async()=>calls.push('flush')};const saveLayout=async()=>calls.push('layout');const syncProjectRelease=()=>{throw Error('Save must not publish');};`.replace(/\b(const|let)\b/g,'var'));
 for(const [start,end] of [["$('#save-draft').onclick=async()=>{","$('#sync-project').onclick=async()=>{"],["$('#delete-project').onclick=async()=>{","$('#name-form').onsubmit=async e=>{"]])w.eval(source.slice(source.indexOf(start),source.indexOf(end)));
 return {w,calls,close:()=>w.close(),$:s=>w.document.querySelector(s)};
}
test('SAVE flushes the draft without publishing or changing the published revision',async()=>{
 const {w,calls,$,close}=setup();try{
  await $('#save-draft').onclick();assert.deepEqual(calls.slice(0,4),['save layers','flush','layout','flush']);assert.match(calls.at(-1),/Draft saved/);assert.equal(w.eval('activeMap.last_synced_at'),'unchanged');assert.equal($('#sidebar').inert,false);
  calls.length=0;w.failSave=true;await $('#save-draft').onclick();assert.match(calls.at(-1),/could not be saved.*Offline/);assert.equal(calls.includes('layout'),false);assert.equal(w.eval('busy||draftSaving'),false);
  calls.length=0;w.eval('readonly=true');await $('#save-draft').onclick();assert.equal(calls.length,0);
  w.eval('readonly=false;queue=[{}]');await $('#save-draft').onclick();assert.match(calls.at(-1),/queued imports/);
 }finally{close();}
});
test('Delete project confirms its name, preserves state on failure, and removes only the selected project',async()=>{
 const {w,calls,$,close}=setup();try{
  await $('#delete-project').onclick();assert.equal(calls.length,0);
  let prompt;w.confirm=text=>{prompt=text;return true;};w.response={error:Error('Permission denied')};await $('#delete-project').onclick();assert.match(prompt,/Project One/);assert.match(prompt,/published phone release/);assert.equal(w.eval('activeMap.id'),'one');assert.match($('#project-error').textContent,/Permission denied/);assert.equal($('#name-dialog').open,true);
  w.response={data:null};await $('#delete-project').onclick();assert.match($('#project-error').textContent,/could not be confirmed/);assert.equal(w.eval('activeMap.id'),'one');
  w.response={data:{id:'one'}};await $('#delete-project').onclick();assert.equal(w.eval('activeMap'),null);assert.equal($('#map-select option[value=one]'),null);assert.ok($('#map-select option[value=two]'));assert.equal($('#name-dialog').open,false);assert.equal($('#delete-project').disabled,false);assert.ok(calls.some(v=>Array.isArray(v)&&v[0]==='id'&&v[1]==='one'));
 }finally{close();}
});
test('Delete project blocks non-admins and pending edits',async()=>{
 const {w,calls,$,close}=setup();try{w.confirm=()=>{throw Error('Should not confirm');};w.eval('admin=false');await $('#delete-project').onclick();assert.equal(calls.length,0);w.eval('admin=true;pending=true');await $('#delete-project').onclick();assert.match(calls[0],/pending edits/);}finally{close();}
});

import {IDBFactory} from 'fake-indexeddb';
import {createLocalWorkspace} from '../src/local-workspace.js';
test('local project deletion also removes its layers and preserves other projects',async()=>{
 const db=createLocalWorkspace(new IDBFactory());
 const one=(await db.from('maps').insert({name:'One'}).select().single()).data;
 const two=(await db.from('maps').insert({name:'Two'}).select().single()).data;
 await db.from('layers').insert({map_id:one.id,name:'One layer'});
 await db.from('layers').insert({map_id:two.id,name:'Two layer'});
 const result=await db.from('maps').delete().eq('id',one.id).select('id').single();assert.equal(result.error,null);assert.equal(result.data.id,one.id);
 assert.equal((await db.from('layers').select().eq('map_id',one.id)).data.length,0);
 assert.equal((await db.from('layers').select().eq('map_id',two.id)).data.length,1);
 assert.equal((await db.from('maps').select().eq('id',two.id).single()).data.name,'Two');
});
