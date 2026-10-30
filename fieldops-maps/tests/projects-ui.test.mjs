import {installProjectHome} from '../src/project-home.js';
import {bindLineDistance} from '../src/line-distance.js';
import {installToolMenus} from '../src/tool-menus.js';
import {installMapComponents} from '../src/map-components.js';
import {installRegistration} from '../src/registration.js';
import {installWorkspaceLayout} from '../src/workspace-layout.js';
import {installMapExplorer} from '../src/map-explorer.js';
import {featureInfo} from '../src/explore-data.js';
import {installFieldTools,annotationLayer,editAnnotation} from '../src/field-tools.js';
import {publishedProjects,publishedLayers} from '../src/published-projects.js';
import {createSaveStatus} from '../src/save-status.js';
import {syncProjectRelease} from '../src/operator-sync.js';
import {transferProject,CLOUD_FILE_LIMIT} from '../src/cloud-transfer.js';
import {installSidebarResize} from '../src/sidebar-resize.js';
import {orderPanes} from '../src/pane-order.js';
import {pointLabels} from '../src/point-labels.js';
import {cachedConversion} from '../src/conversion-cache.js';
import {nodeId,flattenTree,parentGroup,removeNode,moveNode,normaliseTree} from '../src/layer-tree.js';
import {xyzSettings,xyzLayer} from '../src/xyz.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {importCRS,projectCRS} from '../src/project.js';
import {installBasemaps} from '../src/basemaps.js';
import {vectorStyle,pointMarker,styleControls,visibilityIcon} from '../src/layer-style.js';

test('create, edit and switch projects; retain per-import CRS overrides through preview', async () => {
 const dom=new JSDOM('<div id="app"></div>', {url:'https://example.test/maps/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window, catalogue=[{code:'EPSG:7856',name:'GDA2020 / MGA zone 56'},{code:'EPSG:4326',name:'WGS 84'}];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const projects=[], conversions=[],featureHandlers=[];let rasterMode=false,finishRaster,attributeEditor;
 const db={rpc:async(name)=>name==='workspace_context'?{data:{platform_admin:false,workspaces:[{id:'workspace',name:'Company',role:'admin',status:'active'}],invitations:[]}}:{data:null},auth:{onAuthStateChange(fn){fn('SIGNED_IN',{user:{id:'test-owner',app_metadata:{maps_role:'editor'}}});}},from(table){
  let action='select',payload,filter;
  const query={select(){return query;},order(){return Promise.resolve({data:table==='maps'?[...projects]:[],error:null});},
   eq(key,value){filter=value;return query;},insert(value){action='insert';payload=value;return query;},update(value){action='update';payload=value;return query;},
   single(){let row;if(action==='insert'){row={id:String(projects.length+1),...payload};projects.push(row);}else{row=projects.find(p=>p.id===filter);Object.assign(row,payload);}return Promise.resolve({data:{...row},error:null});}};
  return query;
 }};
 const layer=()=>({addTo(){return this;},getBounds(){return {};},bindPopup(){return this;}});
 const panes={};const map={invalidateSize(){},closePopup(){},getBounds:()=>({pad:()=>({contains:()=>true})}),getPane:id=>panes[id],createPane:id=>panes[id]={style:{}},hasLayer:()=>false,setView(){return this;},on(){},removeLayer(){},fitBounds(){}};
 const L={GridLayer:{extend:()=>function(){return layer();}},map:()=>map,tileLayer:layer,layerGroup:layer,geoJSON:(fc,options)=>{for(const f of fc.features||[fc])options.onEachFeature?.(f,{on:(name,handler)=>featureHandlers.push(handler)});return layer();},imageOverlay:layer,circleMarker:layer,
  control:{zoom:layer,scale:layer},latLngBounds:()=>({extend(){},isValid:()=>true})};
 const fc={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[153,-27]}}]};
 globalThis.document=w.document;
 Object.assign(w,{installSidebarToggle:()=>({}),installMapContext:()=>({close(){}}),installMapCompare:()=>({open(){},close(){},refresh(){},rekey(){},includes(){return false;}}),mapCoordinates:async()=>({text:"0, 0",label:"EPSG:4326",axes:"Latitude, longitude"}),installProjectHome,bindLineDistance,installToolMenus,installMapComponents,openAnalysis(){},openURLUpload(){},registerUpload:async()=>{},reportWebDevice:async()=>true,installStorageUsage:()=>({open(){},close(){}}),installPlatformAdmin:()=>({open(){},close(){}}),installRegistration:(db,options)=>installRegistration(db,{...options,doc:w.document}),installWorkspaceLayout,installMapExplorer,featureInfo,installFieldTools,annotationLayer,editAnnotation,publishedProjects,publishedLayers,openAttributeStyle:(layer,onApply)=>{attributeEditor={layer,onApply};},readAuthLink:()=>({}),installPasswordSetup:()=>({onSession(){}}),installAccounts:()=>({close(){}}),createSaveStatus,syncProjectRelease,transferProject,CLOUD_FILE_LIMIT,installSidebarResize,orderPanes,pointLabels,cachedConversion,nodeId,flattenTree,parentGroup,removeNode,moveNode,normaliseTree,structuredClone,L,createClient:()=>db,SUPABASE_URL:'',SUPABASE_KEY:'',LOCAL_TESTING:false,xyzSettings,xyzLayer,importCRS,projectCRS,installBasemaps,vectorStyle,pointMarker,styleControls,visibilityIcon,
  errorText:e=>e.message,fetch:async()=>({json:async()=>catalogue}),
  inspect:async()=>({items:rasterMode?[{name:'Large raster',format:'GeoTIFF',kind:'raster',source:'EPSG:4326',info:{size:[10000,10000]},files:[]}]:[{name:'Survey',format:'CSV',kind:'vector',source:'EPSG:4326',count:1,rows:[{x:153,y:-27}],fields:['x','y'],files:[{name:'survey.csv'}]}],errors:[]}),
  convert:async(item,settings)=>{conversions.push(settings.crs);if(rasterMode)return new Promise((resolve,reject)=>{finishRaster={resolve,reject};});return {fc,bounds:[153,-27,153,-27]};}});
 const code=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.env.BASE_URL',"'/maps/'");
 w.eval(code+";window.testSetEditor=()=>{currentWorkspace.role='editor';updateAccess();};window.testOpenProject=()=>openProject(true);");
 const $=s=>w.document.querySelector(s), tick=()=>new Promise(r=>setTimeout(r,20));
 const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('input',{bubbles:true}));};
 const submit=id=>$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const change=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('change',{bubbles:true}));};
 try{
  await tick();$('#new-map').click();input('#new-name','Ironbark');input('#project-crs','7856');submit('#name-form');await tick();
  assert.equal(projects[0].default_crs,'EPSG:7856');assert.equal($('#map-name').textContent,'Ironbark');
  $('#new-map').click();input('#new-name','Carborough');input('#project-crs','4326');submit('#name-form');await tick();
  assert.equal(projects.length,2);assert.equal($('#map-select').options.length,3);
  change('#map-select','1');await tick();assert.match($('#project-default').textContent,/7856/);
  $('#project-settings').click();input('#new-name','Ironbark survey');submit('#name-form');await tick();assert.equal(projects[0].name,'Ironbark survey');
  // Import review starts with the project CRS, despite embedded WGS84.
  Object.defineProperty($('#files'),'files',{value:[{name:'survey.csv'}]});$('#files').dispatchEvent(new w.Event('change'));await tick();
  assert.match($('#crs-search').value,/7856/);assert.equal($('#use-embedded').hidden,false);
  $('#use-embedded').click();assert.equal($('#crs-search').value,'Embedded coordinate system');
  $('#preview-layer').click();await tick();assert.equal(conversions[0],'EPSG:4326');
  $('#identify').click();featureHandlers[0]();assert.equal($('#feature-info').hidden,false);assert.match($('#feature-info-title').textContent,/Survey/);assert.ok($('#feature-info-content table'));$('#close-info').click();assert.equal($('#identify').getAttribute('aria-pressed'),'false');
  $('#queue [data-index]').click();assert.equal($('#crs-search').value,'Embedded coordinate system');assert.equal(projects[0].default_crs,'EPSG:7856');
  $('#review').close();change('#map-select','2');await tick();assert.equal($('#map-select').value,'1','pending imports prevent switching projects');
  $('#queue [data-discard]').click();change('#map-select','2');await tick();assert.match($('#project-default').textContent,/4326/);
  $('#project-settings').click();input('#project-crs','');submit('#name-form');await tick();assert.equal(projects[1].default_crs,null);
  // Editing a source reuses its layer identity and applies new import settings.
  w.eval('user=null');
  $('#files').dispatchEvent(new w.Event('change'));await tick();
  $('#crs-search').value='4326';$('#crs-search').dispatchEvent(new w.Event('input'));$('#crs-results [data-code="EPSG:4326"]').click();
  submit('#review-form');await tick();
  const originalId=$('.layer-card').dataset.id;
  $('[data-action="attribute-style"]').click();
  assert.equal(attributeEditor.layer.id,originalId);
  const rules={mode:'expression',expressions:{color:"'#ff0000'",symbol:"'triangle'",pointSize:'20'}};
  await attributeEditor.onApply(rules);
  assert.deepEqual(attributeEditor.layer.metadata.style.rules,rules);
  assert.match($('.layer-card').textContent,/Value-based styling is active/);
  $('[data-action="settings"]').click();await tick();
  assert.equal($('#review').open,true);assert.equal($('#layer-name').value,'Survey');
  assert.equal($('#csv-x').value,'x');assert.equal($('#csv-y').value,'y');
  assert.equal($('#import-layer').textContent,'Save layer settings');
  input('#layer-name','Edited survey');input('#crs-search','7856');$('#crs-results [data-code="EPSG:7856"]').click();
  submit('#review-form');await tick();
  assert.equal($('.layer-card').dataset.id,originalId);assert.match($('.layer-card').textContent,/Edited survey/);
  assert.equal(conversions.at(-1),'EPSG:7856');assert.equal(w.document.querySelectorAll('.layer-card').length,1);
  $('[data-action="settings"]').click();await tick();assert.match($('#crs-search').value,/7856/);
  $('#review').close();$('#queue [data-discard]').click();
  // A slow raster releases the modal immediately, retains navigation, and prevents closing mid-job.
  rasterMode=true;$('#files').dispatchEvent(new w.Event('change'));await tick();
  $('#preview-layer').click();await tick();
  assert.equal($('#review').open,false);assert.equal($('#import-job').hidden,false);
  assert.ok($('#import-job progress'));assert.equal($('#fit').disabled,false);
  const unloading=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(unloading);assert.equal(unloading.defaultPrevented,true);
  finishRaster.reject(new Error('Insufficient raster memory'));await tick();
  assert.match($('#import-job').textContent,/Import failed.*Insufficient raster memory/);
  assert.ok($('#queue [data-index]'),'failed raster remains retryable');
  $('#queue [data-index]').click();$('#preview-layer').click();await tick();
  finishRaster.resolve({bounds:[150,-28,151,-27]});await tick();
  assert.match($('#import-job').textContent,/Preview ready/);assert.equal($('#import-job progress'),null);
  w.testSetEditor();assert.equal($('#people').hidden,true);assert.equal($('#project-settings').hidden,true);$('#name-dialog').close();w.testOpenProject();assert.equal($('#name-dialog').open,false);
 }finally{w.close();delete globalThis.document;}
});
