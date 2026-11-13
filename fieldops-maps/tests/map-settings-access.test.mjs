import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const openProject=source.slice(source.indexOf('function openProject('),source.indexOf("$('#new-map').onclick=",source.indexOf('function openProject(')));
test('administrator can open map settings while viewing; editor and viewer remain blocked',()=>{
 const dom=new JSDOM('<form id="name-form"></form><p id="project-error"></p><h2 id="project-dialog-title"></h2><button id="delete-project"></button><input id="new-name"><input id="project-crs"><dialog id="name-dialog"></dialog>');const doc=dom.window.document;doc.querySelector('dialog').showModal=function(){this.open=true;};let admin=true,readOnlyPermission=false;
 const context=vm.createContext({$:s=>doc.querySelector(s),isPermissionReadOnly:()=>readOnlyPermission,isAdmin:()=>admin,isReadOnly:()=>true,geometryEditor:null,fieldTools:null,busy:false,layoutPending:false,styleSaves:new Set(),saves:{state:()=>({})},layers:[],user:{id:'owner'},activeMap:{name:'Selected thumbnail map',default_crs:'EPSG:20355'},renderProjectCRS(){},toast(){},editingProject:false});
 vm.runInContext(openProject+';openProject(true);',context);assert.equal(doc.querySelector('dialog').open,true);assert.equal(doc.querySelector('#new-name').value,'Selected thumbnail map');assert.equal(doc.querySelector('#delete-project').hidden,false);
 doc.querySelector('dialog').open=false;admin=false;vm.runInContext('openProject(true)',context);assert.equal(doc.querySelector('dialog').open,false);admin=true;readOnlyPermission=true;vm.runInContext('openProject(true)',context);assert.equal(doc.querySelector('dialog').open,false);dom.window.close();
});
