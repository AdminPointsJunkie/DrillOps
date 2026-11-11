import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {librarySection,openDataLibrary} from '../src/data-library.js';
import {addLayerToLibrary} from '../src/add-layer-to-library.js';
const rows=[{id:'mine',created_by:'me',visibility:'private',workspace_id:'p'},{id:'other-private',created_by:'other',visibility:'private',workspace_id:'p',shared_direct:true},{id:'project',created_by:'other',visibility:'project',workspace_id:'p'},{id:'archived',archived:true,workspace_id:'p'},{id:'elsewhere',visibility:'project',workspace_id:'q'}];
test('library sections distinguish private, direct shares, project entries, archive and favourites',()=>{
 const options={userId:'me',workspaceId:'p',publicRows:[{id:'public'}],isFavourite:r=>['mine','public'].includes(r.id)},ids=t=>librarySection(rows,t,options).map(r=>r.id);
 assert.deepEqual(ids('yours'),['mine']);assert.deepEqual(ids('shared'),['other-private']);assert.deepEqual(ids('project'),['project']);assert.deepEqual(ids('archived'),['archived']);assert.deepEqual(ids('favourites'),['public','mine']);assert.deepEqual(ids('public'),['public']);
});
function setup(){const dom=new JSDOM('<body></body>',{url:'https://example.test'});globalThis.document=dom.window.document;globalThis.FormData=dom.window.FormData;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};return dom;}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('library has six sections and no upload/save controls or automatic map layers',async()=>{
 const dom=setup();const d=openDataLibrary({L:{},canCreate:()=>true,getScope:()=> 'p',getUser:()=>({id:'me'}),getWorkspace:()=>({id:'p'}),workspaceLibrary:{list:async()=>rows,canManage:()=>false},favourites:{list:async()=>[]}});await tick();
 assert.equal(d.querySelectorAll('[role=tab]').length,6);assert.equal(d.querySelector('[data-upload-drawing],[data-save-layer]'),null);assert.equal(d.querySelector('[data-layer]').dataset.layer,'project');
 d.querySelector('[data-tab=yours]').click();assert.equal(d.querySelectorAll('[data-layer]').length,1);assert.equal(d.querySelector('[data-layer]').dataset.layer,'mine');d.close();dom.window.close();
});
test('right-click add form uses project default and allows a per-layer override',async()=>{
 const dom=setup();let saved;const layer={name:'Survey',kind:'vector'},library={defaultVisibility:async()=> 'private',save:async(l,details)=>saved={l,details}};
 const d=await addLayerToLibrary({layer,library,getScope:()=> 'p',canSave:()=>true});assert.equal(d.querySelector('[name=visibility]').value,'private');d.querySelector('[name=visibility]').value='project';await d.querySelector('form').onsubmit({preventDefault(){},target:d.querySelector('form')});assert.equal(saved.l,layer);assert.equal(saved.details.visibility,'project');assert.equal(d.open,false);dom.window.close();
});
