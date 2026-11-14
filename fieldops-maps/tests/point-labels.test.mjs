import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {pointLabels} from '../src/point-labels.js';
import {labelStyle, labelControls,labelFields,labelText} from '../src/label-style.js';
function fixture(){const dom=new JSDOM(),markers=[0,1,2].map(i=>({feature:{properties:{name:'Hole '+i}},getLatLng:()=>i,unbindTooltip(){this.tooltip=null;},bindTooltip(text,options){this.tooltip={text,options,getElement:()=>({getBoundingClientRect:()=>{const left=options.direction==='left'?-50:10;return {left,right:left+40,top:10,bottom:25,width:40,height:15};}})};},getTooltip(){return this.tooltip;}}));return {dom,markers,layer:{_map:{latLngToContainerPoint:()=>({x:100,y:100})},eachLayer:fn=>markers.forEach(fn)},item:{metadata:{style:{labelField:'name'}}},bounds:{contains:()=>true}};}
test('automatic placement tries another side, suppresses collisions and never removes features',()=>{
 const f=fixture();try{assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document),3);assert.equal(f.markers[0].tooltip.options.direction,'right');assert.equal(f.markers[1].tooltip.options.direction,'left');assert.equal(f.markers[2].tooltip.options.direction,'top');f.item.metadata.style.labelPlacement='right';assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document),1);assert.equal(f.markers.length,3);
 f.item.metadata.style.labelAvoidOverlap=false;assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document),3);
 }finally{f.dom.window.close();}
});
test('label settings redraw content, honour minimum zoom and share collision bounds across layers',()=>{
 const f=fixture();try{const style=f.item.metadata.style;Object.assign(style,{labelSize:20,labelColor:'#123456',labelHaloWidth:0,labelMinZoom:12,labelPlacement:'right'});
 assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document,500,{map:{...f.layer._map,getZoom:()=>11}}),0);
 const occupied=[];assert.equal(pointLabels(f.layer,f.item,f.bounds,f.dom.window.document,500,{map:{...f.layer._map,getZoom:()=>12},occupied}),1);
 assert.equal(f.markers[0].tooltip.text.style.fontSize,'20px');assert.equal(f.markers[0].tooltip.text.style.textShadow,'none');
 const other=fixture();try{other.item.metadata.style.labelPlacement='right';assert.equal(pointLabels(other.layer,other.item,other.bounds,other.dom.window.document,500,{occupied}),0);}finally{other.dom.window.close();}
 style.labelSize=15;f.markers[0].feature.properties.name='Changed';pointLabels(f.layer,f.item,f.bounds,f.dom.window.document);assert.equal(f.markers[0].tooltip.text.textContent,'Changed');assert.equal(f.markers[0].tooltip.text.style.fontSize,'15px');
 }finally{f.dom.window.close();}
});
test('label settings have safe defaults and expose all styling controls',()=>{assert.equal(labelStyle({}).avoidOverlap,true);assert.equal(labelStyle({metadata:{style:{labelSize:999,labelColor:'bad'}}}).size,32);const html=labelControls({});for(const name of ['labelSize','labelColor','labelWeight','labelHaloColor','labelHaloWidth','labelPlacement','labelMinZoom','labelAvoidOverlap'])assert.ok(html.includes('data-action="'+name+'"'));});

test('multiple label fields preserve order, formatting and zero, skip blanks, and override legacy fields',()=>{
 const item={metadata:{style:{labelField:'Old',labelFields:['Hole ID','Year','Depth','Blank','Year']}}};
 assert.deepEqual(labelFields(item),['Hole ID','Year','Depth','Blank']);
 assert.equal(labelText(item,{'Hole ID':'IB-01',Year:2005,Depth:0,Blank:null,Old:'ignored'}),'IB-01\n2005\n0');
 item.metadata.style.labelFields=[];assert.equal(labelText(item,{Old:'legacy'}),'');
 delete item.metadata.style.labelFields;assert.equal(labelText(item,{Old:'legacy'}),'legacy');
});
test('multiple labels render as one safe multiline block',()=>{
 const f=fixture();try{f.item.metadata.style.labelFields=['name','Year'];f.markers[0].feature.properties.Year='<b>2005</b>';pointLabels(f.layer,f.item,f.bounds,f.dom.window.document);
 assert.equal(f.markers[0].tooltip.text.textContent,'Hole 0\n<b>2005</b>');assert.equal(f.markers[0].tooltip.text.style.whiteSpace,'pre');assert.equal(f.markers[0].tooltip.text.querySelector('b'),null);
 }finally{f.dom.window.close();}
});

 test('collision checks never measure live DOM and unchanged labels are reused',()=>{
 const f=fixture();try{let binds=0;for(const marker of f.markers){const bind=marker.bindTooltip;marker.bindTooltip=function(...args){binds++;bind.apply(this,args);this.tooltip.getElement=()=>{throw Error('Layout measurement causes map freezes');};};}
 pointLabels(f.layer,f.item,f.bounds,f.dom.window.document);assert.equal(binds,3);
 pointLabels(f.layer,f.item,f.bounds,f.dom.window.document);assert.equal(binds,3,'unchanged labels must not rebuild');
 }finally{f.dom.window.close();}
 });
