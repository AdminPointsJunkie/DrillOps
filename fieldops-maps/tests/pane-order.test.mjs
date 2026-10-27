import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {orderPanes} from '../src/pane-order.js';

test('every layer count gets valid integer CSS stacking, with DOM order resolving ties',()=>{
 const dom=new JSDOM('<div id="panes"></div>'),root=dom.window.document.getElementById('panes');
 for(const count of [1,2,3,4,5,7,20,200,500]){
  root.replaceChildren();
  const panes=Array.from({length:count},()=>root.appendChild(dom.window.document.createElement('div')));
  orderPanes(panes);
  panes.forEach((pane,i)=>{
   assert.match(pane.style.zIndex,/^\d+$/,'fractional z-index is rejected by browsers');
   assert.ok(Number(pane.style.zIndex)>=400&&Number(pane.style.zIndex)<600);
   if(i)assert.ok(Number(panes[i-1].style.zIndex)>=Number(pane.style.zIndex));
  });
  assert.deepEqual([...root.children],panes.toReversed());
  const reordered=panes.toReversed();orderPanes(reordered);
  assert.equal(root.lastChild,reordered[0]);
  if(count>1)assert.ok(Number(reordered[0].style.zIndex)>Number(reordered.at(-1).style.zIndex));
 }
 dom.window.close();
});
