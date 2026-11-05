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
 handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));assert.equal(panel.style.top,'60px');
 for(let i=0;i<50;i++)handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));
 assert.equal(parseFloat(panel.style.left),dom.window.innerWidth-284);dom.window.close();
});
