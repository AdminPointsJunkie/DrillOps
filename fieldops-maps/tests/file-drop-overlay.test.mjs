import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {installFileDropOverlay} from '../src/file-drop-overlay.js';
test('drop cleanup survives panel stopPropagation and cancelled drags',()=>{
 const dom=new JSDOM('<div class="map-area"><div id="dropzone"></div><aside>Files</aside></div>'),doc=dom.window.document,win=dom.window;installFileDropOverlay(doc);
 const active=()=>doc.querySelector('.map-area').classList.contains('photo-drop-active');const drag=(type,types=['Files'])=>{const e=new win.MouseEvent(type,{bubbles:true,clientX:100,clientY:100});Object.defineProperty(e,'dataTransfer',{value:{types}});doc.querySelector('aside').dispatchEvent(e);};
 try{doc.querySelector('aside').addEventListener('drop',e=>e.stopPropagation());drag('dragenter');drag('dragenter');assert.equal(active(),true);drag('drop');assert.equal(active(),false);assert.equal(doc.querySelector('#dropzone').classList.contains('dragging'),false);
 drag('dragenter');doc.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(active(),false);
 drag('dragenter');win.dispatchEvent(new win.Event('blur'));assert.equal(active(),false);
 drag('dragenter',['application/x-drillops-supporting-file']);assert.equal(active(),false);
 drag('dragenter');drag('dragend');assert.equal(active(),false);
 }finally{dom.window.close();}
});
