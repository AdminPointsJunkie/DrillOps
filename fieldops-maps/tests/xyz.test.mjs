import {locationFilesPanel,addLocationFiles,removeLocationFile,attachmentPaths} from '../src/location-files.js';
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
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createLocalWorkspace} from '../src/local-workspace.js';
import {xyzSettings,xyzLayer} from '../src/xyz.js';
import {importCRS,projectCRS} from '../src/project.js';
import {installBasemaps} from '../src/basemaps.js';
import {vectorStyle,pointMarker,styleControls,visibilityIcon} from '../src/layer-style.js';

test('XYZ validates templates, transport and zoom; escapes provider attribution',()=>{
 const url='https://{s}.example.com/{z}/{x}/{y}{r}.png?key=browser-key';
 assert.equal(xyzSettings({url}).url,url);
 for(const bad of ['http://example.com/{z}/{x}/{y}', 'javascript:alert(1)', 'https://example.com/{z}/{x}', 'https://user:pass@example.com/{z}/{x}/{y}', 'https://example.com/{z}/{x}/{y}?key={secret}'])assert.throws(()=>xyzSettings({url:bad}));
 assert.throws(()=>xyzSettings({url,minZoom:5,maxZoom:4}));
 assert.throws(()=>xyzSettings({url,maxZoom:23}));
 let options;
 xyzLayer({tileLayer:(u,o)=>{options=o;return {once(){}};}},{name:'Test',opacity:.4,metadata:{xyz:{url,attribution:'<img onerror=bad>',maxZoom:18}}});
 assert.equal(options.opacity,.4);assert.equal(options.maxNativeZoom,18);
 assert.equal(options.attribution,'&lt;img onerror=bad&gt;');
});

test('XYZ add, save, edit, visibility, target, opacity and project reload never download a raster',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://example.test/maps/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const db=createLocalWorkspace(new IDBFactory());
 db.storage.from=()=>{throw Error('XYZ must not upload or download raster blobs');};
 const project=(await db.from('maps').insert({name:'XYZ project'}).single()).data;
 const calls=[],views=[];
 const layer=()=>({addTo(){return this;},once(){return this;},getBounds(){return {};}});
 const panes={};const map={invalidateSize(){},getPane:id=>panes[id],createPane:id=>panes[id]={style:{}},hasLayer:()=>false,setView(center,zoom){views.push({center,zoom});return this;},on(){},removeLayer(){},fitBounds(){},getCenter:()=>({lat:-22,lng:148}),getZoom:()=>12,
  getBounds:()=>({pad:()=>({contains:()=>true}),getWest:()=>147,getSouth:()=>-23,getEast:()=>149,getNorth:()=>-21})};
 const L={GridLayer:{extend:()=>function(){return layer();}},map:()=>map,tileLayer:(url,options)=>{calls.push({url,options});return layer();},layerGroup:layer,
  control:{zoom:layer,scale:layer},latLngBounds:()=>({extend(){},isValid:()=>false})};
 globalThis.document=w.document;
 Object.assign(w,{locationFilesPanel,addLocationFiles,removeLocationFile,attachmentPaths,installSidebarToggle:()=>({}),installMapContext:()=>({close(){}}),installMapCompare:()=>({open(){},close(){},refresh(){},rekey(){},includes(){return false;}}),mapCoordinates:async()=>({text:"0, 0",label:"EPSG:4326",axes:"Latitude, longitude"}),installProjectHome,bindLineDistance,installToolMenus,installMapComponents,openAnalysis(){},openURLUpload(){},registerUpload:async()=>{},reportWebDevice:async()=>true,installStorageUsage:()=>({open(){},close(){}}),installPlatformAdmin:()=>({open(){},close(){}}),installRegistration:(db,options)=>installRegistration(db,{...options,doc:w.document}),installWorkspaceLayout,installMapExplorer,featureInfo,installFieldTools,annotationLayer,editAnnotation,publishedProjects,publishedLayers,readAuthLink:()=>({}),installPasswordSetup:()=>({onSession(){}}),installAccounts:()=>({close(){}}),createSaveStatus,syncProjectRelease,transferProject,CLOUD_FILE_LIMIT,installSidebarResize,orderPanes,pointLabels,cachedConversion,nodeId,flattenTree,parentGroup,removeNode,moveNode,normaliseTree,structuredClone,L,LOCAL_TESTING:true,createLocalWorkspace:()=>db,xyzSettings,xyzLayer,importCRS,projectCRS,installBasemaps,
  vectorStyle,pointMarker,styleControls,visibilityIcon,errorText:e=>e.message,fetch:async()=>({json:async()=>[]})});
 const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.env.BASE_URL',"'/maps/'");
 w.eval(source);
 const $=s=>w.document.querySelector(s),tick=()=>new Promise(r=>setTimeout(r,30));
 const submit=()=>$('#xyz-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 try{
  for(let i=0;i<100&&!$('.home-project');i++)await tick();assert.ok($('.home-project'),'saved project appears on Home');$('.home-project').click();await tick();$('#add-xyz').click();$('#xyz-name').value='Site imagery';$('#xyz-url').value='https://tiles.example.com/{z}/{x}/{y}.png';submit();await tick();
  assert.equal($('#xyz-dialog').open,false);assert.match($('#layers').textContent,/XYZ tiles/);
  let saved=(await db.from('layers').select().eq('map_id',project.id).order()).data[0];
  assert.equal(saved.metadata.xyz.url,'https://tiles.example.com/{z}/{x}/{y}.png');assert.equal(saved.opacity,1);
  assert.equal($('#layers [data-action=export]'),null);
  $('#layers [data-action=visibility]').click();await tick();
  assert.equal($('#layers [data-action=visibility]').getAttribute('aria-pressed'),'false');
  $('#layers [data-action=zoom]').click();await tick();assert.deepEqual(Array.from(views.at(-1).center),[-22,148]);assert.equal(views.at(-1).zoom,12);
  const opacity=$('#layers [data-action=opacity]');opacity.value='.35';opacity.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
  $('#layers [data-action=edit-xyz]').click();$('#xyz-url').value='https://tiles.example.com/missing';submit();await tick();assert.match($('#xyz-error').textContent,/Include/);
  $('#xyz-url').value='https://tiles.example.com/new/{z}/{x}/{y}.png';$('#xyz-name').value='Updated imagery';submit();await tick();
  $('#refresh').click();await tick();
  assert.match($('#layers').textContent,/Updated imagery/);assert.equal($('#layers [data-action=opacity]').value,'0.35');
  assert.equal(calls.at(-1).url,'https://tiles.example.com/new/{z}/{x}/{y}.png');assert.equal(calls.at(-1).options.opacity,.35);
  // Add a second layer, group it via the accessible selector, then drag the first into the group.
  $('#add-xyz').click();$('#xyz-name').value='Upper tiles';$('#xyz-url').value='https://tiles.example.com/top/{z}/{x}/{y}.png';submit();await tick();
  $('#new-group').click();$('#group-name').value='Imagery';$('#group-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  const groupId=$('.layer-group').dataset.group;
  const membership=$('[data-membership]');membership.value=groupId;membership.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
  assert.match($('.group-contents').textContent,/Upper tiles/);
  const rootCard=$('#layers > .layer-card'),dragId=rootCard.dataset.id;
  const transfer={effectAllowed:'',dropEffect:'',setData(){},types:['text/plain']};
  const drag=new w.Event('dragstart',{bubbles:true});Object.defineProperty(drag,'dataTransfer',{value:transfer});rootCard.querySelector('[data-drag]').dispatchEvent(drag);
  const drop=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:transfer});$('.group-drop-zone').dispatchEvent(drop);await tick();
  assert.equal($('.group-contents').querySelectorAll('.layer-card').length,2);
  const cards=[...$('.group-contents').querySelectorAll('.layer-card')];
  const savedRows=(await db.from('layers').select().eq('map_id',project.id).order()).data;
  const stored=(await db.from('maps').select().eq('id',project.id).single()).data.layer_layout;
  assert.equal(stored[0].children[1],dragId);assert.equal(savedRows.length,2);
  // Each tile layer owns a pane; top card has the highest z-index, including after redraw.
  const paneNames=calls.filter(c=>c.options?.pane).slice(-2).map(c=>c.options.pane);
  assert.notEqual(paneNames[0],paneNames[1]);
  assert.ok(Number(panes[paneNames[1]].style.zIndex)>Number(panes[paneNames[0]].style.zIndex));
  $('[data-group-action=visibility]').click();await tick();assert.equal($('[data-group-action=visibility]').getAttribute('aria-pressed'),'false');
  $('[data-group-action=collapse]').click();await tick();$('#refresh').click();await tick();
  assert.equal($('.group-contents').hidden,true);assert.equal($('[data-group-action=visibility]').getAttribute('aria-pressed'),'false');
  $('[data-group-action=collapse]').click();await tick();$('[data-group-action=remove]').click();await tick();
  assert.equal($('.layer-group'),null);assert.equal($('#layers').querySelectorAll('.layer-card').length,2);
 }finally{w.close();delete globalThis.document;}
});
