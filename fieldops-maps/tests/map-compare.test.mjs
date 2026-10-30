import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installMapCompare} from '../src/map-compare.js';
test('comparison clips both sides, restores original visibility and uses raster bounds in Leaflet order',()=>{
 const dom=new JSDOM('<main><div id="map"></div></main>'),old=globalThis.document;globalThis.document=dom.window.document;
 try{
  const panes={'data-one':{style:{visibility:''}},'data-hidden':{style:{visibility:'hidden'}}},added=[],removed=[],events={},images=[];
  const map={getContainer:()=>document.querySelector('#map'),getPane:n=>panes[n],getPanes:()=>panes,createPane:n=>panes[n]={style:{}},getSize:()=>({x:1000,y:700}),containerPointToLayerPoint:([x,y])=>({x:x+20,y:y+30}),on:(names,fn)=>names.split(' ').forEach(n=>events[n]=fn),removeLayer:l=>removed.push(l)};
  const layer=()=>({addTo(){added.push(this);return this;}}),L={DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},tileLayer:layer,imageOverlay:(url,bounds)=>{images.push(bounds);return layer();}};
  const comparison=installMapCompare({L,map,getLayers:()=>[{id:'raster',kind:'raster',name:'Raster',url:'test.png',bounds:[150,-28,154,-26]}]});comparison.open();
  assert.equal(panes['data-one'].style.visibility,'hidden');assert.equal(panes.compareLeft.style.clip,'rect(30px, 520px, 730px, 20px)');assert.equal(panes.compareRight.style.clip,'rect(30px, 1020px, 730px, 520px)');
  const right=document.querySelector('[data-right]');right.value='raster';right.onchange();assert.deepEqual(images[0],[[-28,150],[-26,154]]);
  const slider=document.querySelector('input');slider.value='25';slider.oninput();assert.equal(panes.compareLeft.style.clip,'rect(30px, 270px, 730px, 20px)');
  comparison.close();assert.equal(panes['data-one'].style.visibility,'');assert.equal(panes['data-hidden'].style.visibility,'hidden');assert.ok(document.querySelector('.map-compare-panel').hidden);assert.equal(added.length,removed.length);
 }finally{globalThis.document=old;dom.window.close();}
});
