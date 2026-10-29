import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {splitDXFSections} from '../src/dxf-sections.js';
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const review=source.slice(source.indexOf('async function reviewAction('),source.indexOf("$('#preview-layer').onclick"));
const save=source.slice(source.indexOf('async function saveLayer('),source.indexOf('function clearMap('));
const makeLayer=()=>({id:'raw',name:'Survey',kind:'vector',metadata:{format:'DXF',style:{}},files:[{name:'survey.dxf',size:100}],source_crs:'EPSG:4326',fc:{type:'FeatureCollection',features:[
 {type:'Feature',properties:{EntityHandle:'p'},geometry:{type:'Point',coordinates:[0,0]}},
 {type:'Feature',properties:{EntityHandle:'l'},geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}},
 {type:'Feature',properties:{EntityHandle:'s'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}
]}});
function harness({failLine=false}={}){
 const elements=new Map(),uploaded=[],removed=[],saved=[],notices=[],layouts=[];
 const context={console,structuredClone,crypto:{randomUUID},splitDXFSections,CLOUD_FILE_LIMIT:50000000,LOCAL_TESTING:false,busy:false,queue:[{kind:'vector'}],reviewIndex:0,preview:null,user:{id:'user'},activeMap:{id:'project'},layerTree:[],layers:[],rendered:new Map(),
  $:selector=>{if(!elements.has(selector))elements.set(selector,{close(){},textContent:'',disabled:false});return elements.get(selector);},
  settings:()=>({crs:'EPSG:4326'}),convertCurrent:async()=>makeLayer(),setBusy:()=>{},renderQueue:()=>{},fit:()=>{},renderLayers:()=>{},updateEmpty:()=>{},refreshSaveStatus:()=>{},ensureMap:async()=>{},canEditLayer:()=>true,repairDXFLayer:async()=>0,
  toast:message=>notices.push(message),errorText:e=>e.message,registerUpload:async()=>{},explorer:{rekey(){}},
  saveLayout:async()=>layouts.push(structuredClone(context.layerTree)),
  replaceTreeId:(oldID,newID)=>{for(const node of context.layerTree){if(node.children){const i=node.children.indexOf(oldID);if(i>=0)node.children[i]=newID;}}},
  addLayer:l=>{context.layers.push(l);context.layerTree.unshift(l.id);context.rendered.set(l.id,{});},
  db:{storage:{from:()=>({upload:async(path)=>{uploaded.push(path);return {};},remove:async paths=>{removed.push(...paths);return {};}})},rpc:async(name,args)=>{
   if(failLine&&args.p_layer.metadata.dxf_geometry==='line'){failLine=false;return {error:Error('Temporary save failure')};}
   saved.push(structuredClone(args));return {data:randomUUID()};
  }}
 };
 vm.createContext(context);vm.runInContext(review+'\n'+save,context);return {context,uploaded,removed,saved,notices,layouts,elements};
}
test('DXF import creates grouped editable sections and uploads the shared original once',async()=>{
 const h=harness();await h.context.reviewAction(false);
 assert.equal(h.context.layers.length,3);assert.ok(h.context.layers.every(l=>l.saved));assert.equal(h.uploaded.length,1);assert.equal(h.removed.length,0);
 assert.equal(h.saved.length,3);assert.deepEqual(h.saved.map(a=>a.p_layer.metadata.dxf_geometry),['point','line','shape']);
 assert.ok(h.saved.every(a=>a.p_layer.original_paths[0]===h.uploaded[0]));
 assert.equal(h.context.layerTree.length,1);assert.deepEqual(Array.from(h.context.layerTree[0].children),h.context.layers.map(l=>l.id));assert.equal(h.context.queue.length,0);
});
test('partial save retains the unsaved section; retry never deletes or reuploads the shared source',async()=>{
 const h=harness({failLine:true});await h.context.reviewAction(false);
 assert.deepEqual(h.context.layers.map(l=>l.saved===true),[true,false,true]);assert.equal(h.uploaded.length,1);assert.equal(h.removed.length,0);assert.match(h.notices.at(-1),/saving needs attention/);
 await h.context.saveLayer(h.context.layers[1]);assert.ok(h.context.layers.every(l=>l.saved));assert.equal(h.uploaded.length,1);assert.equal(h.removed.length,0);
 assert.deepEqual(Array.from(h.context.layerTree[0].children),h.context.layers.map(l=>l.id));
});
test('rebuilding source settings replaces only the existing DXF section',async()=>{
 const h=harness(),old={id:'existing',metadata:{dxf_geometry:'line'}};h.context.queue=[{kind:'vector',editLayer:old}];let replacement;
 h.context.replaceLayer=async(a,b)=>{assert.equal(a,old);replacement=b;};await h.context.reviewAction(false);
 assert.equal(replacement.fc.features.length,1);assert.equal(replacement.fc.features[0].geometry.type,'LineString');assert.equal(replacement.metadata.dxf_geometry,'line');assert.equal(h.context.layers.length,0);assert.equal(h.uploaded.length,0);
});
