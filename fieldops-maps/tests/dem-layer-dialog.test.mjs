import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openDEMLayer} from '../src/dem-layer-dialog.js';
function setup(){const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;dom.window.HTMLDialogElement.prototype.show=function(){};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'));};return dom;}
const source=()=>({name:'Ironbark',url:'https://example.com/catalog.json',datum:'Unknown',bounds:[149,-23,150,-22],dispose(){this.disposed=true;}});
const submit=d=>d.querySelector('form').onsubmit({preventDefault(){}});
test('add creates one visible-layer source with chosen display settings and releases collection',async()=>{
 const dom=setup(),dem=source();let result;
 const d=openDEMLayer({canEdit:()=>true,loadDEM:async()=>dem,onApply:r=>{result=r;}});
 d.querySelector('[name=opacity]').value='.45';await submit(d);
 assert.equal(result.name,'Ironbark');assert.equal(result.settings.opacity,.45);assert.equal(result.settings.url,dem.url);assert.deepEqual(result.bounds,dem.bounds);assert.equal(result.fc.features[0].geometry.type,'Polygon');assert.equal(dem.disposed,true);assert.equal(d.isConnected,false);dom.window.close();
});
test('editing changes display without loading source or losing source settings',async()=>{
 const dom=setup();let result;
 const layer={name:'DEM',opacity:.8,metadata:{cloud_dem:{url:'https://example.com/a.json',datum:'AHD',min:1,max:30}}};
 const d=openDEMLayer({layer,canEdit:()=>true,loadDEM:()=>assert.fail('should not reload'),onApply:r=>{result=r;}});
 d.querySelector('[name=mode]').value='grey';d.querySelector('[name=min]').value='';await submit(d);
 assert.equal(result.settings.datum,'AHD');assert.equal(result.settings.min,null);assert.equal(result.settings.mode,'grey');assert.equal(result.settings.opacity,.8);dom.window.close();
});
test('invalid range does not add a layer',async()=>{
 const dom=setup(),d=openDEMLayer({canEdit:()=>true,loadDEM:()=>assert.fail(),onApply:()=>assert.fail()});
 d.querySelector('[name=min]').value='30';d.querySelector('[name=max]').value='10';await submit(d);assert.match(d.querySelector('.error').textContent,/Maximum/);assert.equal(d.querySelector('[type=submit]').disabled,false);dom.window.close();
});
for(const reason of ['close','access'])test(`pending load cannot add after ${reason}`,async()=>{
 const dom=setup(),dem=source();let resolve,allowed=true;
 const d=openDEMLayer({canEdit:()=>allowed,loadDEM:()=>new Promise(r=>resolve=r),onApply:()=>assert.fail('stale layer added')});
 const pending=submit(d);if(reason==='close')d.close();else allowed=false;resolve(dem);await pending;assert.equal(dem.disposed,true);dom.window.close();
});
