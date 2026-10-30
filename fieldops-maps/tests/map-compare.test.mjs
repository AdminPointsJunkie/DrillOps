import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installMapCompare} from '../src/map-compare.js';
function setup(items=[{id:'a',name:'Survey',kind:'vector',visible:true},{id:'b',name:'Image',kind:'raster',visible:true},{id:'hidden',name:'Hidden XYZ',kind:'raster',visible:false}]){
 const dom=new JSDOM('<div class="map-area"><div id="map"></div></div>'),doc=dom.window.document,container=doc.querySelector('#map'),panes=new Map(),overlays=new Map(),shown=new Set(),events={};let layers=items,pan=true,offset={x:0,y:0},width=1000;
 container.getBoundingClientRect=()=>({left:100,width});
 const map={getContainer:()=>container,getSize:()=>({x:width,y:600}),containerPointToLayerPoint:p=>({x:p[0]+offset.x,y:p[1]+offset.y}),hasLayer:l=>shown.has(l),removeLayer:l=>shown.delete(l),on:(names,fn)=>names.split(' ').forEach(n=>events[n]=fn),dragging:{enabled:()=>pan,disable:()=>{pan=false;},enable:()=>{pan=true;}}};
 function add(l){const pane=doc.createElement('div');container.append(pane);panes.set(l.id,pane);const overlay={addTo(){shown.add(this);return this;}};overlays.set(l.id,overlay);if(l.visible)shown.add(overlay);}
 layers.forEach(add);
 const state=[];const api=installMapCompare({L:{DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}}},map,getLayers:()=>layers,getLayer:l=>overlays.get(l.id),getPane:l=>panes.get(l.id),isVisible:l=>l.visible,onChange:x=>state.push(x)});
 function check(id,side,value){const input=doc.querySelector(`[data-layer="${id}"][data-side="${side}"]`);input.checked=value;input.dispatchEvent(new dom.window.Event('change'));}
 function pointer(type,x=600,id=1){const e=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,pointerId:id,button:0});doc.querySelector('[role=slider]').dispatchEvent(e);}
 return {dom,doc,api,map,panes,overlays,shown,events,state,check,pointer,get pan(){return pan;},setOffset:v=>{offset=v;},setWidth:v=>{width=v;},setLayers:v=>{layers=v;},add};
}
test('compare has an empty state and supports multiple layers on either or both sides',()=>{
 const empty=setup([]);empty.api.open();assert.match(empty.doc.body.textContent,/no layers to compare/);empty.api.close();empty.dom.window.close();
 const h=setup();h.api.open();assert.equal(h.doc.querySelectorAll('input[type=checkbox]').length,6);assert.equal(h.panes.get('a').style.clip,'rect(0px, 500px, 600px, 0px)');assert.equal(h.panes.get('b').style.clip,'rect(0px, 1000px, 600px, 500px)');
 h.check('a','right',true);assert.equal(h.panes.get('a').style.clip,'');h.check('a','left',false);assert.equal(h.panes.get('a').style.clip,h.panes.get('b').style.clip);h.check('a','right',false);assert.equal(h.panes.get('a').style.visibility,'hidden');
 h.check('hidden','left',true);assert.ok(h.shown.has(h.overlays.get('hidden')));h.api.close();assert.ok(!h.shown.has(h.overlays.get('hidden')));assert.equal(h.panes.get('a').style.visibility,'');assert.equal(h.panes.get('a').style.clip,'');assert.deepEqual(h.state,[true,false]);h.dom.window.close();
});
test('divider follows pointer, keyboard, map pan and resize; close/cancel restore dragging',()=>{
 const h=setup();h.api.open();h.pointer('pointerdown');assert.equal(h.pan,false);h.pointer('pointermove',850);assert.equal(h.doc.querySelector('[role=slider]').getAttribute('aria-valuenow'),'75');h.pointer('pointercancel');assert.equal(h.pan,true);
 h.setOffset({x:-120,y:30});h.events.move();assert.equal(h.panes.get('a').style.clip,'rect(30px, 630px, 630px, -120px)');h.setWidth(800);h.events.resize();assert.equal(h.panes.get('a').style.clip,'rect(30px, 480px, 630px, -120px)');
 const handle=h.doc.querySelector('[role=slider]');handle.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(handle.getAttribute('aria-valuenow'),'100');handle.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(handle.getAttribute('aria-valuenow'),'0');handle.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(handle.getAttribute('aria-valuenow'),'2');
 h.pointer('pointerdown');handle.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.api.active,false);assert.equal(h.pan,true);h.dom.window.close();
});
test('refresh handles removed/new layers, names safely, and saved IDs without changing source state',()=>{
 const layer={id:'a',name:'<img src=x onerror=alert(1)>',kind:'vector',visible:true},h=setup([layer]);const original=structuredClone(layer);h.api.open();assert.equal(h.doc.querySelector('.map-compare-panel img'),null);assert.equal(h.api.includes('a'),true);
 const pane=h.panes.get('a'),overlay=h.overlays.get('a');layer.id='saved';h.panes.set('saved',pane);h.overlays.set('saved',overlay);h.api.rekey('a','saved');h.api.refresh();assert.equal(h.api.includes('saved'),true);
 const newLayer={id:'new',name:'New layer',kind:'vector',visible:false};h.add(newLayer);h.setLayers([newLayer]);h.api.refresh();assert.equal(h.api.includes('saved'),false);assert.equal(h.doc.querySelectorAll('input[type=checkbox]').length,2);h.api.close();assert.equal(layer.name,original.name);assert.equal(layer.visible,true);assert.equal(pane.style.clip,'');h.dom.window.close();
});
test('closing restores changes made to normal visibility while comparing and preserves disabled panning',()=>{
 const layer={id:'a',name:'A',kind:'vector',visible:true},h=setup([layer]);h.api.open();layer.visible=false;h.map.dragging.disable();h.pointer('pointerdown');h.pointer('pointerup');assert.equal(h.pan,false);h.api.close();assert.ok(!h.shown.has(h.overlays.get('a')));h.dom.window.close();
});
