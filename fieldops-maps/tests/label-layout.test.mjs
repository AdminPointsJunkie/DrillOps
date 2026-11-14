import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {labelPlacement,createLabelIndex,labelsOverlap} from '../src/label-layout.js';
import {styleControls} from '../src/layer-style.js';import {installLabelFieldControls,readLabelFields} from '../src/label-fields.js';
test('placement bounds match Leaflet rounding, offsets, anchor and multiline height',()=>{
 const size={width:61,height:29};const p=labelPlacement({x:100,y:100},size,'right',12,[4,-2],2);assert.deepEqual(p.offset,[12,0]);assert.deepEqual(p.box,{left:114,top:81,right:179,bottom:114});
 const top=labelPlacement({x:100,y:100},size,'top',12,[0,0],0);assert.deepEqual(top.box,{left:69,top:59,right:130,bottom:88});
});
test('spatial index matches exhaustive collision checks across dense and boundary-crossing labels',()=>{
 const boxes=[],index=createLabelIndex(boxes);let state=42;const rand=()=>((state=(state*1664525+1013904223)>>>0)/4294967296);
 for(let i=0;i<2000;i++){const x=rand()*2000-400,y=rand()*1200-200,w=20+rand()*180,h=14+rand()*80,b={left:x,top:y,right:x+w,bottom:y+h};assert.equal(index.overlaps(b),boxes.some(a=>labelsOverlap(a,b)));if(i%3===0)index.add(b);}
});
test('multiple label controls add, persist, remove and clear fields; read-only layers cannot change',()=>{
 const dom=new JSDOM('<div id="layers"></div>'),doc=dom.window.document,root=doc.querySelector('#layers');let editable=true;
 const layer={color:'#147d72',fc:{features:[{properties:{ID:'IB-01',Year:2005,Depth:0},geometry:{type:'Point',coordinates:[0,0]}}]},metadata:{style:{labelField:'ID'}}};
 const draw=()=>{root.innerHTML='<article data-id="test">'+styleControls(layer)+'</article>';};draw();installLabelFieldControls(root,()=>editable);
 root.addEventListener('change',()=>{layer.metadata.style.labelFields=readLabelFields(root);});
 const click=s=>root.querySelector(s).click();const change=(i,value)=>{const select=root.querySelectorAll('[data-action=labelFields]')[i];select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
 try{click('[data-label-add]');change(1,'Year');assert.deepEqual(layer.metadata.style.labelFields,['ID','Year']);draw();assert.deepEqual(readLabelFields(root),['ID','Year']);
 root.querySelectorAll('[data-label-remove]')[0].click();assert.deepEqual(layer.metadata.style.labelFields,['Year']);assert.equal(root.querySelector('[data-action=labelFields]').getAttribute('aria-label'),'Label field 1');
 click('[data-label-remove]');assert.deepEqual(layer.metadata.style.labelFields,[]);editable=false;click('[data-label-add]');assert.equal(root.querySelectorAll('[data-action=labelFields]').length,1);
 }finally{dom.window.close();}
});
