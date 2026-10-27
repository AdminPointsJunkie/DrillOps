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
 const dom=new JSDOM('<div id="app"></div>', {url:'https://example.test/maps/',runScripts:'outside-only'});
 const w=dom.window, catalogue=[{code:'EPSG:7856',name:'GDA2020 / MGA zone 56'},{code:'EPSG:4326',name:'WGS 84'}];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const projects=[], conversions=[],featureHandlers=[];let rasterMode=false,finishRaster;
 const db={auth:{onAuthStateChange(fn){fn('SIGNED_IN',{user:{id:'test-owner'}});}},from(table){
  let action='select',payload,filter;
  const query={select(){return query;},order(){return Promise.resolve({data:table==='maps'?[...projects]:[],error:null});},
   eq(key,value){filter=value;return query;},insert(value){action='insert';payload=value;return query;},update(value){action='update';payload=value;return query;},
   single(){let row;if(action==='insert'){row={id:String(projects.length+1),...payload};projects.push(row);}else{row=projects.find(p=>p.id===filter);Object.assign(row,payload);}return Promise.resolve({data:{...row},error:null});}};
  return query;
 }};
 const layer=()=>({addTo(){return this;},getBounds(){return {};},bindPopup(){return this;}});
 const panes={};const map={closePopup(){},getBounds:()=>({pad:()=>({contains:()=>true})}),getPane:id=>panes[id],createPane:id=>panes[id]={style:{}},hasLayer:()=>false,setView(){return this;},on(){},removeLayer(){},fitBounds(){}};
 const L={GridLayer:{extend:()=>function(){return layer();}},map:()=>map,tileLayer:layer,layerGroup:layer,geoJSON:(fc,options)=>{for(const f of fc.features)options.onEachFeature(f,{on:(name,handler)=>featureHandlers.push(handler)});return layer();},imageOverlay:layer,circleMarker:layer,
  control:{zoom:layer,scale:layer},latLngBounds:()=>({extend(){},isValid:()=>true})};
 const fc={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[153,-27]}}]};
 Object.assign(w,{orderPanes,pointLabels,cachedConversion,nodeId,flattenTree,parentGroup,removeNode,moveNode,normaliseTree,structuredClone,L,createClient:()=>db,SUPABASE_URL:'',SUPABASE_KEY:'',LOCAL_TESTING:false,xyzSettings,xyzLayer,importCRS,projectCRS,installBasemaps,vectorStyle,pointMarker,styleControls,visibilityIcon,
  errorText:e=>e.message,fetch:async()=>({json:async()=>catalogue}),
  inspect:async()=>({items:rasterMode?[{name:'Large raster',format:'GeoTIFF',kind:'raster',source:'EPSG:4326',info:{size:[10000,10000]},files:[]}]:[{name:'Survey',format:'CSV',kind:'vector',source:'EPSG:4326',count:1,rows:[{x:153,y:-27}],fields:['x','y'],files:[]}],errors:[]}),
  convert:async(item,settings)=>{conversions.push(settings.crs);if(rasterMode)return new Promise((resolve,reject)=>{finishRaster={resolve,reject};});return {fc,bounds:[153,-27,153,-27]};}});
 const code=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.env.BASE_URL',"'/maps/'");
 w.eval(code);
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
  $('#identify').click();featureHandlers[0]();assert.equal($('#feature-info').hidden,false);assert.match($('#feature-info-title').textContent,/Survey/);assert.match($('#feature-info-content').textContent,/Feature details/);$('#close-info').click();assert.equal($('#identify').getAttribute('aria-pressed'),'false');
  $('#queue [data-index]').click();assert.equal($('#crs-search').value,'Embedded coordinate system');assert.equal(projects[0].default_crs,'EPSG:7856');
  $('#review').close();change('#map-select','2');await tick();assert.equal($('#map-select').value,'1','pending imports prevent switching projects');
  $('#queue [data-discard]').click();change('#map-select','2');await tick();assert.match($('#project-default').textContent,/4326/);
  $('#project-settings').click();input('#project-crs','');submit('#name-form');await tick();assert.equal(projects[1].default_crs,null);
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
 }finally{w.close();}
});
