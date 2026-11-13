import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {installPanelStack} from '../src/panel-stack.js';
test('newly opened panels and clicked panels share one order without moving DOM nodes',async()=>{
 const dom=new JSDOM('<body><aside id="sidebar"><button>Layers</button><section data-layer-panel="style" hidden><input></section></aside><section class="attribute-table" hidden><button>Table</button></section></body>'),doc=dom.window.document,proto=dom.window.HTMLElement.prototype,matches=proto.matches;let order=[];
 proto.matches=function(s){return s===':popover-open'?order.includes(this):matches.call(this,s);};proto.showPopover=function(){order.push(this);};proto.hidePopover=function(){order=order.filter(p=>p!==this);};
 try{const ui=installPanelStack(doc),side=doc.querySelector('#sidebar'),table=doc.querySelector('.attribute-table'),inspector=doc.querySelector('[data-layer-panel]');table.hidden=false;await Promise.resolve();assert.equal(order.at(-1),table);
 side.querySelector('button').dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true}));assert.equal(order.at(-1),side);table.querySelector('button').click();assert.equal(order.at(-1),table);
 inspector.hidden=false;await Promise.resolve();assert.equal(order.at(-1),inspector);ui.bringToFront(table);assert.equal(order.at(-1),table);assert.equal(inspector.parentElement,side);assert.equal(order.includes(inspector),true);
 doc.body.classList.add('project-home-open');await Promise.resolve();assert.equal(order.length,0);doc.body.classList.remove('project-home-open');await Promise.resolve();assert.equal(order.includes(side),true);assert.equal(order.includes(table),true);
 table.hidden=true;await Promise.resolve();assert.equal(order.includes(table),false);
 }finally{dom.window.close();}
});
