import {installFeatureExtract} from '../src/feature-extract.js';
import {installMapSelection} from '../src/map-selection.js';
import {editFeatureAttributes} from '../src/feature-attributes.js';
import {toolDialog} from '../src/explore-dialogs.js';
import {isArchiveFile,isLocalGeoTIFF,assertCloudFile,cloudLayout} from '../src/data-policy.js';
import {createAnalyticsMeter} from '../src/analytics-meter.js';
import {locationFilesPanel,addLocationFiles,removeLocationFile,attachmentPaths} from '../src/location-files.js';
import {installProjectHome} from '../src/project-home.js';
import {bindLineDistance} from '../src/line-distance.js';
import {installToolMenus} from '../src/tool-menus.js';
import {installMapComponents} from '../src/map-components.js';
import {installRegistration} from '../src/registration.js';
import {installWorkspaceLayout} from '../src/workspace-layout.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {installMapExplorer} from '../src/map-explorer.js';
import {featureInfo} from '../src/explore-data.js';
import {installFieldTools,annotationLayer,editAnnotation} from '../src/field-tools.js';
import {publishedProjects,publishedLayers} from '../src/published-projects.js';
import {createSaveStatus} from '../src/save-status.js';
import {installSidebarResize} from '../src/sidebar-resize.js';
import {orderPanes} from '../src/pane-order.js';
import {pointLabels} from '../src/point-labels.js';
import {nodeId,flattenTree,parentGroup,removeNode,moveNode,normaliseTree} from '../src/layer-tree.js';
import {installBasemaps} from '../src/basemaps.js';
import {vectorStyle,pointMarker,styleControls,visibilityIcon} from '../src/layer-style.js';

test('operator app loads assigned release and keeps visibility, filtering and ordering read-only',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://example.test/maps/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;globalThis.document=w.document;
 const feature={type:'Feature',properties:{Hole_ID:'IB-01'},geometry:{type:'Point',coordinates:[148,-22]}},item={id:'layer',name:'Published holes',kind:'vector',source_crs:'EPSG:4326',color:'#147d72',metadata:{style:{}},fc:{type:'FeatureCollection',features:[feature]}};
 const project={workspace_id:'workspace',id:'project',name:'Published project',release_id:'release'},calls=[];
 const db={auth:{onAuthStateChange(fn){queueMicrotask(()=>fn('SIGNED_IN',{user:{id:'operator',app_metadata:{maps_role:'operator'}}}));}},async rpc(name){calls.push(name);if(name==='workspace_context')return {data:{platform_admin:false,workspaces:[{id:'workspace',name:'Company',role:'operator',status:'active'}],invitations:[]}};if(name==='maps_published_projects')return {data:[project]};throw Error('Unexpected write or draft read: '+name);},from(name){calls.push(name);assert.equal(name,'map_releases');return {select(){return this;},eq(){return this;},async single(){return {data:{map_id:'project',version:3,published_at:'2026-10-28',manifest:{project,layer_layout:['layer'],layers:[item]}}};}};}};
 const leaf=()=>({addTo(){return this;},clearLayers(){},on(){return this;},getBounds:()=>({isValid:()=>true})}),panes={},map={getContainer:()=>w.document.querySelector('#map'),invalidateSize(){},closePopup(){},getPane:id=>panes[id],createPane:id=>panes[id]={style:{}},hasLayer:()=>false,setView(){return this;},on(){},removeLayer(){},fitBounds(){},getBounds:()=>({pad:()=>({contains:()=>true})})};
 const L={GridLayer:{extend:()=>function(){return leaf();}},map:()=>map,tileLayer:leaf,geoJSON:leaf,layerGroup:leaf,control:{zoom:leaf,scale:leaf},latLngBounds:()=>({extend(){},isValid:()=>true})};
 Object.assign(w,{installFeatureExtract,installMapSelection,editFeatureAttributes,toolDialog,isArchiveFile,isLocalGeoTIFF,assertCloudFile,cloudLayout,releaseCache:{clear:async()=>{}},createAnalyticsMeter,setInterval:()=>0,locationFilesPanel,addLocationFiles,removeLocationFile,attachmentPaths,installSidebarToggle:()=>({}),installMapContext:()=>({close(){}}),installMapCompare:()=>({open(){},close(){},refresh(){},rekey(){},includes(){return false;}}),mapCoordinates:async()=>({text:"0, 0",label:"EPSG:4326",axes:"Latitude, longitude"}),installProjectHome,bindLineDistance,installToolMenus,installMapComponents,openAnalysis(){},openURLUpload(){},registerUpload:async()=>{},reportWebDevice:async()=>true,installStorageUsage:()=>({open(){},close(){}}),installPlatformAdmin:()=>({open(){},close(){}}),installRegistration:(db,options)=>installRegistration(db,{...options,doc:w.document}),installWorkspaceLayout,L,structuredClone,installMapExplorer,featureInfo,installFieldTools,annotationLayer,editAnnotation,publishedProjects,publishedLayers:(db,p)=>publishedLayers(db,p),createSaveStatus,installSidebarResize,orderPanes,pointLabels,nodeId,flattenTree,parentGroup,removeNode,moveNode,normaliseTree,installBasemaps,vectorStyle,pointMarker,styleControls,visibilityIcon,readAuthLink:()=>({}),installPasswordSetup:()=>({onSession(){}}),installAccounts:()=>({close(){}}),LOCAL_TESTING:false,createClient:()=>db,SUPABASE_URL:'',SUPABASE_KEY:'',errorText:e=>e.message,fetch:async()=>({json:async()=>[]})});
 const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.env.BASE_URL',"'/maps/'");
 try{
  w.eval(source);await new Promise(r=>setTimeout(r,90));const $=s=>w.document.querySelector(s);
  assert.equal($('.project-home').hidden,false);$('.home-project').click();await new Promise(r=>setTimeout(r,40));assert.equal($('#map-name').textContent,'Published project');assert.equal($('#sync-status').textContent,'SYNC version 3');assert.equal(w.document.body.classList.contains('viewer-mode'),true);assert.equal($('#open-annotation').hidden,true);
  $('#layers [data-action=visibility]').click();await new Promise(r=>setTimeout(r,0));assert.equal($('#layers [data-action=visibility]').getAttribute('aria-pressed'),'false');
  $('#open-table').click();assert.equal($('[data-save-view]').hidden,true);assert.equal($('[data-info-settings]').hidden,true);
  assert.deepEqual(calls,['workspace_context','maps_published_projects','map_releases']);
 }finally{dom.window.close();delete globalThis.document;}
});
