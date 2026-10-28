import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installGeometryEditor} from '../src/geometry-editor.js';
test('drawing editor keeps unsaved changes through failure, supports undo, and refuses viewer writes',async()=>{
 const dom=new JSDOM('<div id="layers"></div><div class="map-area"></div>');globalThis.document=dom.window.document;
 const handlers={},clicks=[],saved=[],previews=[];let editable=true,fail=true;
 const make=()=>({addTo(){return this;},clearLayers(){},on(name,fn){if(name==='click')clicks.push(fn);return this;}});
 const L={layerGroup:make,polyline:make,circleMarker:make,marker:make,divIcon:x=>x,DomEvent:{stopPropagation(){}},geoJSON(f,options){options.onEachFeature(f,make());return make();}};
 const map={createPane:()=>({style:{}}),on:(n,f)=>handlers[n]=f,latLngToContainerPoint:c=>({x:c[1]*1000,y:c[0]*1000})},q=s=>document.querySelector(s),tick=()=>new Promise(r=>setTimeout(r,0));
 try{
  const editor=installGeometryEditor({L,map,getLayers:()=>[],isVisible:()=>true,canEdit:()=>editable,onPreviewLayer:l=>previews.push(l),notify(){},save:async(l,v)=>{if(fail)throw Error('Offline');saved.push(v);}});
  editor.open();q('[data-mode=point]').click();handlers.click({latlng:{lng:148,lat:-22}});assert.equal(editor.pending,true);
  q('[data-undo]').click();assert.match(q('[data-count]').textContent,/0 features/);q('[data-redo]').click();assert.match(q('[data-count]').textContent,/1 features/);
  q('[data-save]').click();await tick();assert.match(q('[data-error]').textContent,/Offline/);assert.equal(editor.pending,true);assert.equal(editor.active,true);
  editable=false;q('[data-save]').click();await tick();assert.equal(saved.length,0);
  editable=true;fail=false;q('[data-save]').click();await tick();assert.equal(saved.length,1);assert.deepEqual(saved[0].fc.features[0].geometry.coordinates,[148,-22]);assert.equal(editor.pending,false);assert.equal(editor.active,false);assert.equal(q('#layers').inert,false);
  editable=false;editor.open();assert.equal(editor.active,false);
 }finally{dom.window.close();delete globalThis.document;}
});
