import test from 'node:test';import assert from 'node:assert/strict';
import {qglobeDirectory,qglobeFeatures,qglobeBounds,qglobePreview} from '../src/qglobe.js';
const bounds=[152.9,-27.6,153.1,-27.4];
test('QGlobe rejects large areas, oversized and partial results',async()=>{
 assert.throws(()=>qglobeBounds([130,-40,155,-10]),/Zoom/);let calls=0;
 const fetcher=async url=>{calls++;assert.equal(new URL(url).searchParams.get('geometry'),bounds.join(','));return {ok:true,text:async()=>JSON.stringify(calls===1?{count:2}:{type:'FeatureCollection',features:[{}]})};};
 await assert.rejects(qglobeFeatures('Location/Places/FeatureServer/0',bounds,{fetcher}),/incomplete/);
 await assert.rejects(qglobeFeatures('x',bounds,{fetcher:async()=>({ok:true,text:async()=>'{"count":5001}'})}),/5,000/);
});
test('QGlobe imports complete GeoJSON in WGS84',async()=>{
 const fc={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Town'},geometry:{type:'Point',coordinates:[153,-27.5]}}]};
 const result=await qglobeFeatures('Location/Places/FeatureServer/0',bounds,{fetcher:async url=>{const p=new URL(url).searchParams;if(p.get('f')==='geojson'){assert.equal(p.get('outSR'),'4326');assert.equal(p.get('outFields'),'*');}return {ok:true,text:async()=>JSON.stringify(p.has('returnCountOnly')?{count:1}:fc)};}});assert.deepEqual(result,fc);
});
test('QGlobe surfaces errors and requests source-rendered colour previews',async()=>{
 await assert.rejects(qglobeDirectory('',{fetcher:async()=>({ok:true,text:async()=>'{"error":{"message":"Unavailable"}}'})}),/Unavailable/);
 const u=new URL(qglobePreview('Location/Places/MapServer/3',bounds));assert.equal(u.searchParams.get('layers'),'show:3');assert.equal(u.searchParams.get('bboxSR'),'4326');assert.equal(qglobePreview('Location/Places/FeatureServer/3',bounds),null);
});
test('selected public provider is used for queries and source previews',async()=>{
 const root='https://carto.nationalmap.gov/arcgis/rest/services';let queried;
 await qglobeDirectory('',{root,fetcher:async url=>{queried=url;return {ok:true,text:async()=>'{"folders":[],"services":[]}'};}});assert.equal(queried,root+'?f=json');assert.ok(qglobePreview('govunits/MapServer/0',bounds,root).startsWith(root+'/govunits/MapServer/export?'));
});
test('public directory dialog loads and closes without leaking late results',async()=>{
 const {JSDOM}=await import('jsdom');const {openQGlobe}=await import('../src/qglobe.js');const dom=new JSDOM();globalThis.document=dom.window.document;const old=globalThis.fetch;dom.window.HTMLDialogElement.prototype.showModal=function(){};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'));};
 let finish;globalThis.fetch=()=>new Promise(r=>finish=r);
 try{const d=openQGlobe({L:{},getBounds:()=>bounds,valid:()=>{},onResult:()=>{}});d.close();finish({ok:true,text:async()=>'{"folders":["Location"]}'});await new Promise(r=>setTimeout(r,0));assert.equal(document.querySelector('dialog'),null);}finally{globalThis.fetch=old;delete globalThis.document;dom.window.close();}
});
