import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installFloatingInspectors} from '../src/floating-inspectors.js';
test('floating editors keep delegated events and follow hidden state through rerenders',async()=>{
 const dom=new JSDOM('<div id="layers"><article><section data-layer-panel="style" hidden><button>Edit</button></section></article></div><div id="menu" hidden></div>'),doc=dom.window.document,proto=dom.window.HTMLElement.prototype,opened=new Set(),matches=proto.matches;
 proto.showPopover=function(){opened.add(this);};proto.hidePopover=function(){opened.delete(this);};proto.matches=function(selector){return selector===':popover-open'?opened.has(this):matches.call(this,selector);};
 const root=doc.querySelector('#layers'),menu=doc.querySelector('#menu'),panel=root.querySelector('section');let edits=0;root.addEventListener('click',()=>edits++);const ui=installFloatingInspectors(root,menu,doc);
 panel.hidden=false;await Promise.resolve();assert.ok(opened.has(panel));assert.equal(panel.closest('article').parentElement,root);panel.querySelector('button').click();assert.equal(edits,1);
 menu.hidden=false;ui.refresh();assert.ok(opened.has(menu));menu.hidden=true;panel.hidden=true;await Promise.resolve();assert.equal(opened.size,0);
 root.innerHTML='<article><section data-layer-panel="style" hidden></section></article>';await Promise.resolve();assert.equal(root.querySelector('section').getAttribute('popover'),'manual');dom.window.close();
});
