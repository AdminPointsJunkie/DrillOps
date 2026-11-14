import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {pointLabels} from '../src/point-labels.js';
import {labelStyle, labelControls} from '../src/label-style.js';
function fixture(){const dom=new JSDOM(),markers=[0,1,2].map(i=>({feature:{properties:{name:'Hole '+i}},getLatLng:()=>i,unbindTooltip(){this.tooltip=null;},bindTooltip(text,options){this.tooltip={text,options,getElement:()=>({getBoundingClientRect:()=>{const left=options.direction==='left'?-50:10;return {left,right:left+40,top:10,bottom:25,width:40,height:15};}})};},getTooltip(){return this.tooltip;}}));return {dom,markers,layer:{eachLayer:fn=>markers.forEach(fn)},item:{metadata:{style:{labelField:'name'}}},bounds:{contains:()=>true}};}
test('automatic placement tries another side, suppresses collisions and never removes features',()=>{
 const f=fixture();try{assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document),2);assert.equal(f.markers[0].tooltip.options.direction,'right');assert.equal(f.markers[1].tooltip.options.direction,'left');assert.equal(f.markers[2].tooltip,null);assert.equal(f.markers.length,3);
 f.item.metadata.style.labelAvoidOverlap=false;assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document),3);
 }finally{f.dom.window.close();}
});
test('label settings redraw content, honour minimum zoom and share collision bounds across layers',()=>{
 const f=fixture();try{const style=f.item.metadata.style;Object.assign(style,{labelSize:20,labelColor:'#123456',labelHaloWidth:0,labelMinZoom:12,labelPlacement:'right'});
 assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document,500,{map:{getZoom:()=>11}}),0);
 const occupied=[];assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document,500,{map:{getZoom:()=>12},occupied}),1);
 assert.equal(f.markers[0].tooltip.text.style.fontSize,'20px');assert.equal(f.markers[0].tooltip.text.style.textShadow,'none');
 const other=fixture();try{assert.equal(pointLabels(other.layer,other.item,other.bounds,other.dom.window.document,500,{occupied}),1);}finally{other.dom.window.close();}
 style.labelSize=15;f.markers[0].feature.properties.name='Changed';pointLabels(f.layer,f.item,f.bounds,f.dom.window.document);assert.equal(f.markers[0].tooltip.text.textContent,'Changed');assert.equal(f.markers[0].tooltip.text.style.fontSize,'15px');
 }finally{f.dom.window.close();}
});
test('label settings have safe defaults and expose all styling controls',()=>{assert.equal(labelStyle({}).avoidOverlap,true);assert.equal(labelStyle({metadata:{style:{labelSize:999,labelColor:'bad'}}}).size,32);const html=labelControls({});for(const name of ['labelSize','labelColor','labelWeight','labelHaloColor','labelHaloWidth','labelPlacement','labelMinZoom','labelAvoidOverlap'])assert.ok(html.includes('data-action="'+name+'"'));});
