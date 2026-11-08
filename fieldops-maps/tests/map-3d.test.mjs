import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {installMap3D} from '../src/map-3d.js';
function setup(options={}){
 const dom=new JSDOM('<div class="map-area"></div><button id="open-drawing"></button><button id="identify" disabled></button>',{url:'https://example.test/maps/'}),doc=dom.window.document;
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const notices=[],engines=[],map={getCenter:()=>({lng:148,lat:-21}),getZoom:()=>15,on(){},off(){},invalidateSize(){},setView(){}};
 const make=()=>{const engine={stats:[],viewer:{},basemap(){},sync:async()=>{},fit(){},resize(){},destroy(){this.destroyed=true;}};engines.push(engine);return engine;};
 const control=installMap3D({doc,map,getLayers:()=>[],getBasemap:()=>({type:'street'}),toast:m=>notices.push(m),loadScene:async()=>({createScene3D:async()=>make()}),...options});return {doc,dom,control,engines,notices,make};
}
test('3D opens lazily, restores 2D controls, and releases rendering resources',async()=>{
 const s=setup();assert.equal(s.engines.length,0);await s.control.open();assert.equal(s.control.active,true);assert.equal(s.doc.querySelector('#open-drawing').disabled,true);s.control.close();assert.equal(s.control.active,false);assert.equal(s.engines[0].destroyed,true);assert.equal(s.doc.querySelector('#open-drawing').disabled,false);assert.equal(s.doc.querySelector('#identify').disabled,true);s.control.destroy();s.dom.window.close();
});
test('unsupported WebGL keeps 2D available and preserves prior disabled controls',async()=>{
 const s=setup({loadScene:async()=>({createScene3D:async()=>{throw Error('WebGL unavailable');}})});await s.control.open();assert.equal(s.control.active,false);assert.match(s.notices[0],/continue in 2D/);assert.equal(s.doc.querySelector('#identify').disabled,true);s.control.destroy();s.dom.window.close();
});
test('pending drawings block the switch without discarding edits',async()=>{
 const s=setup({canOpen:()=>false});await s.control.open();assert.equal(s.engines.length,0);assert.match(s.notices[0],/drawing/);s.control.destroy();s.dom.window.close();
});
test('closing during initialization destroys the late renderer and keeps 2D active',async()=>{
 let release;const waiting=new Promise(resolve=>release=resolve),s=setup({loadScene:async()=>({createScene3D:()=>waiting})}),opening=s.control.open();await new Promise(r=>setTimeout(r,0));s.control.close();const late=s.make();release(late);await opening;assert.equal(late.destroyed,true);assert.equal(s.control.active,false);s.control.destroy();s.dom.window.close();
});
