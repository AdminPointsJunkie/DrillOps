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

test('DXF point section exposes its own geometry editor and prevents mixing in lines or shapes',async()=>{
 const dom=new JSDOM('<div id="layers"></div><div class="map-area"></div>');globalThis.document=dom.window.document;
 const target={id:'points',name:'Drawing — Points',kind:'vector',metadata:{dxf_geometry:'point'},fc:{type:'FeatureCollection',features:[{type:'Feature',properties:{EntityHandle:'original'},geometry:{type:'Point',coordinates:[148,-22]}}]}};
 const handlers={},saved=[],make=()=>({addTo(){return this;},clearLayers(){},on(){return this;}});
 const L={layerGroup:make,polyline:make,circleMarker:make,marker:make,divIcon:x=>x,DomEvent:{stopPropagation(){}},geoJSON(f,options){options.onEachFeature(f,make());return make();}};
 const map={createPane:()=>({style:{}}),on:(n,f)=>handlers[n]=f,latLngToContainerPoint:c=>({x:c[1]*1000,y:c[0]*1000})};
 try{
  const editor=installGeometryEditor({L,map,getLayers:()=>[target],isVisible:()=>true,canEdit:()=>true,notify(){},save:async(old,next)=>{saved.push({old,next});}});
  editor.open(target);const q=s=>document.querySelector(s);
  assert.equal(q('[data-mode=point]').disabled,false);assert.equal(q('[data-mode=line]').disabled,true);assert.equal(q('[data-mode=polygon]').disabled,true);assert.equal(q('[data-mode=circle]').disabled,true);
  q('[data-snap]').checked=false;q('[data-mode=point]').click();handlers.click({latlng:{lng:148.01,lat:-22.01}});
  q('[data-save]').click();await new Promise(r=>setTimeout(r,0));
  assert.equal(saved.length,1);assert.equal(saved[0].old,target);assert.equal(saved[0].next.fc.features.length,2);assert.ok(saved[0].next.fc.features.every(f=>f.geometry.type==='Point'));assert.equal(target.fc.features.length,1);
 }finally{dom.window.close();delete globalThis.document;}
});
