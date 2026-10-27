import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installSidebarResize} from '../src/sidebar-resize.js';

test('sidebar drag resizes, clamps, persists and supports keyboard and reset',()=>{
 const dom=new JSDOM('<aside></aside><div id="handle"></div>',{url:'https://example.test',pretendToBeVisual:true}),w=dom.window;
 const side=w.document.querySelector('aside'),handle=w.document.querySelector('#handle');
 handle.setPointerCapture=()=>{};handle.hasPointerCapture=()=>false;
 const pointer=(type,x)=>{const e=new w.MouseEvent(type,{clientX:x,button:0,bubbles:true,cancelable:true});Object.defineProperty(e,'pointerId',{value:1});handle.dispatchEvent(e);};
 try{
  installSidebarResize(handle,side,()=>{},w);
  assert.equal(handle.getAttribute('aria-valuenow'),'285');
  pointer('pointerdown',285);pointer('pointermove',420);assert.equal(side.style.getPropertyValue('--sidebar-width'),'420px');
  pointer('pointerup',420);assert.equal(w.localStorage.getItem('fieldops-maps-sidebar-width'),'420');
  pointer('pointerdown',420);pointer('pointermove',900);pointer('pointerup',900);assert.equal(handle.getAttribute('aria-valuenow'),'600');
  handle.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home'}));assert.equal(handle.getAttribute('aria-valuenow'),'240');
  pointer('pointerdown',240);pointer('pointermove',400);pointer('pointercancel',400);assert.equal(handle.getAttribute('aria-valuenow'),'240');
  handle.dispatchEvent(new w.MouseEvent('dblclick'));assert.equal(handle.getAttribute('aria-valuenow'),'285');
  w.localStorage.setItem('fieldops-maps-sidebar-width','410');installSidebarResize(w.document.createElement('div'),side,()=>{},w);
  assert.equal(side.style.getPropertyValue('--sidebar-width'),'410px');
 }finally{w.close();}
});
