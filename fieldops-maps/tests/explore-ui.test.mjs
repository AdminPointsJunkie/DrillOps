import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installMapExplorer} from '../src/map-explorer.js';
import {installFieldTools} from '../src/field-tools.js';
import {classifyFeatures} from '../src/attribute-style.js';
const tick=ms=>new Promise(r=>setTimeout(r,ms));
function setup(){
 const dom=new JSDOM('<div id="layers"><article class="layer-card" data-id="holes"></article></div><div class="map-area"><div id="map"></div></div>',{pretendToBeVisual:true});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'));};
 const handlers={},fits=[],make=()=>({addTo(){return this;}}),L={geoJSON:make,circleMarker:make,layerGroup:make,polygon:make,polyline:make};
 const map={on:(name,fn)=>handlers[name]=fn,fitBounds:b=>fits.push(b),removeLayer(){},getBounds:()=>({getWest:()=>147,getEast:()=>150,getSouth:()=>-23,getNorth:()=>-21})};
 return {dom,L,map,handlers,fits,close(){dom.window.close();delete globalThis.document;}};
}
test('table, legend, filter, search and map selection stay linked; viewers never save defaults',async()=>{
 const env=setup(),{dom,L,map,fits}=env,w=dom.window,$=s=>document.querySelector(s);
 const fc={features:Array.from({length:140},(_,i)=>({type:'Feature',properties:{Hole_ID:`IB-${i+1}`,Status:i%2?'Complete':'Planned',Depth:i},geometry:{type:'Point',coordinates:[148+i*.0001,-22]}}))};
 const layer={id:'holes',name:'Holes',kind:'vector',color:'#147d72',fc,metadata:{style:{rules:{mode:'categorized',field:'Status',classes:classifyFeatures(fc,'Status','categorized')}}}};
 let writes=0,redraws=0,editable=true,info;
 try{
  const explorer=installMapExplorer({L,map,getLayers:()=>[layer],isVisible:()=>true,canEdit:()=>editable,redraw:()=>redraws++,saveStyle:async(l,k,v)=>{writes++;l.metadata.style[k]=v;},showInfo:(title,content)=>{info={title,content};}});
  explorer.refresh();explorer.openTable();assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,100);
  $('[data-page="1"]').click();assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,40);
  const complete=$('[data-legend-key="string:Complete"]');complete.checked=false;complete.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,70);assert.equal(redraws,1);assert.equal(writes,0);
  $('[data-filter]').click();$('[data-add]').click();const field=$('[data-key=field]'),op=$('[data-key=op]'),value=$('[data-key=value]');field.value='Depth';field.dispatchEvent(new w.Event('change',{bubbles:true}));op.value='gt';op.dispatchEvent(new w.Event('change',{bubbles:true}));const val=$('[data-key=value]');val.value='130';val.dispatchEvent(new w.Event('change',{bubbles:true}));$('.explore-dialog form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(0);
  assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,4);
  $('[data-save-view]').click();await tick(0);assert.equal(writes,1);assert.equal(layer.metadata.style.view.filter.conditions[0].field,'Depth');
  $('.attribute-table tbody tr button').click();assert.equal(fits.length,1);assert.match(info.title,/IB-/);assert.ok($('.attribute-table tr.selected'));
  explorer.openSearch();$('[data-global-search]').value='IB-133';$('[data-global-search]').dispatchEvent(new w.Event('input'));await tick(180);
  assert.equal(document.querySelectorAll('[data-result-layer]').length,1);$('[data-result-layer]').click();assert.equal(info.title,'IB-133');assert.equal($('.feature-search').hidden,true);
  editable=false;explorer.refresh();assert.equal($('[data-save-view]').hidden,true);assert.equal($('[data-info-settings]').hidden,true);assert.equal($('[data-save-default]'),null);
  $('[data-reset]').click();assert.equal(writes,1);assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,4,'reset returns to saved defaults');
 }finally{env.close();}
});
test('measurement remains local; annotation save checks role and carries drawn coordinates',async()=>{
 const env=setup(),{L,map,handlers,dom}=env,$=s=>document.querySelector(s);let admin=false,saved=[];
 try{
  const tools=installFieldTools({L,map,canAnnotate:()=>admin,hasProject:()=>true,onAnnotation:async a=>saved.push(a),notify(){}});
  tools.open('annotation');assert.equal($('.field-tools-panel').hidden,true);
  tools.open('measure');handlers.click({latlng:{lng:0,lat:0}});handlers.click({latlng:{lng:1,lat:0}});assert.match($('[data-measure-result]').textContent,/111.20 km/);$('[data-tool-finish]').click();assert.equal(tools.drawing,false);assert.equal(saved.length,0);
  admin=true;tools.open('annotation');$('[data-annotation-name]').value='Gate';$('[data-annotation-note]').value='Use south gate';handlers.click({latlng:{lng:148,lat:-22}});assert.equal(tools.pending,true);$('[data-tool-finish]').click();await tick(0);assert.equal(saved.length,1);assert.deepEqual(saved[0].feature.geometry.coordinates,[148,-22]);assert.equal(tools.pending,false);
  tools.open('annotation');$('[data-annotation-name]').value='Gate';$('[data-annotation-note]').value='Keep out';handlers.click({latlng:{lng:148,lat:-22}});admin=false;$('[data-tool-finish]').click();await tick(0);assert.match($('[data-tool-error]').textContent,/Only admins/);assert.equal(saved.length,1);
 }finally{env.close();}
});
