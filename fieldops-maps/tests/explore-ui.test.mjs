import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installMapExplorer} from '../src/map-explorer.js';
import {installFieldTools} from '../src/field-tools.js';
import {classifyFeatures} from '../src/attribute-style.js';
const tick=ms=>new Promise(r=>setTimeout(r,ms));
function setup(){
 const dom=new JSDOM('<div id="layers"><article class="layer-card" data-id="holes"></article></div><div class="map-area"><div id="map"></div></div>',{pretendToBeVisual:true});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.show=dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'));};
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
  const complete=$('[data-legend-key="string:Complete"]');complete.click();
  assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,70);assert.equal(redraws,1);assert.equal(writes,1);
  $('[data-filter]').click();$('[data-add]').click();const field=$('[data-key=field]'),op=$('[data-key=op]'),value=$('[data-key=value]');field.value='Depth';field.dispatchEvent(new w.Event('change',{bubbles:true}));op.value='gt';op.dispatchEvent(new w.Event('change',{bubbles:true}));const val=$('[data-key=value]');val.value='130';val.dispatchEvent(new w.Event('change',{bubbles:true}));$('.explore-dialog form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(0);
  assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,4);
  $('[data-save-view]').click();await tick(0);assert.equal(writes,2);assert.equal(layer.metadata.style.view.filter.conditions[0].field,'Depth');
  $('.attribute-table tbody tr button').click();assert.equal(fits.length,1);assert.match(info.title,/IB-/);assert.ok($('.attribute-table tr.selected'));
  explorer.openSearch();$('[data-global-search]').value='IB-133';$('[data-global-search]').dispatchEvent(new w.Event('input'));await tick(180);
  assert.equal(document.querySelectorAll('[data-result-layer]').length,1);$('[data-result-layer]').click();assert.equal(info.title,'IB-133');assert.equal($('.feature-search').hidden,true);
  editable=false;explorer.refresh();assert.equal($('[data-save-view]').hidden,true);assert.equal($('[data-info-settings]').hidden,true);assert.equal($('[data-save-default]'),null);
  $('[data-reset]').click();assert.equal(writes,2);assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,4,'reset returns to saved defaults');
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

test('table adds columns, previews calculations and saves typed row edits; viewers cannot edit',async()=>{
 const env=setup(),{dom,L,map}=env,w=dom.window,$=s=>document.querySelector(s);
 const layer={id:'holes',name:'Holes',kind:'vector',color:'#147d72',metadata:{},fc:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[148,-22]},properties:{Depth:10}},{type:'Feature',geometry:{type:'Point',coordinates:[148,-22]},properties:{Depth:20}}]}};
 let editable=true,writes=0;
 try{const api=installMapExplorer({L,map,getLayers:()=>[layer],isVisible:()=>true,canEdit:()=>editable,redraw(){},saveStyle(){},showInfo(){},saveAttributes:async(l,fc,types,removed=[])=>{writes++;l.fc=fc;l.metadata.field_types={...l.metadata.field_types,...types};for(const name of removed)delete l.metadata.field_types[name];}});api.openTable();
 $('[data-add-column]').click();$('dialog [name=column]').value='Result';$('dialog form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(0);assert.equal(writes,1);assert.equal(layer.fc.features[0].properties.Result,null);
 $('[data-calculator]').click();const mode=$('dialog [name=mode]');mode.value='existing';mode.dispatchEvent(new w.Event('change',{bubbles:true}));$('dialog [name=existing]').value='Result';$('dialog [name=expression]').value='"Depth" * 2';assert.equal($('dialog [type=submit]').disabled,true);$('[data-preview-calc]').click();assert.match($('[data-calculation-preview]').textContent,/2 rows/);assert.equal(writes,1);$('dialog form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(0);assert.equal(writes,2);assert.equal(layer.fc.features[1].properties.Result,40);
 $('.attribute-table tbody [data-show]').click();$('[data-edit-row]').click();const input=$('dialog [aria-label=Result]');input.value='33';input.dispatchEvent(new w.Event('input'));$('dialog form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(0);assert.equal(layer.fc.features[0].properties.Result,33);
 $('[data-delete-column]').click();$('dialog [name=column]').value='Result';$('dialog [name=confirm]').checked=true;$('dialog form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(0);assert.ok(layer.fc.features.every(f=>!Object.hasOwn(f.properties,'Result')));assert.equal(layer.metadata.field_types.Result,undefined);assert.ok(!$('.attribute-table thead').textContent.includes('Result'));
 editable=false;api.refresh();for(const name of ['data-add-column','data-calculator','data-edit-row','data-delete-column'])assert.equal($(`[${name}]`).hidden,true);
 }finally{env.close();}
});

test('classified years hide independently and collapse survives rebuilding rows',async()=>{
 const env=setup(),{dom,L,map}=env;
 try{
  const fc={features:[2005,2006,2021].map(year=>({type:'Feature',properties:{Year:year},geometry:{type:'Point',coordinates:[148,-22]}}))};
  const layer={id:'holes',name:'Holes',kind:'vector',fc,metadata:{style:{rules:{mode:'categorized',field:'Year',classes:classifyFeatures(fc,'Year','categorized')}}}};
  const original=JSON.stringify(fc);let writes=0;
  const api=installMapExplorer({L,map,getLayers:()=>[layer],isVisible:()=>true,canEdit:()=>true,redraw(){},saveStyle:async(l,k,v)=>{writes++;l.metadata.style[k]=structuredClone(v);},showInfo(){}});
  api.refresh();api.openTable();assert.ok(document.querySelector('.has-classified-legend'));
  for(const year of [2005,2006])document.querySelector(`[data-legend-key="number:${year}"]`).click();
  assert.deepEqual(fc.features.map(f=>api.acceptFeature(layer,f)),[false,false,true]);
  assert.equal(document.querySelectorAll('.attribute-table tbody tr').length,1);
  document.querySelector('.layer-legend').open=false;await tick(10);
  document.querySelector('.layer-card').replaceChildren();api.refresh();
  assert.equal(document.querySelector('.layer-legend').open,false);
  assert.equal(document.querySelector('[data-legend-key="number:2005"]').getAttribute('aria-pressed'),'false');assert.ok(document.querySelector('[data-legend-key="number:2005"]').closest('.is-hidden'));assert.equal(document.querySelector('.layer-legend input[type=checkbox]'),null);
  document.querySelector('.layer-legend').open=true;document.querySelector('[data-legend-key="number:2005"]').click();
  assert.deepEqual(fc.features.map(f=>api.acceptFeature(layer,f)),[true,false,true]);
  assert.equal(JSON.stringify(fc),original);assert.equal(writes,3);
  api.reset();api.refresh();assert.deepEqual(fc.features.map(f=>api.acceptFeature(layer,f)),[true,false,true],'reload restores saved visibility');
 }finally{env.close();}
});


test('Save persists viewer class choices when editing starts, without saving personal search',async()=>{
 const env=setup(),{L,map,dom}=env;
 try{
  const fc={features:[2005,2006,2021].map(Year=>({type:'Feature',properties:{Year},geometry:{type:'Point',coordinates:[148,-22]}}))};
  const layer={id:'holes',name:'Holes',kind:'vector',fc,metadata:{style:{view:{filter:{conditions:[]}},rules:{mode:'categorized',field:'Year',classes:classifyFeatures(fc,'Year','categorized')}}}};
  let editable=false,writes=0;
  const api=installMapExplorer({L,map,getLayers:()=>[layer],isVisible:()=>true,canEdit:()=>editable,redraw(){},saveStyle:async(l,k,v)=>{writes++;l.metadata.style[k]=structuredClone(v);},showInfo(){}});
  api.refresh();api.openTable();document.querySelector('[data-legend-key="number:2005"]').click();
  await api.saveVisibilityChanges();assert.equal(writes,0,'viewers cannot save map defaults');
  const search=document.querySelector('[data-table-search]');search.value='2006';search.dispatchEvent(new dom.window.Event('input'));await tick(200);
  editable=true;await api.saveVisibilityChanges();assert.equal(writes,1);assert.equal(layer.metadata.style.view.search,undefined);assert.deepEqual(layer.metadata.style.view.filter,{conditions:[]});
  api.reset();api.refresh();assert.deepEqual(fc.features.map(f=>api.acceptFeature(layer,f)),[false,true,true]);
 }finally{env.close();}
});
