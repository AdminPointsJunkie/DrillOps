import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installPanelDragging} from '../src/panel-drag.js';
test('panel handles move with arrow keys and remain within the viewport',()=>{
 const dom=new JSDOM('<aside id="sidebar"><button class="panel-drag-handle" data-panel-drag>Move</button></aside>');
 const doc=dom.window.document,panel=doc.querySelector('aside'),handle=doc.querySelector('button');
 panel.getBoundingClientRect=()=>({left:parseFloat(panel.style.left)||10,top:parseFloat(panel.style.top)||20,width:280,height:300});
 installPanelDragging(doc);
 handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(panel.style.left,'20px');
 handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));assert.equal(panel.style.top,'60px');assert.equal(panel.style.getPropertyValue('--sidebar-top'),'60px');assert.equal(panel.style.maxHeight,'');
 for(let i=0;i<50;i++)handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));
 assert.equal(parseFloat(panel.style.left),dom.window.innerWidth-284);dom.window.close();
});

test('new dialogs get draggable headers and remain inside the viewport',async()=>{
 const dom=new JSDOM('<body></body>'),w=dom.window,doc=w.document;installPanelDragging(doc);
 const panel=doc.createElement('dialog');panel.innerHTML='<div class="dialog-heading"><h2>Calculator</h2><button>Close</button></div><input>';doc.body.append(panel);
 panel.getBoundingClientRect=()=>({left:parseFloat(panel.style.left)||300,top:parseFloat(panel.style.top)||650,width:600,height:600});panel.open=true;
 await Promise.resolve();const handle=panel.querySelector('.dialog-heading');assert.ok(handle.hasAttribute('data-panel-drag'));assert.equal(panel.style.top,'164px');
 const event=(type,x,y)=>{const e=new w.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:1});handle.dispatchEvent(e);};
 event('pointerdown',320,180);event('pointermove',120,80);event('pointerup',120,80);assert.equal(panel.style.left,'100px');assert.equal(panel.style.top,'64px');dom.window.close();
});
